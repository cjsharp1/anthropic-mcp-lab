/**
 * json-tree.ts — renders a value as a collapsible tree.
 *
 * Copied from the Anthropic Chat Lab, unchanged apart from this note.
 *
 * Recorded rather than quietly duplicated, because an unexplained
 * identical file in two projects is a thing a later reader has to
 * investigate. It is shared by copy rather than by package: two
 * teaching repos that each stand alone are worth more here than one
 * shared dependency nobody can read without cloning a third thing.
 *
 * If it is changed in one project, it has diverged — which is allowed,
 * but should be said in this comment when it happens.
 *
 * The payloads differ between the two labs even though the renderer
 * does not: there the tree shows an Anthropic request body, here it
 * shows a JSON-RPC envelope or a tool result.
 *
 * The activity log used to print each payload as one block of
 * JSON.stringify output. That is fine for a token count and useless
 * for a request body: the interesting field is `output_config` or
 * `cache_control` or one tool's schema, and finding it means
 * scrolling past two kilobytes of things you already understand.
 *
 * ---------------------------------------------------------------------------
 * Why <details> rather than click handlers
 * ---------------------------------------------------------------------------
 *
 * Every object and array becomes a <details> element. The browser then
 * supplies the toggling, the keyboard behaviour (Enter and Space on a
 * focused summary), the correct announcement to a screen reader, and
 * the open/closed state — none of which has to be written or tested
 * here. A div with a click handler would need all four and would get
 * at least one of them wrong.
 *
 * ---------------------------------------------------------------------------
 * What is open to begin with
 * ---------------------------------------------------------------------------
 *
 * The top two levels, and nothing deeper. Opening everything puts you
 * back where you started; opening nothing means three clicks before
 * you see anything. Two levels shows the shape of a request — model,
 * max_tokens, system, messages, tools — with the bulky parts still
 * folded.
 *
 * Long strings are truncated with a control to show the rest, because
 * a system prompt or a tool description is frequently the longest
 * thing in the payload and rarely the thing being looked for.
 */

/** How deep to open automatically. */
const OPEN_DEPTH = 2;

/** Characters of a string shown before it is truncated. */
const STRING_PREVIEW = 120;

/**
 * How many entries a container can hold and still be worth expanding
 * automatically. A `messages` array of forty turns is not.
 */
const AUTO_OPEN_MAX_ENTRIES = 12;

/** True for a plain object or an array — the things that can nest. */
function isContainer(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** A one-line description of what is inside a container, unopened. */
function summarise(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 1 ? "1 item" : `${value.length} items`;
  }

  const keys = Object.keys(value as object);
  if (keys.length === 0) return "empty";

  // The first few key names, because "6 keys" says less than
  // "model, max_tokens, system…" about whether this is the thing you
  // are looking for.
  const shown = keys.slice(0, 3).join(", ");
  return keys.length > 3 ? `${shown}, +${keys.length - 3} more` : shown;
}

/** Renders a primitive, styled by type so the eye can sort them. */
function renderPrimitive(value: unknown): HTMLElement {
  const span = document.createElement("span");

  if (value === null) {
    span.className = "jt-null";
    span.textContent = "null";
    return span;
  }

  switch (typeof value) {
    case "string": {
      span.className = "jt-string";

      // Long strings fold. A tool's description or a system prompt is
      // usually the biggest thing in a payload and seldom the reason
      // anyone opened it.
      if (value.length > STRING_PREVIEW) {
        const shown = document.createElement("span");
        shown.textContent = `"${value.slice(0, STRING_PREVIEW)}`;

        const rest = document.createElement("span");
        rest.className = "jt-hidden-rest";
        rest.textContent = `${value.slice(STRING_PREVIEW)}"`;
        rest.hidden = true;

        const more = document.createElement("button");
        more.type = "button";
        more.className = "jt-more";
        more.textContent = `…+${value.length - STRING_PREVIEW} chars`;

        more.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          rest.hidden = !rest.hidden;
          more.textContent = rest.hidden
            ? `…+${value.length - STRING_PREVIEW} chars`
            : " show less";
        });

        span.append(shown, rest, more);
        return span;
      }

      span.textContent = `"${value}"`;
      return span;
    }

    case "number":
      span.className = "jt-number";
      span.textContent = String(value);
      return span;

    case "boolean":
      span.className = "jt-boolean";
      span.textContent = String(value);
      return span;

    default:
      span.className = "jt-other";
      span.textContent = String(value);
      return span;
  }
}

/**
 * Renders one value, recursively.
 *
 * @param value The thing to render.
 * @param key   Its name in the parent, or null at the root.
 * @param depth How deep this is, which decides whether it starts open.
 */
function renderValue(
  value: unknown,
  key: string | null,
  depth: number,
): HTMLElement {
  if (!isContainer(value)) {
    const line = document.createElement("div");
    line.className = "jt-line";

    if (key !== null) {
      const label = document.createElement("span");
      label.className = "jt-key";
      label.textContent = key;
      line.append(label, document.createTextNode(": "));
    }

    line.appendChild(renderPrimitive(value));
    return line;
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);

  const node = document.createElement("details");
  node.className = "jt-node";

  // Shallow and small containers start open; deep or long ones do not.
  node.open = depth < OPEN_DEPTH && entries.length <= AUTO_OPEN_MAX_ENTRIES;

  const summary = document.createElement("summary");
  summary.className = "jt-summary";

  if (key !== null) {
    const label = document.createElement("span");
    label.className = "jt-key";
    label.textContent = key;
    summary.append(label, document.createTextNode(": "));
  }

  const bracket = document.createElement("span");
  bracket.className = "jt-bracket";
  bracket.textContent = Array.isArray(value) ? "[" : "{";
  summary.appendChild(bracket);

  const hint = document.createElement("span");
  hint.className = "jt-hint";
  hint.textContent = summarise(value);
  summary.appendChild(hint);

  const close = document.createElement("span");
  close.className = "jt-bracket";
  close.textContent = Array.isArray(value) ? "]" : "}";
  summary.appendChild(close);

  node.appendChild(summary);

  const children = document.createElement("div");
  children.className = "jt-children";
  for (const [childKey, childValue] of entries) {
    children.appendChild(renderValue(childValue, childKey, depth + 1));
  }
  node.appendChild(children);

  return node;
}

/**
 * Builds the tree, with controls to open and close all of it.
 *
 * The two buttons exist because the per-node toggles solve the wrong
 * half of the problem on their own: finding one field in a folded
 * tree means opening six things, and getting back to an overview
 * after exploring means closing them again.
 */
export function buildJsonTree(value: unknown): HTMLElement {
  const container = document.createElement("div");
  container.className = "json-tree";

  const controls = document.createElement("div");
  controls.className = "jt-controls";

  const expandAll = document.createElement("button");
  expandAll.type = "button";
  expandAll.className = "jt-control";
  expandAll.textContent = "Expand all";

  const collapseAll = document.createElement("button");
  collapseAll.type = "button";
  collapseAll.className = "jt-control";
  collapseAll.textContent = "Collapse all";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "jt-control";
  copy.textContent = "Copy JSON";

  controls.append(expandAll, collapseAll, copy);
  container.appendChild(controls);

  const tree = document.createElement("div");
  tree.className = "jt-root";
  tree.appendChild(renderValue(value, null, 0));
  container.appendChild(tree);

  /** Opens or closes every node at once. */
  const setAll = (open: boolean): void => {
    for (const node of tree.querySelectorAll<HTMLDetailsElement>(".jt-node")) {
      node.open = open;
    }
    // The folded tails of long strings follow the same switch: an
    // "expand all" that leaves text truncated has not expanded all.
    for (const rest of tree.querySelectorAll<HTMLElement>(".jt-hidden-rest")) {
      rest.hidden = !open;
    }
    for (const more of tree.querySelectorAll<HTMLButtonElement>(".jt-more")) {
      // The label is rebuilt from the hidden length so it stays honest.
      const tail = more.previousElementSibling;
      const length = tail?.textContent?.length ?? 0;
      more.textContent = open ? " show less" : `…+${Math.max(length - 1, 0)} chars`;
    }
  };

  expandAll.addEventListener("click", () => setAll(true));
  collapseAll.addEventListener("click", () => setAll(false));

  copy.addEventListener("click", () => {
    // The whole payload, formatted — what you want in a bug report or
    // a message to someone else, which the tree itself is not.
    let text: string;
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }

    void navigator.clipboard
      .writeText(text)
      .then(() => {
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy JSON";
        }, 1500);
      })
      .catch(() => {
        // Clipboard access can be refused. Saying so beats a button
        // that silently does nothing.
        copy.textContent = "Blocked";
        window.setTimeout(() => {
          copy.textContent = "Copy JSON";
        }, 1500);
      });
  });

  return container;
}
