/**
 * types.ts — shapes that exist only in the browser.
 *
 * The distinction between this file and shared/types.ts is worth being
 * precise about, because the two look similar and mixing them up causes
 * a specific, annoying class of bug.
 *
 *   shared/types.ts  the WIRE CONTRACT. Both halves import it, so every
 *                    change to it is a change to an agreement. Adding a
 *                    required field there means the server must now send
 *                    it and the browser may now rely on it.
 *
 *   public/types.ts  this file. Things the inspector invents for its own
 *                    convenience and the server has never heard of — view
 *                    state, filter settings, the shape of a row after the
 *                    panel has decorated it.
 *
 * The rule: if the server needs to know about it, it belongs in shared.
 * If only the UI cares, it belongs here. A type that drifts into the
 * wrong file is how a frontend ends up quietly depending on a field the
 * backend never promised to send.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists in phase 1, before the UI does
 * ---------------------------------------------------------------------------
 *
 * Partly to hold the types below, which the inspector will need. Mostly
 * to give the client TypeScript config something to compile.
 *
 * `tsc` fails with TS18003 — "No inputs were found in config file" — when
 * an `include` pattern matches zero files. The client config points at
 * public/ and shared/, so until one real .ts file exists in public/,
 * `npm run typecheck` fails on a project where nothing is wrong. That is
 * a documented gotcha in the chat lab's build plan, and it bit this
 * project within an hour of starting: the overview page claimed the
 * typecheck passed before anyone had run it against an empty public/.
 */

import type { InspectorLevel, McpTransport } from "../shared/types.js";

/**
 * What the reader has chosen to hide.
 *
 * Filtering is a view concern and never leaves the browser — the server
 * sends every event and the panel decides what to draw. That split
 * matters for a teaching app: a hidden row is still in the log, so
 * turning a filter back on reveals history rather than starting a new
 * recording.
 *
 * Sets rather than arrays because the question asked of them is always
 * "is this one hidden", which is what a Set answers in one step.
 */
export interface InspectorFilters {
  /** Levels the reader has unticked. Rows at these levels are hidden. */
  hiddenLevels: Set<InspectorLevel>;

  /**
   * Transports the reader has unticked.
   *
   * The filter the chat lab has no equivalent of, and the one that makes
   * the two-transport lesson usable: with both a stdio and an HTTP client
   * connected, hiding one leaves the other's traffic alone on screen.
   */
  hiddenTransports: Set<McpTransport>;
}

/**
 * How a pair of rows relate, once the panel has matched them up.
 *
 * JSON-RPC pairs a response to its request by id. The panel uses that to
 * show a request and its answer together and to time the gap between
 * them — which is the inspector's main job and the reason the id is on
 * the wire contract at all.
 *
 *   open      a request arrived; no response has gone back yet
 *   answered  both halves are present
 *   orphan    a response with no matching request, or a request whose
 *             answer never came
 *
 * `orphan` earns its place by being the interesting one. A request with
 * no response is either a server that hung or an observer that missed a
 * row, and both are worth seeing rather than silently omitting. The
 * convention this project holds itself to — both halves of every
 * exchange get logged — is only checkable if the unmatched case has a
 * name.
 */
export type ExchangeState = "open" | "answered" | "orphan";
