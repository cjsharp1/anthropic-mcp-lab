/**
 * server-info.ts — a resource describing the server serving it.
 *
 * Returns JSON: the server's name and version, what it has registered,
 * how long it has been running. A fixed resource at `lab://server-info`,
 * with no parameters.
 *
 * ---------------------------------------------------------------------------
 * What it teaches
 * ---------------------------------------------------------------------------
 *
 * The simplest possible resource read, so the mechanics are visible
 * before anything complicates them: one URI, no arguments, a string
 * back. It is the `echo` of the resource primitive.
 *
 * It also makes a point that is easy to miss — the contents are
 * generated at read time, not stored. A resource is not a file. It is
 * an address that produces a document when asked, which is why uptime
 * can appear in a document with no file behind it.
 *
 * ---------------------------------------------------------------------------
 * The import that looks circular and is not
 * ---------------------------------------------------------------------------
 *
 * This file imports the tool registry to count the tools, and the
 * resource registry imports this file. So:
 *
 *   resources/registry → server-info → tools/registry
 *
 * That is a chain, not a cycle: tools/registry never imports anything
 * under resources/. Worth stating explicitly because the shape looks
 * alarming, and because the obvious "fix" — having server-info import
 * the resource registry too, to count resources the same way — WOULD
 * create a real cycle, of exactly the kind documented in
 * tools/types.ts.
 *
 * The resource count is therefore passed in by the registry rather than
 * imported here. See `setResourceCount` below.
 */

import { TOOLS } from "../../tools/registry.js";
import { defineResource } from "../types.js";

/** When this process started, for the uptime figure. */
const STARTED_AT = Date.now();

/**
 * How many resources this server has.
 *
 * Injected by the registry at module load rather than imported, to
 * avoid the import cycle described in the header. A plain mutable
 * module variable is the smallest thing that works here; anything more
 * structured would be ceremony around a single number.
 *
 * It starts at zero and is correct from the moment the registry
 * finishes loading, which is long before any client can read anything.
 */
let resourceCount = 0;

/** Called once by the resource registry, which knows the real figure. */
export function setResourceCount(count: number): void {
  resourceCount = count;
}

export const serverInfo = defineResource({
  name: "server-info",
  title: "Server information",
  uri: "lab://server-info",
  templated: false,
  mimeType: "application/json",

  description:
    "Facts about this MCP server: its name and version, how many " +
    "tools, resources and prompts it exposes, and how long it has " +
    "been running.",

  async read() {
    // Rebuilt on every read. Nothing is cached, which is what makes the
    // uptime figure move and is the cheapest demonstration that a
    // resource is generated rather than stored.
    const info = {
      name: "anthropic-mcp-lab",
      version: "1.0.0",
      description: "A teaching MCP server with a live inspector.",
      registered: {
        tools: TOOLS.length,
        resources: resourceCount,
      },
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      // Stated rather than implied. It is the single most useful fact
      // about this server for anyone trying to work out where the API
      // key lives in an MCP setup, and a reader who finds it here does
      // not have to take the README's word for it.
      callsAnthropic: false,
    };

    // Indented, because a human reads this in the inspector. The two
    // extra bytes per line cost nothing at this size and the
    // alternative is a single unreadable line.
    return JSON.stringify(info, null, 2);
  },

  exampleWatch:
    "resources/read going out and the JSON coming back. Read it twice " +
    "and the uptime has moved — the document is generated when asked, " +
    "not stored.",
});
