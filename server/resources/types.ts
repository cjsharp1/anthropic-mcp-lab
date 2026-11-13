/**
 * types.ts — what a resource is, in this project.
 *
 * Same job as server/tools/types.ts, for the second MCP primitive, and
 * it sits at the bottom of its own directory's dependency graph for the
 * same reason: definitions import it, the registry imports the
 * definitions, and nothing imports upward.
 *
 * ---------------------------------------------------------------------------
 * What a resource IS, and why it is not a tool
 * ---------------------------------------------------------------------------
 *
 * This is the primitive with no equivalent in the Anthropic Messages
 * API, so it is worth being precise rather than reaching for an
 * analogy that does not hold.
 *
 * A tool is a FUNCTION. The model decides to call it, chooses the
 * arguments, and the call may do something — write a note, roll dice,
 * deploy a service. Calling it twice is not guaranteed to be the same
 * as calling it once.
 *
 * A resource is a DOCUMENT. It has a URI, you read it, and reading it
 * changes nothing. There are no arguments, only an address.
 *
 * The practical difference is who decides. Tools are offered TO the
 * model, which picks among them. Resources are offered to the CLIENT,
 * and the usual pattern is that a person picks one — the file picker
 * in a desktop app, the attachment menu in a chat window — and the
 * client puts its contents into the conversation. A resource is closer
 * to an attachment than to a function call.
 *
 * That distinction gets lost constantly, because the obvious way to
 * expose a document to a model is a `read_document` tool, and that
 * works. The reason to use a resource instead is that it lets the
 * client show the user what is available and let them choose, which a
 * tool cannot do — a tool's arguments are the model's business.
 *
 * ---------------------------------------------------------------------------
 * Fixed URIs and templates
 * ---------------------------------------------------------------------------
 *
 * A resource either has one address or a family of them:
 *
 *   fixed      "lab://server-info"           — one document
 *   template   "lab://dice/{sides}"          — a document per value
 *
 * The SDK takes a plain string for the first and a ResourceTemplate for
 * the second, with different callback signatures. This interface keeps
 * both behind one shape so the registry can hold them in one list, and
 * the registration code branches once rather than every call site
 * knowing the difference.
 */

/**
 * The parameters pulled out of a templated URI.
 *
 * `lab://dice/{sides}` read at `lab://dice/20` produces
 * `{ sides: "20" }`. Always strings — a URI has no types, and a
 * resource that wants a number has to parse and validate it itself.
 *
 * That is a genuine difference from tools, where Zod has already
 * checked everything before the handler runs. A resource handler is
 * closer to an HTTP route handler: the path matched, and nothing else
 * has been verified.
 */
export type UriParams = Record<string, string | string[] | undefined>;

/**
 * One resource this server exposes over MCP.
 */
export interface McpLabResource {
  /**
   * A short name for the resource.
   *
   * Distinct from its URI, which is the address. The name is what a
   * client shows in a list; the URI is what it reads from.
   */
  name: string;

  /** A human-readable title, for a client that shows one. */
  title: string;

  /**
   * The address, or the pattern of addresses.
   *
   * Fixed resources use a complete URI: "lab://server-info".
   * Templated ones use RFC 6570 placeholders: "lab://dice/{sides}".
   *
   * The scheme is "lab://" throughout. MCP does not mandate a scheme
   * and any would work, but an invented one is honest: these are not
   * files, not HTTP endpoints, and pretending otherwise with "file://"
   * would imply a filesystem path that does not exist.
   */
  uri: string;

  /** Whether `uri` contains placeholders. Decides how it is registered. */
  templated: boolean;

  /**
   * What this resource holds, written for whoever is choosing it.
   *
   * Unlike a tool description, this is usually read by a PERSON picking
   * from a list rather than by a model deciding what to call. Write it
   * accordingly: say what the document contains, not when to reach
   * for it.
   */
  description: string;

  /**
   * The MIME type of what `read` returns.
   *
   * Clients use it to decide how to display the contents. "text/plain"
   * and "application/json" are the two here; getting this wrong is a
   * display bug rather than a protocol error, which is why it is easy
   * to leave stale after changing what a resource returns.
   */
  mimeType: string;

  /**
   * Produces the contents.
   *
   * Receives the resolved URI, and the extracted parameters when the
   * resource is templated. A fixed resource gets an empty object rather
   * than undefined, so handlers never have to check.
   *
   * Returns a string. Resources can carry binary data in the protocol,
   * via a base64 `blob` field instead of `text`, but nothing here needs
   * it and supporting both would mean a union type in every handler for
   * a case this lab does not teach.
   *
   * Throwing is allowed. The registration layer turns it into a protocol
   * error, which is the correct outcome for an address that cannot be
   * read — unlike a tool, where a failure is usually something the
   * model should see and recover from.
   */
  read(uri: URL, params: UriParams): Promise<string>;

  /** What to watch for in the inspector when this resource is read. */
  exampleWatch: string;
}

/**
 * Registers a resource.
 *
 * Exists for symmetry with `defineTool`, so that every definition file
 * in this project opens the same way. It is the identity function with
 * a type annotation attached — which is worth keeping anyway, because
 * it gives each definition a declaration-shaped top line and a single
 * place to add validation later if one is ever wanted.
 */
export function defineResource(resource: McpLabResource): McpLabResource {
  return resource;
}
