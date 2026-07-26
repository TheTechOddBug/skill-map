# MCP server (skill-map as a Model Context Protocol server)

*(Stability: experimental. Opt-in, off by default. One toggle exposes the whole surface: the read-only map tools/resources plus the queue + findings-lifecycle tools. See [§Stability](#stability).)*

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

## Map read-only; queue operable (opt-in)

The **map** surface is strictly read-only: the graph tools (`query_graph`,
`get_node`, `list_issues`, `get_branch`) and every resource are pure reads over
the persisted `ScanResult`. skill-map still has no runtime: it never executes a
skill, spawns an agent, or invokes a command (that is the host's job), and it
never mutates the graph itself, the scanned node/link/issue tables, config, or a
node body.

The **same server** also lets an MCP host DRIVE THE JOB QUEUE and manage
findings (decision 2026-07-23). This is not "the map became writable": it is the
same job-queue + findings-lifecycle contract the CLI verbs and BFF routes
already expose, offered to an MCP client so it can be the processing agent
without a shell. It rides the SAME endpoint and the SAME single opt-in
(`mcp.server.enabled`, see [§Enablement](#enablement)); there is no separate
toggle. When the server is off, nothing is registered and it behaves exactly as
before; when it is on, the whole surface (map reads + queue + findings) is
available. The surface is loopback-only and unauthenticated, so enabling it
grants queue + findings control to any local process (the same trust boundary
the REST mutating routes already sit behind, Decision #119).

The operable surface honours the storage rule ([`architecture.md` §Storage
rule](./architecture.md)): `record_job` persists machine output (executions,
findings, summaries) to the DB; the findings state flips (`resolve`, row
`dismiss`, `reopen`) are DB-only; the two curation writes (`dismiss --class`,
`undismiss`) go to the node's `.sm` sidecar through the SAME consent gate every
other channel uses (see [§Findings lifecycle tools](#findings-lifecycle-tools)).
There is still no MCP `prompts` capability (a future revision MAY expose skill /
command bodies as MCP prompts; that is still "serve what we already know").

**Write posture.** Every mutating tool opens the DB with the WRITE posture
(refuse on schema drift), the same as the REST mutating routes, NOT the
read-side advisory the map tools use; a drifted / stale DB refuses the write
rather than silently mutating it.

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

## Queue tools

Registered whenever the server is on (`mcp.server.enabled`). These wrap the SAME shared
job engines the CLI verbs (`sm jobs *`, `sm record`) and BFF routes use; they
add no new queue semantics. `Job` is the shape in
[`job.schema.json`](./schemas/job.schema.json), always projected WITHOUT the
`nonce` (the public-job shape) except where noted. Every mutating tool appends
one line to the operations log with `channel: 'mcp'`.

| Tool | Input | Returns |
|---|---|---|
| `list_extensions` | `{}` | `{ extensions: Array<{ id, kind: 'analyzer' \| 'action', role: 'finder' \| 'fixer' \| 'standalone', description, analyzerIds? }> }`, every ENABLED probabilistic extension `submit_job` accepts (finders, fixers, standalone), composed from the live enabled runtime. Call this to DISCOVER the valid extension ids. Read. |
| `list_jobs` | `{ status?: string, extension?: string, node?: string }` | `{ items: PublicJob[] }`, the live queue (same filter as `GET /api/jobs` / `sm jobs list`). Read; nonce stripped. |
| `get_job` | `{ id: string }` | `{ item: PublicJob }`; unknown id → `-32602`. Read; nonce stripped. |
| `submit_job` | `{ node: string, extension: string, autoFix?: boolean, findingIds?: integer[], force?: boolean, ttl?: integer, priority?: integer }` | `{ outcome: 'created', jobId, nodePath, supersededIds }` or a structured refusal (`duplicate` / `job-running` / `drift` / `unreadable` / `no-findings` / a prepare error). **The `no-processing-agent` gate applies** exactly as on the CLI / BFF: if the processing skill is not installed (`sm agent install`), the submit refuses. |
| `claim_job` | `{ runner?: string, filter?: string, wait?: number }` | `{ id, nonce, content } \| null` (null when the queue is empty). The ONE tool that returns the `nonce`: the client needs it to `record_job`. Content is the rendered prompt. Reap-expired runs first. A corrupt (missing-content) job is failed and skipped. **`wait`** (optional, seconds, capped at 3600) turns the call into a server-side BLOCKING long-poll: the tool holds the response, re-attempting the reap+claim every ~2s, until a job is claimable or the window elapses (then null). It lets a client PARK on ONE call instead of polling, so a runtime that cannot cheaply hold a blocking shell command (Codex kills an exec at 10s by default, burning an LLM turn per re-issue) matches the cheap wait the CLI `sm jobs claim --wait` gives Claude Code as a backgrounded command. While parked, the server emits a `notifications/progress` notification every ~15s WHEN the request carried a `progressToken` (silent otherwise, per MCP: progress is only sent to a client that asked). This is what keeps the park alive on clients that reset their per-request timeout on progress (OpenCode calls every tool with `resetTimeoutOnProgress: true` and a 60s default, so without progress its park died at the first minute); it also serves as a liveness heartbeat for any observing client. Clients whose timeout is a fixed budget instead MUST set it `>= wait` (Codex: `tool_timeout_sec` under `[mcp_servers.<name>]`). Each re-attempt opens the DB fresh; the sleep never holds a write lock. |
| `record_job` | `{ id: string, nonce: string, status: 'completed' \| 'failed', report?: string, failureReason?: string, tokensIn?: integer, tokensOut?: integer, durationMs?: integer, model?: string }` | `{ outcome: 'completed', executionId }` or a structured refusal (`nonce-mismatch` / `not-running` / `not-found` / `report-invalid` / `schema-unresolved`). On `completed` it validates `report` against the extension's report schema, writes the execution + findings/summary write-throughs, and fires the auto-fix chain, identical to `sm record`. |
| `cancel_job` | `{ id: string }` | `{ outcome: 'cancelled' \| 'already-terminal' \| 'not-found' }`. A queued/running job → terminal `cancelled` (never interrupts a running agent). |
| `fail_job` | `{ id: string }` | `{ outcome: 'failed' \| 'already-terminal' \| 'not-found' }` (`user-failed` reason). |

## Findings lifecycle tools

Registered whenever the server is on (`mcp.server.enabled`). Mirror `sm findings
resolve / dismiss / reopen / undismiss` and the `POST
/api/nodes/:pathB64/findings/*` routes. `resolve`, row `dismiss`, `reopen`, and (mostly) `delete`
are DB-only state flips (no consent). `dismiss --class` and `undismiss` write
the node's `.sm` sidecar (`annotations.suppressions`) through the shared consent
gate; because MCP has no interactive prompt, the two sidecar tools take
`confirm` / `always` params (the analog of the BFF body flags): they succeed
under a standing `allowEditSmFiles` grant or with `confirm: true`, and refuse
otherwise with an MCP error carrying `details.key = 'allowEditSmFiles'`. The
team policy `allowSidecarWriters: false` is a HARD block (an MCP error), not
bypassable by `confirm`. Every tool appends one operations-log line with
`channel: 'mcp'`.

| Tool | Input | Returns |
|---|---|---|
| `list_findings` | `{ node?: string, extension?: string, includeStale?: boolean }` | `{ findings: FindingRecord[] }` from `state_findings`: pass `node` for one node, OMIT it for the WHOLE project; `extension` / `includeStale` narrow further. This is the READ counterpart the queue tools lacked, how the agent reads what a finder recorded after `record_job`. Read. |
| `resolve_finding` | `{ id: integer, note?: string }` | `{ outcome: 'resolved' \| 'already-fixed' \| 'not-found' }`. DB-only: `resolution='fixed'`, actor `human`. |
| `dismiss_finding` | `{ id: integer, class?: boolean, confirm?: boolean, always?: boolean, note?: string }` | Row grain (default): `{ outcome: 'dismissed' \| 'already-dismissed' \| 'not-found' }`, DB-only. `class: true`: writes the class suppression to the sidecar (consent), `{ outcome: 'suppressed' }`, or a consent refusal. |
| `reopen_finding` | `{ id: integer }` | `{ outcome: 'reopened' \| 'already-open' \| 'not-found' }`. DB-only: clears `resolution`. Does NOT lift a class suppression (use `undismiss_finding`). |
| `undismiss_finding` | `{ node: string, extension: string, type?: string, confirm?: boolean, always?: boolean }` | Removes the matching suppression from the sidecar (consent), `{ outcome: 'unsuppressed' }`, or a consent refusal. Re-running the finder re-judges the class. |
| `delete_finding` | `{ id: integer, confirm?: boolean, always?: boolean }` | Hard-delete one finding row: `{ outcome: 'deleted' \| 'not-found' }`. Pure DB EXCEPT it lifts a now-orphan class suppression from the sidecar (consent) when deleting the last dismissed row of a class; the lift runs first, so a missing consent aborts before any delete. |

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

- `mcp.server.enabled` (boolean, default `false`) mounts the endpoint and
  registers the WHOLE surface: the read-only map tools/resources plus the
  queue + findings-lifecycle tools. There is no separate write toggle (unified
  2026-07-23). `sm serve` accepts `--mcp` / `--no-mcp` as the per-invocation
  override (precedence: flag > `mcp.server.enabled` > default off). The key lives
  in [`schemas/project-config.schema.json`](./schemas/project-config.schema.json),
  resolved through the normal config layering, and is project-local-only (never
  committed).

Because the endpoint + tool set are fixed at **serve boot**, flipping the key
while a server runs has no effect until `sm serve` restarts. The reference UI
surfaces this with the same section-level restart notice it uses for plugin
changes.

## Stability

Everything in this document is **experimental** as of v0.x. Off by default,
opt-in, and additive: enabling the toggle changes no existing behaviour, and
the REST / WS / CLI surfaces are unaffected whether it is on or off. The single
opt-in exposes the whole surface (map reads + queue + findings).

Locked at a future minor once the tool / resource vocabulary settles. Breaking
changes to the tool names, tool input shapes, resource URIs, or the transport
ship as a **minor** bump pre-1.0 (per [`versioning.md`](./versioning.md) §Pre-1.0)
and MUST be recorded in [`CHANGELOG.md`](./CHANGELOG.md). Adding a new tool or
resource is a patch. The stdio transport, an optional bearer credential,
and an MCP `prompts` capability (skill / command bodies as prompt templates)
are candidate additive extensions, none of which is promised here.

Security note: the surface is loopback-only, Origin-gated, NO per-connection
auth. Enabling the server therefore grants map reads AND queue + findings
control to any process that can reach `127.0.0.1`; that is the same trust
boundary the REST mutating routes already sit behind (Decision #119), documented
here so an operator opts in knowingly.
