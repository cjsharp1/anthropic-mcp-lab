/**
 * envelope.ts — taps the JSON-RPC frames passing through /mcp.
 *
 * The Express route logs the HTTP envelope: a method, three headers, a
 * status code, an elapsed time. The handler hooks log what each
 * handler did with its arguments. Between those two layers sat a gap
 * exactly the width of the protocol — the
 * {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{...}} that is
 * the actual subject of an app whose pitch is "the actual envelope,
 * not a summary".
 *
 * ---------------------------------------------------------------------------
 * Why this is a tap and not a parse
 * ---------------------------------------------------------------------------
 *
 * /mcp is deliberately mounted BEFORE express.json(), because the MCP
 * adapter reads the raw request stream itself. A body parser that has
 * already drained the stream leaves the adapter with nothing to read,
 * and the request hangs.
 *
 * So nothing here consumes anything. The request side attaches a
 * `data` listener, which copies each chunk as it flows past on its way
 * to the adapter; attaching a listener does not take the data away
 * from any other consumer. The response side wraps `write` and `end`,
 * passing every argument straight through to the real method and
 * keeping a copy.
 *
 * The consequence to respect: if this file ever calls req.read(),
 * awaits the stream, or returns anything other than what the wrapped
 * method returned, the endpoint breaks in a way that looks like a
 * network fault rather than a logging bug.
 *
 * ---------------------------------------------------------------------------
 * Why the response needs unwrapping and the request does not
 * ---------------------------------------------------------------------------
 *
 * A request body is JSON. A response may be JSON, or it may be
 * Server-Sent Events — the adapter picks per request, which is what
 * Streamable HTTP means. An SSE body looks like
 *
 *     event: message
 *     data: {"result":{...},"jsonrpc":"2.0","id":1}
 *
 * so the frames have to be pulled out of the `data:` lines. That is
 * the one piece of real parsing here, and it is why a response can
 * produce several envelope rows where a request produces one.
 */

import type { Request, Response } from "express";
import type { Observer } from "./observer.js";

/**
 * How much of a body to keep, in bytes.
 *
 * A tool result can be large, and an inspector that buffers an
 * unbounded response for every request is a memory leak wearing a
 * teaching hat. Past this the capture stops and the row says it was
 * truncated — which is still more useful than no row.
 */
const MAX_CAPTURE = 256 * 1024;

/** A parsed JSON-RPC frame, as far as this file cares about it. */
interface Frame {
  jsonrpc?: unknown;
  method?: unknown;
  id?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

/**
 * Pulls an id out of a frame, keeping its type.
 *
 * Returns undefined for anything that is not a string or a number,
 * which includes the null id a response to an unparseable request
 * carries. shared/types.ts is explicit that an id of 1 and an id of
 * "1" are different ids and must not be normalised to one another.
 */
function idOf(frame: Frame): string | number | undefined {
  return typeof frame.id === "string" || typeof frame.id === "number"
    ? frame.id
    : undefined;
}

/** Describes a frame in a few words, for the row label. */
function describe(frame: Frame): string {
  if (typeof frame.method === "string") {
    // A request names its method; a notification is a request with no
    // id, and the distinction is worth showing because it decides
    // whether a response is coming.
    return frame.id === undefined
      ? `notification ${frame.method}`
      : frame.method;
  }

  if (frame.error !== undefined) return "error response";
  if (frame.result !== undefined) return "result";
  return "frame";
}

/**
 * Splits a captured body into JSON-RPC frames.
 *
 * Handles the three shapes that can arrive: a bare JSON object, a JSON
 * array (a batch, which the spec allows), and an SSE stream whose
 * `data:` lines each carry one frame.
 *
 * Returns an empty array rather than throwing on anything it cannot
 * parse. A malformed body is a thing to log, not a reason to take the
 * endpoint down — and the HTTP rows on either side still show the
 * exchange happened.
 */
function framesIn(body: string): Frame[] {
  const text = body.trim();
  if (text === "") return [];

  // SSE: pull the payload out of each data: line.
  if (text.startsWith("event:") || text.startsWith("data:")) {
    const frames: Frame[] = [];

    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;

      try {
        frames.push(JSON.parse(payload) as Frame);
      } catch {
        // One unparseable frame does not invalidate the others.
      }
    }

    return frames;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Frame[]) : [parsed as Frame];
  } catch {
    return [];
  }
}

/**
 * Logs one row per frame.
 *
 * `direction` is the protocol view, not the HTTP one: a frame arriving
 * from a client is "in" whether it came by POST body or down an event
 * stream.
 */
function logFrames(
  observer: Observer,
  frames: Frame[],
  direction: "in" | "out",
  truncated: boolean,
): void {
  for (const frame of frames) {
    const method = typeof frame.method === "string" ? frame.method : undefined;
    const id = idOf(frame);

    // An error response is a failure the protocol carries in-band, so
    // it is logged at error level even though the HTTP status was 200.
    // That pairing — 200 OK, error inside — is one of the things this
    // panel exists to make visible.
    const isError = frame.error !== undefined;

    const detail: Record<string, unknown> = { frame };
    if (truncated) {
      detail["note"] =
        `The captured body hit the ${MAX_CAPTURE}-byte inspector limit ` +
        `and was cut short. What is shown is the start of it.`;
    }

    const label = `${direction === "in" ? "→" : "←"} ${describe(frame)}`;

    if (isError) {
      observer.log.error(label, detail, {
        direction,
        transport: "http",
        ...(method !== undefined ? { method } : {}),
        ...(id !== undefined ? { id } : {}),
      });
      continue;
    }

    observer.log.mcp(label, detail, {
      direction,
      transport: "http",
      ...(method !== undefined ? { method } : {}),
      ...(id !== undefined ? { id } : {}),
      because: "the JSON-RPC envelope on the wire",
    });
  }
}

/**
 * Copies the request body as it streams past, and logs its frames.
 *
 * Attaches listeners only. The adapter still receives the stream in
 * full — see the header for why that is the whole point.
 */
export function observeRequestEnvelope(req: Request, observer: Observer): void {
  // GET opens an event stream and DELETE ends a session; neither
  // carries a JSON-RPC body worth waiting for.
  if (req.method !== "POST") return;

  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;

  req.on("data", (chunk: Buffer | string) => {
    if (truncated) return;

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_CAPTURE) {
      truncated = true;
      return;
    }

    chunks.push(buffer);
  });

  req.on("end", () => {
    const frames = framesIn(Buffer.concat(chunks).toString("utf8"));
    logFrames(observer, frames, "in", truncated);
  });
}

/**
 * Copies the response body as it is written, and logs its frames.
 *
 * `write` and `end` are replaced with wrappers that record their
 * payload and then call the original with the arguments untouched.
 * The return value is the original one, because Express and the
 * adapter both rely on write reporting backpressure truthfully.
 */
export function observeResponseEnvelope(
  req: Request,
  res: Response,
  observer: Observer,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;

  const capture = (chunk: unknown): void => {
    if (truncated || chunk === undefined || chunk === null) return;

    // Uint8Array, not just Buffer.
    //
    // This is the trap in this file, and it fails silently. The MCP
    // adapter builds a web-standard Response and pipes its body to
    // res.write, and a web ReadableStream yields Uint8Array — which
    // is NOT a Buffer. Buffer.isBuffer() returns false for it, so an
    // earlier version of this guard dropped every chunk of every
    // response and logged a confident "0 bytes" while 3 kB of
    // JSON-RPC went past untouched.
    //
    // Buffer.from() copies a Uint8Array rather than wrapping it,
    // which is what we want: the adapter may reuse the underlying
    // ArrayBuffer for the next chunk.
    const buffer =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : null;

    if (buffer === null) return;
    size += buffer.length;

    if (size > MAX_CAPTURE) {
      truncated = true;
      return;
    }

    chunks.push(buffer);
  };

  // Bound to the real methods before replacing them, so the wrappers
  // call the originals rather than recursing into themselves.
  const realWrite = res.write.bind(res);
  const realEnd = res.end.bind(res);

  // The signatures are deliberately loose. write and end are both
  // heavily overloaded — (chunk), (chunk, encoding), (chunk, cb),
  // (chunk, encoding, cb) — and a wrapper naming one overload would
  // drop arguments from the others. Spreading preserves all of them,
  // and the cast is what lets the loose wrapper sit in a typed slot.
  res.write = function (
    this: Response,
    ...args: Parameters<Response["write"]>
  ): boolean {
    capture(args[0]);
    return realWrite(...(args as Parameters<typeof realWrite>));
  } as Response["write"];

  res.end = function (
    this: Response,
    ...args: Parameters<Response["end"]>
  ): Response {
    // end() may carry a final chunk, or none at all when the body was
    // written already. A function in that slot is a callback, not data.
    if (typeof args[0] !== "function") capture(args[0]);
    realEnd(...(args as Parameters<typeof realEnd>));
    return this;
  } as Response["end"];

  res.on("finish", () => {
    const frames = framesIn(Buffer.concat(chunks).toString("utf8"));

    // A GET that opened an event stream and carried no frames is not
    // worth a row: the HTTP pair already says the stream opened and
    // closed.
    if (frames.length === 0 && req.method === "GET") return;

    logFrames(observer, frames, "out", truncated);
  });
}
