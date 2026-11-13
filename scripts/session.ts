/**
 * session.ts — the walkthrough both try- scripts run.
 *
 * Lists and calls a tool, lists and reads a resource, lists and fetches
 * a prompt, and calls the slow tool with a progress handler attached.
 * Shared by `try-stdio.ts` and `try-http.ts`.
 *
 * ---------------------------------------------------------------------------
 * Why this is shared rather than written twice
 * ---------------------------------------------------------------------------
 *
 * Because it is the argument.
 *
 * The claim those two scripts exist to demonstrate is that the
 * transport is not the protocol — that the same exchange, with the
 * same envelope and the same result, works identically over a child
 * process and over HTTP. Two hand-written walkthroughs could not prove
 * that: any difference in their output might be a difference in the
 * scripts rather than in the transports.
 *
 * One function, called with two different `Client` objects, can. The
 * ONLY thing that differs between the two runs is which transport was
 * connected before this code was reached, and this file cannot tell
 * which it was. It takes the transport name purely to label its own
 * output.
 *
 * Every line below is therefore transport-agnostic by construction
 * rather than by care, which is a stronger guarantee than a comment
 * saying "keep these two in sync".
 */

import type { Client } from "@modelcontextprotocol/client";

/** Prints a section heading, so the output is navigable. */
function heading(text: string): void {
  console.log(`\n${"─".repeat(60)}\n${text}\n${"─".repeat(60)}`);
}

/**
 * Pulls the text out of a result's content blocks.
 *
 * Content is an array of blocks that may be text, image, audio or an
 * embedded resource, and this lab only ever returns text. Filtering by
 * type rather than reaching for `content[0].text` is what keeps the
 * compiler happy under `noUncheckedIndexedAccess` — and is correct
 * anyway, since nothing promises a single block.
 */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return String(content);

  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

/**
 * Pulls the text out of one resource-contents entry.
 *
 * A resource returns EITHER `text` or `blob` (base64), never both, and
 * the SDK types that honestly as a union. So `contents[0].text` does
 * not compile: on the blob branch there is no such property.
 *
 * That is the type system reporting something true rather than being
 * awkward. Everything this lab serves is text, but nothing in the
 * protocol says a resource must be — and a client written against a
 * server that later adds an image would otherwise break at runtime
 * where it could have broken at compile time.
 *
 * Narrowing with `in` rather than casting keeps that check real.
 */
function contentsText(entry: unknown): string {
  if (typeof entry === "object" && entry !== null && "text" in entry) {
    return String((entry as { text: unknown }).text);
  }
  return "(binary contents)";
}

/**
 * Runs the walkthrough.
 *
 * `label` is only used in the printed output. Nothing below branches
 * on it, which is the point — see the header.
 */
export async function runSession(
  client: Client,
  label: "stdio" | "http",
): Promise<void> {
  heading(`Connected over ${label}`);

  // What the server said about itself during the handshake. Identical
  // under both transports, because it is a property of the server
  // rather than of the pipe.
  const info = client.getServerVersion();
  console.log(`server: ${info?.name} ${info?.version}`);

  // --- Tools ---------------------------------------------------------------

  heading("tools/list");

  const { tools } = await client.listTools();
  for (const tool of tools) {
    console.log(`  ${tool.name.padEnd(18)} ${tool.title ?? ""}`);
  }

  heading("tools/call — roll_dice");

  // Chosen because the result cannot be faked. If dice come back, the
  // server ran. See the header of roll-dice.ts.
  const dice = await client.callTool({
    name: "roll_dice",
    arguments: { count: 3, sides: 20 },
  });
  console.log(`  ${textOf(dice.content)}`);

  // --- Progress ------------------------------------------------------------

  heading("tools/call — slow_task, with a progress handler");

  console.log(
    "  Passing onprogress, which makes the SDK attach a progress\n" +
      "  token to the request. Without one the server's notifications\n" +
      "  would go nowhere and this call would print nothing until it\n" +
      "  finished.\n",
  );

  const slow = await client.callTool(
    { name: "slow_task", arguments: { steps: 4, label: "demo" } },
    // The second argument is the options object, and `onprogress` is
    // what causes the token to be sent — it is not merely a local
    // callback, it changes what goes on the wire.
    //
    // Two arguments, not three. An earlier draft passed `undefined` in
    // the middle, copying the shape of the SDK's lower-level
    // `request(params, schema, options)` — a reasonable guess that the
    // compiler rejected outright. `callTool` folds the schema in
    // itself.
    {
      onprogress(progress) {
        const { progress: done, total, message } = progress;
        console.log(`  → progress ${done}/${total ?? "?"}  ${message ?? ""}`);
      },
    },
  );
  console.log(`  ${textOf(slow.content)}`);

  // --- Resources -----------------------------------------------------------

  heading("resources/list and resources/read");

  const { resources } = await client.listResources();
  for (const resource of resources) {
    console.log(`  ${resource.uri.padEnd(24)} ${resource.name}`);
  }

  // Templated resources are listed separately from fixed ones, because
  // a template is a pattern rather than a document — there is nothing
  // at `lab://dice/{sides}` to read.
  const { resourceTemplates } = await client.listResourceTemplates();
  for (const template of resourceTemplates) {
    console.log(`  ${template.uriTemplate.padEnd(24)} ${template.name} (template)`);
  }

  console.log("");

  const info2 = await client.readResource({ uri: "lab://server-info" });
  const infoText = contentsText(info2.contents[0]);
  console.log(`  lab://server-info →\n${infoText.replace(/^/gm, "    ")}`);

  // The templated one, resolved to a concrete address. Note that the
  // client asks for `lab://dice/6` — it never sends the template.
  const odds = await client.readResource({ uri: "lab://dice/6" });
  const oddsText = contentsText(odds.contents[0]);
  console.log(`\n  lab://dice/6 → ${oddsText.split("\n")[0]} (${oddsText.length} chars)`);

  // --- Prompts -------------------------------------------------------------

  heading("prompts/list and prompts/get");

  const { prompts } = await client.listPrompts();
  for (const prompt of prompts) {
    console.log(`  ${prompt.name.padEnd(18)} ${prompt.title ?? ""}`);
  }

  console.log("");

  const prompt = await client.getPrompt({
    name: "explain_exchange",
    arguments: { method: "tools/call" },
  });

  console.log(`  explain_exchange returned ${prompt.messages.length} messages:`);
  for (const message of prompt.messages) {
    const text = textOf([message.content]);
    const firstLine = text.split("\n")[0] ?? "";
    console.log(
      `    ${message.role.padEnd(9)} ${firstLine.slice(0, 48)}${
        firstLine.length > 48 ? "…" : ""
      }`,
    );
  }

  console.log(
    "\n  The middle one is an assistant turn the SERVER wrote — a\n" +
      "  few-shot example, not something a model generated.",
  );
}
