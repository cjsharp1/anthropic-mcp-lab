/**
 * protocol-notes.ts — a resource backed by a file on disk.
 *
 * Serves `server/data/protocol-notes.md` at `lab://notes/protocol`.
 * Where `server-info` generates its document, this one reads one, which
 * is the more common case and the one with the sharper lesson attached.
 *
 * ---------------------------------------------------------------------------
 * What it teaches
 * ---------------------------------------------------------------------------
 *
 * That a resource is an address, not a path — and that the gap between
 * those two things is where the security problem lives.
 *
 * `lab://notes/protocol` does not name a file. It names a document this
 * server has decided to publish, and the mapping to a file is private.
 * A client cannot ask for `lab://notes/../../../.env`, because there is
 * no path arithmetic in the URI: the resource is registered at one
 * fixed address and either matches or does not.
 *
 * That is worth stating because it is the opposite of how the chat
 * lab's `read_file` tool works. There, the model supplies a path, and
 * the tool has to defend itself: resolve to a canonical absolute path
 * FIRST, then check it is still inside the sandbox. Reversing that
 * ordering reintroduces traversal, which is why the comment saying so
 * sits in that file to this day.
 *
 * Here there is no path to defend against, because there is no
 * parameter. The file name is a constant in this module. That is not
 * cleverness — it is the design of a fixed resource, and it is the main
 * reason to prefer a fixed resource over a templated one whenever the
 * set of documents is known in advance.
 *
 * The templated resource in this directory, `dice-odds.ts`, does take a
 * parameter, and it carries the matching note about what that costs.
 *
 * ---------------------------------------------------------------------------
 * Why the path is resolved from import.meta.url
 * ---------------------------------------------------------------------------
 *
 * Not from `process.cwd()`, which is wherever the user happened to be
 * standing when they started the server, and not from `__dirname`,
 * which does not exist in an ES module and throws a ReferenceError if
 * you reach for it out of habit.
 *
 * `new URL(".", import.meta.url)` is the ESM equivalent: the directory
 * of THIS file, regardless of how the process was launched. It also
 * survives the build, because the compiled layout under dist/ mirrors
 * the source — which is precisely what `scripts/copy-data.ts` exists to
 * keep true.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineResource } from "../types.js";

/**
 * The data directory, relative to this file rather than to the process.
 *
 * Three levels up: definitions/ → resources/ → server/, then into
 * data/. Brittle to a directory rename, which is a fair criticism — but
 * the failure is a loud ENOENT at the first read, not a quiet wrong
 * answer, and the alternative (searching upward for a marker file) is
 * more machinery than a teaching app should carry.
 */
const DATA_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "data",
);

/**
 * The one file this resource serves.
 *
 * A constant, not a parameter. See the header: this is what makes the
 * resource safe without a sandbox check, because there is no input to
 * sanitise.
 */
const FILE = join(DATA_DIR, "protocol-notes.md");

export const protocolNotes = defineResource({
  name: "protocol-notes",
  title: "MCP in one page",
  uri: "lab://notes/protocol",
  templated: false,
  mimeType: "text/markdown",

  description:
    "A one-page summary of MCP: the three primitives, the two " +
    "transports, the JSON-RPC envelope, and where the model sits " +
    "relative to the server. Written for this lab and served by it.",

  async read() {
    // No try/catch. A missing file here means the build dropped
    // server/data, which is a deployment fault rather than something a
    // client did wrong — and the registration layer turns a throw into
    // a protocol error with the message attached. Catching it to return
    // a friendly string would hide a broken install behind a document
    // that looks like it loaded.
    return readFile(FILE, "utf8");
  },

  exampleWatch:
    "The URI on the request is lab://notes/protocol, and no file path " +
    "appears anywhere in the exchange. The client cannot name a file, " +
    "which is why this resource needs no sandbox check.",
});
