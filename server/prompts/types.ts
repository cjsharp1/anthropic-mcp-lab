/**
 * types.ts — what a prompt is, in this project.
 *
 * The third MCP primitive, and the one people most often skip. Same
 * three-level layout as tools and resources: this file imports nothing
 * but Zod's types, definitions import it, the registry imports the
 * definitions.
 *
 * ---------------------------------------------------------------------------
 * What a prompt IS
 * ---------------------------------------------------------------------------
 *
 * A template the server offers, which a client can fetch, fill in, and
 * drop into a conversation.
 *
 * The inversion is the whole idea. Normally the client writes the
 * prompt and the server answers it. Here the SERVER supplies the
 * wording — because the server is the thing that knows how its own
 * tools and resources are best used, and that knowledge is otherwise
 * stranded on the wrong side of the connection.
 *
 * Concretely: this server exposes `roll_dice`, `lab://dice/{sides}`
 * and three other things, and a user staring at a chat box has no idea
 * what to type to exercise them. A prompt is the server answering that
 * question in advance. In Claude Desktop they show up as slash
 * commands; in another client, as a menu.
 *
 * ---------------------------------------------------------------------------
 * Why it is not just a string
 * ---------------------------------------------------------------------------
 *
 * Two reasons, both visible in the interface below.
 *
 * A prompt is PARAMETERISED. `argsSchema` describes what the caller
 * must supply, the same way a tool's input schema does, and the client
 * can render a form from it before anything is sent.
 *
 * And a prompt returns MESSAGES, not text — a list of role/content
 * pairs. That matters because a good template is frequently more than
 * one turn: a user message setting the task, sometimes an assistant
 * message establishing a format. Returning a conversation fragment
 * rather than a paragraph is what lets a server supply few-shot
 * examples, which is the thing prompts are genuinely good for and the
 * reason they are not simply documentation.
 *
 * ---------------------------------------------------------------------------
 * The limit worth knowing
 * ---------------------------------------------------------------------------
 *
 * A prompt cannot make anything happen. Fetching one returns text; it
 * runs no tool, reads no resource, and calls no model. Whether the
 * returned messages are ever sent anywhere is entirely the client's
 * decision.
 *
 * That is easy to forget when writing one, because the wording reads
 * like an instruction being issued. It is not. It is a suggestion being
 * handed to a client that is free to ignore it.
 */

import type { z } from "zod";

/**
 * One message in a prompt template.
 *
 * A narrowing of the SDK's `PromptMessage`, which also permits image,
 * audio and embedded-resource content. Text is all this lab needs, and
 * a union of four content types in every definition file would obscure
 * the shape rather than teach it.
 *
 * The roles are the familiar two. Note there is no "system" role here —
 * MCP prompts carry user and assistant turns only, and a server that
 * wants to set system-level behaviour has to do it through the wording
 * of a user message. That surprises people arriving from the Messages
 * API, where `system` is a top-level parameter.
 */
export interface PromptTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * One prompt template this server offers.
 *
 * Generic over its arguments so `build` receives them typed, the same
 * arrangement `McpLabTool` uses for tool input.
 */
export interface McpLabPrompt<TArgs = unknown> {
  /**
   * The name a client fetches this prompt by.
   *
   * Lowercase with underscores, matching the tools. In a client that
   * surfaces prompts as slash commands this becomes the command, so it
   * is read by people more often than a tool name is — worth keeping
   * short and typable.
   */
  name: string;

  /** A human-readable title, for a client that shows one. */
  title: string;

  /**
   * What this prompt is for, written for whoever is choosing it.
   *
   * Like a resource description and unlike a tool description, the
   * audience is usually a PERSON picking from a list rather than a
   * model deciding what to call. Say what the template does for them.
   */
  description: string;

  /**
   * The arguments, as a Zod schema.
   *
   * Taken directly by the SDK, exactly as a tool's input schema is —
   * published to clients as JSON Schema and validated on the way in,
   * so `build` below only ever sees arguments that passed.
   *
   * Use `z.object({})` for a prompt that takes none, rather than
   * leaving it undefined. The SDK accepts both, but a schema that says
   * "no arguments" is a clearer statement than a missing field, and it
   * keeps every definition in this directory the same shape.
   */
  argsSchema: z.ZodType<TArgs>;

  /**
   * Produces the messages.
   *
   * Synchronous, deliberately: a prompt is a template being filled in,
   * and there is nothing here to await. Tools and resources are async
   * because they do work; a prompt that needed to do work to build
   * itself would be a sign the job belongs in a tool instead.
   */
  build(args: TArgs): PromptTurn[];

  /** What to watch for in the inspector when this prompt is fetched. */
  exampleWatch: string;
}

/**
 * A prompt whose argument type we have deliberately forgotten.
 *
 * Same widening as `AnyMcpLabTool`, for the same reason: a list cannot
 * hold several different generic types at once. `never` keeps the
 * variance pointing the right way, so every concrete prompt is
 * assignable to this.
 */
export type AnyMcpLabPrompt = McpLabPrompt<never>;

/**
 * Registers a prompt.
 *
 * Exists so each definition file can keep its own precise argument type
 * while still going into one shared list, with the cast contained here
 * rather than repeated in every file.
 */
export function definePrompt<TArgs>(
  prompt: McpLabPrompt<TArgs>,
): AnyMcpLabPrompt {
  return prompt as AnyMcpLabPrompt;
}
