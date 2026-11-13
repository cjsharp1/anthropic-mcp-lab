# anthropic-mcp-lab — build plan

A teaching MCP server with a live inspector, consumed by `anthropic-chat-lab`.

Sibling project to `anthropic-chat-lab`, same conventions, same author, its
own GitHub repo and Pages site.

---

## 1. What it is

An MCP server you can **watch**. Two halves, exactly like the chat lab:

- `server/` — the MCP server (tools, resources, prompts) plus an Express
  app that serves both the MCP endpoint and the inspector UI.
- `public/` — the inspector: a live log of every MCP message in and out,
  beside a panel showing what the server currently exposes.

Runs on **port 3100**, so it sits beside the chat lab on 3000 without a
clash.

The teaching point the chat lab cannot make: the chat lab shows you the
*Anthropic API* boundary. This shows you the *MCP* boundary — a second,
independent protocol, with its own handshake, its own envelope, and its
own idea of what a tool is. Running both at once makes the two-boundary
picture concrete: Claude asks the chat lab for a tool, the chat lab asks
this server, this server answers, and the answer travels back out.

---

## 2. Verified API facts

Checked against the published packages, not from memory. These are the
load-bearing details and several contradict what older tutorials show.

| Fact | Value |
|---|---|
| Server package | `@modelcontextprotocol/server` **2.4.0** |
| Client package | `@modelcontextprotocol/client` **2.4.0** |
| Node adapter | `@modelcontextprotocol/node` **2.1.2** |
| Old single package | `@modelcontextprotocol/sdk` 1.32.2 — **superseded, do not use** |

- Server construction: `new McpServer({ name, version })`, tools via
  `server.registerTool(name, { description, inputSchema }, handler)`.
- `inputSchema` is a **Zod v4 object** (`z.object({...})`), not JSON
  Schema. The chat lab already uses Zod 4, so this is familiar ground.
- Handlers return `{ content: [{ type: "text", text }] }`.
- stdio serving: `serveStdio(createServer, options)` from
  `@modelcontextprotocol/server/stdio` — note it takes a **factory**, and
  calls it more than once (including for a discarded `server/discover`
  probe). Returning a shared instance is a bug; return a fresh one.
  Hand-wiring `server.connect(new StdioServerTransport())` compiles but
  only serves 2025-era clients.
- HTTP serving: `createMcpHandler(factory, options)` from the package
  root, returning a web-standard `{ fetch, close, notify, bus }`. Mount
  it on Express with `toNodeHandler(handler)` from
  `@modelcontextprotocol/node`. There is **no** `StreamableHTTPServerTransport`
  to wire up by hand in 2.x.
- Client: `new Client({ name, version }, { versionNegotiation: { mode: "auto" } })`,
  then `connect(transport)`, `listTools()`, `callTool({ name, arguments })`,
  `listResources()`, `listPrompts()`, `close()`.
- Client transports: `StreamableHTTPClientTransport` (package root) and
  `StdioClientTransport` (`/stdio` subpath, takes `{ command, args, env, cwd }`).
  `SSEClientTransport` exists and is **deprecated** — do not use it.
- Tool results carry `isError`; check the flag rather than catching.

---

## 3. Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Inspector | Own web UI, port 3100 | Standalone — drive it from the chat lab, Claude Desktop or MCP Inspector and watch all of it. |
| Transport | **Both**, user-selectable in the chat lab | The stdio/HTTP distinction is the thing people get wrong; making it a visible switch teaches it directly. |
| MCP surface | Tools + resources + prompts | All three primitives. Tools alone under-teaches MCP, since tools look like what the chat lab already has. |
| Sampling / elicitation | Out of scope | Needs client-side callback support that would complicate the chat lab substantially. Noted as future work. |

---

## 4. File and folder structure

Mirrors the chat lab deliberately, so moving between them costs nothing.

```
anthropic-mcp-lab/
├── .env.example            PORT=3100, nothing secret
├── .gitattributes          LF, copied from the chat lab
├── .gitignore              copied; public/*.js, dist/, .env
├── CLAUDE.md               conventions (section 8)
├── LICENSE                 MIT, same author
├── README.md               setup, layout, what to watch
├── index.html              GitHub Pages overview (repo root, like the chat lab)
├── package.json            name, scripts, deps
├── tsconfig.json           server half — copy, change nothing but include
├── tsconfig.client.json    browser half — copy verbatim
│
├── shared/
│   └── types.ts            wire contract for the inspector's SSE stream
│
├── server/
│   ├── index.ts            Express: mounts MCP handler + inspector + SSE
│   ├── mcp-server.ts       createServer() factory — registers everything
│   ├── stdio.ts            stdio entry point (npm run stdio)
│   ├── observer.ts         the tap: records MCP traffic, feeds the log
│   ├── logger.ts           copied shape from the chat lab
│   ├── tools/
│   │   ├── types.ts        McpLabTool — name, description, Zod schema, run
│   │   ├── registry.ts     the list + assertUniqueToolNames()
│   │   └── definitions/
│   │       ├── echo.ts            trivial; proves the round trip
│   │       ├── roll-dice.ts       non-deterministic; proves it really ran
│   │       ├── inspect-request.ts returns the MCP envelope it was called with
│   │       └── slow-task.ts       progress notifications over time
│   ├── resources/
│   │   ├── registry.ts
│   │   └── definitions/    server-info, sample-log, a templated resource
│   ├── prompts/
│   │   ├── registry.ts
│   │   └── definitions/    a couple of parameterised prompt templates
│   └── data/               static files the resources read
│
├── public/
│   ├── index.html          the inspector
│   ├── app.ts              wiring
│   ├── log.ts              the MCP traffic log
│   ├── json-tree.ts        copied from the chat lab
│   ├── surface.ts          what the server exposes, live
│   ├── state.ts            shared values
│   ├── types.ts            browser-side types
│   ├── styles.css          copied, retuned
│   └── favicon.svg
│
├── scripts/
│   ├── audit-comments.ts   copied verbatim — the convention is enforced
│   ├── check-env.ts        port only; no API key lives here
│   ├── copy-data.ts        copied
│   ├── try-stdio.ts        connect over stdio, list and call a tool
│   └── try-http.ts         same over HTTP — the two side by side
│
└── docs/
    └── build-plan.html     this plan, as the historical record
```

**One difference from the chat lab worth stating up front: this project
holds no API key.** It never calls Anthropic. That removes the whole
`api-key.ts` / Settings-dialog apparatus, and `check-env.ts` shrinks to
checking the port. The security section of `CLAUDE.md` changes shape
accordingly (section 8).

---

## 5. Build phases

### Phase 1 — Skeleton
1. `package.json`, both tsconfigs, `.gitignore`, `.gitattributes`,
   `.env.example`, LICENSE. Copy from the chat lab, change names and port.
2. `npm install` — `@modelcontextprotocol/server`, `/client`, `/node`,
   `express`, `zod`, `dotenv`; dev: `tsx`, `typescript`, `@types/*`.
3. `scripts/audit-comments.ts` copied in **first**, so the convention is
   enforced from the first file rather than retrofitted.

### Phase 2 — The MCP server itself
4. `server/tools/types.ts` — `McpLabTool`, `defineTool`. Bottom of the
   dependency graph, imports nothing but Zod types. (The chat lab's
   registry-cycle bug is documented there; same layout avoids it here.)
5. The four tools, one file each.
6. `server/tools/registry.ts` — list, name map, `assertUniqueToolNames()`.
7. Resources and prompts, same three-level shape.
8. `server/mcp-server.ts` — `createServer()` factory building a **fresh**
   `McpServer` per call and registering all three primitives.
9. `server/stdio.ts` — `serveStdio(createServer)`. First runnable
   milestone: verifiable with
   `npx @modelcontextprotocol/inspector --cli node dist/server/stdio.js --method tools/list`.

### Phase 3 — HTTP and the inspector
10. `shared/types.ts` — the SSE contract for the inspector.
11. `server/observer.ts` — the tap. Wraps each registered handler so every
    call is recorded (direction, method, params, result, elapsed) and
    pushed to connected inspectors.
12. `server/logger.ts` — the chat lab's logger shape, levels retuned for
    MCP (`mcp` replaces `api`).
13. `server/index.ts` — Express on 3100: `toNodeHandler(createMcpHandler(...))`
    at `/mcp`, `GET /api/stream` for the inspector's SSE, `GET /api/surface`
    for the current tool/resource/prompt list, static `public/`.
14. The inspector frontend. `json-tree.ts` and `styles.css` come across
    mostly unchanged; `log.ts` is retuned for MCP's envelope.
15. `scripts/try-stdio.ts` and `try-http.ts` — the same session over both
    transports, which is the clearest way to see that the protocol is the
    same and only the pipe differs.

### Phase 4 — Chat lab integration
See section 6.

### Phase 5 — Documentation
16. `README.md`, `index.html` (Pages), `CLAUDE.md`, `docs/build-plan.html`.
17. Update the **chat lab's** `README.md`, `index.html` and `CLAUDE.md`
    for the new MCP settings and route count — the chat lab's `CLAUDE.md`
    names these as files that must stay in sync, and its route count and
    stat strip have gone stale before.

---

## 6. Changes to anthropic-chat-lab

This is the part that modifies an existing, working project, so it is
scoped tightly. The design goal: **MCP tools appear in the Tools tab
alongside the existing ones**, tagged `mcp`, and everything downstream —
the tool loop, the log, the patterns — keeps working unchanged.

The seam already exists. `server/tools/registry.ts` holds a list, and
`tool-runner.ts` looks tools up by name in `TOOLS_BY_NAME`. An MCP tool
that satisfies the `LabTool` interface needs no changes to the loop at all.

**New files in the chat lab:**

| File | Purpose |
|---|---|
| `server/mcp/client.ts` | Connection manager: connect, disconnect, hold the live `Client`, surface status. |
| `server/mcp/transport.ts` | Builds `StreamableHTTPClientTransport` or `StdioClientTransport` from config. |
| `server/mcp/adapter.ts` | Wraps a remote MCP tool as a `LabTool`: `jsonSchemaToZod` for the input schema, `run` calls `callTool` and flattens the text content. |

**Edited files:**

| File | Change |
|---|---|
| `server/tools/registry.ts` | `TOOLS` becomes a base list; add `getActiveTools()` returning base + connected MCP tools. Keep `assertUniqueToolNames()` and extend it to catch an MCP tool colliding with a local one. |
| `server/tools/types.ts` | `executedBy` gains `"mcp"`. Currently `"client" \| "server"`. |
| `server/index.ts` | `/api/tools` reports MCP tools with the new tag; `activeTools` filter reads from `getActiveTools()`; new routes `GET /api/mcp/status`, `POST /api/mcp/connect`, `DELETE /api/mcp/connect`. Route count goes 14 → 17. |
| `public/settings.ts` | An MCP section: transport picker (HTTP / stdio), URL or command field, Connect/Disconnect, live status. |
| `public/types.ts` | `ToolInfo.executedBy` gains `"mcp"`. |
| `public/app.ts` | Render the `mcp` badge in the Tools tab. |
| `shared/types.ts` | If MCP rows need a distinct marker beyond the existing `tool` level — decide during build; prefer reusing `tool` with a tag over adding a level. |
| `README.md`, `index.html`, `CLAUDE.md` | Setup, route count, dependency table, architecture notes. |

**Two risks worth naming now:**

1. **Schema conversion.** MCP hands us JSON Schema; `LabTool` wants Zod.
   The chat lab goes Zod → JSON Schema (`z.toJSONSchema`); this is the
   inverse, which is lossy in general. Mitigation: the MCP SDK exports
   `fromJsonSchema`, so use that rather than hand-rolling a converter.
   Verified present in the server package's exports.
2. **Name collisions.** A remote tool called `calculator` would shadow the
   local one in `TOOLS_BY_NAME`, and the chat lab's own registry comment
   warns that a shadowed tool fails silently. Mitigation: extend
   `assertUniqueToolNames()` to the merged list and surface a collision as
   a visible `warn` row, not a crash — the server is remote and the user
   cannot rename its tools.

**Not changing:** the API key handling, the orchestration patterns, the
security invariants, or the `tool-runner.ts` loop. If the plan starts
requiring edits there, something has gone wrong.

---

## 7. Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/server": "^2.4.0",
    "@modelcontextprotocol/client": "^2.4.0",
    "@modelcontextprotocol/node": "^2.1.2",
    "dotenv": "^18.0.10",
    "express": "^5.3.0",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^26.6.6",
    "tsx": "^4.23.15",
    "typescript": "^7.0.2"
  }
}
```

Versions match the chat lab's where they overlap, so the two projects do
not disagree about Express or Zod. The chat lab additionally needs
`@modelcontextprotocol/client` added to its own dependencies.

Scripts: `dev`, `stdio`, `build`, `build:client`, `watch:client`,
`typecheck`, `check-env`, `audit-comments`, `try-stdio`, `try-http`.

---

## 8. Conventions carried over

From the chat lab's `CLAUDE.md`, because the point is that these read as
one body of work:

- Every `.ts` file opens with a block comment naming the file and saying
  why it exists. Enforced by `npm run audit-comments`.
- Inline comments explain **why**, and especially explain traps.
- `strict` TypeScript; ES modules with `.js` extensions on relative
  imports (NodeNext); LF line endings via `.gitattributes`.
- Client `tsconfig` keeps `"types": []` — no Node globals in browser code.
- Model output and remote content render with `textContent`, never
  `innerHTML`. **This matters more here than in the chat lab**: tool
  descriptions, resource contents and prompt text now arrive from a
  *remote MCP server*, which is a third party. Treat everything crossing
  the MCP boundary as untrusted data.
- Error handling matches on error classes, not message text.
- `README.md`, `index.html` and `.env.example` are updated in the same
  change as the behaviour they describe.

Two conventions this project adds:

- **Both halves of every MCP exchange get logged.** A request with no
  logged response is a bug in the observer, not a quiet success.
- **No API key, ever.** This server never calls Anthropic. If a change
  starts to need a key, that change belongs in the chat lab.

---

## 9. GitHub

New repo `anthropic-mcp-lab` under `cjsharp1`, MIT, matching the chat
lab. `index.html` at the repo root, served from `main` at
`https://cjsharp1.github.io/anthropic-mcp-lab/` — root-level and named
`index.html` for the same reason as the chat lab: Pages serves it as the
site root.

Commits follow the chat lab's style: imperative, descriptive, no
scope prefixes (`Publish the overview via GitHub Pages`).

The chat lab's changes land as a separate commit in its own repo, and
should say in the body that they depend on this project.

---

## 10. Open questions, deferred

Not blockers — flagged so they are decided deliberately when reached.

1. **Does the inspector need a request/response pairing view**, or is a
   flat chronological log enough? Suggest starting flat, matching the
   chat lab, and adding pairing only if the log proves hard to read.
2. **Progress notifications** (`slow-task`) need the handler's `notify`
   facility. Worth confirming the exact shape during Phase 2 rather
   than assuming; if it complicates the first milestone, build the tool
   without progress and add it after.
3. **Sampling and elicitation** are deliberately out of scope. Worth a
   sentence in the README saying so, since their absence is otherwise
   read as an oversight.
