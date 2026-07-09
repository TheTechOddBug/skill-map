# Provider activity (live node activity)

Normative contract for the **live node activity** feature: while an operator works
in an external AI-coding CLI (Claude Code, Codex, Antigravity, opencode, ...), that
runtime's own hook system reports which skill / agent / command is being invoked,
and the skill-map UI lights up the matching node (and the active execution spine)
in real time.

This surface is UNRELATED to skill-map's internal `hook` extension kind
([`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set)),
which subscribes to skill-map's own scan lifecycle. Provider activity consumes the
PROVIDER runtime's hook system, an external event source. The two never compose.

## Roles and boundary

The pipeline crosses four independently-owned pieces:

```
[provider runtime hook]                     (vendor-owned, fires on invocation)
        v  spawns / calls
[bridge]                                    (skill-map-installed artifact, dumb forwarder)
        v  POST /api/activity  (loopback + token)
[BFF ingest + mapper]                       (long-running `sm serve` process)
        v  broadcaster
[WS `node.activity`]  ->  [UI lighting]
```

- **Kernel** owns only the ABSTRACTION: the optional `activity` capability on the
  `provider` extension manifest (install descriptor + event mapping). The kernel is
  a scan-time engine; it is not alive at runtime and never transports events.
- **BFF** owns the runtime: the ingest route, the event->node resolution against the
  scanned node set, the WebSocket broadcast, the in-memory execution-stats
  accumulator (§Execution stats), and the consent-gated conversation store
  (§Conversation capture). Activity state is in-memory only; nothing is persisted
  (no `scan_*` / `state_*` writes), and everything dies with the process.
- **Bridge** is the tiny artifact installed into the provider's own hook config. It
  has ZERO skill-map logic beyond discovery + forwarding (see §Bridge contract).
- **UI** owns presentation: per-node lighting, the active spine, TTL decay.

## The `provider.activity` capability

A Provider that integrates a runtime hook system declares an optional `activity`
capability on its manifest (schema: [`schemas/extensions/provider.schema.json`](./schemas/extensions/provider.schema.json)).
Like `scaffold`, it is a provider-owned capability sub-object, NOT a new extension
kind: the same Provider that owns the on-disk layout and invocation grammar owns
how its runtime reports invocations. Providers without a hookable runtime
(`agent-skills` as a pure format, the `core/markdown` base) simply omit it.

Two halves:

- **Declarative (manifest JSON)**: the `install` descriptor. Where the provider's
  project-local hook config lives (`configPath`, always relative to the scope root)
  and which install shape applies (`kind`). The remaining fields are PER-KIND:
  `events` / `group` / `commandCwd` parameterize the spawned-bridge wiring and are
  valid ONLY on `json-hooks` descriptors (schema-enforced; a `plugin-file`
  descriptor carries only `kind` + `configPath`).
- **Runtime (TypeScript only, never in the manifest, mirroring `classify()` /
  `walk()`)**: `mapEvent(raw)` receives one raw provider hook payload and returns
  zero or more activity signals, or `null` to disclaim. Providers with a
  `plugin-file` install additionally supply `pluginHooksSource`, the
  hook-registration half of the generated in-process plugin (see the
  `plugin-file` paragraph below); like `mapEvent`, it is payload knowledge and
  lives with the Provider, never in the manifest. A signal names its unit in
  one of two forms:
  - **By name**: `{ kind, name, phase, owner? }`. The generic BFF mapper resolves
    `(kind, name)` to a scanned `node.path` using the provider's kind identifiers
    ([`architecture.md` §Provider · kind identifiers](./architecture.md#provider--kind-identifiers)).
  - **By path**: `{ path, phase, owner? }`, where `path` is scope-relative
    (forward-slash). Used when the runtime reports a FILE rather than a named unit
    (a markdown read via the provider's file-read tool). Path signals match the
    scanned node with that exact `path`, ACROSS providers and kinds (the file may
    be a `markdown` node, a skill's `SKILL.md`, anything scanned), because the
    path already identifies one node unambiguously.

  - **Owner release (node-less)**: `{ phase: "end", owner, ownerScope: true }`
    with NO `kind`/`name`/`path`. Used when the runtime reports the end of a
    whole execution context that is not itself a node (Antigravity's `Stop`:
    a conversation going idle). The resolver forwards it without resolution
    and consumers release every claim that `owner` holds.

  - **Relation-only (spawn)**: `{ phase, owner, spawn }` with NO `kind`/`name`/
    `path`. Used when a spawn happens in a context that is not itself a node
    (the main session spawning a subagent): there is no parent node to claim,
    but the relation still matters. The resolver emits one `agent.spawn` frame
    (§WS event: `agent.spawn`) and no `node.activity` event.

  Three optional fields refine a signal's meaning:

  - `keepAlive` (start-only): marks a CUSTODY claim (a parent held lit through
    a spawn, §WS event: `node.activity`, parent custody) rather than an
    execution of the named unit. Keep-alive starts light nodes exactly like any
    other start but are EXCLUDED from execution counting (§Execution stats).
  - `spawn`: a spawn-relation block `{ spawnId, phase: "start" | "handoff" |
    "end", parentOwner, childKind?, childName?, childOwner?, prompt?,
    response? }` riding the signal produced by the spawning tool call.
    `spawnId` is the raw spawn tool-call id (never a synthetic owner key;
    nothing parses owner strings). The BFF turns each block into one
    `agent.spawn` frame, resolving `childKind`/`childName` through the same
    identifiers contract as name signals. `prompt` / `response` are the
    inter-agent conversation halves; they never ride the WS and are retained
    ONLY under the capture gate (§Conversation capture). A sync completion
    MAY also carry `execution` (`{ durationMs?, tokens?, toolUses? }`), the
    child run's aggregate execution summary as the runtime reported it
    (Claude: `totalDurationMs` / `totalTokens` / `totalToolUseCount` on the
    completion payload, live-verified 2026-07-05). Execution summaries are
    METADATA (plain numbers): they feed the per-node aggregates and the
    retained records independently of the capture gate's content rules.
    Async completions carry no summary (the terminal stop does not either);
    the fields simply stay absent. The vendor `toolStats` / `usage`
    breakdowns stay uncaptured until their inner shapes are pinned against
    a live run.
  - `report` (only on `phase: "end"` boundary signals): the ENDING context's
    final message, as the runtime reported it on its stop event (Claude:
    `last_assistant_message`). CONTENT, not metadata: it never rides the WS,
    and the BFF hands it to the conversation store ONLY under the capture
    gate, where it completes the response half of spawns whose completion
    frame carries no content (async spawns), matched by the record's
    `childOwner`. Runtimes fire stop events on pause too; overwrite
    semantics make the terminal message win.

  Either way the provider owns payload knowledge and does NOT resolve nodes;
  `mapEvent` is also where irrelevant runtime events are FILTERED with an early
  disclaim (a file-read of a non-markdown source file, a path outside the scope
  root), so obviously-unresolvable events never reach the node set. Signals that
  resolve to no scanned node are dropped (a phantom node is never lit).

Install shapes (`install.kind`, closed set, extensible by minor bump):

| kind | meaning | example target |
|---|---|---|
| `json-hooks` | merge hook entries into a JSON settings/hooks file that spawns the bridge command | `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json` |
| `plugin-file` | write an in-process plugin file that POSTs directly (no spawn) | `.opencode/plugin/skill-map-activity.js` |

`json-hooks` covers two document shapes, selected by the optional
`install.group` field, and two command-path conventions, selected by the
optional `install.commandCwd` field (`'scope-root'` default / `'config-dir'`
for runtimes that spawn hook commands at the hook config's own directory, in
which case install writes the bridge command with the relative hops from
`dirname(configPath)` back to the root). Claude / Codex nest the per-event entry map under the
vendor's fixed `hooks` key, where operator entries coexist with skill-map's
(removal is marker-filtered: every skill-map entry's command contains the
bridge path). Antigravity's `.agents/hooks.json` instead maps NAMED GROUPS to
event maps; a provider declaring `group` makes skill-map write its entries
under its own group key (and uninstall remove exactly that group). The inner
per-event shape (`[{ matcher?, hooks: [{ type: "command", command }] }]` for
tool events) is identical in both shapes.

`plugin-file` installs write ONE self-contained plugin file at `configPath`
(opencode: `.opencode/plugin/skill-map-activity.js`, loaded in-process by the
runtime). The file IS both the wiring and the bridge, and its source splits
along the same ownership line as the rest of the capability: the install
engine owns the ENVELOPE (the header marker, `serve.json` discovery under the
plugin context's project directory, scope + loopback + token checks, the
fetch timeout, and the NEVER-throw invariant, an exception inside an
in-process hook could alter the host session, the in-process analog of the
exit-0 invariant, §Bridge contract), while the Provider supplies the
HOOK-REGISTRATION half via its runtime `pluginHooksSource` (the in-process
analog of the `events` list, which `plugin-file` descriptors MUST omit): it
registers exactly the hooks `mapEvent` consumes, applies any wiring-level
filters (dropping high-frequency host traffic before it ever leaves the
process), and forwards each payload as a `{ hook, directory, ... }` wrapper
through the envelope's POST. Payload knowledge therefore stays with the
Provider even in the generated artifact; the engine never names another
runtime's hooks. Status: `configWired` and `bridgePresent` both derive from
that one file (present and carrying the skill-map header marker). Because
the generated plugin is an ES module (`export const …`), the engine also
writes an ESM-pinning sibling `package.json` (`{ "type": "module" }`) next
to it so the runtime loads it cleanly whatever the host project's module
type is (the ESM counterpart of the spawned bridge's CommonJS-pinning
`package.json`), but ONLY when the plugin dir has no `package.json`: that
dir is the vendor's territory, shared with its own plugins, so a
vendor-authored one is never clobbered. Uninstall deletes the plugin file
plus that sibling `package.json` when its content is exactly ours, leaving
any vendor file untouched.

## `serve.json` (server discovery file)

The bridge is a short-lived process with no channel to the long-running `sm serve`;
it discovers the server through `<scopeRoot>/.skill-map/serve.json`, written by the
`serve` verb. Shape: [`schemas/serve-info.schema.json`](./schemas/serve-info.schema.json).

- **Lifecycle**: written atomically right after the listener binds (it records the
  RESOLVED host/port actually bound, plus `pid`, `scopeRoot`, `startedAt`,
  `smVersion`, and the per-session `token`); deleted on shutdown. A hard kill
  (SIGKILL) cannot clean up, so a stale file may remain: readers MUST fail open
  (see §Bridge contract). A new server overwrites any stale file on boot.
- **It is a runtime artifact, not user config** (lockfile-like). It is gitignored
  (`sm init` adds it to `.gitignore`) and never committed. The place to CONFIGURE
  host/port is the project config; `serve.json` publishes the resolved outcome.
- **Token**: a random per-session secret minted at boot. Readers present it on
  every ingest request (§Ingest). It rotates on every server restart. Because the
  file is project-local and gitignored, only co-located local processes can read it.

## Bridge contract

The bridge is the artifact `sm activity install <provider>` wires into the
provider's hook config (a zero-dependency CommonJS script spawned per event, or an
in-process plugin file for `plugin-file` providers). Because a bare `.js` inherits
the nearest `package.json`'s module type, the installer writes a sibling
`package.json` pinning `{"type": "commonjs"}` next to the bridge so it parses as
CommonJS even inside an ESM host project. Normative behavior:

1. Derive its scope root from its OWN installed location (`../..` from the
   bridge script). Never from the spawn cwd: runtimes disagree about it
   (Claude spawns hook commands at the project root; Antigravity at the hook
   config's own directory, live-verified 2026-07-04), and the bridge's
   physical location already identifies the project it was installed into.
2. Read `<scopeRoot>/.skill-map/serve.json`. Missing or unparseable: exit
   silently. Verify the file's `scopeRoot` equals the derived root. Mismatch:
   exit silently (a hook firing in project A must never reach project B's
   server).
3. Verify `host` is loopback (`127.0.0.1`, `::1`, `localhost`). Non-loopback: exit
   silently (a tampered `serve.json` must not exfiltrate events to a remote host).
4. Forward the provider's raw event (stdin for spawned bridges) verbatim to
   `POST http://<host>:<port>/api/activity` with the provider id and the token.
   No mapping, no filtering, no interpretation: the bridge stays dumb so all
   payload knowledge lives in exactly one place (the provider's `mapEvent`).
5. **Invisibility invariants (HARD)**: the bridge ALWAYS exits `0`, ALWAYS keeps
   stdout EMPTY, and emits at most one short warning line to stderr. Provider
   runtimes interpret hook exit codes and stdout as control flow (deny/allow
   decisions); a bridge that breaks these invariants can block or alter the
   operator's session. Every failure path (no server, refused connection, bad
   JSON, timeout) is a silent no-op. Activity is best-effort by design.

## Ingest: `POST /api/activity`

Served by the BFF, loopback-gated like every `/api/*` route, plus token-gated:

- **Request**: `{ "provider": "<provider-id>", "event": <raw provider payload> }`
  with the serve.json token in the `x-skill-map-token` header.
- **Responses**: `202` accepted with `{ "ok": true, "resolved": <n>, "spawns":
  <n> }` (also when the event maps to nothing; the bridge never needs the
  outcome), `403` on missing/mismatched token (before any body processing),
  `400` on malformed body shape.
- The handler resolves the Provider by id, calls its `mapEvent(raw)`, resolves
  `(kind, name)` against the scanned node set, feeds each resolved signal to the
  execution-stats accumulator (§Execution stats), and broadcasts one
  `node.activity` WS event per resolved signal (stats-enriched) plus one
  `agent.spawn` event per spawn relation (§WS event: `agent.spawn`). Spawn
  conversation content reaches the conversation store ONLY while the capture
  gate is on (§Conversation capture). The raw event is then discarded.
- **Observability log**: each ingest emits ONE diagnostic line through the
  server logger so an operator debugging a Provider's wiring (`sm serve
  --log-level info`) can tell whether a hook fired and where it ended up,
  instead of the otherwise-silent `202` short-circuits. The line names the
  Provider id, a sanitized hook-type discriminator (see the Privacy bullet),
  and the coarse outcome: `resolved` (with the activity / spawn counts),
  `no-signals` (`mapEvent` disclaimed), `no-nodes` (nothing scanned yet), or
  `unresolved` (signals produced, none matched a node), all at INFO; the hard
  drop `no-provider` (no registered Provider with that id and an `activity`
  adapter, i.e. untrusted / disabled / unknown) and a token mismatch log at
  WARN so they surface at the default level. No further body field is logged.
- **Privacy**: the raw event may contain prompts, command text, and file contents.
  The route's request body is excluded from error reporting (Sentry), access logs,
  and error messages. The only body-derived value the observability log may emit
  is a single sanitized, length-capped hook-type discriminator (a fixed vendor
  event name such as `PreToolUse` / `command.execute.before`, read from a
  closed key allow-list: `hook_event_name`, `hook`, `type`), never any content
  field. Nothing beyond the minimal WS payload leaves the process, and nothing
  ever leaves the machine (see §Privacy).

## Install management over HTTP

The same install / uninstall operations the CLI verbs expose (`sm activity
install|uninstall <provider>`, [`cli-contract.md` §Activity](./cli-contract.md))
are served by the BFF so the SPA can wire a provider without leaving the
browser. All three routes are loopback-gated like every `/api/*` route; they do
NOT take the serve.json token (that token authenticates the bridge's ingest
path, not the operator's own UI).

The server resolves the provider against its FULL registry (built-ins plus
loaded drop-in plugins), a superset of the CLI verbs' built-ins-only set; a
drop-in provider declaring `activity` is therefore installable from the SPA.

### `GET /api/activity/install?provider=<id>`

Install status probe. Response `200`:

```json
{
  "provider": "claude",
  "supported": true,
  "installed": true,
  "configPath": ".claude/settings.json",
  "configWired": true,
  "bridgePresent": true,
  "events": 5
}
```

- `supported`: the provider declares `activity` with an implemented install
  kind (`json-hooks` today). When `false`, every other field degrades
  (`installed: false`, `configPath: null`, `events: 0`).
- `configWired`: the provider's hook config carries at least one skill-map
  bridge entry (detected by the bridge-path marker, §Bridge contract).
- `bridgePresent`: the bridge script exists on disk.
- `installed`: `configWired && bridgePresent`. A half-installed state (bridge
  deleted by hand, config hand-edited) reports `false`; a fresh install repairs
  both halves.
- `events`: how many hook events the descriptor wires.
- Unknown provider id: `404`. Missing `provider` query param: `400`.

### `POST /api/activity/install` / `POST /api/activity/uninstall`

Body: `{ "provider": "<id>", "confirm": true }`.

- **Consent gate (normative)**: both verbs modify the operator's project files
  (the provider's own hook config plus `.skill-map/activity/`). Without
  `confirm: true` the server MUST refuse with `412` (`confirm-required`) and
  MUST NOT touch any file. The SPA surfaces the refusal as an explicit consent
  dialog and retries with `confirm: true`. This is the HTTP analogue of the CLI
  install prompt; note it is deliberately STRICTER than the CLI on uninstall
  (the CLI uninstall does not prompt).
- Semantics are identical to the CLI verbs: install refreshes the wiring
  (remove-then-merge, so a changed descriptor propagates) and (re)writes the
  bridge + its sibling `package.json`; uninstall removes exactly the marked
  entries (operator hooks untouched) and is idempotent (`removed: false` when
  nothing was wired). The bridge artifact under `.skill-map/activity/` is
  SHARED across `json-hooks` providers: uninstall deletes it only when no
  OTHER such provider's config remains wired (mirroring
  [`cli-contract.md` §Activity](./cli-contract.md): "delete the bridge
  artifact when no installed provider references it anymore"); a
  `plugin-file` uninstall never touches it.
- Response `200`: the refreshed status envelope (uninstall adds `removed`).
- Unknown provider id: `404`. Provider without `activity` or with an
  unimplemented install kind: `400`.

## WS event: `node.activity`

Broadcast over `/ws` in the common envelope of
[`job-events.md` §Common envelope](./job-events.md) (experimental non-job family):

```json
{
  "type": "node.activity",
  "timestamp": 1730000000000,
  "data": {
    "nodePath": ".claude/skills/deploy/SKILL.md",
    "phase": "start",
    "owner": "main"
  }
}
```

- `nodePath`: the resolved scanned node's stable id (its `path`).
- `phase`: `"start" | "end"`. Providers with no native end signal for a unit (a
  Claude skill has none) simply never emit `end` for it; the UI owns span decay.
- `owner`: opaque identifier of the executing context (a sessionized main key
  like `main:<session_id>`, an agent id, an agent type, a session/conversation
  id, provider-dependent; providers whose payloads carry no session id fall
  back to the bare `"main"` literal). Consumers treat it as an opaque grouping
  key and MUST NOT parse it; structural discriminators (like a missing
  `parentNodePath` on `agent.spawn` frames) carry the semantics instead.
- `detail` (optional): a finer-grained human-readable label for the frame beneath
  the node itself, e.g. the specific MCP tool invoked (`notion-create-pages`) on
  an `mcp://<server>` node. Metadata only, never used for resolution; the UI
  renders it as a transient label on the node's glow AND appends it to the node's
  recent history (§Execution stats, per-node `recent` ring, so the inspector
  stacks the tool call log). Absent when the provider mapped no finer detail.
  Emitted by the Provider's `mapEvent` as the optional `IActivitySignal.detail`
  and forwarded verbatim by the resolver.
- `access` (optional): classifies a RESOURCE frame, `"mcp"` when the node is an
  `mcp://` server (a tool call) or `"read"` when it is a file a unit read.
  Absent on a UNIT's own execution (a skill / agent / command start). The
  resolver derives it from the signal SHAPE, a PATH signal is a resource access,
  a NAME signal (`kind` + `name`) is a unit execution, so a unit reading another
  unit's file still classifies as a `read`, not an execution of it. It drives
  caller attribution and the typed recent log (below).
- `ownerScope` (optional, only on `phase: "end"`): `true` when the signal marks
  the END OF THE OWNER'S WHOLE EXECUTION CONTEXT (a subagent terminating), not
  just of the named node. Consumers then release EVERY claim held by that
  `owner`, so the units the context lit along the way (the skills it invoked,
  the markdowns it read) go dark with it instead of waiting out their decay.
  On the node-less OWNER-RELEASE form (a context end with no node to hang it
  on, e.g. an Antigravity conversation going idle) the envelope carries NO
  `nodePath` at all; `owner` + `ownerScope: true` + `phase: "end"` are then
  all REQUIRED.
- `sticky` (optional, only on `phase: "start"`): `true` for LIFECYCLE claims
  (an agent's own span, a parent held lit by a running child). Consumers give
  sticky claims a much longer decay window than momentary usage claims: they
  are meant to end via `ownerScope` ends, the long window is only a safety net
  against a crashed runtime that never sends one.
- `keepAlive` (optional, only on `phase: "start"`): `true` for CUSTODY claims
  (the parent-custody mechanism below). Keep-alive starts light and refresh
  nodes like any other start but are excluded from execution counting
  (§Execution stats), and SHOULD NOT trigger "executed" affordances.
- `stats` (optional, only on node-attributed frames): the node's current
  execution stats `{ count, lastStartAt, lastOwner?, distinctOwners,
  toolUses?, tokens?, summarizedRuns? }` as accumulated server-side
  (§Execution stats). The server is the single source
  of truth: clients MUST overwrite from this field (and from the summary
  snapshot), never accumulate counts themselves.

Consumers SHOULD also treat any owned signal as a HEARTBEAT: every arriving
signal with `owner` X refreshes the decay window of every claim X already
holds, so an actively-working context never times out mid-run.

**Pause is not end (parent custody).** Some runtimes emit their subagent-stop
event when an agent merely PAUSES awaiting a child (Claude fires `SubagentStop`
on pause and a fresh `SubagentStart` on resume; only the last stop is terminal
and nothing marks it as such). Adapters therefore keep the parent lit through
CUSTODY instead of trying to classify stops: the spawn tool-call emits a sticky
claim on the PARENT node owned first by a synthetic spawn key and then by the
CHILD's id, so as long as the child runs (and heartbeats), the parent stays
lit even while "stopped"; the child's terminal owner-scoped end releases the
parent claim, and the unwind proceeds bottom-up.

Custody MUST only pass to a child that is STILL RUNNING when the spawn's
completion event arrives (Claude: `tool_response.status === 'async_launched'`).
Runtimes also deliver the spawn's completion AFTER the child's terminal stop
(observed live: `status: 'completed'` arriving ~66ms after the child's
terminal `SubagentStop`); handing custody to an already-terminated child
creates a claim whose release cascade has ALREADY passed, an orphan that pins
the parent lit until the sticky window lapses. In the completed case,
releasing the synthetic spawn key IS the end of custody: the parent's own
lifecycle claim (its `SubagentStart`) carries it until its own terminal stop.

## WS event: `agent.spawn`

Broadcast over `/ws` in the same common envelope (experimental non-job family).
One frame per spawn relation reported by a provider signal (§capability,
`spawn` block). Frames are STATELESS and self-contained: the server keeps no
spawn registry, so parent fields repeat on every frame and consumers correlate
by `spawnId`.

```json
{
  "type": "agent.spawn",
  "timestamp": 1730000000000,
  "data": {
    "spawnId": "toolu_01MEQBSdHNo3B9pMjY8s7ZQK",
    "phase": "start",
    "parentOwner": "main:6cfe5636-2e56-4271-91a6-87fc3d4355be",
    "childKind": "agent",
    "childName": "demo-worker",
    "childNodePath": ".claude/agents/demo-worker.md"
  }
}
```

- `spawnId`: opaque per-spawn correlation id (the spawning tool call's id).
- `phase`: `"start"` at the spawn call; `"handoff"` when an async child's own
  owner id becomes known (`childOwner` present from then on); `"end"` when the
  spawn completed with no live child (sync spawns, or a completion arriving
  after the child already stopped).
- `parentOwner`: owner key of the spawning context. `parentNodePath`
  (optional): the scanned parent agent's node path; ABSENT when the spawner is
  a session (the main context). That absence is the structural discriminator
  for session parents; consumers never parse owner strings.
- `childKind` / `childName`: the child unit as the runtime named it.
  `childNodePath` is present when the name resolved against the scanned node
  set. An unresolved child is still emitted (name only) so session surfaces
  can count it, but no edge can target a phantom node.
- `childOwner`: the child context's own owner id, present from `"handoff"` on.
- `pairCount` (optional): the accumulated spawn count for this parent-child
  pair (§Execution stats), present on frames whose pair is counted. Clients
  overwrite, never accumulate.
- Conversation content (`prompt` / `response`) NEVER rides this event; it is
  served on demand under the capture gate (§Conversation capture).

Edge lifetime is UI-owned, mirroring custody: draw at `"start"`, consolidate
at `"handoff"`, release on the explicit `"end"` frame OR on the
`node.activity` owner-scoped end whose `owner` equals `childOwner`, with the
sticky decay window as the crash safety net.

## Execution stats

The BFF accumulates per-node execution stats in memory (process lifetime,
reset on every `sm serve` boot, never persisted). Counting semantics
(normative):

- Only node-attributed `phase: "start"` signals count. Ends, owner releases
  and relation-only signals never mutate stats.
- `keepAlive: true` starts NEVER count: custody is not an execution.
- `sticky: true` starts count ONCE per `(nodePath, owner)` pair for the
  process lifetime. Runtimes re-emit lifecycle starts on pause/resume with the
  SAME owner id, and a resume is not a new execution; a fresh instance has a
  fresh owner id and counts again. The dedupe memory is append-only (owners
  are not forgotten on `ownerScope` ends, or every pause/resume cycle would
  recount).
- All other starts (skill invocations, command expansions, markdown reads)
  count on every signal.

Per node the accumulator keeps `count`, `lastStartAt` (unix ms), `lastOwner`,
the distinct-owner count, and a short ring of recent executions
(`{ at, owner, detail?, caller?, target?, kind? }`, most recent first). A
RESOURCE access (a tool call or a file read, `access` set on the frame) is
written to BOTH ends: the resource node's entry carries `caller` (the unit that
accessed it) and the unit's own mirrored entry carries `target` (the accessed
node), both tagged with `kind` (`"mcp"` | `"read"`) and, for an mcp call, the
`detail` tool (a read carries no `detail`). So the inspector shows, from either
side, who accessed what and of which type. A unit's own execution carries none
of these. All sets and rings are bounded; hitting a bound saturates or evicts
oldest entries, it never errors.

Per-node stats gain OPTIONAL execution aggregates when spawn completions
carry a summary (agent nodes, sync spawns): `toolUses` and `tokens` sum the
reported totals across summarized runs, and `summarizedRuns` says how many
runs contributed (so consumers can contextualize the sums). Nodes that never
received a summary (skills, markdowns, async-only agents) simply omit them.

The accumulator ALSO keeps per-PAIR spawn counters (metadata, independent of
the capture gate): every `agent.spawn` relation with `phase: "start"` and a
RESOLVED child increments the pair keyed by the parent identity
(`parentNodePath` for agent parents, `parentOwner` for session parents) and
`childNodePath`. Pair entries carry `{ count, lastStartAt }` and feed the edge
conversation-count labels; the pair map is bounded like everything else. The
current pair count rides every broadcast `agent.spawn` frame as `pairCount`
(overwrite semantics: the client never accumulates).

### `GET /api/activity/summary`

Snapshot for client hydration (connect, reconnect, re-enable). Loopback-gated,
no token (operator surface, like §Install management). Response `200`:

```json
{
  "since": 1730000000000,
  "nodes": {
    ".claude/skills/deploy/SKILL.md": {
      "count": 3,
      "lastStartAt": 1730000001234,
      "lastOwner": "main:6cfe5636-2e56-4271-91a6-87fc3d4355be",
      "distinctOwners": 2
    }
  }
}
```

The response also carries the per-pair spawn counters under `"pairs"`, keyed
`"<parent>>><childNodePath>"` (the same separator-free identities the
accumulator uses), each `{ "count": <n>, "lastStartAt": <ms> }`, so edge
labels hydrate together with the node counters.

Stats-only by design: the summary carries NO live claim or spawn state. Live
lighting and spawn edges rebuild from the WS stream as events arrive; clients
treat both this snapshot and the WS `stats` / `pairCount` fields as overwrites
from the single server-side source of truth.

### `GET /api/activity/node/<pathB64>`

Per-node detail for inspector surfaces. Response `200`: `{ "stats": { ... },
"recent": [{ "at": <ms>, "owner": "...", "detail"?: "<tool>", "caller"?: "<unit path>", "target"?: "<accessed path>", "kind"?: "mcp" | "read" }], "spawns": [ ... ],
"captureEnabled": <bool> }`, where `spawns` lists the RETAINED spawn records
touching the node (as parent or child). Records exist only while the capture
gate is on (§Conversation capture): with the gate off the list is always
empty, and live spawn metadata remains available only on the `agent.spawn` WS
stream. A scanned node with no recorded activity returns empty stats, not
`404`; an unknown path returns `404`.

## Conversation capture

The inter-agent conversation halves (the spawn `prompt`, the sync-completion
`response`) are CONTENT, not metadata; retaining them requires explicit
operator consent:

- **Gate**: off by default. The setting lives in the project-local config
  layer (never committed, never `$HOME`). Turning it off clears the store
  immediately.
- **Consent flow**: `POST /api/activity/capture` with body `{ "enabled":
  true|false, "confirm": true }`; without `confirm: true` the server MUST
  refuse with `412` (`confirm-required`) and change nothing, the same gate
  §Install management uses. `GET /api/activity/capture` reports
  `{ "enabled": <bool> }`.
- **Retention bounds**: an in-memory ring of at most 200 spawn records; each
  content field is capped (64 KiB) and truncated with an explicit marker.
  Nothing is persisted; the store dies with the process.
- **Custody (normative)**: the store is reachable ONLY from the BFF
  composition root and the activity routes. It MUST NOT be exposed through the
  kernel, the plugin runtime, any extension context, or the plugin KV API;
  plugins have no supported path to it. Content is excluded from error
  reporting, access logs and error messages (same posture as the ingest body)
  and NEVER rides the WS; it is served only on demand over the loopback-gated
  detail endpoints.
- **Response sources**: the response half arrives through two complementary
  paths, capped and gated identically. A SYNC spawn's completion carries it
  on the spawn relation itself (`response`, extracted from the completion
  payload as a plain string or joined text content blocks). An ASYNC spawn's
  completion carries no content, so the child's boundary-stop `report` (its
  final message, live-verified 2026-07-05: Claude's `SubagentStop` carries
  `last_assistant_message`) attaches to the record by matching `childOwner`.
  Pause stops overwrite harmlessly; the terminal message wins.

### `GET /api/activity/spawns/<spawnId>`

One RETAINED spawn record (the edge-click surface), with its `prompt` /
`response` halves; `captureEnabled` rides every `200` response. Records exist
only while the gate is on, so with the gate off (or after it cleared the
store) the route answers `404`, exactly like an unknown id.

## Transport shapes

Three shapes converge on the same ingest route; the provider's `install.kind`
declares which applies:

1. **Spawned-command push** (Claude Code, Codex, Antigravity): the provider spawns
   the bridge per event with the payload on stdin.
2. **In-process plugin push** (opencode): a plugin file registers the provider's
   plugin hooks and POSTs directly, no process spawn.
3. **SSE pull** (fallback, no v1 implementation): a skill-map-side subscriber
   consumes a provider's event stream and POSTs on its behalf.

## Privacy

- Everything is local: bridge, server, and browser speak over loopback only. The
  loopback gate is load-bearing; activity data never leaves the machine and is
  NEVER sent to telemetry (Sentry / PostHog), regardless of consent toggles.
- Ephemeral by contract: activity state (per-node execution stats, spawn
  metadata, and, ONLY under the explicit capture gate, inter-agent conversation
  content) is in-memory only and dies with the process; the raw event is
  dropped after mapping. Conversation retention is opt-in and off by default
  (§Conversation capture). Wider rich surfaces (a full tool log with arguments)
  remain future opt-in gates, and file CONTENTS stay excluded unless explicitly
  enabled.
- Installation is explicit: `sm activity install <provider>` is operator-invoked
  and consent-prompted, and the SPA equivalent (§Install management over HTTP)
  sits behind a server-enforced confirm gate on BOTH install and uninstall.
  Either surface writes ONLY project-local provider config (never `$HOME`,
  per [`cli-contract.md` §Scope is always project-local](./cli-contract.md)), merges
  non-destructively (pre-existing hooks are preserved), and `uninstall` reverses
  exactly what `install` added.

## Per-provider signal notes (informative)

Live-verified against real runs (2026-06-30). These inform each provider's
`mapEvent`; they are descriptive of vendor behavior, not normative.

| Provider | skill | agent | command | notes |
|---|---|---|---|---|
| `claude` | `PreToolUse` tool=`Skill` (`tool_input.skill`), slash form via `UserPromptExpansion.command_name` | `SubagentStart` (start) / `SubagentStop` (owner-scoped end, `ownerScope: true`) keyed by `agent_id`; `agent_id`/`agent_type` on inner tool events; deep nesting attributable. The spawning `Agent` `PreToolUse`/`PostToolUse` pair emits the parent-custody claims (`keepAlive: true`, excluded from execution counting) plus the `spawn` relation block (`prompt` on start, sync `response` on completion; main-context spawns use the relation-only signal form). It deliberately NEVER claims the CHILD node: that claim would outlive the child's own `SubagentStop` (TTL instead of native end) | `UserPromptExpansion.command_name` (shares the `/` namespace with skills; disambiguate by which node exists) | markdown usage: `PreToolUse` tool=`Read` (`tool_input.file_path`, relativized against the event's `cwd`) emits a PATH signal; non-`.md` reads and paths outside the scope root are early-disclaimed. MCP usage: `PreToolUse` tool=`mcp__<server>__<tool>` (the bridge matcher is widened to `^(Skill|Agent|Read|mcp__.+)$`) emits a PATH signal to the `mcp://<server>` node, the SAME node the static `core/mcp-tools` edge targets (and `mcpConfig` config-side discovery materialises), so a live tool call lights it deterministically, the runtime reports the exact tool name, no inference. Auto-loaded context (`CLAUDE.md` at session start) fires no tool event and stays invisible. Main-context owner is sessionized (`main:<session_id>`, bare `main` when the payload carries no `session_id`). Terminal `SubagentStop` carries `last_assistant_message` (the child's final report, the async response source) plus `agent_transcript_path`; sync completions carry the report as `tool_response.content` text blocks. Ignore `SubagentStop` orphans with empty `agent_type` |
| `codex` | weak: `$name` tokens inside `UserPromptSubmit.prompt` (the adapter scans with the SAME shared `$`-token grammar the `dollar-skill` extractor uses, so activity and link extraction agree; sigil stripped, resolver drops unknowns) | `SubagentStart` (sticky start) / `SubagentStop` (owner-scoped end) keyed by `agent_id`; a NAMED `agent_type` resolves to its `.codex/agents/<name>.toml` node, the default generic `worker` resolves to nothing and drops. Spawn relations ride the `spawn_agent` Pre/PostToolUse pair (the ONLY tool events wired, matcher-scoped): `tool_input.agent_type` + `message` (the prompt) on start, the child's `agent_id` parsed from the JSON-string `tool_response` on handoff (live-verified 2026-07-05); the response half is the stop's `last_assistant_message` (generic report path), the wait / close tool responses repeat it and stay disclaimed; no execution totals exist anywhere in the payloads. NO parent custody needed: a Codex parent never pauses (it blocks inside the wait tool), so terminal stops unwind bottom-up natively; an agent-context spawn rides a keep-alive heartbeat on the parent only so the resolver stamps `parentNodePath` | none (`/` is Codex's own built-in namespace) | hook config `.codex/hooks.json` uses the same `{ hooks: { <Event>: [...] } }` convention as claude, so the `json-hooks` engine applies verbatim; payload near-identical to claude's, including the sessionized main owner (`main:<session_id>`). Markdown usage is NOT mapped: Codex has an internal `read_file` tool but hooks do not fire for it (PreToolUse covers only Bash / apply_patch / MCP; expansion is an open upstream request), so read signals wait for that surface |
| `antigravity` | invocation itself invisible (`/skill` injects the SKILL.md with no tool event, live-verified 2026-07-04), but a skill's `references/*.md` reads DO fire and light those resources | no on-disk agent files exist (subagents are runtime-only Prompt specs), so there is nothing to light; `conversationId` (present in EVERY payload) is the owner grouping key, and the conversation `Stop` (`terminationReason` present) maps to a node-less OWNER RELEASE only when the conversation is FULLY idle: live-verified 2026-07-05, an orchestrating conversation fires Stop with `fullyIdle: false` every time it naps while its subagents run (waking on their `send_message`), and those nap stops disclaim (a missing `fullyIdle` keeps releasing, older runtimes). Spawn relations are UNMAPPABLE on this runtime: `invoke_subagent` takes a `Subagents` array of runtime-only `{ Prompt, Role, TypeName, Workspace }` specs (types declared via `define_subagent`, no on-disk file), its completion returns NO child `conversationId`, and tool calls carry no ids, so there is nothing to correlate a spawn frame with; `send_message` carries full message text both directions keyed by `conversationId` (a future session-centric surface, unusable today without node anchors) | none; workflows (`.agent/workflows/*.md`) light when the agent FOLLOWS them (it `view_file`s the workflow file) | TWO mapped signals: `PreToolUse` tool `view_file` (`toolCall.args.AbsolutePath`, relativized against `workspacePaths[*]`) emitting PATH signals (markdown reads, skill resources, followed workflows all light through it), and `Stop` emitting the owner release. Payloads carry NO `hook_event_name`; events are distinguished STRUCTURALLY (`toolCall` = tool event, `invocationNum` = invocation pulse, `terminationReason` = Stop). Hook config `.agents/hooks.json` uses the NAMED-GROUP shape (`install.group`) with the FLAT entry shape on lifecycle events (`events[].entryShape`); the runtime spawns hook commands at the config's directory (`install.commandCwd: "config-dir"`); hooks stay neutral via exit 0 + empty stdout, which the bridge invariants already guarantee |
| `agent-skills` via opencode | `tool.execute.before` tool `skill` (`args.name`), fires even for prose invocations (live-verified 2026-07-04, v1.17.11) | `chat.message` carries the NAMED `agent` + its own `sessionID` per subagent; `sessionID` is the owner key and `session.idle` maps to the node-less OWNER RELEASE (native end, fires only when a session truly finishes: the parent BLOCKS inside the `task` tool, no naps, live-verified 2026-07-05). Spawn relations ride the `task` tool pair: the before carries `input.callID` (the spawnId) + `args.subagent_type` / `args.prompt`, the after carries `output.metadata.sessionId` (the child's own owner) and the child's full final report inside `output.output`'s `<task_result>` wrapper (the response source). The task event never names the PARENT agent (only its sessionID), so every spawn emits the relation-only form and anchors on a session capsule, one per spawning session. Per-message token usage exists on the bus (`message.updated`) but stays unaggregated (a high-frequency family) | dedicated `command.execute.before` hook (`{ command, sessionID }`, prose-invoked too) | in-process plugin (`plugin-file`, `.opencode/plugin/skill-map-activity.js`; BOTH `plugin/` and `plugins/` dirs load, install targets the singular). Markdown reads map from tool `read` (`args.filePath`, relativized against the plugin context's `directory`). The plugin registers ONLY the consumed hooks (with `tool.execute.after` wiring-filtered to `task`) and forwards `{ hook, directory, input, output? }` wrappers |

## Stability

This entire surface is **experimental** across spec v0.x: the capability shape
(`provider.activity`), `serve.json`, the ingest route, and the `node.activity`
event may tighten before a stable tag lands. The `agent.spawn` family, the
execution-stats fields and endpoints, and the conversation-capture surface are
experimental additions under the same policy. Once promoted (a minor bump), the
usual semantics apply: adding an optional manifest field, a new install kind, or a
new `data` field is a minor bump; removing or renaming any of them is a major
bump. The bridge invisibility invariants (§Bridge contract item 5) are normative
from day one and will not be relaxed.
