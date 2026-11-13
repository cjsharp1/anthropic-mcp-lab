/**
 * registry.ts — the list of every tool this server exposes.
 *
 * A "tool" here is a function a client can ask us to run. The model does
 * not execute anything itself, and neither does the client: the model
 * decides a tool should be called, the client sends `tools/call`, this
 * server runs the function, and the result travels back. This file is
 * what that lookup runs over.
 *
 * The layout:
 *
 *   types.ts        what a tool IS. Imports nothing but Zod's types.
 *   definitions/    one file per tool. Each imports types.ts.
 *   registry.ts     this file. Imports the definitions and lists them.
 *
 * The three levels are a dependency order, not just tidiness. The chat
 * lab had the interface in its registry file, which meant tool files and
 * the registry imported each other — a cycle that worked with one tool
 * and threw "Cannot access 'currentTime' before initialization" with
 * two. A module defining shared types belongs at the bottom of the
 * graph, importing nothing from the modules that use it.
 *
 * ---------------------------------------------------------------------------
 * Why there is no TOOLS_BY_NAME here
 * ---------------------------------------------------------------------------
 *
 * The chat lab's registry exports a Map alongside its array, because its
 * tool loop has to answer "what did the model just ask for" on every
 * turn and a linear search would be the wrong shape.
 *
 * Nothing here needs that. The MCP SDK keeps its own registry — each
 * tool is handed to `registerTool` once at startup, and dispatch is the
 * SDK's job from then on. A second lookup table maintained beside it
 * would be a copy that can drift, answering a question nobody asks.
 *
 * What this array IS for is the two things the SDK cannot do: listing
 * what was registered, for the inspector's surface panel, and giving
 * the observer one place to wrap every handler.
 */

import { echo } from "./definitions/echo.js";
import { inspectRequest } from "./definitions/inspect-request.js";
import { rollDice } from "./definitions/roll-dice.js";
import { slowTask } from "./definitions/slow-task.js";
import type { AnyMcpLabTool } from "./types.js";

// Re-exported so the rest of the server can import everything about
// tools from one place, without needing to know which file defines what.
export type { AnyMcpLabTool, McpLabTool, ToolContext } from "./types.js";
export { defineTool } from "./types.js";

/**
 * Every tool this server offers, in the order the inspector lists them.
 *
 * Ordered by how much they assume, not alphabetically. Someone reading
 * down the list meets the bare round trip first, then proof the server
 * really ran, then the protocol envelope, then the asynchronous case —
 * which is roughly the order the concepts build in.
 */
export const TOOLS: AnyMcpLabTool[] = [
  echo,
  rollDice,
  inspectRequest,
  slowTask,
];

/**
 * Throws if two tools share a name.
 *
 * Called at startup. A duplicate name is not a runtime error that shows
 * up in the logs — it is a tool that silently never runs, because
 * whichever registration happens second wins and the first is
 * unreachable. Far better to fail loudly on boot.
 *
 * Worth knowing that the SDK will also reject a duplicate registration,
 * which raises the fair question of why this exists. Two reasons: the
 * error here names the project's own concept rather than the SDK's
 * internals, and this check runs before any registration happens, so it
 * cannot leave a half-built server behind. The SDK's own error arrives
 * partway through `createServer()`, with some tools registered and
 * others not.
 */
export function assertUniqueToolNames(): void {
  const seen = new Set<string>();

  for (const tool of TOOLS) {
    if (seen.has(tool.name)) {
      throw new Error(
        `Two tools are registered as "${tool.name}". Tool names must be unique.`,
      );
    }
    seen.add(tool.name);
  }
}
