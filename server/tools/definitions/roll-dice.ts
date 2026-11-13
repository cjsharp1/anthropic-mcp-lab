/**
 * roll-dice.ts — a tool whose result the model could not have invented.
 *
 * Rolls dice and returns the numbers. Trivial work, chosen for one
 * property: the answer is random, so it cannot be guessed, remembered
 * or derived. If the dice come back, the server really ran.
 *
 * ---------------------------------------------------------------------------
 * What it teaches
 * ---------------------------------------------------------------------------
 *
 * That tool use is real. This sounds obvious until you watch someone
 * test an integration with "what is 2 + 2", get "4", and conclude the
 * tool worked — when the model answered from its own knowledge and
 * never called anything. A tool that returns facts the model already
 * has cannot prove it ran.
 *
 * Randomness settles it. Ask for five dice and five specific numbers
 * come back; ask again and they differ. No amount of model knowledge
 * produces that.
 *
 * The chat lab makes this point with arithmetic large enough to be
 * unmemorised. Dice make it more cheaply — and they make it twice,
 * because a second call visibly differs from the first. That is also
 * why this is the better tool for demonstrating that MCP results are
 * not cached anywhere between the server and the model.
 */

import { z } from "zod";
import { defineTool } from "../types.js";

/**
 * Dice notation this tool understands, as sides per die.
 *
 * A fixed set rather than any positive integer. Partly because these
 * are the dice that exist, and partly so the schema has an enum in it:
 * `tools/list` then shows a constrained field, which is a different
 * thing for a reader to look at than another unbounded number.
 */
const SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

export const rollDice = defineTool({
  name: "roll_dice",
  title: "Roll dice",

  description:
    "Rolls one or more dice and returns the individual results and " +
    "their total. Use it whenever a random number is wanted, or to " +
    "verify that this server is genuinely being called — the results " +
    "are random, so they cannot be guessed or recalled. It does not " +
    "simulate games, apply modifiers, or interpret what a roll means.",

  inputSchema: z.object({
    count: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(1)
      .describe("How many dice to roll. 1 to 20; defaults to 1."),

    sides: z
      .union(SIDES.map((n) => z.literal(n)))
      .default(6)
      .describe(
        "How many sides each die has. One of 4, 6, 8, 10, 12, 20 or " +
          "100; defaults to 6.",
      ),
  }),

  async run({ count, sides }) {
    // Math.random, not crypto. These dice decide nothing, and reaching
    // for a cryptographic generator here would suggest to a reader that
    // the choice matters more than it does. Where it WOULD matter —
    // anything a person could profit by predicting — this is the wrong
    // function, and that is the distinction worth carrying away.
    const rolls = Array.from(
      { length: count },
      () => 1 + Math.floor(Math.random() * sides),
    );

    const total = rolls.reduce((sum, roll) => sum + roll, 0);

    // Phrased as a sentence rather than returned as bare JSON. A tool
    // result is read by a model, and "3d6: 4, 2, 6 (total 12)" survives
    // being quoted into a reply in a way that {"rolls":[4,2,6]} does
    // not. Say what the numbers are, not just what they were.
    return `${count}d${sides}: ${rolls.join(", ")} (total ${total})`;
  },

  examplePrompt: "Roll five twenty-sided dice.",

  exampleWatch:
    "The numbers in the result. Ask twice and they change — which is " +
    "the proof that the server ran rather than the model answering " +
    "from memory.",
});
