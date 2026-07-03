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

1. Read `<cwd>/.skill-map/serve.json`. Missing or unparseable: exit silently.
2. Verify `scopeRoot` equals its own working directory. Mismatch: exit silently
   (a hook firing in project A must never reach project B's server).
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
- Installation is explicit: `sm activity install <provider>` is operator-invoked,
  consent-prompted, writes ONLY project-local provider config (never `$HOME`,
  per [`cli-contract.md` §Scope is always project-local](./cli-contract.md)), merges
  non-destructively (pre-existing hooks are preserved), and `uninstall` reverses
  exactly what `install` added.

## Per-provider signal notes (informative)

Live-verified against real runs (2026-06-30). These inform each provider's
`mapEvent`; they are descriptive of vendor behavior, not normative.

| Provider | skill | agent | command | notes |
|---|---|---|---|---|
| `claude` | `PreToolUse` tool=`Skill` (`tool_input.skill`), slash form via `UserPromptExpansion.command_name` | `SubagentStart/Stop` + `agent_id`/`agent_type` on inner tool events; deep nesting attributable | `UserPromptExpansion.command_name` (shares the `/` namespace with skills; disambiguate by which node exists) | markdown usage: `PreToolUse` tool=`Read` (`tool_input.file_path`, relativized against the event's `cwd`) emits a PATH signal; non-`.md` reads and paths outside the scope root are early-disclaimed. Auto-loaded context (`CLAUDE.md` at session start) fires no tool event and stays invisible. `Stop` clears, EXCEPT owners listed in `background_tasks[]`; ignore `SubagentStop` orphans with empty `agent_type` |
| `codex` | weak: `$name` only inside `UserPromptSubmit.prompt` | `SubagentStart/Stop` (`agent_id`, generic `worker` type); subagents cannot spawn (depth 1) | none | payload near-identical to claude's |
| `antigravity` | invisible at hook level | own `conversationId` per subagent; spawn via `invoke_subagent` tool | none | events: Pre/PostToolUse, Pre/PostInvocation, Stop only |
| `agent-skills` via opencode | `tool.execute.before` tool=`skill` (`args.name`) | `chat.message.agent` (named); own `sessionID` per subagent | dedicated `command.execute.before` hook | in-process plugin API (no spawn) |

## Stability

This entire surface is **experimental** across spec v0.x: the capability shape
(`provider.activity`), `serve.json`, the ingest route, and the `node.activity`
event may tighten before a stable tag lands. Once promoted (a minor bump), the
usual semantics apply: adding an optional manifest field, a new install kind, or a
new `data` field is a minor bump; removing or renaming any of them is a major
bump. The bridge invisibility invariants (§Bridge contract item 5) are normative
from day one and will not be relaxed.
