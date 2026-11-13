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

/**
 * What the arrow means, as hover text.
 *
 * The marks are compact enough to be ambiguous on first sight, and a
 * title attribute costs nothing. The chat lab does the same.
 */
function directionTitle(direction: string): string {
  switch (direction) {
    case "in":
      return "a client sent this to us";
    case "out":
      return "we sent this back";
    case "call":
      return "we called a handler";
    case "back":
      return "the handler returned";
    default:
      return "internal — nothing crossed a boundary";
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

  // Three classes carrying three independent signals — the same
  // arrangement the chat lab's activity log uses, so the two panels
  // read the same way.
  //
  //   dir-*    tints the row and colours the arrow: which way it went
  //   level-*  colours the level word, and for warn and error takes
  //            over the row, because a failure matters more than
  //            which way it was travelling
  //
  // An absent direction is "none" rather than nothing, so an internal
  // note gets the faded treatment instead of falling through to an
  // untinted row that looks like a styling bug.
  const direction = event.direction ?? "none";
  row.className = `row level-${event.level} dir-${direction}`;

  if (!isVisible(event)) row.classList.add("hidden");

  // --- The arrow, in its own narrow column ---------------------------------
  //
  // The primary signal, and the leftmost thing in the row: it answers
  // "in, out, or neither" before a word is read.
  const arrow = document.createElement("span");
  arrow.className = "row-arrow";
  arrow.textContent = arrowOf(event);
  arrow.title = directionTitle(direction);
  row.append(arrow);

  // --- The headline: what happened, with the time at the right margin ------
  //
  // The time used to lead each row, which gave the most prominent
  // position in the panel to the least-read value. The chat lab moved
  // it to the right margin for that reason and this follows.
  const headline = document.createElement("div");
  headline.className = "row-headline";

  const label = document.createElement("span");
  label.className = "row-label";
  // textContent. See the header — this string may have come from a
  // remote client.
  label.textContent = event.label;

  const time = document.createElement("span");
  time.className = "row-time";
  time.textContent = clockOf(event.at);

  headline.append(label, time);
  row.append(headline);

  // --- The meta line: what kind, over what, and why ------------------------
  //
  // These belong together as one sentence — "an MCP message, over
  // HTTP, because the client asked for the tool list". The chat lab
  // learned this the hard way: its level used to sit in its own
  // column at the far left, separated from the reason by the whole
  // width of the label.
  const meta = document.createElement("div");
  meta.className = "row-meta";

  const level = document.createElement("span");
  level.className = "row-level";
  level.textContent = event.level;
  meta.append(level);

  // The transport, as a badge in the same slot the chat lab gives its
  // actor. Both answer "who or what was this between".
  if (event.transport && event.transport !== "none") {
    const transport = document.createElement("span");
    transport.className = `row-transport transport-${event.transport}`;
    transport.textContent = event.transport;
    meta.append(transport);
  }

  // The JSON-RPC method and id, which answer "which exchange is this
  // part of" — the question the chat lab has no equivalent of,
  // because one HTTP call there carries one exchange.
  const notes: string[] = [];
  if (event.method) notes.push(event.method);
  if (event.id !== undefined) notes.push(`id ${JSON.stringify(event.id)}`);
  if (event.because) notes.push(event.because);

  if (notes.length > 0) {
    const why = document.createElement("span");
    why.className = "row-why";
    why.textContent = notes.join(" · ");
    meta.append(why);
  }

  if (event.elapsedMs !== undefined) {
    const elapsed = document.createElement("span");
    elapsed.className = "row-elapsed";
    elapsed.textContent = `${event.elapsedMs}ms`;
    meta.append(elapsed);
  }

  row.append(meta);

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
