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
 * payoff is sharper, because this server genuinely runs with no
 * inspector attached: over stdio there is no browser, no SSE and
 * nowhere to send anything. Every log call still works, and goes
 * nowhere.
 *
 * ---------------------------------------------------------------------------
 * What a Logger is
 * ---------------------------------------------------------------------------
 *
 * A set of small functions, one per level, each building an
 * `InspectorEvent` and handing it to a sink. The sink is supplied at
 * construction — `makeLogger(fn)` — so the same code serves a live
 * browser connection and a silent stdio process.
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
  InspectorDirection,
  InspectorEvent,
  InspectorLevel,
  McpTransport,
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
 * A logger that discards everything.
 *
 * For the stdio path, which has no inspector attached and must not
 * write to stdout under any circumstances — see the rule at the top of
 * server/stdio.ts.
 *
 * A no-op object rather than making the logger optional everywhere. A
 * nullable logger means `log?.info(...)` at every call site and one
 * forgotten `?` away from a crash; a silent logger means the calls are
 * unconditional and the silence is configuration.
 */
export const silentLogger: Logger = makeLogger(() => {});

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

/**
 * Describes a direction in words, for a label.
 *
 * The inspector draws an arrow from the `direction` field, but a label
 * read on its own — in a terminal, in a copied row — needs the word.
 */
export function directionWord(direction: InspectorDirection): string {
  switch (direction) {
    case "in":
      return "received";
    case "out":
      return "sent";
    case "call":
      return "calling";
    case "back":
      return "returned";
    case "none":
      return "";
  }
}

/** Names a transport for a label. Exhaustive, so a new one must be handled. */
export function transportWord(transport: McpTransport): string {
  switch (transport) {
    case "stdio":
      return "stdio";
    case "http":
      return "HTTP";
    case "none":
      return "internal";
  }
}
