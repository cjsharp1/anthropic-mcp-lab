/**
 * types.ts — the shapes that travel between the server and the inspector.
 *
 * This file is the contract for the whole app. The server builds these
 * objects, serialises them as JSON over Server-Sent Events, and the browser
 * parses them back out. Nothing here has any behaviour: it is types only,
 * and it compiles to nothing at all.
 *
 * Keeping the definitions in one file means the two halves cannot quietly
 * disagree about what an inspector row looks like. It is the same job
 * shared/types.ts does in the chat lab, and deliberately the same shape —
 * but the thing being described is different, and the differences are
 * where the teaching is.
 *
 * ---------------------------------------------------------------------------
 * What is different here, and why
 * ---------------------------------------------------------------------------
 *
 * The chat lab logs ONE boundary: this app talking to Anthropic. Its rows
 * need to say what was sent, what came back, and what it cost.
 *
 * This app logs a different boundary, with three properties the chat lab's
 * events had no reason to carry:
 *
 *   1. There is no cost. Nothing here calls a model, so there are no
 *      tokens to count and no dollars to add up. A reader who goes looking
 *      for a cost column and finds none has learned something real about
 *      where the money is spent in an MCP setup.
 *
 *   2. There are two transports. The same exchange can arrive over stdio
 *      or over HTTP, and which one carried it is the single most useful
 *      fact for understanding that the transport is not the protocol.
 *
 *   3. The protocol is JSON-RPC, so every exchange has a METHOD
 *      ("tools/call", "resources/read") and usually an id pairing a
 *      response to its request. That pairing is explicit on the wire here,
 *      where in the Messages API it is implicit in the request/response
 *      cycle of one HTTP call.
 */

// ---------------------------------------------------------------------------
// Inspector events
// ---------------------------------------------------------------------------

/**
 * How significant an event is, and what kind of thing it describes.
 *
 * As in the chat lab, these levels are about *what happened* rather than
 * severity in the usual logging sense. A reader watching the panel wants
 * to tell a protocol message apart from a handler running, which matters
 * more here than distinguishing debug from warn.
 *
 *   info   Something the app did on its own: a server instance being
 *          built, a transport opening, a client completing a handshake.
 *          No protocol message involved.
 *
 *   mcp    A JSON-RPC message in either direction. These are the rows
 *          that ARE the protocol: initialize, tools/list, tools/call and
 *          their responses. Where the chat lab has "api", this has "mcp" —
 *          the same slot in the design, a different wire.
 *
 *   handler A registered tool, resource or prompt actually running. Split
 *          from "mcp" on purpose: the message arriving and the code running
 *          are two events, and collapsing them hides that a server can
 *          receive a call it refuses to execute.
 *
 *   warn   Nothing failed, but you should know. An unknown method, a
 *          client asking for a capability this server did not advertise,
 *          a protocol version negotiated downward.
 *
 *   error  Something failed. Always rendered prominently, because a silent
 *          failure in a teaching app teaches the wrong lesson.
 *
 * The line between warn and error is the same test the chat lab uses:
 * whether the thing that was asked for still happened. A tool that threw
 * is an error. A client that asked for a tool this server does not have
 * is a warning — the server answered correctly, and the answer was "no".
 */
export type InspectorLevel = "info" | "mcp" | "handler" | "warn" | "error";

/**
 * Which way a logged event travelled, if it travelled at all.
 *
 * Separate from `level` because the two answer different questions.
 * Level says what KIND of thing happened; direction says WHO SENT IT TO
 * WHOM.
 *
 *   in    a client → this server. A request or notification arriving.
 *   out   this server → a client. A response, or a notification we raise.
 *   call  this server → a handler. Our own code being invoked.
 *   back  a handler → this server. Its return value.
 *   none  neither; an internal note about lifecycle or configuration.
 *
 * ---------------------------------------------------------------------------
 * The test for choosing one
 * ---------------------------------------------------------------------------
 *
 * Ask: did data cross a boundary AT THE MOMENT this row was logged?
 *
 * If not, the direction is "none", however much the row is ABOUT
 * something that crossed one. The chat lab had to correct three rows that
 * got this wrong, all in the same way — they described data that had
 * already arrived, or was about to leave later. The failure mode is
 * consistent: a row that REPORTS ON a boundary crossing gets marked as
 * BEING one, and the panel then claims more round trips than happened.
 *
 * Note that "in" and "out" are reversed relative to the chat lab's
 * identical-looking field, and that is not a mistake to tidy up. There,
 * "out" meant a request leaving for Anthropic; this app is the one being
 * called, so "in" is the request arriving. The direction is always
 * relative to the process doing the logging — which is the whole reason
 * a client and a server see the same exchange as mirror images.
 */
export type InspectorDirection = "in" | "out" | "call" | "back" | "none";

/**
 * Which pipe carried an exchange.
 *
 * The field that makes the two-transport lesson visible. The same
 * tools/call, with the same envelope and the same result, can arrive
 * either way — and the ONLY difference in this entire type is this
 * string. That is the point: the transport is not the protocol.
 *
 *   stdio  a child process, talking over its stdin and stdout. How
 *          Claude Desktop launches a local server.
 *   http   Streamable HTTP. How a remote server works, and what the
 *          chat lab connects to.
 *   none   an internal event that did not arrive over either.
 */
export type McpTransport = "stdio" | "http" | "none";

/**
 * One row in the inspector.
 *
 * Deliberately small. Every field below is either shown in the panel or
 * used to decide how to show it — there is no metadata here that nobody
 * reads.
 */
export interface InspectorEvent {
  /** Which kind of event this is. Decides the colour and the tag text. */
  level: InspectorLevel;

  /**
   * Which way it travelled. Defaults to "none" when absent — an
   * internal note rather than something crossing a boundary.
   */
  direction?: InspectorDirection;

  /**
   * Which transport carried it. Defaults to "none" when absent.
   *
   * Optional rather than required because lifecycle events — a registry
   * being validated at startup, a server instance being constructed —
   * genuinely belong to neither.
   */
  transport?: McpTransport;

  /**
   * The JSON-RPC method this row concerns, when it concerns one.
   *
   * "tools/call", "resources/read", "initialize". Kept as a plain string
   * rather than a union of known methods on purpose: a client may send a
   * method this server does not implement, and the row that says so needs
   * to be able to name it. A union would make the unknown-method case —
   * the one most worth logging — the one case the type forbids.
   */
  method?: string;

  /**
   * The JSON-RPC id, for pairing a response with its request.
   *
   * The spec allows a string or a number, and notifications have no id at
   * all, which is what `undefined` means here. Do not normalise these to
   * strings: an id of 1 and an id of "1" are different ids, and quietly
   * merging them would pair the wrong rows together.
   */
  id?: string | number;

  /**
   * A short, human-readable summary — the whole of what the row shows by
   * default. Write it as a complete thought a reader can scan without
   * expanding anything: "tools/call → roll_dice", not "req_recv".
   */
  label: string;

  /**
   * Why this happened, in one phrase.
   *
   * Written as a sentence fragment that completes "because…":
   * "the client asked for the tool list", "the handler returned".
   */
  because?: string;

  /**
   * How long a handler took, in milliseconds.
   *
   * Only meaningful on a "back" row, where something actually ran. Absent
   * elsewhere rather than zero, because zero is a real duration and
   * "no duration applies" is not the same statement.
   */
  elapsedMs?: number;

  /**
   * The full data behind the event: a JSON-RPC envelope, a tool result,
   * an error with its stack.
   *
   * Rendered inside a collapsed element so the panel stays scannable
   * while the detail stays one click away. Optional, because plenty of
   * events are fully described by their label.
   *
   * Typed as `unknown` rather than `any`: this is arbitrary JSON from
   * many different call sites, and `unknown` forces the rendering code to
   * handle it defensively instead of assuming a shape. That is not
   * pedantry here — some of this JSON arrives from a remote client, and
   * the renderer is the last line of defence.
   */
  detail?: unknown;

  /**
   * When the event happened, as milliseconds since the epoch (Date.now()).
   *
   * A number rather than a Date object, because this crosses the wire as
   * JSON and JSON has no date type — a Date would arrive as a string and
   * need parsing back. The browser formats it for display.
   */
  at: number;
}

// ---------------------------------------------------------------------------
// What the server currently exposes
// ---------------------------------------------------------------------------

/**
 * One tool, resource or prompt, as the inspector's surface panel shows it.
 *
 * A single type for all three primitives rather than three near-identical
 * ones. They differ in how they are invoked, which is a server concern;
 * from the panel's point of view they are all "a named thing this server
 * offers, with a description and a schema you can look at".
 */
export interface SurfaceEntry {
  /** Which primitive this is. Decides the badge the panel draws. */
  kind: "tool" | "resource" | "prompt";

  /** The name a client calls it by, or the URI a resource is read from. */
  name: string;

  /** What it does, written for a model rather than for a developer. */
  description: string;

  /**
   * The input schema as JSON Schema, when the entry takes input.
   *
   * JSON Schema rather than the Zod object the server defines it with,
   * because this crosses the wire — and because JSON Schema is what a
   * client sees too. Showing the panel exactly what a client would get
   * means the panel cannot flatter the server.
   */
  inputSchema?: unknown;
}

/**
 * The answer to "what does this server offer right now".
 *
 * Fetched once when the inspector loads. Separate from the event stream
 * because it is state rather than history: the event log says what has
 * happened, this says what is currently true.
 */
export interface SurfaceSnapshot {
  /** The server's own name and version, as advertised in the handshake. */
  serverName: string;
  serverVersion: string;

  /** Everything registered, in the order the panel should list it. */
  entries: SurfaceEntry[];
}

// ---------------------------------------------------------------------------
// The stream the inspector receives
// ---------------------------------------------------------------------------

/**
 * Every message the server can send over the inspector stream.
 *
 * This is a discriminated union: the `type` field says which variant it
 * is, and TypeScript narrows the rest of the object once you check it.
 * The browser's event handler switches on `type`, and the compiler will
 * complain if a new variant is added here and not handled there.
 *
 * Only three variants, where the chat lab needs eight. That is not this
 * app being simpler — it is this app having a narrower job. The chat lab
 * streams a model's reply token by token and has to carry deltas,
 * thinking and completion. Nothing here streams: an MCP exchange either
 * has happened or has not.
 */
export type InspectorStreamEvent =
  /** A row for the traffic log. */
  | { type: "event"; event: InspectorEvent }
  /**
   * The surface changed — something was registered or removed.
   *
   * Sent rather than requiring a refetch so the panel cannot drift out of
   * date without anyone noticing. Carries the whole snapshot rather than
   * a diff, because the snapshot is small and a diff would be a second
   * thing that can be wrong.
   */
  | { type: "surface"; surface: SurfaceSnapshot }
  /** Something failed in a way the inspector should show prominently. */
  | { type: "error"; message: string };
