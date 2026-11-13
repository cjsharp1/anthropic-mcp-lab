/**
 * surface.ts — draws what the server currently exposes.
 *
 * The right-hand panel: every tool, resource and prompt, with its
 * description and — for the ones that take input — the JSON Schema a
 * client would see.
 *
 * ---------------------------------------------------------------------------
 * Why this panel exists beside the log
 * ---------------------------------------------------------------------------
 *
 * The log answers "what just happened". This answers "what is
 * possible", and the two questions are asked at different moments.
 * Someone watching traffic wants the log; someone about to drive the
 * server from a client wants this, and specifically wants the exact
 * tool names and argument shapes to type.
 *
 * It is also the honest view. The entries come from the same
 * registries the server registered from, and the schemas are produced
 * by the same `z.toJSONSchema` the SDK uses for `tools/list` — so the
 * panel shows what a client would be told, not a hand-written
 * description of it that could drift.
 *
 * ---------------------------------------------------------------------------
 * textContent, as everywhere else in this directory
 * ---------------------------------------------------------------------------
 *
 * The descriptions here are written in this repository, so they are
 * not the untrusted case the log deals with. The rule is kept anyway:
 * an inspector where one panel escapes its input and another does not
 * is one refactor away from the unsafe one being copied.
 */

import type { SurfaceEntry, SurfaceSnapshot } from "../shared/types.js";
import { buildJsonTree } from "./json-tree.js";

/** Where the panel draws itself. */
let host: HTMLElement | null = null;

/**
 * Wires the module to its element. Called once, by app.ts.
 *
 * This used to take a second element as well, for a chip in the
 * header that showed the server's name and version. The header
 * already says "MCP Lab", and the name and version are in the
 * overview page and the README — so the chip repeated what the
 * reader knew in the one place with least room for it.
 */
export function initSurface(hostEl: HTMLElement): void {
  host = hostEl;
}

/** Builds one entry's element. */
function buildEntry(entry: SurfaceEntry): HTMLElement {
  const element = document.createElement("div");
  element.className = `entry entry-${entry.kind}`;

  const head = document.createElement("div");
  head.className = "entry-head";

  const badge = document.createElement("span");
  badge.className = `entry-badge badge-${entry.kind}`;
  badge.textContent = entry.kind;
  head.append(badge);

  const name = document.createElement("span");
  name.className = "entry-name";
  name.textContent = entry.name;
  head.append(name);

  element.append(head);

  const description = document.createElement("p");
  description.className = "entry-description";
  description.textContent = entry.description;
  element.append(description);

  // The schema, folded away. Shown for tools and prompts, absent for
  // resources — which take no arguments, only an address. That
  // absence is informative rather than missing data, so nothing
  // apologises for it.
  if (entry.inputSchema !== undefined) {
    const details = document.createElement("details");
    details.className = "entry-schema";

    const summary = document.createElement("summary");
    summary.textContent = "input schema";
    details.append(summary);

    details.append(buildJsonTree(entry.inputSchema));
    element.append(details);
  }

  return element;
}

/**
 * Draws the whole panel.
 *
 * Replaces its contents rather than diffing. The surface changes at
 * most once per server start, so there is nothing to preserve and
 * nothing to gain from being clever — and `replaceChildren` cannot
 * leave a stale node behind the way an incremental update can.
 */
export function renderSurface(surface: SurfaceSnapshot): void {
  if (!host) return;

  const groups: Array<SurfaceEntry["kind"]> = ["tool", "resource", "prompt"];
  const fragments: HTMLElement[] = [];

  for (const kind of groups) {
    const entries = surface.entries.filter((entry) => entry.kind === kind);
    if (entries.length === 0) continue;

    const heading = document.createElement("h3");
    heading.className = "entry-group";
    heading.textContent = `${entries.length} ${kind}${
      entries.length === 1 ? "" : "s"
    }`;
    fragments.push(heading);

    for (const entry of entries) fragments.push(buildEntry(entry));
  }

  host.replaceChildren(...fragments);
}
