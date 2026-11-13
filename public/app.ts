/**
 * app.ts — wires the inspector together.
 *
 * Finds the elements, builds the filter checkboxes, opens the event
 * stream, and routes what arrives to the module that draws it. It
 * holds no rendering logic of its own: the log draws rows, the
 * surface panel draws entries, and this decides which gets what.
 *
 * ---------------------------------------------------------------------------
 * The import graph runs one way
 * ---------------------------------------------------------------------------
 *
 *   app.ts  →  log.ts, surface.ts, state.ts
 *   log.ts  →  json-tree.ts, state.ts
 *   surface.ts  →  json-tree.ts
 *
 * and NOTHING imports app.ts. The chat lab holds the same rule for the
 * same reason: the entry point may know about everything, and nothing
 * may know about the entry point. A cycle through the top of the graph
 * is the hardest kind to unpick, because the fix is usually to move
 * code that looks like it belongs where it is.
 *
 * ---------------------------------------------------------------------------
 * Why EventSource rather than fetch
 * ---------------------------------------------------------------------------
 *
 * Server-Sent Events have a browser API that handles the parts that
 * are tedious to get right by hand: framing the `data:` lines,
 * reconnecting after a drop, and backing off between attempts. A
 * `fetch` with a streaming reader would need all three written here.
 *
 * The automatic reconnect is the one that earns it. Restarting
 * `npm run dev` drops every stream, and with EventSource the panel
 * reconnects on its own a second later. The `connected` indicator in
 * the header exists to make that visible rather than mysterious.
 */

import type { InspectorStreamEvent } from "../shared/types.js";
import {
  LEVELS,
  TRANSPORTS,
  appendEvent,
  applyFilters,
  clearLog,
  initLog,
} from "./log.js";
import { initSurface, renderSurface } from "./surface.js";
import { state } from "./state.js";

/**
 * Finds an element, or throws.
 *
 * A missing element is a mistake in index.html, and the useful moment
 * to hear about it is immediately — not later, via a silent no-op in
 * a render function that checked for null and gave up. The cast is
 * unavoidable: `getElementById` cannot know what it will find.
 */
function need<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html is missing #${id}`);
  return element as T;
}

/** Builds one filter checkbox and wires it to a filter set. */
function buildFilter(
  host: HTMLElement,
  value: string,
  hidden: Set<string>,
  className: string,
): void {
  const label = document.createElement("label");
  label.className = `filter ${className}`;

  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = true;

  box.addEventListener("change", () => {
    // The set holds what is HIDDEN, so a ticked box means absent.
    // Storing the inverse — what is shown — would mean seeding the
    // set with every value at startup and keeping it in step as
    // values are added.
    if (box.checked) hidden.delete(value);
    else hidden.add(value);

    applyFilters();
  });

  const text = document.createElement("span");
  text.textContent = value === "none" ? "internal" : value;

  label.append(box, text);
  host.append(label);
}

/** Reflects the connection state in the header. */
function setConnected(connected: boolean, indicator: HTMLElement): void {
  state.connected = connected;
  indicator.classList.toggle("on", connected);
  indicator.textContent = connected ? "live" : "reconnecting…";
}

function main(): void {
  initLog(need("log"), need("log-count"));
  initSurface(need("surface"), need("server-identity"));

  // --- Filters -------------------------------------------------------------

  const levelFilters = need("level-filters");
  for (const level of LEVELS) {
    buildFilter(levelFilters, level, state.hiddenLevels, `f-${level}`);
  }

  const transportFilters = need("transport-filters");
  for (const transport of TRANSPORTS) {
    buildFilter(
      transportFilters,
      transport,
      state.hiddenTransports,
      `f-${transport}`,
    );
  }

  need("clear").addEventListener("click", () => clearLog());

  // --- The stream ----------------------------------------------------------

  const indicator = need("connection");

  const source = new EventSource("/api/stream");

  source.addEventListener("open", () => setConnected(true, indicator));

  // Fired on a drop as well as on a failure. EventSource retries by
  // itself, so this reports rather than reacts — the one thing that
  // would be wrong here is calling source.close(), which would turn a
  // recoverable blip into a permanently dead panel.
  source.addEventListener("error", () => setConnected(false, indicator));

  source.addEventListener("message", (message: MessageEvent<string>) => {
    // Everything below arrives from the server as JSON. Parsing is
    // wrapped because a malformed frame should cost one row, not the
    // whole panel: an uncaught throw in an event listener kills no
    // other listener, but it does lose this event silently, and a
    // visible complaint in the console is better than that.
    let parsed: InspectorStreamEvent;
    try {
      parsed = JSON.parse(message.data) as InspectorStreamEvent;
    } catch {
      console.error("Could not parse an event from the server.");
      return;
    }

    // A discriminated union, switched on `type`. The compiler will
    // complain here if a variant is added to shared/types.ts and not
    // handled — which is the reason the stream is typed as a union
    // rather than as a loose object.
    switch (parsed.type) {
      case "event":
        appendEvent(parsed.event);
        return;

      case "surface":
        renderSurface(parsed.surface);
        return;

      case "error":
        appendEvent({
          level: "error",
          label: parsed.message,
          at: Date.now(),
        });
        return;
    }
  });
}

main();
