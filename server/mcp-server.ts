/**
 * mcp-server.ts — builds the MCP server, registering everything on it.
 *
 * The centre of the project. Both entry points — `stdio.ts` for a
 * child-process client, `index.ts` for HTTP — call `createServer()` and
 * hand it to a serving function. Everything either of them serves is
 * registered here.
 *
 * ---------------------------------------------------------------------------
 * Why this exports a FACTORY and not a server
 * ---------------------------------------------------------------------------
 *
 * The single most important thing in this file, and the easiest to get
 * wrong, because the wrong version works until it does not.
 *
 * `serveStdio()` and `createMcpHandler()` both take a factory and call
 * it MORE THAN ONCE. The documented reason is protocol negotiation: a
 * modern client opens with a `server/discover` probe, and if it turns
 * out to be a 2025-era client that falls back to `initialize`, the
 * instance built for the probe is discarded and a fresh one is built.
 * Over HTTP it goes further — the handler builds one per request.
 *
 * So a module that did this:
 *
 *     export const server = new McpServer({ ... });   // WRONG
 *
 * would hand the same instance to every connection. One client works.
 * Two clients share state they should not. A discarded probe instance
 * takes the live one down with it when it closes.
 *
 * The rule: `createServer()` must return a NEW `McpServer` every time,
 * and must be cheap enough to call per request. Everything expensive —
 * reading files, building indexes — belongs outside it, in module
 * scope, computed once and closed over.
 *
 * This is the same hazard as the chat lab's Anthropic client, arrived
 * at from the opposite direction. There, a module-level `new
 * Anthropic()` captures whatever API key existed at import time, so the
 * fix is a Proxy that defers construction. Here construction must be
 * deferred because the SDK wants many instances rather than one. Both
 * come down to: do not build at import time something whose correct
 * lifetime is shorter than the module's.
 *
 * ---------------------------------------------------------------------------
 * The adapter layer, and why it is thin
 * ---------------------------------------------------------------------------
 *
 * Each of the three registries holds objects in this project's own
 * shape — `McpLabTool`, `McpLabResource`, `McpLabPrompt` — and this
 * file translates them into `registerTool`, `registerResource` and
 * `registerPrompt` calls.
 *
 * Those translations are the only place the SDK's API is touched. A
 * tool file never imports from `@modelcontextprotocol/server`, which
 * means a change to the SDK's registration signature is a change to
 * this file and nothing else. Given that the SDK renamed and reshaped
 * most of this surface between 1.x and 2.x, that containment is worth
 * the indirection.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import {
  PROMPTS,
  assertUniquePromptNames,
  type PromptTurn,
} from "./prompts/registry.js";
import {
  RESOURCES,
  assertUniqueResourceUris,
  type McpLabResource,
} from "./resources/registry.js";
import {
  TOOLS,
  assertUniqueToolNames,
  type AnyMcpLabTool,
  type ToolContext,
} from "./tools/registry.js";

/** What this server calls itself in the handshake. */
export const SERVER_NAME = "anthropic-mcp-lab";

/** Reported in the handshake, and by the server-info resource. */
export const SERVER_VERSION = "1.0.0";

/**
 * Checks the registries before anything is registered.
 *
 * Run once at module load rather than inside `createServer()`, for two
 * reasons. A duplicate name is a programming error that cannot change
 * between requests, so checking per request would be the same
 * computation forever. And over HTTP `createServer()` runs on every
 * request — a throw in there would turn a startup bug into a stream of
 * 500s rather than a server that refuses to start.
 *
 * Top-level, so an import of this module is enough to trigger it. That
 * is what makes it impossible to forget: there is no "call this first"
 * step for an entry point to skip.
 */
assertUniqueToolNames();
assertUniqueResourceUris();
assertUniquePromptNames();

/**
 * Something that went wrong while a handler ran, in a shape the
 * inspector can log.
 *
 * `onHandlerEvent` is how phase 3's observer will see inside this
 * module without this module importing it. Left as an optional
 * parameter so stdio can run with no observer at all.
 */
export interface HandlerHooks {
  /** A handler is about to run. */
  onStart?(kind: "tool" | "resource" | "prompt", name: string, input: unknown): void;

  /** A handler finished, successfully or not. */
  onFinish?(
    kind: "tool" | "resource" | "prompt",
    name: string,
    outcome: { ok: boolean; summary: string; elapsedMs: number },
  ): void;
}

/**
 * Shortens text for a log label.
 *
 * The full value always goes in the event's detail, so nothing is lost
 * — this only keeps the one-line summary scannable. A resource
 * returning 10KB of Markdown would otherwise produce a log row taller
 * than the panel.
 */
function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

/**
 * Registers one tool on a server instance.
 *
 * Extracted per primitive rather than inlined into `createServer()`, so
 * that each adapter sits beside the explanation of what it adapts.
 */
function registerOneTool(
  server: McpServer,
  tool: AnyMcpLabTool,
  hooks: HandlerHooks,
): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      // Handed over as-is. The SDK reads the Zod schema's Standard
      // Schema interface to produce the JSON Schema it advertises in
      // tools/list, and to validate arguments on the way in. No
      // conversion step, unlike the chat lab's z.toJSONSchema() call
      // for the Anthropic API.
      inputSchema: tool.inputSchema,
    },

    async (args, ctx) => {
      const started = Date.now();
      hooks.onStart?.("tool", tool.name, args);

      // The narrowed context, built here so tool files never import
      // from the SDK. Everything a tool can reach for is on this
      // object, and the list is short on purpose.
      const toolCtx: ToolContext = {
        id: ctx.mcpReq.id,
        method: ctx.mcpReq.method,
        meta: ctx.mcpReq._meta as Record<string, unknown> | undefined,
        signal: ctx.mcpReq.signal,

        async reportProgress(progress, total, message) {
          // Built as a notification rather than called through a
          // helper, because the SDK's progress API is a notification
          // like any other. The progressToken comes from the client's
          // request metadata: no token, nothing to attach to, and the
          // notification goes nowhere. See slow-task.ts, trap 1.
          const token = (ctx.mcpReq._meta as { progressToken?: unknown } | undefined)
            ?.progressToken;

          if (token === undefined) return;

          await ctx.mcpReq.notify({
            method: "notifications/progress",
            params: {
              progressToken: token as string | number,
              progress,
              ...(total !== undefined ? { total } : {}),
              ...(message !== undefined ? { message } : {}),
            },
          });
        },
      };

      try {
        // `args as never` is the counterpart to the widening in
        // tools/types.ts. It is safe precisely here and nowhere else:
        // the SDK has already validated these arguments against the
        // same schema that produced the tool's input type.
        const text = await tool.run(args as never, toolCtx);

        hooks.onFinish?.("tool", tool.name, {
          ok: true,
          summary: truncate(text, 60),
          elapsedMs: Date.now() - started,
        });

        return { content: [{ type: "text", text }] };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        hooks.onFinish?.("tool", tool.name, {
          ok: false,
          summary: truncate(message, 60),
          elapsedMs: Date.now() - started,
        });

        // Returned as an errored RESULT, not rethrown as a protocol
        // error. The distinction is the same one the chat lab draws:
        // a tool that failed is something the model should see and can
        // recover from — "the service timed out, try again" is
        // actionable. A protocol error instead fails the whole request,
        // which takes the decision away from the model.
        //
        // The message is written for the model to read. "429 Too Many
        // Requests, retry after 30s" gives it something to act on;
        // "Error" does not.
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );
}

/** Registers one resource, fixed or templated. */
function registerOneResource(
  server: McpServer,
  resource: McpLabResource,
  hooks: HandlerHooks,
): void {
  const run = async (uri: URL, params: Record<string, unknown>) => {
    const started = Date.now();
    hooks.onStart?.("resource", resource.name, { uri: uri.href, ...params });

    try {
      const text = await resource.read(uri, params as never);

      hooks.onFinish?.("resource", resource.name, {
        ok: true,
        summary: `${text.length} characters`,
        elapsedMs: Date.now() - started,
      });

      return {
        contents: [{ uri: uri.href, mimeType: resource.mimeType, text }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      hooks.onFinish?.("resource", resource.name, {
        ok: false,
        summary: truncate(message, 60),
        elapsedMs: Date.now() - started,
      });

      // Rethrown, where a failing tool returns an errored result.
      //
      // Not an inconsistency. A tool failure is information for the
      // model; a resource that cannot be read is a failed read, and
      // answering it with a document containing an error message would
      // report success at the protocol level and leave the client to
      // discover the problem by reading the prose.
      throw error;
    }
  };

  if (resource.templated) {
    // The templated overload needs a ResourceTemplate rather than a
    // string, and hands the callback the extracted variables. Built
    // inline because it is only ever used here.
    //
    // `listCallback: undefined` says this server will not enumerate the
    // family — there are infinitely many dice, and a client asking
    // "what instances exist" gets no answer rather than a wrong one.
    server.registerResource(
      resource.name,
      new ResourceTemplate(resource.uri, { list: undefined }),
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async (uri, variables) => run(uri, variables as Record<string, unknown>),
    );
    return;
  }

  server.registerResource(
    resource.name,
    resource.uri,
    {
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    },
    async (uri) => run(uri, {}),
  );
}

/** Registers one prompt. */
function registerOnePrompt(
  server: McpServer,
  prompt: (typeof PROMPTS)[number],
  hooks: HandlerHooks,
): void {
  server.registerPrompt(
    prompt.name,
    {
      title: prompt.title,
      description: prompt.description,
      argsSchema: prompt.argsSchema,
    },

    (args: unknown) => {
      const started = Date.now();
      hooks.onStart?.("prompt", prompt.name, args);

      // No try/catch. `build` is synchronous template filling over
      // arguments the SDK has already validated — there is nothing in
      // it that can fail for a reason worth reporting differently from
      // any other bug. Wrapping it would suggest otherwise.
      const turns: PromptTurn[] = prompt.build(args as never);

      hooks.onFinish?.("prompt", prompt.name, {
        ok: true,
        summary: `${turns.length} message(s)`,
        elapsedMs: Date.now() - started,
      });

      return {
        description: prompt.description,
        messages: turns.map((turn) => ({
          role: turn.role,
          content: { type: "text" as const, text: turn.text },
        })),
      };
    },
  );
}

/**
 * Builds a fresh server with everything registered on it.
 *
 * MUST return a new instance every call — see the header. Both serving
 * entry points call this more than once, and over HTTP it runs per
 * request.
 *
 * ---------------------------------------------------------------------------
 * Why this takes no arguments, and makeServerFactory exists instead
 * ---------------------------------------------------------------------------
 *
 * An earlier version of this file was `createServer(hooks = {})`,
 * passed straight to `serveStdio(createServer)`. It read well and the
 * compiler rejected it, which was the right call:
 *
 *   Argument of type '(hooks?: HandlerHooks) => McpServer' is not
 *   assignable to parameter of type 'McpServerFactory'.
 *     Type 'McpRequestContext' has no properties in common with
 *     type 'HandlerHooks'.
 *
 * The SDK calls the factory with its OWN argument — an
 * `McpRequestContext` carrying the protocol era and, over HTTP, the
 * request. A factory whose first parameter is something else is a
 * factory the SDK will call with the wrong thing.
 *
 * Had `hooks` been typed loosely enough to accept it, this would have
 * compiled and then behaved absurdly at runtime: every server built
 * with an `McpRequestContext` in place of its hooks, `onStart` and
 * `onFinish` undefined, and the inspector mysteriously silent. The
 * error is the type system catching a parameter-shaped coincidence.
 *
 * So hooks are supplied by CLOSURE instead of by argument.
 * `makeServerFactory(hooks)` returns a factory of exactly the shape the
 * SDK wants, with the hooks captured. `createServer` stays
 * zero-argument for the common case.
 */
export function createServer(): McpServer {
  return buildServer({});
}

/**
 * Builds a factory that reports to the given hooks.
 *
 * This is what phase 3 hands to `createMcpHandler`. The returned
 * function matches `McpServerFactory` exactly — one parameter, supplied
 * by the SDK, which this implementation happens not to need.
 *
 * The unused context parameter is omitted rather than named and
 * ignored, because `noUnusedParameters` is on and an underscore-prefixed
 * placeholder would be noise. A factory is free to ignore what it is
 * given; what it is not free to do is expect something different.
 */
export function makeServerFactory(hooks: HandlerHooks): () => McpServer {
  return () => buildServer(hooks);
}

/** The shared construction both entry points above go through. */
function buildServer(hooks: HandlerHooks): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  for (const tool of TOOLS) registerOneTool(server, tool, hooks);
  for (const resource of RESOURCES) registerOneResource(server, resource, hooks);
  for (const prompt of PROMPTS) registerOnePrompt(server, prompt, hooks);

  return server;
}
