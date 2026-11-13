/**
 * slow-task.ts — a tool that takes its time, and says so while it does.
 *
 * Counts through a number of steps, pausing between them and reporting
 * progress as it goes. The work is invented; the behaviour around it is
 * the subject.
 *
 * ---------------------------------------------------------------------------
 * What it teaches
 * ---------------------------------------------------------------------------
 *
 * That a server can speak before it has an answer.
 *
 * Every other tool here follows the shape people expect: a request
 * arrives, a response goes back, one of each. This one sends several
 * messages per call — a stream of progress notifications, then the
 * result — and watching that in the inspector is the clearest
 * demonstration that MCP is a bidirectional protocol rather than a
 * request/response API with extra steps.
 *
 * It also teaches the two traps that come with that.
 *
 * ---------------------------------------------------------------------------
 * Trap 1: progress only works if the client asked for it
 * ---------------------------------------------------------------------------
 *
 * A progress notification has to attach to a progress token, and a
 * token only exists when the CLIENT puts one in the request's `_meta`.
 * No token, no notifications — the SDK drops them.
 *
 * This is the single most common confusion about MCP progress, and the
 * reason it is confusing is that nothing fails. The tool works. The
 * result is correct. The notifications just silently go nowhere, and
 * the obvious conclusion is that the server is broken.
 *
 * The handler below does NOT check for a token before reporting. That
 * is deliberate, and it is the right way to write one: report
 * unconditionally, and let the protocol decide whether anyone is
 * listening. A handler that checks first has coupled itself to what
 * the client happened to send.
 *
 * Call it from `try-http.ts` (which sends a token) and from a client
 * that does not, and the difference is visible in the log.
 *
 * ---------------------------------------------------------------------------
 * Trap 2: cancellation is cooperative
 * ---------------------------------------------------------------------------
 *
 * When a client gives up, the SDK aborts `ctx.signal`. It cannot stop a
 * running handler — nothing can, in JavaScript. A handler that ignores
 * the signal keeps counting, keeps sending notifications nobody will
 * read, and eventually returns a result into a void.
 *
 * So this one checks the signal at every step and between every sleep.
 * That is the whole mechanism: there is no cancellation unless the
 * handler implements it, and a long-running tool that does not check is
 * a tool whose cancel button is decorative.
 */

import { z } from "zod";
import { defineTool, type ToolContext } from "../types.js";

/** How long each step takes. Long enough to watch, short enough to wait for. */
const STEP_MS = 400;

/**
 * Waits, unless the caller has given up first.
 *
 * Rejects on abort rather than returning early, so a cancelled call
 * unwinds through the same path as any other failure instead of
 * quietly returning a half-finished result that looks successful.
 *
 * Written with an explicit listener rather than `AbortSignal.timeout`
 * or a bare `setTimeout` because both halves need cleaning up: a timer
 * that outlives a cancelled call keeps the process alive, and a
 * listener that outlives a completed call leaks on a long-lived
 * server. Each path below removes the other.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Cancelled by the client."));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error("Cancelled by the client."));
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const slowTask = defineTool({
  name: "slow_task",
  title: "Slow task",

  description:
    "Simulates work that takes several seconds, reporting progress as " +
    "it goes. Use it to see what a long-running tool call looks like, " +
    "or to test how a client handles progress notifications and " +
    "cancellation. It does no real work and computes nothing — the " +
    "only output is a note that it finished.",

  inputSchema: z.object({
    steps: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe(
        "How many steps to work through, roughly 0.4 seconds each. " +
          "1 to 10; defaults to 5.",
      ),

    label: z
      .string()
      .max(60)
      .default("work")
      .describe("What to call the task in its progress messages."),
  }),

  async run({ steps, label }, ctx: ToolContext) {
    for (let step = 1; step <= steps; step += 1) {
      // Checked before the work as well as inside sleep(), so a call
      // cancelled during the final step stops there rather than
      // falling through to the return below.
      if (ctx.signal.aborted) {
        throw new Error("Cancelled by the client.");
      }

      await sleep(STEP_MS, ctx.signal);

      // Awaited, not fired and forgotten. Notifications travel the same
      // transport as the result, and a handler that does not wait can
      // have its last notification overtake its own response — which
      // looks, in a log, like progress arriving after completion.
      //
      // No check for a progress token first. See trap 1 in the header.
      await ctx.reportProgress(step, steps, `${label}: step ${step} of ${steps}`);
    }

    return `Finished ${label} after ${steps} steps (about ${(
      (steps * STEP_MS) /
      1000
    ).toFixed(1)}s).`;
  },

  examplePrompt: "Run slow_task with 5 steps and tell me when it finishes.",

  exampleWatch:
    "Several notification rows between the request and the response — " +
    "but only if the client sent a progress token. Without one the " +
    "tool still works and the notifications vanish.",
});
