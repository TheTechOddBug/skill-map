# MCP server (skill-map as a read-only Model Context Protocol server)

*(Stability: experimental. Opt-in, off by default. See [§Stability](#stability).)*

skill-map is primarily a cartographer: it observes a project and draws the
skill / agent / command graph. This contract adds a **secondary, opt-in
surface** where skill-map also *serves* that graph to AI hosts through the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP). A host
(Claude Code, Cursor, Codex, any MCP client) connects and asks skill-map
about the project's topology in real time, instead of scraping files.

This is the **producer / server** side. It is distinct from, and independent
of, the **consumer / observer** side (the `core/mcp-*` extractors that map the
MCP servers a project *uses*, see [`architecture.md` §Extractor](./architecture.md)).
The two are separately toggleable.

## Read-only mandate

The MCP server is **strictly read-only**. It exposes tools that *query* the
map and resources that *expose* the map. It MUST NOT:

- execute a skill, spawn an agent, or invoke any command (that is the host's
  job, not skill-map's; skill-map has no runtime and stays filesystem-as-truth);
- mutate the graph, the DB, config, sidecars, or any file;
- expose an MCP tool whose effect is anything other than reading already-scanned
  state.

Every tool below is a pure read over the persisted `ScanResult`. There is no
mutating tool, and there is no MCP `prompts` capability at this stability (a
future revision MAY expose skill / command bodies as MCP prompts; that is
still "serve what we already know", never "execute").

## Transport

The server speaks MCP over the **Streamable HTTP** transport, mounted on the
existing `sm serve` process (see [`cli-contract.md` §Server](./cli-contract.md#server)).
There is exactly one MCP endpoint:

| Path | Method | Purpose |
|---|---|---|
| `POST /mcp` | POST | Client → server JSON-RPC 2.0 messages (`initialize`, `tools/*`, `resources/*`). The response is either a single JSON body or an SSE stream, per the Streamable HTTP spec. |
| `GET /mcp` | GET | Opens the server → client SSE stream the server uses to deliver notifications (`notifications/resources/updated`, `notifications/*/list_changed`). |

`/mcp` is a **top-level path**, a sibling of `/ws`, NOT under `/api/*`: it is a
distinct JSON-RPC protocol surface, not part of the REST API, exactly as `/ws`
is its own surface. The stdio transport (a standalone `sm mcp` subprocess a
host spawns) is deferred; today the server is HTTP-only and rides the running
`sm serve`.

### Security posture

The MCP endpoint inherits the server's loopback posture (loopback-only through
v0.6.0, no per-connection auth, Decision #119) and is covered by the same
first-stage Host + Origin gate as `/api/*` and `/ws`:

- **Host** header hostname MUST be loopback (`127.0.0.1`, `localhost`, `::1`),
  closing DNS rebinding. This satisfies the MCP spec's own requirement that a
  local server validate `Origin` / bind to loopback to prevent DNS-rebinding
  attacks.
- **Origin** header, when present, MUST be a loopback hostname; a missing /
  empty / `null` Origin is accepted, because non-browser MCP clients (the
  common case) send none. `/mcp` is added to the Origin-checked set alongside
  `/api/*` and `/ws`.

No bearer token is required at this stability (loopback trust). A future
revision MAY optionally accept the per-session `token` from `serve.json`
(see [`cli-contract.md` §Server, Discovery file](./cli-contract.md#server)) as
an `Authorization: Bearer` credential; it is not required today.

## Capabilities

On `initialize` the server advertises exactly:

```json
{
  "capabilities": {
    "tools": { "listChanged": true },
    "resources": { "subscribe": true, "listChanged": true }
  }
}
```

No `prompts`, no `logging`, no `sampling`, no elicitation. `serverInfo.name`
is `skill-map`; `serverInfo.version` is the CLI `implVersion`.

## Tools

All tool inputs are validated against the declared `inputSchema`; all tool
outputs return the corresponding spec schema shape as `application/json`
structured content. Filters reuse the `sm export` grammar (`kind=` / `has=` /
`path=`) so a query means the same thing here, in `sm export`, and on
`GET /api/nodes`.

| Tool | Input | Returns |
|---|---|---|
| `query_graph` | `{ kind?: string, has?: string, path?: string, limit?: integer }` | A closed subgraph `{ nodes: Node[], links: Link[], issues: Issue[] }` (the `applyExportQuery` result: links survive only if both endpoints survive, issues survive if any node survives). Bounded by `limit` (default 100, max the scan's `maxRenderNodes`). |
| `get_node` | `{ path: string, includeBody?: boolean }` | Single-node bundle `{ item: Node, links: { incoming: Link[], outgoing: Link[] }, issues: Issue[] }`. `includeBody: true` reads the file body on demand (`item.body`), `null` when unreadable. Unknown path → JSON-RPC error `-32602` (invalid params). |
| `list_issues` | `{ severity?: string, analyzerId?: string, node?: string, limit?: integer, offset?: integer }` | `{ items: Issue[], total: integer }` (the same SQL-side filter/pagination as `GET /api/issues`). |
| `get_branch` | `{ path: string[] , limit?: integer }` | Prefix-union branch projection `{ branch, nodes, links, issues }` (the `/api/branch` shape), the map projection for one or more folder prefixes. |

`Node` / `Link` / `Issue` are the shapes in
[`schemas/node.schema.json`](./schemas/node.schema.json),
[`schemas/link.schema.json`](./schemas/link.schema.json),
[`schemas/issue.schema.json`](./schemas/issue.schema.json). These tools wrap the
same kernel reads the REST routes use (`applyExportQuery`, `StoragePort.scans.*`
/ `issues.list`, on-demand body read); they add no new query capability.

## Resources

Resources expose the graph as readable documents. mimeType is
`application/json` unless noted.

| URI | Contents |
|---|---|
| `skillmap://graph` | The full persisted `ScanResult` (1:1 with [`schemas/scan-result.schema.json`](./schemas/scan-result.schema.json)), the same payload as `GET /api/scan`. |
| `skillmap://issues` | The full issue list (`{ items, total }`). |
| `skillmap://activity` | A snapshot of live execution stats (the `GET /api/activity/summary` shape: `{ since, nodes, pairs }`). In-memory, resets each serve boot. |
| `skillmap://node/{path}` | Resource template: one node's detail bundle (same as `get_node`). `{path}` is the node path. |

Resources are **coarse and few by design**: one graph resource, one issues
resource, one activity resource, plus the per-node template. The server MUST
NOT register one static resource per node (a large corpus would flood the
resource list); per-node reads go through the template or `get_node`.

## Real-time updates

The server is live: a subscribed client is notified when the underlying map
changes, so a host stays in sync without polling. Updates are driven by the
**existing in-process broadcaster** (the same `WsBroadcaster` stream that feeds
the Web UI over `/ws`), not a second watcher. The MCP server registers a
passive sink on that stream and translates its envelopes into MCP
notifications:

| Internal event (broadcaster) | MCP notification |
|---|---|
| `scan.completed` | `notifications/resources/updated` for `skillmap://graph` and `skillmap://issues` (a batch finished, re-read); `notifications/resources/list_changed` when the node set changed (nodes added / removed) so per-node resource URIs are refreshed; `notifications/tools/list_changed` is NOT emitted (the tool set is static). |
| `node.activity`, `agent.spawn` | `notifications/resources/updated` for `skillmap://activity`. |

Per-resource `resources/updated` is only delivered for URIs the client actually
subscribed to (`resources/subscribe`); the server tracks the subscribed set per
connection and drops the notification otherwise. `list_changed` is broadcast to
all connections (it advertises catalog change, not content).

If `mcp.server.enabled` is off, no sink is registered and no MCP endpoint is
mounted; the broadcaster is unaffected (the Web UI keeps working).

## Enablement

The MCP server is **off by default** and gated by a single config key:

- `mcp.server.enabled` (boolean, default `false`) in
  [`schemas/project-config.schema.json`](./schemas/project-config.schema.json),
  resolved through the normal config layering.
- `sm serve` accepts `--mcp` / `--no-mcp` as the per-invocation override
  (precedence: flag > `mcp.server.enabled` > default off), see
  [`cli-contract.md` §Server, Flag surface](./cli-contract.md#server).

Because the endpoint mounts at **serve boot**, flipping the config key while a
server runs has no effect until `sm serve` restarts. The reference UI surfaces
this with the same section-level restart notice it uses for plugin changes.

## Stability

Everything in this document is **experimental** as of v0.x. Off by default,
opt-in, read-only, and additive: enabling it changes no existing behaviour, and
the REST / WS / CLI surfaces are unaffected whether it is on or off.

Locked at a future minor once the tool / resource vocabulary settles. Breaking
changes to the tool names, tool input shapes, resource URIs, or the transport
ship as a **minor** bump pre-1.0 (per [`versioning.md`](./versioning.md) §Pre-1.0)
and MUST be recorded in [`CHANGELOG.md`](./CHANGELOG.md). Adding a new read-only
tool or resource is a patch. The stdio transport, an optional bearer credential,
and an MCP `prompts` capability (skill / command bodies as prompt templates)
are candidate additive extensions, none of which is promised here.
