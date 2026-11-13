/**
 * try-http.ts — connects to this server over HTTP and exercises it.
 *
 * Run it with:  npm run try-http   (with `npm run dev` already running)
 *
 * The companion to `try-stdio.ts`, and the pair is the point. Both
 * scripts call the SAME function — `runSession` in session.ts — with
 * the only difference being which transport was connected first.
 *
 * Run them side by side:
 *
 *     npm run try-stdio
 *     npm run try-http
 *
 * The output is the same, line for line, apart from the heading. Same
 * tools, same dice, same resources, same three-message prompt. That
 * is the demonstration: the transport is not the protocol.
 *
 * ---------------------------------------------------------------------------
 * What differs, and it is only the first twelve lines
 * ---------------------------------------------------------------------------
 *
 * Against stdio this script LAUNCHES a server and owns its lifetime.
 * Here it CONNECTS to one that is already running and outlives it.
 * That difference is entirely contained in the transport constructor
 * below — a URL instead of a command — and everything after
 * `client.connect(...)` is identical.
 *
 * The consequences are worth noticing even though the code does not
 * show them:
 *
 *   - This server can serve several clients at once. A stdio server
 *     serves exactly one, because each client spawns its own process.
 *   - You must start the server yourself. A stdio client cannot fail
 *     to find its server; an HTTP one can, which is why the error
 *     handling at the bottom says what to do about it.
 *   - Someone can be watching. The inspector at http://localhost:3100
 *     shows this session's traffic as it happens, which is the whole
 *     reason the HTTP transport exists in this project.
 *
 * Run this with the inspector open in a browser. Watching the rows
 * appear as the script prints its own output is the clearest view of
 * both sides of one exchange that this lab offers.
 */

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { runSession } from "./session.js";

/** Where the server is. Matches the default in server/index.ts. */
const PORT = Number(process.env.PORT) || 3100;
const ENDPOINT = `http://localhost:${PORT}/mcp`;

async function main(): Promise<void> {
  const client = new Client(
    { name: "try-http", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );

  // A URL, where the stdio version takes a command. This is the whole
  // difference between the two scripts.
  //
  // `new URL(...)` rather than a string: the transport wants a URL
  // object, and constructing it here means a malformed endpoint fails
  // with a clear parse error rather than a confusing connection error
  // later.
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT));

  console.log(`Connecting to ${ENDPOINT} …\n`);

  try {
    await client.connect(transport);
  } catch (error: unknown) {
    // The failure stdio cannot have. A stdio client spawns its own
    // server and so can always reach it; an HTTP client is talking to
    // something it did not start and might not be there.
    //
    // Worth catching specifically, because the raw error — a bare
    // ECONNREFUSED from somewhere inside fetch — does not mention
    // this project, this port, or the command that would fix it.
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Could not connect: ${message}\n`);
    console.error("Is the server running? Start it with:\n");
    console.error("    npm run dev\n");
    console.error(
      "Unlike the stdio script, this one does not start a server —\n" +
        "it connects to one that is already listening.",
    );

    process.exitCode = 1;
    return;
  }

  try {
    await runSession(client, "http");

    console.log(
      "\nIf the inspector is open at " +
        `http://localhost:${PORT} , every exchange above is in its log.`,
    );
  } finally {
    // Closes this client's connection. The SERVER keeps running —
    // the opposite of the stdio script, where closing the transport
    // kills the process it spawned.
    await client.close();
    console.log("Disconnected. The server is still running.");
  }
}

await main();
