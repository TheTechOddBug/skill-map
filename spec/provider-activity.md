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
  scanned node set, and the WebSocket broadcast. Activity state is in-memory only;
  nothing is persisted (no `scan_*` / `state_*` writes in v1).
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
  and which install shape applies (`kind`).
- **Runtime (TypeScript only, never in the manifest, mirroring `classify()` /
  `walk()`)**: `mapEvent(raw)` receives one raw provider hook payload and returns
  zero or more activity signals, or `null` to disclaim. A signal names its unit in
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

  Either way the provider owns payload knowledge and does NOT resolve nodes;
  `mapEvent` is also where irrelevant runtime events are FILTERED with an early
  disclaim (a file-read of a non-markdown source file, a path outside the scope
  root), so obviously-unresolvable events never reach the node set. Signals that
  resolve to no scanned node are dropped (a phantom node is never lit).

Install shapes (`install.kind`, closed set, extensible by minor bump):

| kind | meaning | example target |
|---|---|---|
| `json-hooks` | merge hook entries into a JSON settings/hooks file that spawns the bridge command | `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json` |
| `plugin-file` | write an in-process plugin file that POSTs directly (no spawn) | `.opencode/plugins/skill-map-activity.js` |

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
- **Responses**: `202` accepted (also when the event maps to nothing; the bridge
  never needs the outcome), `403` on missing/mismatched token (before any body
  processing), `400` on malformed body shape.
- The handler resolves the Provider by id, calls its `mapEvent(raw)`, resolves
  `(kind, name)` against the scanned node set, and broadcasts one `node.activity`
  WS event per resolved signal. The raw event is then discarded (v1).
- **Privacy**: the raw event may contain prompts, command text, and file contents.
  The route's request body is excluded from error reporting (Sentry), access logs,
  and error messages. Nothing beyond the minimal WS payload leaves the process,
  and nothing ever leaves the machine (see §Privacy).

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
  entries (operator hooks untouched), deletes `.skill-map/activity/`, and is
  idempotent (`removed: false` when nothing was wired).
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
- `owner`: opaque identifier of the executing context (`"main"`, an agent id, an
  agent type, a session/conversation id, provider-dependent). Consumers treat it
  as an opaque grouping key.
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
- v1 keeps nothing: activity state is in-memory, the raw event is dropped after
  mapping. Future rich surfaces (tool log with arguments, inter-agent conversation
  view) are opt-in config gates, local-UI-only, and file CONTENTS stay excluded
  even then unless explicitly enabled.
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
| `claude` | `PreToolUse` tool=`Skill` (`tool_input.skill`), slash form via `UserPromptExpansion.command_name` | `SubagentStart` (start) / `SubagentStop` (owner-scoped end, `ownerScope: true`) keyed by `agent_id`; `agent_id`/`agent_type` on inner tool events; deep nesting attributable. The spawning `Agent` `PreToolUse` is deliberately NOT mapped: it would claim the child node under the PARENT's owner, and that claim would outlive the child's own `SubagentStop` (TTL instead of native end) | `UserPromptExpansion.command_name` (shares the `/` namespace with skills; disambiguate by which node exists) | markdown usage: `PreToolUse` tool=`Read` (`tool_input.file_path`, relativized against the event's `cwd`) emits a PATH signal; non-`.md` reads and paths outside the scope root are early-disclaimed. Auto-loaded context (`CLAUDE.md` at session start) fires no tool event and stays invisible. Ignore `SubagentStop` orphans with empty `agent_type` |
| `codex` | weak: `$name` tokens inside `UserPromptSubmit.prompt` (the adapter scans with the SAME shared `$`-token grammar the `dollar-skill` extractor uses, so activity and link extraction agree; sigil stripped, resolver drops unknowns) | `SubagentStart` (sticky start) / `SubagentStop` (owner-scoped end) keyed by `agent_id`; a NAMED `agent_type` resolves to its `.codex/agents/<name>.toml` node, the default generic `worker` resolves to nothing and drops. NO parent custody: nesting is capped by `agents.max_depth` (default 1, spawns main-only), and spawning is consolidate-on-completion (the parent waits), so terminal stops unwind bottom-up natively; no tool events are wired at all | none (`/` is Codex's own built-in namespace) | hook config `.codex/hooks.json` uses the same `{ hooks: { <Event>: [...] } }` convention as claude, so the `json-hooks` engine applies verbatim; payload near-identical to claude's. Markdown usage is NOT mapped: Codex has an internal `read_file` tool but hooks do not fire for it (PreToolUse covers only Bash / apply_patch / MCP; expansion is an open upstream request), so read signals wait for that surface |
| `antigravity` | invocation itself invisible (`/skill` injects the SKILL.md with no tool event, live-verified 2026-07-04), but a skill's `references/*.md` reads DO fire and light those resources | no on-disk agent files exist (subagents are runtime-only Prompt specs), so there is nothing to light; `conversationId` (present in EVERY payload) is the owner grouping key, and the conversation `Stop` (`terminationReason` present) maps to a node-less OWNER RELEASE so the whole chain goes dark the moment the agent idles | none; workflows (`.agent/workflows/*.md`) light when the agent FOLLOWS them (it `view_file`s the workflow file) | TWO mapped signals: `PreToolUse` tool `view_file` (`toolCall.args.AbsolutePath`, relativized against `workspacePaths[*]`) emitting PATH signals (markdown reads, skill resources, followed workflows all light through it), and `Stop` emitting the owner release. Payloads carry NO `hook_event_name`; events are distinguished STRUCTURALLY (`toolCall` = tool event, `invocationNum` = invocation pulse, `terminationReason` = Stop). Hook config `.agents/hooks.json` uses the NAMED-GROUP shape (`install.group`) with the FLAT entry shape on lifecycle events (`events[].entryShape`); the runtime spawns hook commands at the config's directory (`install.commandCwd: "config-dir"`); hooks stay neutral via exit 0 + empty stdout, which the bridge invariants already guarantee |
| `agent-skills` via opencode | `tool.execute.before` tool=`skill` (`args.name`) | `chat.message.agent` (named); own `sessionID` per subagent | dedicated `command.execute.before` hook | in-process plugin API (no spawn) |

## Stability

This entire surface is **experimental** across spec v0.x: the capability shape
(`provider.activity`), `serve.json`, the ingest route, and the `node.activity`
event may tighten before a stable tag lands. Once promoted (a minor bump), the
usual semantics apply: adding an optional manifest field, a new install kind, or a
new `data` field is a minor bump; removing or renaming any of them is a major
bump. The bridge invisibility invariants (§Bridge contract item 5) are normative
from day one and will not be relaxed.
