/**
 * index.ts — the web server.
 *
 * Start it with:  npm run dev
 *
 * This is the entry point for the HTTP half of the project. It does
 * three jobs:
 *
 *   1. Serves the MCP endpoint   — POST /mcp, the protocol itself
 *   2. Serves the inspector      — the HTML, CSS and JS in public/
 *   3. Feeds the inspector       — GET /api/stream, Server-Sent Events
 *
 * The other entry point, `stdio.ts`, serves the same MCP server down a
 * pipe with none of this around it. Both call into `mcp-server.ts`,
 * and neither knows the other exists.
 *
 * ---------------------------------------------------------------------------
 * The thing that is genuinely different from the chat lab
 * ---------------------------------------------------------------------------
 *
 * The chat lab's server is the only way into that app: the browser
 * talks to it, it talks to Anthropic, and nothing else connects.
 *
 * This server has TWO kinds of client and they are not the same kind
 * of thing. MCP clients — the chat lab, Claude Desktop, a script —
 * connect to `/mcp` and speak JSON-RPC. Inspectors connect to
 * `/api/stream` and watch. One is the subject; the other is the
 * audience.
 *
 * Keeping that straight is most of the design here. The MCP endpoint
 * must behave identically whether or not anyone is watching, which is
 * why the observer is passed in as hooks rather than consulted by the
 * handlers, and why `npm run stdio` works with no inspector at all.
 *
 * ---------------------------------------------------------------------------
 * There is no API key in this file
 * ---------------------------------------------------------------------------
 *
 * Worth noticing by its absence, because the equivalent file in the
 * chat lab is substantially about key handling — where it lives, how
 * it is set, why it never reaches the browser. None of that applies.
 * This server exposes capabilities and waits to be called; the model
 * is somewhere on the far side of whoever connected.
 */

import express from "express";
import "dotenv/config"; // load .env before anything reads process.env
import { z } from "zod";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import type { InspectorStreamEvent, SurfaceSnapshot } from "../shared/types.js";
import {
  observeRequestEnvelope,
  observeResponseEnvelope,
} from "./envelope.js";
import { Observer } from "./observer.js";
import {
  SERVER_NAME,
  SERVER_VERSION,
  makeServerFactory,
} from "./mcp-server.js";
import { PROMPTS } from "./prompts/registry.js";
import { RESOURCES } from "./resources/registry.js";
import { TOOLS } from "./tools/registry.js";

const app = express();

/**
 * The port.
 *
 * 3100 rather than 3000, so this runs beside the chat lab rather than
 * fighting it for a socket. `npm run check-env` fails on PORT=3000 for
 * the same reason.
 */
const PORT = Number(process.env.PORT) || 3100;

/** The one observer. Everything that logs, logs through this. */
const observer = new Observer();

// ---------------------------------------------------------------------------
// The MCP endpoint
// ---------------------------------------------------------------------------

/**
 * The handler that serves the protocol.
 *
 * `createMcpHandler` returns a web-standard `{ fetch, close, notify,
 * bus }` — the shape a Worker or Deno would export directly. Node
 * frameworks need it adapted, which is what `toNodeHandler` does.
 *
 * Note what is NOT here: no `StreamableHTTPServerTransport`, no
 * `server.connect(transport)`. That was the 1.x shape and most
 * tutorials still show it. In 2.x the handler IS the transport, and it
 * builds a server instance per request from the factory.
 *
 * Which is why the factory matters so much. `makeServerFactory(hooks)`
 * returns a function the SDK calls for EVERY request — see the long
 * note in mcp-server.ts about why that must build a fresh instance.
 */
const mcpHandler = createMcpHandler(
  makeServerFactory(observer.hooks("http")),
  {
    // Out-of-band failures: a malformed frame, a rejected request.
    // These do not belong to any one exchange, so they are logged as
    // errors with no direction rather than attached to a row.
    onerror(error) {
      observer.log.error(`MCP handler error: ${error.message}`, {
        message: error.message,
        stack: error.stack,
      }, { transport: "http" });
    },

    // "auto" sends a single JSON body unless the handler emits
    // something before its result, in which case the response upgrades
    // to SSE. That upgrade is exactly what `slow_task` triggers when a
    // client sends a progress token — so leaving this on "auto" is
    // what makes progress notifications work over HTTP at all.
    //
    // Setting it to "json" would silently drop every mid-call
    // notification and keep only the final result, which would make
    // slow_task look broken over HTTP while working over stdio.
    responseMode: "auto",
  },
);

const mcpNodeHandler = toNodeHandler(mcpHandler, {
  onerror(error) {
    observer.log.error(`Adapter error: ${error.message}`, {
      message: error.message,
    }, { transport: "http" });
  },
});

/**
 * Guards against DNS rebinding and hostile origins.
 *
 * A browser on a page you did not write can POST to localhost. Without
 * these, any site you visit could drive this MCP server — call its
 * tools, read its resources — because the browser helpfully attaches
 * no obstacle to a cross-origin POST to a local port.
 *
 * `localhostHostValidation` rejects a request whose Host header is not
 * localhost, which defeats a DNS name that resolves to 127.0.0.1.
 * `localhostOriginValidation` rejects a browser Origin that is not
 * localhost, while letting through requests with no Origin at all —
 * which is every non-browser MCP client.
 *
 * Both are the SDK's own, rather than hand-rolled. The failure mode
 * for a hand-rolled version is subtle (IPv6 bracket forms, port
 * suffixes, a missing header treated as a match) and the consequence
 * is a server anyone's web page can drive.
 */
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

/**
 * POST /mcp — the protocol endpoint.
 *
 * `app.all` rather than `app.post`, because Streamable HTTP uses GET
 * for a standalone event stream and DELETE to end a session, and the
 * handler needs to see all three to answer them correctly. Restricting
 * this to POST produces a server that works until a client tries to
 * open a notification stream.
 *
 * Deliberately mounted BEFORE express.json(). The adapter reads the
 * raw body itself, and a body parser that has already consumed the
 * stream leaves it with nothing to read — the request then hangs or
 * fails on an empty body. If a parser ever has to run first, its
 * result must be passed through as the handler's third argument.
 */
app.all("/mcp", (req, res) => {
  if (!validateHost(req, res)) return;
  if (!validateOrigin(req, res)) return;

  const startedAt = Date.now();

  // Logged before the handler runs, so the row exists even if the
  // request turns out to be malformed. This is the "in" half of the
  // pairing the project's conventions require; the handler hooks
  // supply what happens in between, and the "out" half is logged on
  // the response's own finish event below.
  observer.log.mcp(`${req.method} /mcp`, {
    method: req.method,
    headers: {
      // A deliberately short list. Logging every header would put a
      // session id and an auth token in a browser panel, and the
      // three below are the ones that explain the exchange.
      "content-type": req.headers["content-type"],
      accept: req.headers["accept"],
      "mcp-protocol-version": req.headers["mcp-protocol-version"],
    },
  }, { direction: "in", transport: "http" });

  // --- The JSON-RPC envelope, in both directions --------------------------
  //
  // The rows above and below are the HTTP envelope: method, a few
  // headers, a status code. They say an exchange happened and how long
  // it took, but not what was actually said — and what was said is the
  // protocol, which is the thing this app exists to show. A reader
  // watching "POST /mcp → 200" learns nothing that curl would not tell
  // them.
  //
  // The observer's own header explains why this was missing: the SDK
  // owns the transport and offers no "show me every frame" hook. True,
  // but the frames still pass through this route on their way in and
  // out, and a tap is possible without taking the body away from the
  // adapter that needs it.
  //
  // READING THE REQUEST WITHOUT CONSUMING IT
  //
  // This route is mounted before express.json() precisely because the
  // adapter reads the raw stream itself, and a parser that has already
  // drained it leaves the adapter hanging on an empty body. So this
  // listens rather than reads: a "data" handler copies each chunk as
  // it passes, and the stream still arrives at the adapter intact.
  // Nothing is awaited and nothing is paused.
  observeRequestEnvelope(req, observer);
  observeResponseEnvelope(req, res, observer);

  // The "out" half of the pairing.
  //
  // Hooked to the response's own "finish" event rather than awaiting
  // the handler, because an SSE response does not resolve when the
  // first bytes go out — it stays open for the stream. "finish" fires
  // when the body is actually complete, which is the moment the
  // exchange is over for either response mode.
  //
  // Registered before the handler runs. An exchange that fails
  // synchronously still emits "finish", so the pair is never left
  // half-open; registering afterwards would race a fast response.
  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;

    // The status code is the honest summary of what left. An MCP
    // error is usually a 200 carrying a JSON-RPC error body — the
    // protocol's failures are in-band — so a 200 here does not
    // promise the client got what it asked for, only that the
    // exchange completed.
    observer.log.mcp(
      `${res.statusCode} ${req.method} /mcp`,
      {
        status: res.statusCode,
        content_type: res.getHeader("content-type"),
        note:
          "An MCP error is usually a 200 with a JSON-RPC error in the " +
          "body — the protocol carries its failures in-band. A 200 " +
          "means the exchange completed, not that it succeeded.",
      },
      { direction: "out", transport: "http", elapsedMs },
    );
  });

  // No await and no next(). The adapter owns the response from here;
  // a floating promise is correct, and passing Express's `next` would
  // be ignored anyway — the adapter explicitly discards a function
  // third argument so it is never mistaken for a parsed body.
  void mcpNodeHandler(req, res);
});

// ---------------------------------------------------------------------------
// Everything below here is the inspector, not the protocol
// ---------------------------------------------------------------------------

// No inspector route reads a request body today — both are GETs. The
// parser stays, below /mcp, to mark the ordering rule: mounted above
// it, this line would drain the stream the MCP adapter needs to read
// for itself, and every protocol request would fail. Keeping it here
// means a future route that does post JSON already has its parser,
// in the one position that is safe.
app.use(express.json({ limit: "1mb" }));

app.use(express.static("public"));

/**
 * What the server exposes, assembled once at startup.
 *
 * Built from the three registries rather than asked of the MCP server,
 * because the SDK offers no way to read back what was registered — the
 * reason those registries exist as arrays at all.
 *
 * `z.toJSONSchema` here is the one place this project does the
 * conversion the chat lab does everywhere. The MCP SDK does it
 * internally for `tools/list`; this is for the inspector's own panel,
 * which wants to show a reader the same schema a client would see.
 *
 * Converting matters, and the type system will not insist on it.
 * `SurfaceEntry.inputSchema` is `unknown`, so handing it the raw Zod
 * object compiles cleanly and then serialises to JSON as a tangle of
 * internal Zod machinery — `{"_zod":{"def":{...}}}` — rather than a
 * schema. The panel would render something, and it would be the
 * wrong thing. An explicit conversion is the difference.
 */
function buildSurface(): SurfaceSnapshot {
  return {
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    entries: [
      ...TOOLS.map((tool) => ({
        kind: "tool" as const,
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.inputSchema),
      })),
      ...RESOURCES.map((resource) => ({
        kind: "resource" as const,
        name: resource.uri,
        description: resource.description,
      })),
      ...PROMPTS.map((prompt) => ({
        kind: "prompt" as const,
        name: prompt.name,
        description: prompt.description,
        inputSchema: z.toJSONSchema(prompt.argsSchema),
      })),
    ],
  };
}

/**
 * Built once, here, because nothing can change it.
 *
 * The registries are fixed at import time, so the answer is the same
 * on the first request and the ten-thousandth. Both routes below serve
 * this same object.
 */
const surface = buildSurface();

/**
 * GET /api/surface — what the server currently offers.
 *
 * Fetched once when the inspector loads. State rather than history:
 * the event stream says what has happened, this says what is true.
 */
app.get("/api/surface", (_req, res) => {
  res.json(surface);
});

/**
 * GET /api/stream — the inspector's event feed.
 *
 * Server-Sent Events, the same mechanism the chat lab uses for its
 * activity log, and for the same reason: the server needs to push and
 * the browser only needs to listen. A WebSocket would be a
 * bidirectional channel where one direction is never used.
 */
app.get("/api/stream", (req, res) => {
  // These three headers are what make the response a stream rather
  // than a document. Without them the browser buffers the whole body
  // and hands it over at the end, which would make the streaming
  // pointless.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Node buffers small writes for efficiency, which is exactly wrong
  // here: a buffered event arrives late and the log stops being live.
  res.flushHeaders();

  /** Writes one event to this connection in SSE format. */
  const send = (event: InspectorStreamEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    //                                        ^^^^
    //        Two newlines: one ends the data line, one ends the message.
  };

  // What the server offers, before any history, so the panel can draw
  // itself immediately rather than appearing empty for a moment.
  send({ type: "surface", surface });

  // Then the backlog. A browser opened after a few tool calls should
  // see them — an empty panel reads as "nothing happened" rather than
  // "you were not watching".
  for (const event of observer.getRecent()) {
    send({ type: "event", event });
  }

  const unsubscribe = observer.subscribe((event) => {
    send({ type: "event", event });
  });

  // Removal matters as much as subscription. Without this, every
  // closed tab leaves a sink that writes to a dead socket forever.
  req.on("close", unsubscribe);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  // console.log is correct HERE and a bug in stdio.ts. There, stdout
  // IS the protocol connection and a stray line corrupts it. Here
  // stdout is a terminal nobody is parsing.
  console.log(
    `\n${SERVER_NAME} ${SERVER_VERSION}\n` +
      `  inspector    http://localhost:${PORT}\n` +
      `  MCP endpoint http://localhost:${PORT}/mcp\n` +
      `\n  ${TOOLS.length} tools, ${RESOURCES.length} resources, ` +
      `${PROMPTS.length} prompts. No API key — this server never calls ` +
      `Anthropic.\n`,
  );

  observer.log.info(`Listening on port ${PORT}`, {
    tools: TOOLS.length,
    resources: RESOURCES.length,
    prompts: PROMPTS.length,
  });
});
