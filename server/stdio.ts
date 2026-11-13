/**
 * stdio.ts — serves this MCP server over standard input and output.
 *
 * Run it with:  npm run stdio
 *
 * This is the entry point a desktop client uses. There is no port, no
 * URL and no listening socket: the client LAUNCHES this process and
 * talks to it down the pipes it was born with. One client, one process,
 * for as long as the client keeps it alive.
 *
 * To connect it to Claude Desktop, point a server entry at the built
 * file (`node dist/server/stdio.js`). To poke at it without a desktop
 * client:
 *
 *   npx @modelcontextprotocol/inspector --cli node dist/server/stdio.js \
 *     --protocol-era modern --method tools/list
 *
 * ---------------------------------------------------------------------------
 * The rule that governs this entire file
 * ---------------------------------------------------------------------------
 *
 *   NOTHING MAY EVER BE WRITTEN TO STDOUT EXCEPT PROTOCOL MESSAGES.
 *
 * stdout IS the connection. A single stray `console.log` — a debug
 * line, a startup banner, a dependency announcing itself — lands in the
 * middle of the JSON-RPC stream and corrupts it. The client sees a
 * parse error, or worse, silently drops a message it could not read.
 *
 * This is the most common way a working stdio server gets broken, and
 * the symptom is maddening: the server is fine, the tools are fine, and
 * the client reports something unhelpful about malformed JSON. The
 * cause is a print statement somebody added while debugging.
 *
 * So: diagnostics go to stderr, which the client collects separately
 * and which is safe to write to freely. `console.error` is correct
 * here. `console.log` is a bug.
 *
 * ---------------------------------------------------------------------------
 * Why serveStdio gets a function rather than a server
 * ---------------------------------------------------------------------------
 *
 * `serveStdio(createServer)` — note no parentheses after createServer.
 * The function itself is handed over, and the SDK decides when to call
 * it.
 *
 * It calls it more than once. A modern client opens with a
 * `server/discover` probe; if the client turns out to be 2025-era and
 * falls back to `initialize`, the instance built for the probe is
 * thrown away and a fresh one is built for the real connection.
 *
 * Passing `createServer()` instead — an instance — compiles, runs, and
 * serves a single client correctly. It breaks under version
 * negotiation, which is exactly the situation nobody tests locally.
 * See the long note in mcp-server.ts.
 *
 * The older spelling, `server.connect(new StdioServerTransport())`,
 * also still compiles. A server wired that way only ever serves
 * 2025-era clients, silently.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { SERVER_NAME, SERVER_VERSION, createServer } from "./mcp-server.js";

/**
 * Starts the connection.
 *
 * `serveStdio` returns a handle whose `close()` tears down the pinned
 * instance and the transport. Kept so the signal handlers below can
 * shut down cleanly rather than letting the process die mid-message.
 */
const handle = serveStdio(createServer, {
  // Out-of-band failures — a malformed frame, a transport error. These
  // do not belong to any one request, so there is nowhere to return
  // them to; stderr is the only honest destination.
  onerror(error) {
    console.error(`[${SERVER_NAME}] ${error.message}`);
  },
});

// stderr, not stdout. See the rule above. This line is genuinely
// useful — it is how you tell a server that started from one that
// failed before it got here — and writing it to stdout would break
// every client that connected.
console.error(
  `[${SERVER_NAME} ${SERVER_VERSION}] serving over stdio. ` +
    "Protocol messages on stdout; diagnostics here on stderr.",
);

/**
 * Shuts down on a signal.
 *
 * A client that goes away usually closes the pipes, which ends the
 * process on its own. These handlers cover the other case — someone
 * pressing Ctrl-C in a terminal they started the server in — so the
 * connection closes properly instead of the process vanishing partway
 * through writing a message.
 *
 * `void` on the call because a signal handler cannot be async, and the
 * floating promise is deliberate rather than overlooked.
 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handle.close().finally(() => {
      process.exit(0);
    });
  });
}
