/**
 * registry.ts — the list of every resource this server exposes.
 *
 * Same three-level layout as the tools directory, for the same reason:
 * types.ts imports nothing, definitions/ import types.ts, and this file
 * imports the definitions. Nothing imports upward, so there is no cycle
 * to resolve at load time.
 *
 * ---------------------------------------------------------------------------
 * The one piece of wiring here that is not just a list
 * ---------------------------------------------------------------------------
 *
 * `server-info` reports how many resources this server has, and it
 * cannot import this file to find out — that WOULD be a cycle, since
 * this file imports it. So the number is pushed the other way: the
 * definitions are listed first, then `setResourceCount` is called with
 * the length.
 *
 * It runs at module load, which is what makes it safe. By the time
 * anything can call `read()`, this module has finished evaluating and
 * the count is set. A reader who sees a mutable module variable and
 * worries about ordering is asking the right question; the answer is
 * that the only write happens before any read can.
 *
 * The alternative — passing a count into every resource's read() — puts
 * a parameter on every handler to serve one of them. This is the
 * smaller cost, and it is confined to two files that both explain it.
 */

import { diceOdds } from "./definitions/dice-odds.js";
import { protocolNotes } from "./definitions/protocol-notes.js";
import { serverInfo, setResourceCount } from "./definitions/server-info.js";
import type { McpLabResource } from "./types.js";

// Re-exported so the rest of the server can import everything about
// resources from one place.
export type { McpLabResource, UriParams } from "./types.js";
export { defineResource } from "./types.js";

/**
 * Every resource this server offers, in the order the inspector lists
 * them.
 *
 * Ordered by what they demonstrate rather than alphabetically: a
 * generated document first, then one backed by a file, then a
 * templated family. Each adds exactly one idea to the last.
 */
export const RESOURCES: McpLabResource[] = [
  serverInfo,
  protocolNotes,
  diceOdds,
];

// See the header. This is the write that closes the loop server-info
// cannot close itself, and it happens here, at load, before any client
// exists to read anything.
setResourceCount(RESOURCES.length);

/**
 * Throws if two resources share a URI.
 *
 * Called at startup, alongside the equivalent check for tools. A
 * duplicate URI is a resource that can never be read, because whichever
 * registration happens second wins — the same silent-shadowing failure
 * the tool check exists to prevent.
 *
 * Checks the URI rather than the name, because the URI is the address a
 * client actually reads from. Two resources could share a display name
 * harmlessly; two at the same address could not.
 *
 * It does NOT check whether a templated URI overlaps a fixed one —
 * `lab://dice/{sides}` and a hypothetical `lab://dice/20` would both
 * match a read of the latter, and which wins is the SDK's business.
 * Detecting that properly means expanding templates against each other,
 * which is more machinery than this lab needs. Worth knowing the gap is
 * there rather than assuming this check covers it.
 */
export function assertUniqueResourceUris(): void {
  const seen = new Set<string>();

  for (const resource of RESOURCES) {
    if (seen.has(resource.uri)) {
      throw new Error(
        `Two resources are registered at "${resource.uri}". ` +
          "Resource URIs must be unique.",
      );
    }
    seen.add(resource.uri);
  }
}
