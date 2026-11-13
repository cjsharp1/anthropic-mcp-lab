/**
 * log.ts — draws the traffic log.
 *
 * One function does the work: `appendEvent` turns an `InspectorEvent`
 * from the wire into a row in the panel. Everything else here supports
 * it — filtering, the follow-scroll behaviour, and the counters.
 *
 * ---------------------------------------------------------------------------
 * textContent, never innerHTML
 * ---------------------------------------------------------------------------
 *
 * This rule is load-bearing and it is sharper here than in the chat
 * lab.
 *
 * There, the untrusted text was model output — bad enough. Here, every
 * string in an event may have come from a REMOTE MCP CLIENT: a tool
 * name it asked for, an error message quoting its arguments, a URI it
 * invented. A client this server does not control can put whatever it
 * likes in those fields, and the inspector renders them.
 *
 * So nothing in this file assigns to `innerHTML`, ever. Rows are built
 * with `createElement` and filled with `textContent`, which cannot
 * execute anything. The one place markup is constructed — the
 * collapsible detail tree — is `json-tree.ts`, which follows the same
 * rule and was copied here for that reason.
 *
 * ---------------------------------------------------------------------------
 * Why rows are not re-rendered
 * ---------------------------------------------------------------------------
 *
 * A row is created once and never touched again. Filtering hides and
 * shows existing elements rather than rebuilding the list.
 *
 * That is deliberate. A log that rebuilds itself on every filter
 * change loses the open/closed state of every expanded detail — which
 * is precisely the state a reader cares about, since they expanded it
 * to look at something.
 */

import type {
  InspectorEvent,
  InspectorLevel,
  McpTransport,
} from "../shared/types.js";
import { buildJsonTree } from "./json-tree.js";
import { state } from "./state.js";

/** The scrolling container the rows live in. */
let panel: HTMLElement | null = null;

/** The count beside the panel's title. */
let counter: HTMLElement | null = null;

/**
 * How close to the bottom counts as "at the bottom", in pixels.
 *
 * Not zero, because a browser's scroll arithmetic is fractional at
 * fractional zoom levels and an exact comparison is false just often
 * enough to be baffling.
 */
const BOTTOM_SLOP = 32;

/** Wires the module to its elements. Called once, by app.ts. */
export function initLog(panelEl: HTMLElement, counterEl: HTMLElement): void {
  panel = panelEl;
  counter = counterEl;

  // Follow-scroll: stop following when the reader scrolls up, resume
  // when they come back. Without this the panel fights anyone trying
  // to read a row while traffic is arriving.
  panel.addEventListener("scroll", () => {
    if (!panel) return;
    const distanceFromBottom =
      panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    state.follow = distanceFromBottom <= BOTTOM_SLOP;
  });
}

/** Formats a timestamp as HH:MM:SS. */
function clockOf(at: number): string {
  const date = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

/**
 * The arrow for a direction.
 *
 * Characters rather than icons, so there is no asset to load and no
 * sprite to keep aligned. The pairs are chosen to be distinguishable
 * at a glance: protocol traffic uses horizontal arrows, handler calls
 * use angled ones.
 */
function arrowOf(event: InspectorEvent): string {
  switch (event.direction) {
    case "in":
      return "→";
    case "out":
      return "←";
    case "call":
      return "↘";
    case "back":
      return "↖";
    default:
      return "·";
  }
}

/** Whether a row should currently be visible. */
function isVisible(event: InspectorEvent): boolean {
  if (state.hiddenLevels.has(event.level)) return false;

  // Events with no transport are internal notes. They are governed by
  // the "internal" checkbox, which is what `none` means in the filter
  // set — so an absent transport is treated as "none" rather than as
  // always-visible.
  const transport: McpTransport = event.transport ?? "none";
  return !state.hiddenTransports.has(transport);
}

/** Every row drawn so far, with its event, so filters can re-apply. */
const rows: Array<{ element: HTMLElement; event: InspectorEvent }> = [];

/**
 * Re-applies the filters to every existing row.
 *
 * Toggles a class rather than removing elements — see the header for
 * why rows are never rebuilt.
 */
export function applyFilters(): void {
  for (const row of rows) {
    row.element.classList.toggle("hidden", !isVisible(row.event));
  }
}

/** Removes every row. */
export function clearLog(): void {
  if (!panel) return;
  panel.replaceChildren();
  rows.length = 0;
  state.eventCount = 0;
  updateCounter();
}

/** Updates the count beside the title. */
function updateCounter(): void {
  if (!counter) return;
  counter.textContent =
    state.eventCount === 1 ? "1 event" : `${state.eventCount} events`;
}

/**
 * Adds one event to the panel.
 *
 * The only function here that matters. Everything above is support.
 */
export function appendEvent(event: InspectorEvent): void {
  if (!panel) return;

  const row = document.createElement("div");

  // Two classes carrying two independent signals — see the colour
  // section of styles.css. `dir-*` tints the row and colours its left
  // edge; `level-*` colours the tag, and for warn and error also takes
  // over the row, because a failure matters more than which way it was
  // travelling.
  //
  // An absent direction is "none" rather than nothing, so that an
  // internal note gets the faded treatment instead of falling through
  // to an untinted row that looks like a styling bug.
  row.className = `row level-${event.level} dir-${event.direction ?? "none"}`;

  if (!isVisible(event)) row.classList.add("hidden");

  // --- The always-visible line ---------------------------------------------

  const head = document.createElement("div");
  head.className = "row-head";

  const time = document.createElement("span");
  time.className = "row-time";
  time.textContent = clockOf(event.at);
  head.append(time);

  const tag = document.createElement("span");
  tag.className = `row-tag tag-${event.level}`;
  tag.textContent = event.level;
  head.append(tag);

  // The transport, when there is one. This is the field the chat lab's
  // log has no equivalent of, and the one that makes two concurrent
  // clients readable.
  if (event.transport && event.transport !== "none") {
    const transport = document.createElement("span");
    transport.className = `row-transport transport-${event.transport}`;
    transport.textContent = event.transport;
    head.append(transport);
  }

  const arrow = document.createElement("span");
  arrow.className = "row-arrow";
  arrow.textContent = arrowOf(event);
  head.append(arrow);

  const label = document.createElement("span");
  label.className = "row-label";
  // textContent. See the header — this string may have come from a
  // remote client.
  label.textContent = event.label;
  head.append(label);

  if (event.elapsedMs !== undefined) {
    const elapsed = document.createElement("span");
    elapsed.className = "row-elapsed";
    elapsed.textContent = `${event.elapsedMs}ms`;
    head.append(elapsed);
  }

  row.append(head);

  // --- The second line, when there is more to say --------------------------

  // `because` and the JSON-RPC id answer two different questions that
  // both come up constantly: why did this happen, and which exchange
  // does it belong to. Shown together on a quieter line so the head
  // stays scannable.
  const notes: string[] = [];
  if (event.method) notes.push(event.method);
  if (event.id !== undefined) notes.push(`id ${JSON.stringify(event.id)}`);
  if (event.because) notes.push(event.because);

  if (notes.length > 0) {
    const note = document.createElement("div");
    note.className = "row-note";
    note.textContent = notes.join("  ·  ");
    row.append(note);
  }

  // --- The expandable detail -----------------------------------------------

  if (event.detail !== undefined) {
    const details = document.createElement("details");
    details.className = "row-detail";

    const summary = document.createElement("summary");
    summary.textContent = "detail";
    details.append(summary);

    // buildJsonTree builds elements and uses textContent throughout.
    // It is the only thing here that constructs nested markup, which
    // is why it was copied from the chat lab rather than rewritten.
    details.append(buildJsonTree(event.detail));
    row.append(details);
  }

  panel.append(row);
  rows.push({ element: row, event });

  state.eventCount += 1;
  updateCounter();

  if (state.follow) {
    panel.scrollTop = panel.scrollHeight;
  }
}

/** The level names, in the order the filter row shows them. */
export const LEVELS: InspectorLevel[] = [
  "mcp",
  "handler",
  "info",
  "warn",
  "error",
];

/** The transport names, in the order the filter row shows them. */
export const TRANSPORTS: McpTransport[] = ["http", "stdio", "none"];
