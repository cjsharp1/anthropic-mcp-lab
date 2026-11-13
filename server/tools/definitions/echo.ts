/**
 * echo.ts — the simplest possible tool, and the first one to try.
 *
 * It takes a string and gives it back. That is the whole behaviour, and
 * the uselessness is the point: when a round trip fails, you want one
 * tool in the registry where nothing but the protocol can be at fault.
 *
 * ---------------------------------------------------------------------------
 * What it teaches
 * ---------------------------------------------------------------------------
 *
 * The shape of an MCP exchange, with nothing else in the frame. Call it
 * and the inspector shows four rows: the request arriving, the handler
 * running, the handler returning, the response going out. Every other
 * tool produces those same four rows with real work in the middle, so
 * this is the baseline that makes the others readable.
 *
 * It is also the tool to reach for when something is wrong. A failing
 * echo means the transport, the handshake or the registration is
 * broken. A working echo and a failing anything-else means the problem
 * is in that tool.
 *
 * ---------------------------------------------------------------------------
 * Why it takes an optional second argument
 * ---------------------------------------------------------------------------
 *
 * `times` is not there to be useful. It is there so the schema has two
 * fields of different types, one required and one not, which makes the
 * JSON Schema in `tools/list` worth actually looking at — a single
 * required string produces a schema so trivial that nobody reads it and
 * nobody learns what the SDK generated.
 *
 * The bound on it teaches something sharper, documented on the field.
 */

import { z } from "zod";
import { defineTool } from "../types.js";

export const echo = defineTool({
  name: "echo",
  title: "Echo",

  description:
    "Repeats text back exactly as given. Use it to confirm the " +
    "connection to this server is working, or to see what a tool call " +
    "looks like on the wire. It performs no useful work: it cannot " +
    "look anything up, calculate, or transform the text beyond " +
    "repeating it.",

  inputSchema: z.object({
    message: z.string().describe("The text to repeat back."),

    // The bound here is enforced, and that is worth stating because the
    // chat lab's equivalent is not.
    //
    // There, numeric bounds have to be STRIPPED from the schema before
    // it reaches the Anthropic API — strict mode rejects "minimum" and
    // "maximum" outright, so the tool loop re-validates with Zod itself
    // to get them back. Two validation steps, because the protocol
    // only guarantees the shape of arguments and not their values.
    //
    // MCP has no such restriction. The SDK publishes this schema whole,
    // bounds included, and validates against it before the handler is
    // reached. `times: 50` is rejected by the protocol layer and `run`
    // below never sees it.
    times: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe("How many times to repeat it. 1 to 5; defaults to 1."),
  }),

  async run({ message, times }) {
    // No validation here, deliberately. By this point the SDK has
    // checked the arguments against the schema above, so `message` is a
    // string and `times` is an integer between 1 and 5. Re-checking
    // would imply a doubt the protocol has already settled.
    return Array.from({ length: times }, () => message).join("\n");
  },

  examplePrompt: 'Use the echo tool to repeat "hello" three times.',

  exampleWatch:
    "Four rows for one call: tools/call arriving, the handler running, " +
    "the handler returning, the response leaving. Every other tool " +
    "makes the same four.",
});
