/**
 * try-stdio.ts — connects to this server over stdio and exercises it.
 *
 * Run it with:  npm run try-stdio
 *
 * Launches `server/stdio.ts` as a child process, performs the
 * handshake, and walks through all three primitives: list and call a
 * tool, list and read a resource, list and fetch a prompt. Prints what
 * happened at each step.
 *
 * ---------------------------------------------------------------------------
 * Why this exists when the MCP Inspector already works
 * ---------------------------------------------------------------------------
 *
 * The Inspector is better for poking at one method. This is better for
 * three things it cannot do:
 *
 *   1. PROGRESS. The Inspector CLI sends no progress token, so
 *      `slow_task`'s notifications go nowhere and the feature looks
 *      broken. This script passes `onprogress`, which is what causes
 *      the SDK to attach a token — and the notifications appear. That
 *      difference is the single clearest demonstration of trap 1 in
 *      slow-task.ts.
 *
 *   2. A WHOLE SESSION. One handshake, several calls, one teardown —
 *      which is what a real client does, and what shows that the
 *      connection is stateful even though each exchange is not.
 *
 *   3. A COMPARISON. `try-http.ts` is this same script over the other
 *      transport. Running both and diffing the output is the point:
 *      the two are near-identical, and the parts that differ are
 *      exactly the parts that are about the transport rather than the
 *      protocol.
 *
 * ---------------------------------------------------------------------------
 * What to notice
 * ---------------------------------------------------------------------------
 *
 * There is no URL here and no port. `StdioClientTransport` takes a
 * COMMAND — this client starts the server itself, owns the process,
 * and kills it on close. Nothing is listening before this script runs
 * and nothing is listening after it exits.
 *
 * That is the whole of what "stdio transport" means, and it is why a
 * stdio server cannot be shared between two clients: each one would
 * launch its own copy.
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSession } from "./session.js";

/** The project root, derived from this file rather than from cwd. */
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

async function main(): Promise<void> {
  // The client half of the handshake. The name and version here are
  // what the SERVER sees — `inspect_request` would report them, and a
  // server is free to behave differently per client. This one does not.
  const client = new Client(
    { name: "try-stdio", version: "1.0.0" },
    // "auto" probes with server/discover and falls back to the 2025-era
    // initialize handshake if the server does not answer it. Worth
    // leaving on: it is what lets one client talk to servers of both
    // eras, and it is the reason the server factory gets called twice.
    { versionNegotiation: { mode: "auto" } },
  );

  // No URL. A command.
  //
  // tsx rather than node, so this runs against server/stdio.ts
  // directly without needing a build first — the same reason `npm run
  // dev` uses tsx. Pointing it at dist/server/stdio.js would work and
  // would make the script fail confusingly on a clean checkout.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
           join(ROOT, "server", "stdio.ts")],

    // The server writes diagnostics to stderr — see the rule at the
    // top of server/stdio.ts. "inherit" passes them through to this
    // terminal, which is how the server's own startup line appears in
    // this script's output. Set it to "ignore" and the server goes
    // quiet; set it to "pipe" and you have to drain it yourself or the
    // child eventually blocks on a full buffer.
    stderr: "inherit",
  });

  console.log("Starting the server as a child process…\n");

  await client.connect(transport);

  try {
    await runSession(client, "stdio");
  } finally {
    // Closes the transport, which kills the child process. Without
    // this the script finishes and the server stays running, orphaned,
    // until the shell cleans it up.
    await client.close();
    console.log("\nClosed. The child process is gone with it.");
  }
}

await main();
