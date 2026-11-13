/**
 * registry.ts — the list of every prompt this server offers.
 *
 * Third and last of the matching registries, with the same three-level
 * layout as tools and resources: types.ts imports nothing, definitions/
 * import types.ts, this file imports the definitions.
 *
 * The repetition across the three directories is deliberate. Someone
 * who has read the tool registry can read this one in a few seconds and
 * be confident nothing clever is happening, which is worth more in a
 * teaching codebase than the lines a shared abstraction would save. A
 * generic `makeRegistry<T>()` would collapse all three into one file
 * and make each primitive harder to understand on its own terms.
 */

import { explainExchange } from "./definitions/explain-exchange.js";
import { tryTheTools } from "./definitions/try-the-tools.js";
import type { AnyMcpLabPrompt } from "./types.js";

// Re-exported so the rest of the server can import everything about
// prompts from one place.
export type { AnyMcpLabPrompt, McpLabPrompt, PromptTurn } from "./types.js";
export { definePrompt } from "./types.js";

/**
 * Every prompt this server offers, in the order the inspector lists
 * them.
 *
 * The single-message one first, then the few-shot one, because the
 * second only makes sense once the first has established what a prompt
 * is at all.
 */
export const PROMPTS: AnyMcpLabPrompt[] = [tryTheTools, explainExchange];

/**
 * Throws if two prompts share a name.
 *
 * Called at startup, alongside the tool and resource checks. Same
 * failure being prevented: a duplicate name means whichever
 * registration happens second wins and the first is silently
 * unreachable.
 *
 * It matters a little more for prompts than for the other two, because
 * in a client that surfaces prompts as slash commands a shadowed
 * prompt is one a user can see in a menu and never successfully
 * invoke.
 */
export function assertUniquePromptNames(): void {
  const seen = new Set<string>();

  for (const prompt of PROMPTS) {
    if (seen.has(prompt.name)) {
      throw new Error(
        `Two prompts are registered as "${prompt.name}". ` +
          "Prompt names must be unique.",
      );
    }
    seen.add(prompt.name);
  }
}
