/**
 * types.ts — what a tool is, in this project.
 *
 * Deliberately imports nothing but Zod's types. Every tool file imports
 * from here, and the registry imports every tool file; if the interface
 * lived in the registry, those two imports would form a cycle.
 *
 * A cycle like that does not always fail. Node resolves it when the thing
 * being used is a hoisted function declaration, so in the chat lab one
 * tool worked fine — and the second one crashed at startup with "Cannot
 * access 'currentTime' before initialization". That is the characteristic
 * shape of this bug: it looks like it works until something unrelated
 * changes the order. The same three-level layout is used here for the
 * same reason.
 *
 * ---------------------------------------------------------------------------
 * Why this interface exists at all, when MCP has its own
 * ---------------------------------------------------------------------------
 *
 * A fair question, since `server.registerTool(name, config, handler)`
 * already takes everything needed to define a tool. We could call it
 * directly in six places and delete this file.
 *
 * Three things are wanted that the SDK's signature does not carry:
 *
 *   1. A LIST. The inspector's surface panel has to answer "what does
 *      this server offer", and the SDK offers no way to read back what
 *      was registered. Keeping our own array is the only way to show it
 *      without asking the server to call itself.
 *
 *   2. The TEACHING FIELDS. `examplePrompt` and `exampleWatch` have no
 *      place in the MCP protocol — no client will ever see them — but a
 *      tool nobody knows how to invoke teaches nothing. They are for the
 *      reader, and they are why this project's tools carry more metadata
 *      than the protocol defines.
 *
 *   3. ONE PLACE TO WRAP. The observer needs to see every handler
 *      run. Wrapping one array in one place is a few lines;
 *      remembering to wrap each registerTool call is a convention that
 *      will eventually be forgotten.
 *
 * The cost is one indirection between a tool file and the SDK, which is
 * the trade this project keeps making: a little structure, in exchange
 * for the thing being visible.
 */

import type { z } from "zod";

/**
 * The second argument every handler receives.
 *
 * The SDK calls this `ServerContext` and it carries a great deal — the
 * session id, the HTTP request where there is one, deprecated sampling
 * and elicitation hooks. This narrows it to the parts a tool here has
 * any business touching.
 *
 * Narrowing rather than re-exporting the SDK's type is deliberate. It
 * keeps the tool files honest about their dependencies, and it means the
 * handler signature reads as documentation: everything a tool can reach
 * for is listed right here, and it is a short list.
 */
export interface ToolContext {
  /**
   * The JSON-RPC id of the `tools/call` being handled.
   *
   * A string or a number, per the spec. Do not normalise to a string:
   * an id of 1 and an id of "1" are different ids.
   */
  id: string | number;

  /** The method name — "tools/call" for everything in this directory. */
  method: string;

  /**
   * Metadata the client attached to the request.
   *
   * Where a progress token arrives, if the client sent one. Typed as a
   * loose record because it comes off the wire from a client we do not
   * control, and pretending to know its shape would be a lie the type
   * system would then enforce.
   */
  meta?: Record<string, unknown>;

  /**
   * Fires when the client gives up on this call.
   *
   * Worth honouring in anything that takes time. A handler that ignores
   * it keeps working on an answer nobody will read, which on a long tool
   * is the difference between a cancel button that works and one that
   * only greys out.
   */
  signal: AbortSignal;

  /**
   * Reports progress partway through a long call.
   *
   * Returns a promise, and the promise matters: notifications go out
   * over the same transport as everything else, and a handler that
   * fires a dozen without awaiting them can interleave them with its
   * own result. Await each one.
   *
   * Calling this is only meaningful when the client sent a progress
   * token — without one the notification has nothing to attach to and
   * the SDK drops it. That is not an error, and a tool should not check
   * first: report progress unconditionally and let the protocol decide
   * whether anyone is listening.
   */
  reportProgress(progress: number, total?: number, message?: string): Promise<void>;
}

/**
 * One tool this server exposes over MCP.
 *
 * Generic over its input type so that `run` receives properly typed,
 * already-validated arguments rather than `unknown`. The schema is the
 * single source of truth: the SDK publishes it as JSON Schema in
 * `tools/list`, and validates what arrives in `tools/call` against it
 * before the handler is reached.
 *
 * That last part is a real difference from the chat lab. There, the
 * tool loop had to parse arguments itself with Zod before running
 * anything, because the Anthropic API's `strict: true` guarantees the
 * shape of arguments but not their values — and the numeric bounds were
 * stripped out of the schema entirely, because strict mode rejects
 * them. Here the SDK validates against the full schema, bounds
 * included, and a handler is only called with arguments that passed.
 */
export interface McpLabTool<TInput = unknown> {
  /**
   * The name a client calls this tool by.
   *
   * Lowercase with underscores, matching the convention in the MCP
   * specification and Anthropic's documentation. It must be unique
   * across the registry — `assertUniqueToolNames` checks at startup,
   * because the failure mode otherwise is a tool that silently never
   * runs rather than an error anyone sees.
   */
  name: string;

  /**
   * What the tool does, written for the model rather than for a
   * developer.
   *
   * Say what it is for and when to reach for it. Where a tool is easily
   * confused with another, say what it is NOT for — that single
   * sentence prevents more wrong calls than any amount of describing
   * what it does.
   *
   * Worth remembering that this string is the entire basis on which a
   * model decides whether to call the tool. It is prompt text, not
   * documentation, and it is the part of a tool most worth rewriting.
   */
  description: string;

  /**
   * A short human-readable name for the tool.
   *
   * MCP carries this separately from `name` so that a client can show
   * "Roll dice" in a list while still calling `roll_dice` on the wire.
   * The Anthropic API has no equivalent — a tool there has one name
   * doing both jobs.
   */
  title: string;

  /**
   * The arguments, as a Zod schema.
   *
   * MCP takes the Zod object DIRECTLY — the SDK reads its Standard
   * Schema interface to produce the JSON Schema it advertises and to
   * validate incoming calls. There is no conversion step to write.
   *
   * This is the inverse of the chat lab, which calls `z.toJSONSchema()`
   * to hand the Anthropic API a plain JSON Schema object. Same Zod
   * definition, two protocols, and only one of them needs the
   * translation written by hand.
   *
   * Note `z.ZodType` rather than a raw shape (`{ field: z.string() }`).
   * The SDK still accepts the raw form and marks it deprecated, so the
   * wrapped `z.object({...})` is the one to write.
   */
  inputSchema: z.ZodType<TInput>;

  /**
   * Runs the tool and returns text for the caller to read.
   *
   * Always async, even where the work is synchronous, so that every
   * tool has the same signature and the registration code does not have
   * to care which is which.
   *
   * The return value is a string because that is what a text content
   * block carries. Return something the caller can act on: a number, a
   * sentence, or JSON — but say what it is. "42" alone is less useful
   * than "7 × 6 = 42".
   *
   * Throwing is allowed and expected. The registration layer catches it
   * and returns a result with `isError` set, which lets a model recover
   * rather than the whole request failing. Write the message for
   * whoever has to act on it.
   */
  run(input: TInput, ctx: ToolContext): Promise<string>;

  /**
   * A prompt that reliably triggers this tool.
   *
   * A note for whoever is reading this definition: a tool nobody knows
   * how to invoke teaches nothing, and the prompts are chosen so the
   * tool is genuinely needed, since a model asked something it can
   * answer unaided will not reach for one.
   *
   * Not part of MCP, and not sent anywhere. `buildSurface` in
   * `index.ts` sends the inspector `kind`, `name`, `description` and
   * `inputSchema` — this field is not among them, and no client sees
   * it either. It is documentation that happens to be typed.
   */
  examplePrompt: string;

  /**
   * What to watch for in the inspector when that prompt runs.
   *
   * Same as `examplePrompt`: a note for the reader of this file, not
   * sent to the inspector or to any client.
   */
  exampleWatch: string;
}

/**
 * A tool whose input type we have deliberately forgotten.
 *
 * Each tool is generic over its own input, which is what gives `run` a
 * properly typed argument where it is defined. But a list cannot hold
 * several different generic types at once, so the registry stores them
 * with the parameter widened.
 *
 * `never` rather than `unknown` is what makes the widening safe in the
 * right direction: a function accepting `never` is assignable from a
 * function accepting anything, so every concrete tool fits. The cast
 * back at the call site is contained in one place — the registration
 * code — where the SDK has already validated the arguments against the
 * schema that produced the type.
 */
export type AnyMcpLabTool = McpLabTool<never>;

/**
 * Registers a tool.
 *
 * Exists so each tool file can keep its own precise input type while
 * still going into one shared list. The cast is contained here rather
 * than repeated in every tool file.
 *
 * It does nothing at runtime, which is the point: it is a type-level
 * helper that reads like a declaration at the top of each tool file.
 */
export function defineTool<TInput>(tool: McpLabTool<TInput>): AnyMcpLabTool {
  return tool as AnyMcpLabTool;
}
