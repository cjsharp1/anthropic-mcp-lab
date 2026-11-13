/**
 * logger.ts — builds the events the inspector shows.
 *
 * One small indirection with a specific job: the code that notices
 * something happened should not know who is watching. A tool handler
 * calls `log.handler(...)`; whether that reaches a browser, a test, or
 * nothing at all is decided here and nowhere else.
 *
 * The chat lab makes the same move and it pays off the same way. Its
 * patterns log into a function that writes Server-Sent Events, and none
 * of them had to change when the log panel was rewritten. Here the
 * payoff is that the inspector is optional: `index.ts` builds a logger
 * whose sink feeds the observer, and `stdio.ts` builds none at all,
 * because nothing over there is watching and stdout belongs to the
 * protocol.
 *
 * ---------------------------------------------------------------------------
 * What a Logger is
 * ---------------------------------------------------------------------------
 *
 * A set of small functions, one per level, each building an
 * `InspectorEvent` and handing it to a sink. The sink is supplied at
 * construction — `makeLogger(fn)` — so the code that logs never learns
 * where its events end up.
 *
 * The methods take their fields in a deliberate order: the label
 * first, because it is the only required one, then the detail, then
 * the metadata nobody always has. That keeps the common call short:
 *
 *     log.info("Serving on port 3100");
 *
 * while a fully specified one stays readable:
 *
 *     log.mcp("tools/call → roll_dice", envelope, {
 *       direction: "in", transport: "http", method: "tools/call", id: 7,
 *     });
 */

import type {
  InspectorEvent,
  InspectorLevel,
} from "../shared/types.js";

/**
 * The optional fields of an event, minus the ones the methods set.
 *
 * `level` is fixed by which method was called, and `at` is stamped
 * here — neither belongs in what a caller passes. `Omit` derives this
 * from the event type rather than restating its fields, so adding one
 * to the wire contract makes it available here automatically.
 */
export type EventExtras = Omit<InspectorEvent, "level" | "label" | "detail" | "at">;

/** Everything the server can log. */
export interface Logger {
  /** Something the app did on its own. No protocol message involved. */
  info(label: string, detail?: unknown, extras?: EventExtras): void;

  /** A JSON-RPC message in either direction. The protocol itself. */
  mcp(label: string, detail?: unknown, extras?: EventExtras): void;

  /** A registered tool, resource or prompt actually running. */
  handler(label: string, detail?: unknown, extras?: EventExtras): void;

  /** Nothing failed, but you should know. */
  warn(label: string, detail?: unknown, extras?: EventExtras): void;

  /** Something failed. */
  error(label: string, detail?: unknown, extras?: EventExtras): void;
}

/** Where a built event goes. */
export type LogSink = (event: InspectorEvent) => void;

/**
 * Builds a logger that writes into the given sink.
 *
 * Every method funnels through one `emit`, so the shape of an event is
 * decided in exactly one place. A level that needed special handling
 * would be a sign the level should not exist.
 */
export function makeLogger(sink: LogSink): Logger {
  function emit(
    level: InspectorLevel,
    label: string,
    detail: unknown,
    extras: EventExtras | undefined,
  ): void {
    sink({
      level,
      label,
      // Spread before the fixed fields so a caller cannot accidentally
      // override `level` or `at` by passing them in extras. The type
      // already forbids it; this makes the runtime agree.
      ...extras,
      ...(detail !== undefined ? { detail } : {}),
      at: Date.now(),
    });
  }

  return {
    info: (label, detail, extras) => emit("info", label, detail, extras),
    mcp: (label, detail, extras) => emit("mcp", label, detail, extras),
    handler: (label, detail, extras) => emit("handler", label, detail, extras),
    warn: (label, detail, extras) => emit("warn", label, detail, extras),
    error: (label, detail, extras) => emit("error", label, detail, extras),
  };
}

/**
 * Shortens text for a log label.
 *
 * The full value always goes in the event's detail, so nothing is lost
 * — this only keeps the one-line summary scannable. A resource
 * returning 10KB of Markdown would otherwise produce a row taller than
 * the panel.
 */
export function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}
