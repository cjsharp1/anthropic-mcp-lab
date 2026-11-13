/**
 * check-env.ts — reports what is in your .env file.
 *
 * Run it with:  npm run check-env
 *
 * There is very little to check here, and that is the finding worth
 * reporting. This project has exactly one setting — the port — and it
 * has a working default, so a correct .env for this app is an absent
 * .env.
 *
 * ---------------------------------------------------------------------------
 * Why this script exists at all, then
 * ---------------------------------------------------------------------------
 *
 * Two reasons, neither of them "validate the port".
 *
 * The first is the API key check it DOESN'T do. The chat lab's version
 * of this file is mostly about ANTHROPIC_API_KEY: is it present, does it
 * start with sk-ant-, is it the reason the app is failing. None of that
 * applies here, because an MCP server does not call a model and has no
 * key to get wrong. Running both scripts and seeing how much shorter
 * this one is answers "which component talks to Anthropic?" faster than
 * a paragraph of explanation would.
 *
 * So if a key HAS found its way into this project's .env, this script
 * says so — not as a failure, but as a sign that something was copied
 * from the chat lab that did not need to be.
 *
 * The second is the port clash, which is the one real misconfiguration
 * available here: setting PORT=3000 and then wondering why the server
 * will not start while the chat lab is running.
 */

import "dotenv/config"; // reads .env and puts its values on process.env

/** The port the server falls back to when nothing is configured. */
const DEFAULT_PORT = 3100;

/** The port the chat lab uses, which this project must not collide with. */
const CHAT_LAB_PORT = 3000;

/**
 * Runs the checks and returns an exit code: 0 for success, 1 for failure.
 *
 * The work lives in a function so that each failure can `return`
 * immediately. TypeScript follows those returns and understands that any
 * code after them has a defined value. (It does not know that
 * `process.exit()` ends the program, so a version written with bare exit
 * calls still complains that a value might be undefined.)
 */
function checkEnvironment(): number {
  // process.env values are always string | undefined — there is no
  // guarantee a variable was set. Strict mode makes us handle the
  // undefined case, which here is the EXPECTED case.
  const port: string | undefined = process.env.PORT;
  const key: string | undefined = process.env.ANTHROPIC_API_KEY;

  console.log("Checking environment...\n");

  // --- The port ------------------------------------------------------------

  if (!port) {
    console.log(`none  PORT is not set. The server will use ${DEFAULT_PORT}.`);
    console.log("      That is the intended setup — there is nothing to fix.");
  } else {
    // Number("") is 0 and Number("abc") is NaN, so both the empty string
    // and a typo land in this branch rather than silently becoming a
    // port the server cannot bind.
    const parsed = Number(port);

    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      console.error(`FAIL  PORT is "${port}", which is not a usable port.`);
      console.error("      Expected a whole number between 1 and 65535.");
      console.error(`      Remove the line to fall back to ${DEFAULT_PORT}.`);
      return 1;
    }

    if (parsed === CHAT_LAB_PORT) {
      // Not fatal on its own — it only breaks when both apps run at
      // once, which is exactly how these two projects are meant to be
      // used. Worth failing on, because the error you get otherwise
      // (EADDRINUSE at startup) does not mention either project.
      console.error(`FAIL  PORT is ${CHAT_LAB_PORT}, which the chat lab uses.`);
      console.error("      These two apps are designed to run side by side:");
      console.error("      the chat lab on 3000, this server on 3100. Sharing");
      console.error("      a port means whichever starts second will not bind.");
      return 1;
    }

    console.log(`PASS  PORT = ${parsed}`);
  }

  // --- The key that should not be here -------------------------------------

  if (key) {
    // Deliberately not a failure. The app ignores it and runs fine; the
    // only thing wrong is that a secret is sitting in a project that has
    // no use for it, which is a small risk for no benefit.
    console.log("");
    console.log("note  ANTHROPIC_API_KEY is set in this project's .env.");
    console.log("      Nothing here reads it. This server exposes tools,");
    console.log("      resources and prompts over MCP; it never calls");
    console.log("      Anthropic, so it has no use for a key.");
    console.log("");
    console.log("      It belongs in the chat lab's .env instead. A secret");
    console.log("      stored where nothing needs it is pure downside —");
    console.log("      remove the line from this project.");
  }

  console.log("\nEnvironment looks good.");
  return 0;
}

// A non-zero exit code is how a shell script or CI job notices a failure.
process.exit(checkEnvironment());
