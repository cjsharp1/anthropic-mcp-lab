/**
 * try-the-tools.ts — a prompt that tells a model how to exercise this
 * server.
 *
 * Produces a single user message asking for a tour of whatever this
 * server exposes. The least elaborate prompt possible, which is why it
 * is the first one.
 *
 * ---------------------------------------------------------------------------
 * What it teaches
 * ---------------------------------------------------------------------------
 *
 * The point of the prompt primitive, in the smallest form that makes
 * it.
 *
 * Someone connects this server to Claude Desktop and faces an empty
 * chat box. The tools are listed somewhere in a menu; what to type is
 * not obvious. The knowledge of how to exercise this server lives in
 * the server — and without prompts there is no way to get it across
 * the connection.
 *
 * With one, the client shows "Try the tools" in a list, the user picks
 * it, and a sensible opening message appears. That is the entire
 * feature.
 *
 * ---------------------------------------------------------------------------
 * Why it takes a `focus` argument
 * ---------------------------------------------------------------------------
 *
 * To show that a prompt is a function rather than a constant. One
 * registration produces a different message per argument, and the
 * client can render a form for it from the published schema before
 * anything is sent.
 *
 * It is an enum rather than free text on purpose. A client building a
 * form gets a dropdown instead of a box, which is a visible
 * consequence of a schema choice — and the kind of thing worth seeing
 * once, because the same choice has the same effect on a tool's input.
 */

import { z } from "zod";
import { definePrompt } from "../types.js";

export const tryTheTools = definePrompt({
  name: "try_the_tools",
  title: "Try the tools",

  description:
    "Asks for a guided tour of this server's capabilities — a few " +
    "tool calls and a resource read, with an explanation of what " +
    "happened. A good first message after connecting.",

  argsSchema: z.object({
    focus: z
      .enum(["everything", "tools", "resources", "progress"])
      .default("everything")
      .describe("Which part of the server to concentrate on."),
  }),

  build({ focus }) {
    // A plain lookup rather than string assembly. Each branch is a
    // complete instruction someone can read and judge, which matters
    // because these strings ARE the deliverable — a prompt whose
    // wording is stitched together from fragments is one nobody can
    // review by reading it.
    const asks: Record<typeof focus, string> = {
      everything:
        "Give me a tour of this MCP server. Roll some dice, call " +
        "inspect_request, and read the lab://server-info resource. " +
        "After each one, say briefly what happened at the protocol " +
        "level — which method was called and what came back.",

      tools:
        "Call each of this server's tools once, with sensible " +
        "arguments, and summarise what each one does. Start with " +
        "echo and finish with slow_task.",

      resources:
        "Read this server's resources: lab://server-info, " +
        "lab://notes/protocol, and lab://dice/20. Summarise each, " +
        "and explain how reading a resource differs from calling a " +
        "tool.",

      progress:
        "Run slow_task with 8 steps. While it runs, explain what a " +
        "progress notification is, why it only arrives when the " +
        "client sends a progress token, and what happens if nobody " +
        "sends one.",
    };

    return [{ role: "user", text: asks[focus] }];
  },

  exampleWatch:
    "prompts/get returns messages and nothing else. No tool runs, no " +
    "resource is read — the server hands back text and the client " +
    "decides what to do with it.",
});
