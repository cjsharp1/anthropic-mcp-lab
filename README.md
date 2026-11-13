# Anthropic MCP Lab

An MCP server you can watch.

It is a Model Context Protocol server with a live inspector beside it.
The inspector shows every MCP message in both directions — the actual
envelope, not a summary — along with which transport carried it and how
long each handler took.

It is the companion to the
[Anthropic Chat Lab](https://github.com/cjsharp1/anthropic-chat-lab),
and the two are built to run at the same time. The chat lab shows you
the **Anthropic API** boundary. This shows you the **MCP** boundary — a
second, independent protocol, with its own handshake, its own envelope
and its own idea of what a tool is.

Run both and the whole picture is on screen at once: Claude asks the
chat lab for a tool, the chat lab asks this server, this server answers,
and the answer travels back out. Two logs, two protocols, one request.

📄 **[Project overview](https://cjsharp1.github.io/anthropic-mcp-lab/)**
— a one-page tour of the architecture and the plan, without cloning
anything.

---

> ## Status: complete
>
> All five phases are done. The server runs over both transports, the
> inspector shows every exchange live, and the chat lab borrows these
> tools over MCP.
>
> It is built to be read and watched, not deployed: no authentication,
> binds to localhost, and it executes tools for anyone who can reach
> it.

---

## What you need

| | |
|---|---|
| **Node.js** | 20 or newer. Developed on 24.4.1 — check with `node --version` |
| **An API key** | **No.** This server never calls Anthropic — see below |

No database, no Docker, no hosting, no account.

---

## Setup

```bash
npm install
npm run dev
```

Then open <http://localhost:3100>. That is the whole setup — there is
no `.env` to create and no key to paste.

To see traffic in the inspector, drive the server from a client. With
`npm run dev` still running, in another terminal:

```bash
npm run try-http
```

The script walks through all three primitives and the inspector fills
up as it goes.

### Connecting it to Claude Desktop

Build first (`npm run build`), then add a server entry pointing at
`node dist/server/stdio.js`. Note that stdio traffic does **not**
appear in the inspector: a stdio server is a child process of whoever
launched it, so Claude Desktop gets its own copy of this server and
the one behind the web page never sees those calls. That is a property
of the transport, not a limitation of the lab.

---

## Why there is no API key

This is the thing the project exists to make obvious, so it is worth
stating plainly rather than leaving for someone to notice.

**An MCP server does not talk to a model.** It exposes tools, resources
and prompts, and waits for a client to call them. The model sits on the
far side of that client — in the chat lab, or in Claude Desktop — and
this process never sees it, never sends it anything, and needs no
credential to do its job.

So the chat lab holds a key and guards it carefully; this project holds
none and has nothing to guard. Running `npm run check-env` in both and
comparing the output answers "which component talks to Anthropic?"
faster than a paragraph can.

If an `ANTHROPIC_API_KEY` does find its way into this project's `.env`,
`check-env` will point it out. Nothing reads it, and a secret stored
where nothing needs it is pure downside.

### The one setting

```
PORT=3100
```

Optional; 3100 is the default. It is 3100 rather than 3000 so this can
run alongside the chat lab, which is the configuration the two projects
are designed for. `check-env` fails if you set it to 3000, because the
error you get otherwise — `EADDRINUSE` at startup — does not mention
either project.

---

## Using both labs together

This is the configuration the two projects are built for.

| Where | Command | Opens |
|---|---|---|
| `anthropic-mcp-lab` | `npm run dev` | <http://localhost:3100> — the inspector |
| `anthropic-chat-lab` | `npm run dev` | <http://localhost:3000> — the chat window |

In the chat lab, open **Settings → Tools**, scroll to *Connect an MCP
server*, and connect to `http://localhost:3100/mcp`. The four tools
here appear in its Tools tab badged `mcp`, ticked and sent exactly
like its own.

Then ask it to roll some dice, with both activity logs visible. The
same exchange shows up twice, from two sides:

| In the chat lab | In this inspector |
|---|---|
| A request to Anthropic carrying the tool definitions | nothing — this server is not involved yet |
| `stop_reason: "tool_use"` asking for `roll_dice` | nothing — the model has only asked |
| A tool row tagged `mcp` | `POST /mcp` arriving, the handler running, the response leaving |
| A second request carrying the `tool_result` | nothing — this server's part is over |

**Claude is never told where a tool runs.** It receives one `tools`
array and answers with one `tool_use` block; the chat lab's own tools,
Anthropic's `web_search` and these MCP tools are indistinguishable in
the request. Which machine executed the function is the chat lab's
problem alone — and watching both logs is what makes that concrete.

### Over stdio instead

The chat lab can also launch this server as a child process. In its
Settings, switch the transport to **stdio** and give it:

```
npx tsx ../anthropic-mcp-lab/server/stdio.ts
```

Everything works identically — but **the traffic does not appear in
this inspector**, because a stdio server belongs to whoever launched
it. The chat lab gets its own private copy of this server, and the one
behind the web page never sees those calls. That is a property of the
transport, not a limitation of the lab, and running it both ways is
the clearest demonstration of the difference.

---

## Scripts

| Script | What it does |
|---|---|
| `npm run typecheck` | **Both** halves — server and client |
| `npm run build` | Compile both halves into `dist/` |
| `npm run audit-comments` | Verify every file has a header |
| `npm run check-env` | Inspect `.env` — the port, and a key that should not be there |
| `npm run dev` | Start the inspector on port 3100, restart on save |
| `npm run stdio` | Serve over stdio, for Claude Desktop and the MCP Inspector |
| `npm run try-stdio` | Connect as a client over stdio: list and call a tool |
| `npm run try-http` | The same session over HTTP, to compare |

---

## Project layout

```
anthropic-mcp-lab/
├── shared/types.ts      the wire contract — imported by both halves
├── server/              the MCP server, Express, the observer
├── public/              the inspector UI
├── scripts/             CLI utilities
├── index.html           the project overview, served by Pages
└── PLAN.md              the full build plan, all five phases
```

Two halves with a hard boundary between them, the same arrangement the
chat lab uses:

- `server/` — Node. The MCP server and the Express app.
- `public/` — the browser. Compiles **in place** (`public/app.ts` →
  `public/app.js`), which is why `public/*.js` is git-ignored.
- `shared/types.ts` — the wire contract, imported by both so they cannot
  disagree about what crosses the connection.

The client `tsconfig` sets `"types": []` deliberately, so server globals
like `process` cannot be referenced from browser code even by accident.
It is also what stops the inspector importing from `server/`: everything
it knows arrives over the wire as JSON.

---

## Conventions

Carried over from the chat lab, because the two are meant to read as one
body of work:

- **Every `.ts` file opens with a block comment** naming the file and
  explaining why it exists. Enforced by `npm run audit-comments`, which
  checks a header exists, names its file, and is long enough to be an
  explanation rather than a label.
- Inline comments explain **why**, and especially explain traps.
- TypeScript is `strict`. ES modules with `.js` extensions on relative
  imports (NodeNext) — this looks wrong and is correct.
- Line endings are LF, enforced by `.gitattributes`.

Two this project adds:

- **Both halves of every MCP exchange get logged.** A request with no
  logged response is a bug in the observer, not a quiet success.
- **No API key, ever.** If a change starts to need one, that change
  belongs in the chat lab.

---

## Things that will trip you up

Collected as they are hit, the same way the chat lab's list was.

- **The MCP SDK package split.** `@modelcontextprotocol/sdk` 1.x is
  superseded by separate `@modelcontextprotocol/server` and
  `/client` packages at 2.x. Most tutorials still show the 1.x shape and
  several of its APIs no longer exist — HTTP serving in particular is
  now `createMcpHandler()` returning a web-standard handler, not a
  transport object you construct and wire up.
- **The serving entry points take a factory, not a server.**
  `serveStdio(createServer)` calls `createServer()` more than once,
  including for a discovery probe whose result is discarded. Returning a
  shared instance looks fine and breaks under version negotiation.
- **Tool input schemas are Zod objects, not JSON Schema.** The chat lab
  converts Zod *to* JSON Schema for the Anthropic API; MCP takes the Zod
  directly.
- **`moduleResolution: NodeNext` is load-bearing**, not stylistic. It is
  what resolves the packages' subpath exports
  (`@modelcontextprotocol/server/stdio`) to their type definitions.
- **`tsc` fails with `TS18003`** when an `include` pattern matches zero
  files. The client config broke the typecheck while `public/` was still
  empty, on a project where nothing was wrong.

---

## Security notes

- The app has **no authentication** and binds to localhost. It is not
  built to be exposed.
- There is no key to leak, which removes the chat lab's single largest
  risk. It does not make the app safe to expose — an unauthenticated
  endpoint that executes tools on request is worth keeping local on its
  own merits.
- **Everything crossing the MCP boundary is untrusted.** Tool
  descriptions, resource contents and prompt text can arrive from a
  remote server, so the inspector renders them with `textContent`, never
  `innerHTML`. This matters more here than in the chat lab, where the
  only untrusted text was model output.

---

## Licence

MIT. See `LICENSE`.
