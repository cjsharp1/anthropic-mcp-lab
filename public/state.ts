/**
 * state.ts — the handful of values that more than one module changes.
 *
 * Most state in the inspector belongs to one place and stays there:
 * the surface panel owns its own entry list, the log owns its scroll
 * behaviour. Those do not need moving.
 *
 * These are the exceptions — written by one module and read by
 * another.
 *
 * ---------------------------------------------------------------------------
 * Why an object rather than exported variables
 * ---------------------------------------------------------------------------
 *
 * An ES module's exports are live bindings that only the defining
 * module may assign to. `import { eventCount }` followed by
 * `eventCount += 1` is a compile error, not a runtime surprise —
 * which is the language stopping you from doing something that could
 * not work.
 *
 * So the shared values live on one object. `state.eventCount += 1`
 * mutates a property of a thing every module has the same reference
 * to, which is allowed. The `state.` prefix is the visible cost, and
 * it is also a useful signal: it marks every place where one part of
 * the UI reaches into another.
 *
 * The chat lab arrived at exactly this arrangement for exactly these
 * reasons, and its version carries a running cost and a session
 * total. There is no cost here to carry, which is the most visible
 * difference between the two panels and the one worth noticing.
 */

import type { InspectorLevel, McpTransport } from "../shared/types.js";

/** Everything written in one module and read in another. */
export const state = {
  // --- The log -------------------------------------------------------------

  /**
   * How many rows the panel holds, for the count beside its title.
   *
   * Counts every row received, including ones currently filtered out
   * of view. A filter hides rows; it does not unsay them, and a count
   * that dropped when you ticked a box would suggest otherwise.
   */
  eventCount: 0,

  /**
   * Levels the reader has unticked. Rows at these levels are hidden.
   *
   * Filtering happens in the browser and never reaches the server —
   * the server sends everything and the panel decides what to draw.
   * That split matters for a teaching app: turning a filter back on
   * reveals history rather than starting a new recording.
   */
  hiddenLevels: new Set<InspectorLevel>(),

  /**
   * Transports the reader has unticked.
   *
   * The filter the chat lab has no equivalent of, and the one that
   * makes the two-transport lesson usable. With a stdio client and an
   * HTTP client both connected, hiding one leaves the other's traffic
   * alone on screen.
   */
  hiddenTransports: new Set<McpTransport>(),

  /**
   * Whether the log scrolls itself as rows arrive.
   *
   * Turned off automatically when the reader scrolls up, because a
   * panel that yanks you back to the bottom while you are reading is
   * worse than one that needs a click. Turned back on when they
   * return to the bottom.
   */
  follow: true,

  // --- The connection ------------------------------------------------------

  /**
   * Whether the event stream is currently connected.
   *
   * Shown in the header. An inspector that has silently lost its
   * stream looks identical to a server with no traffic, and the
   * difference matters enough to put on screen.
   */
  connected: false,
};
