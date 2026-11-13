# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

A teaching MCP server with a live inspector beside it. People read
this code to learn from it, which changes what "good" means here:
**the explanation is part of the deliverable, not decoration on top
of it.**

Optimising a file into something terse and clever makes this codebase
worse even when the result is objectively better code.

It is the companion to `anthropic-chat-lab`, which sits beside it on
disk. The two are meant to read as one body of work — where something
here mirrors something there, keep the vocabulary and the shape the
same, and say in a comment when they deliberately differ.

## The comment convention

Every `.ts` file opens with a block comment that names the file and
explains what it does, why it exists, and which concept it teaches.
This is enforced:

```bash
npm run audit-comments
```

It checks that a header exists, names its file, and is long enough to
be an explanation rather than a label. It cannot judge quality — that
part is on you.

Inline comments explain **why**, and especially explain the trap.
Several comments here exist specifically to stop a bug being
reintroduced; do not delete one because the code "looks obvious", as
the comment is why it looks obvious.

When you change behaviour, update the comment that describes it in
the same edit. A stale explanation is worse here than no explanation.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Inspector + MCP endpoint on 3100, restart on save |
| `npm run stdio` | Serve over stdio instead (no inspector) |
| `npm run typecheck` | **Both** halves — server and client |
| `npm run build` | Compile both halves into `dist/` |
| `npm run audit-comments` | Verify every file has a header |
| `npm run try-http` / `try-stdio` | Drive the server as a client |

Before finishing any change, run `npm run typecheck` and
`npm run audit-comments`. Both are fast.

## Architecture

Two halves with a hard boundary between them:

- `server/` — the MCP server, Express, the observer.
- `public/` — the inspector. Compiles **in place** (`public/app.ts` →
  `public/app.js`), which is why `public/*.js` is git-ignored.
- `shared/types.ts` — the wire contract for the inspector's event
  stream, imported by both so they cannot disagree.

The client `tsconfig` sets `"types": []` deliberately, so server
globals like `process` cannot be referenced from browser code — and
so the inspector cannot import from `server/` at all. Do not "fix"
that by adding `node` types.

Each primitive follows the same three levels: `types.ts` imports
nothing, `definitions/` import types, `registry.ts` imports the
definitions. That is a dependency order, not tidiness — the chat lab
put its interface in the registry once and got a cycle that worked
with one tool and threw `Cannot access 'currentTime' before
initialization` with two.

## The MCP SDK

**`@modelcontextprotocol/sdk` 1.x is superseded** by the split
`@modelcontextprotocol/server` and `/client` packages at 2.x. Most
tutorials still show the 1.x shape and several of its APIs no longer
exist. Check the installed `.d.mts` files before writing against
remembered API shapes.

Things that bite:

- **The serving entry points take a FACTORY, not a server.**
  `serveStdio(createServer)` and `createMcpHandler(factory)` call it
  more than once — including for a discovery probe whose result is
  discarded, and over HTTP once per request. Returning a shared
  instance compiles, serves one client, and breaks under version
  negotiation.
- That factory is called with the SDK's own `McpRequestContext`, so a
  factory taking different arguments does not fit. Hooks reach
  `createServer` by **closure** (`makeServerFactory`), not by
  parameter.
- **Tool input schemas are Zod objects**, not JSON Schema. The SDK
  reads the Standard Schema interface. The raw-shape form is
  deprecated — write `z.object({...})`.
- `moduleResolution: NodeNext` is load-bearing: it resolves the
  packages' subpath exports (`/stdio`) to their type definitions.
- HTTP serving is `createMcpHandler()` returning a web-standard
  handler, mounted with `toNodeHandler()`. There is no
  `StreamableHTTPServerTransport` to wire up by hand.

## Invariants

These are load-bearing. Changing one is a deliberate decision, not a
refactor:

- **No API key, ever.** This server never calls Anthropic. If a change
  starts to need one, that change belongs in the chat lab.
- **`/mcp` is mounted before `express.json()`.** The adapter reads the
  raw body itself; a parser that has already drained the stream
  leaves it nothing to read.
- **`responseMode: "auto"`.** Setting it to `"json"` silently drops
  every mid-call notification, which makes `slow_task` look broken
  over HTTP while working over stdio.
- **The localhost Host and Origin guards stay.** A browser on any page
  can POST to a local port; without them, any site you visit could
  drive this server.
- **Everything crossing the MCP boundary is untrusted.** Tool
  descriptions, resource contents and prompt text can come from a
  remote server, so the inspector renders with `textContent`, never
  `innerHTML`.
- **Both halves of every exchange get logged.** A request with no
  logged response is a bug in the observer, not a quiet success.
- **`stdio.ts` must never write to stdout.** stdout IS the protocol
  connection there; a stray `console.log` corrupts the stream.
  Diagnostics go to stderr. In `index.ts` stdout is just a terminal,
  so `console.log` is correct there — the rule is per-entry-point.

## Styling

The inspector shares the chat lab's log vocabulary deliberately: the
same `--level-*` variables with the same values in both themes, the
same `1.1rem 1fr` row grid, the same two-dimensional scheme where
**direction** tints the row and **level** colours one word.

If you change a colour or the row shape here, check whether the chat
lab needs the same change. Two panels meant to be read side by side
should not drift.

`json-tree.ts` is copied from the chat lab and emits `jt-*` class
names. Nothing checks that the stylesheet and that file agree — a
renamed class loses its styling silently rather than failing.

## Documentation to keep in sync

Changing setup, routes or counts means updating:

- `README.md` — setup, scripts table, project layout, security notes
- `index.html` — the fact strip, dependency table, status row
- `.env.example` — if env handling changes

The counts in `index.html` are checkable claims and have gone stale
in the sibling project before. Measure them; do not estimate.

## GitHub Pages

`index.html` is the project overview, published at
<https://cjsharp1.github.io/anthropic-mcp-lab/> and served from the
repo root on `main`. It carries that name, rather than a more
descriptive one, because Pages serves it as the site root.

It is a complete HTML document: doctype, `<html lang>`, `<head>` with
`<meta charset="utf-8">`, `<body>`. Keep it that way. Served over
HTTP without a doctype it renders in quirks mode, and without the
charset the browser guesses windows-1252 and every em-dash becomes
mojibake.
