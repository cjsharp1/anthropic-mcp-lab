/**
 * inspect-request.ts — a tool that reports the call that invoked it.
 *
 * Returns the JSON-RPC id, the method, and whatever metadata the client
 * attached. The arguments are almost beside the point: what this tool
 * is for is showing what ARRIVES alongside them.
 *
 * ---------------------------------------------------------------------------
 * What it teaches
 * ---------------------------------------------------------------------------
 *
 * That a tool call is a protocol message, not a function call.
 *
 * Every other tool in this registry reads its arguments and ignores the
 * envelope they came in. That is normal and correct — and it means the
 * envelope stays invisible, which is a problem in a lab whose whole
 * subject is the protocol. This tool makes the second argument the
 * subject.
 *
 * Three things show up that people are routinely surprised by:
 *
 *   1. There is an ID, and the response has to carry it back. MCP is
 *      JSON-RPC: requests and responses are matched by id, and several
 *      can be in flight at once. The Anthropic Messages API has no
 *      equivalent, because one HTTP request carries one exchange.
 *
 *   2. There is a METHOD, and it is a string the client chose. "Which
 *      tool" is `params.name`; "tools/call" is the method. Two levels
 *      of naming where the Messages API has one.
 *
 *   3. There is METADATA, sometimes. A progress token arrives here when
 *      the client sent one, which is how `slow_task` knows anyone is
 *      listening. Clients also use `_meta` for their own purposes, and
 *      what turns up differs between them.
 *
 * ---------------------------------------------------------------------------
 * Why it also reports the transport
 * ---------------------------------------------------------------------------
 *
 * It does not, and the reason is worth recording rather than leaving as
 * an apparent omission.
 *
 * The handler genuinely cannot tell. `ServerContext` exposes an `http`
 * property when an HTTP transport is in use, but that is a detail of
 * how this server is wired rather than something the protocol defines —
 * and relying on it here would teach exactly the wrong lesson. The
 * whole point of two transports is that a tool handler is identical
 * under both. A tool that can distinguish them is a tool that could
 * behave differently under them.
 *
 * The transport is recorded by the observer instead, one layer out,
 * where the wiring is known. Same fact, logged by the component that
 * legitimately has it.
 */

import { z } from "zod";
import { defineTool } from "../types.js";

export const inspectRequest = defineTool({
  name: "inspect_request",
  title: "Inspect this request",

  description:
    "Reports the protocol-level details of the call that invoked it: " +
    "the JSON-RPC request id, the method name, and any metadata the " +
    "client attached. Use it to see what an MCP request carries " +
    "besides its arguments. It reports only this request — it cannot " +
    "see earlier calls, other clients, or anything about the server's " +
    "configuration.",

  inputSchema: z.object({
    // An argument it does not need, which exists so there is something
    // to echo back beside the envelope. Seeing your own string next to
    // an id you did not send is what makes the distinction between
    // "the arguments" and "the request" land.
    note: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Optional text to include in the report, so you can see your " +
          "own arguments beside the protocol metadata.",
      ),
  }),

  async run({ note }, ctx) {
    const lines = [
      `request id:  ${JSON.stringify(ctx.id)}`,
      `method:      ${ctx.method}`,
    ];

    // JSON.stringify on the id rather than template interpolation,
    // because the spec allows a string OR a number and the difference
    // is invisible otherwise. An id of 1 and an id of "1" both
    // interpolate to 1; quoted, they read as 1 and "1". That
    // distinction is the kind of thing this tool exists to surface.

    if (ctx.meta && Object.keys(ctx.meta).length > 0) {
      lines.push(`_meta:       ${JSON.stringify(ctx.meta)}`);
    } else {
      // Said explicitly rather than omitted. An absent line reads as a
      // tool that forgot to check; "none sent" is a finding, and it is
      // the usual one — most clients send no metadata unless they want
      // progress.
      lines.push("_meta:       none sent");
    }

    // Whether the caller has given up already. Almost always false, and
    // worth printing anyway: it is the only hint in the whole result
    // that a handler is expected to care about cancellation at all.
    lines.push(`cancelled:   ${ctx.signal.aborted}`);

    if (note !== undefined) {
      lines.push(`your note:   ${note}`);
    }

    return lines.join("\n");
  },

  examplePrompt:
    'Call inspect_request with the note "testing" and tell me what it returns.',

  exampleWatch:
    "The request id in the result, and the same id on the response row " +
    "in the log. That pairing is JSON-RPC, and it is what lets several " +
    "calls be in flight at once.",
});
