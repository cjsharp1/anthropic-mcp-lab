# MCP in one page

Notes kept with the lab, served over the protocol they describe.

## The three primitives

**Tools** are functions. The model chooses to call one and picks the
arguments. Calling a tool may change something.

**Resources** are documents. They have a URI, you read them, and
reading changes nothing. The *client* usually chooses one — often by
showing a person a list — rather than the model deciding.

**Prompts** are templates the server offers. The server saying "here is
a good way to ask me things", rather than waiting to be asked well.

The distinction that gets lost most often is tool versus resource. You
can always expose a document through a `read_document` tool, and it
works. The reason to use a resource instead is that a resource can be
shown to a person and picked; a tool's arguments are the model's
business.

## Transports

**stdio** — the client launches the server as a child process and talks
over its standard input and output. One client, one process, no
network. This is how Claude Desktop runs a local server.

**Streamable HTTP** — the server listens on a port and any number of
clients connect. This is how a remote server works.

The protocol is identical across both. The same `tools/call`, the same
envelope, the same result. If a server behaves differently depending on
its transport, something has leaked that should not have.

## The envelope

MCP is JSON-RPC 2.0. Every request carries a `method` and usually an
`id`; every response carries the id back. Several requests can be in
flight at once, which is why the id exists and why responses are not
guaranteed to arrive in order.

Notifications are messages with no id, and therefore no reply. Progress
updates are notifications, which is why they can arrive mid-call.

## Where the model is

Not here. An MCP server does not call a model and holds no API key. The
model sits on the far side of the client:

    model  <->  client (holds the key)  <->  MCP server (holds none)

Asking "where does the API key live?" is the fastest way to work out
which component is which.
