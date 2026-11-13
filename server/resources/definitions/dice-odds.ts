/**
 * dice-odds.ts — a resource with a parameter in its address.
 *
 * Serves a probability table for a die at `lab://dice/{sides}`, so
 * `lab://dice/20` returns the odds for a d20. One registration, an
 * unbounded family of documents.
 *
 * ---------------------------------------------------------------------------
 * What it teaches
 * ---------------------------------------------------------------------------
 *
 * Templated resources, and the thing they cost you.
 *
 * A fixed resource is an address this server published. A templated one
 * is a PATTERN, and the value in it comes from whoever is reading. That
 * single difference moves this file into the same category as the chat
 * lab's `read_file` tool: input arrives from outside, and the handler
 * is what stands between it and whatever sits behind.
 *
 * Here the stake is low — the worst a bad value does is produce a silly
 * table — so the validation below is short. That is exactly why it is
 * worth writing out in full rather than skipping: the shape of the
 * check is the lesson, not the severity of what it prevents.
 *
 * ---------------------------------------------------------------------------
 * Three things that catch people out
 * ---------------------------------------------------------------------------
 *
 * 1. THE PARAMETER IS A STRING. URIs have no types. `{sides}` arrives
 *    as "20", or as "twenty", or as "", or as "1e9". Nothing has
 *    checked it. A tool handler gets arguments Zod already validated;
 *    a resource handler gets whatever matched the pattern.
 *
 * 2. IT MIGHT BE AN ARRAY. An RFC 6570 template can expand to multiple
 *    values, so the SDK types each parameter as `string | string[]`.
 *    Code that assumes a string and calls `.trim()` on an array throws
 *    a TypeError at read time. The narrowing below is not defensive
 *    padding; it is handling a case the type system is telling you
 *    about.
 *
 * 3. `Number()` IS NOT A VALIDATOR. `Number("")` is 0, `Number(" 7 ")`
 *    is 7, `Number("0x10")` is 16, and `Number("1e9")` is a billion.
 *    Each of those is a silently wrong answer rather than a rejection.
 *    The check below tests the STRING against a pattern before
 *    converting, which is the ordering that works — the same shape as
 *    "resolve the path, then check it is inside the sandbox", and
 *    wrong in the same way if reversed.
 */

import { defineResource, type UriParams } from "../types.js";

/** The largest die worth tabulating. Keeps the output readable. */
const MAX_SIDES = 100;

/**
 * Pulls a positive integer out of a URI parameter, or explains why not.
 *
 * Returns a number on success and a message on failure, rather than
 * throwing: the caller wants to put the reason in a protocol error that
 * names the bad value, and an exception type would have to carry the
 * same string anyway.
 *
 * The order matters. Narrow the type, then test the text, then convert.
 * Converting first and inspecting the number afterwards is the version
 * that accepts "0x10" and " 7 " without noticing.
 */
function parseSides(raw: string | string[] | undefined): number | string {
  if (raw === undefined) {
    return "no value was given for {sides}";
  }

  // See note 2 in the header: a template parameter may be an array.
  // Taking the first element would quietly honour a request nobody
  // meant to make, so this refuses instead.
  if (Array.isArray(raw)) {
    return "expected one value for {sides}, not several";
  }

  // See note 3: test the text before converting. Anchored, digits only,
  // no sign, no whitespace, no exponent, no hex. Everything Number()
  // would have accepted and should not have.
  if (!/^[0-9]+$/.test(raw)) {
    return `"${raw}" is not a whole number`;
  }

  const sides = Number(raw);

  if (sides < 2) {
    // A one-sided die is not a die, and a zero-sided one divides by
    // zero further down. Both arrive here as valid integers, which is
    // why a range check is needed on top of the format check.
    return "a die needs at least 2 sides";
  }

  if (sides > MAX_SIDES) {
    return `${sides} sides is more than this resource tabulates (max ${MAX_SIDES})`;
  }

  return sides;
}

export const diceOdds = defineResource({
  name: "dice-odds",
  title: "Dice probabilities",
  uri: "lab://dice/{sides}",
  templated: true,
  mimeType: "text/plain",

  description:
    "A probability table for a single die with the given number of " +
    "sides — for example lab://dice/20 for a d20. Shows the chance of " +
    "each face and of rolling at least each value.",

  async read(uri: URL, params: UriParams) {
    const parsed = parseSides(params["sides"]);

    if (typeof parsed === "string") {
      // Thrown, not returned as a document. A URI that cannot be read
      // is a failed read, and answering it with a text file containing
      // an error message would report success at the protocol level —
      // leaving a client to discover the problem by reading the prose.
      throw new Error(`Cannot read ${uri.href}: ${parsed}.`);
    }

    const sides = parsed;
    const each = ((1 / sides) * 100).toFixed(2);

    const lines = [
      `A ${sides}-sided die`,
      "",
      `Each face: ${each}%`,
      "",
      "face   at least",
    ];

    for (let face = 1; face <= sides; face += 1) {
      // "At least this value" — (sides - face + 1) faces qualify.
      const atLeast = (((sides - face + 1) / sides) * 100).toFixed(2);
      lines.push(`${String(face).padStart(4)}   ${atLeast.padStart(6)}%`);
    }

    return lines.join("\n");
  },

  exampleWatch:
    "Read lab://dice/20, then lab://dice/twenty. The first returns a " +
    "table; the second returns a protocol error naming the bad value. " +
    "One registration, two outcomes, decided entirely by the handler.",
});
