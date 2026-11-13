/**
 * observer.ts — the tap. Holds the connected inspectors and feeds them.
 *
 * One object, created once in `index.ts`, that does two jobs:
 *
 *   1. Keeps the set of browsers currently watching, and broadcasts
 *      every event to all of them.
 *   2. Turns the handler hooks `mcp-server.ts` offers into log events,
 *      so that file never has to know what an inspector is.
 *
 * ---------------------------------------------------------------------------
 * Why a broadcast rather than a single connection
 * ---------------------------------------------------------------------------
 *
 * Two browser tabs on the inspector should both work, and both should
 * see the same traffic. That sounds obvious and is worth stating
 * because the alternative — one global `res` that each new connection
 * overwrites — is the version that gets written first and appears to
 * work until someone opens a second tab, at which point the first goes
 * quiet with no error anywhere.
 *
 * So: a Set of sinks, added on connect and removed on disconnect.
 * Removal matters as much as addition. A disconnected browser whose
 * sink is still in the Set means every subsequent event tries to write
 * to a closed socket, which on Express is a slow leak rather than a
 * loud failure.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT do
 * ---------------------------------------------------------------------------
 *
 * It does not itself see raw JSON-RPC frames. The SDK owns the
 * transport and offers no "show me every message on the wire" hook.
 *
 * What this object sees is everything either side of that: a request
 * arriving (logged by the Express route before the handler runs), each
 * handler running and returning (logged through the hooks), and the
 * response going back.
 *
 * The frames themselves ARE logged, by envelope.ts, which taps the
 * HTTP stream in the route rather than asking the SDK for a hook it
 * does not have. Those rows arrive here through the same log methods
 * as any other, so nothing in this file knows the difference.
 *
 * That closed the limit this comment used to describe: a message the
 * SDK rejects before dispatch — a malformed frame, an unknown method
 * — produced a request row and a response row with nothing in
 * between. It now produces an error row naming the rejection, because
 * the JSON-RPC error travels in the response body where the tap can
 * see it, even though the HTTP status is 200.
 */

import type { InspectorEvent, SurfaceSnapshot } from "../shared/types.js";
import { makeLogger, truncate, type Logger } from "./logger.js";
import type { HandlerHooks } from "./mcp-server.js";

/** A connected inspector. Returns false when the socket is gone. */
export type Subscriber = (event: InspectorEvent) => void;

/**
 * How many events to keep for a browser that connects late.
 *
 * Without a buffer, opening the inspector after a few tool calls shows
 * an empty panel, which reads as "nothing happened" rather than "you
 * were not watching". A hundred rows is enough to cover the session so
 * far in normal use and small enough that the memory cost is not worth
 * thinking about.
 *
 * It is a bounded array rather than a growing one on purpose: a
 * long-running server with an unbounded log is a memory leak with a
 * teaching rationale attached.
 */
const REPLAY_LIMIT = 100;

/**
 * The tap.
 *
 * Deliberately a class rather than a module of functions with
 * module-level state. The state here — who is connected, what has
 * happened — is genuinely per-server-instance, and a module-level Set
 * would be shared by every test that imported it.
 */
export class Observer {
  /** Everyone currently watching. */
  private readonly subscribers = new Set<Subscriber>();

  /** The last REPLAY_LIMIT events, for browsers that connect late. */
  private readonly recent: InspectorEvent[] = [];

  /** What the server exposes. Set once at startup by index.ts. */
  private surface: SurfaceSnapshot | null = null;

  /**
   * The logger every part of the server writes through.
   *
   * A property rather than a separate export, so there is exactly one
   * logger per Observer and no way to end up with a logger whose
   * events go to a different observer than the one being watched.
   */
  readonly log: Logger;

  constructor() {
    // The sink closes over `this`, which is what connects the logging
    // API to the broadcast below. Defined in the constructor rather
    // than as a method reference so there is no `this`-binding hazard
    // if a caller ever destructures the logger.
    this.log = makeLogger((event) => this.publish(event));
  }

  /** Records what the server exposes, so a new inspector can be told. */
  setSurface(surface: SurfaceSnapshot): void {
    this.surface = surface;
  }

  /** What the server exposes, or null before startup finishes. */
  getSurface(): SurfaceSnapshot | null {
    return this.surface;
  }

  /** The events a newly connected inspector should be shown first. */
  getRecent(): readonly InspectorEvent[] {
    return this.recent;
  }

  /**
   * Adds a subscriber and returns a function that removes it.
   *
   * Returning the unsubscribe rather than exposing a `remove(fn)`
   * means the caller cannot get the removal wrong: there is no way to
   * pass a different function than the one that was added, which is
   * the usual cause of a listener that never goes away.
   */
  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** How many inspectors are watching. For the startup log and tests. */
  get watcherCount(): number {
    return this.subscribers.size;
  }

  /**
   * Sends one event to every subscriber, and remembers it.
   *
   * Each subscriber is called inside its own try/catch. One browser
   * whose socket died between the check and the write must not stop
   * the others from being told — and must not propagate an exception
   * back into whatever was being logged, which could be the middle of
   * a tool call.
   */
  private publish(event: InspectorEvent): void {
    this.recent.push(event);
    if (this.recent.length > REPLAY_LIMIT) this.recent.shift();

    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // Deliberately swallowed, and deliberately not logged.
        //
        // Logging here would call publish() again, from inside
        // publish(), for an error whose most likely cause is a sink
        // that cannot be written to. The recursion would be shallow
        // but it would also be pointless: the subscriber is about to
        // be removed by its own close handler anyway.
        this.subscribers.delete(subscriber);
      }
    }
  }

  /**
   * The hooks `mcp-server.ts` calls while a handler runs.
   *
   * This is the join between the two halves of the design. `createServer`
   * knows nothing about inspectors; it knows it may call `onStart` and
   * `onFinish`. The Observer knows nothing about MCP registration; it
   * knows how to turn those two calls into rows.
   *
   * `transport` is supplied by the caller because the handler cannot
   * know it — see the note in tools/definitions/inspect-request.ts
   * about why a tool must not be able to tell. The Express route knows
   * it is HTTP, so it says so here.
   */
  hooks(transport: "http" | "stdio"): HandlerHooks {
    return {
      onStart: (kind, name, input) => {
        this.log.handler(`${kind} ${name} running`, { input }, {
          direction: "call",
          transport,
          because: `a ${kind === "tool" ? "tools/call" : kind === "resource" ? "resources/read" : "prompts/get"} asked for it`,
        });
      },

      onFinish: (kind, name, outcome) => {
        if (!outcome.ok) {
          this.log.error(
            `${kind} ${name} failed: ${truncate(outcome.summary, 44)}`,
            outcome,
            { direction: "back", transport, elapsedMs: outcome.elapsedMs },
          );
          return;
        }

        this.log.handler(
          `${kind} ${name} → ${truncate(outcome.summary, 44)}`,
          outcome,
          { direction: "back", transport, elapsedMs: outcome.elapsedMs },
        );
      },
    };
  }
}
