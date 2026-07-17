# CLI contract

Normative description of the `sm` CLI surface: verbs, flags, exit codes, machine-readable output. Any conforming implementation MUST expose a CLI binary satisfying this contract. The binary name (`sm`) and long alias (`skill-map`) are normative.

---

## Binary

- Primary: `sm`.
- Long alias: `skill-map`. MUST resolve to the same binary. A symlink, shim, or alias in `bin` field of `package.json` is acceptable.
- Help invocation: `sm --help` and `sm -h` MUST print top-level help and exit with code 0.
- Bare invocation: `sm` with no arguments starts the Web UI server (equivalent to `sm serve`) when a `.skill-map/` project is initialized in the cwd. With no project in the cwd:
  - When the cwd is empty AND stdin is an interactive terminal, it MUST present a getting-started menu with two choices, run the guided tutorial (equivalent to `sm tutorial`) or drop a ready-to-explore example project (equivalent to `sm example`), and dispatch the chosen verb. The menu reads from stdin and renders to stderr; an empty answer selects the first option (tutorial).
  - When the cwd is NOT empty AND stdin is an interactive terminal, it MUST offer to bootstrap a project here: a yes/no confirm (default yes) that, when accepted, runs `sm init` and continues into the Web UI server (equivalent to `sm serve`). The confirm reads from stdin and renders to stderr. A first scan that only reports content issues (`init` exit `1`) still continues into the server; only a hard `init` failure (a config, scan, or guard error, exit `2`+) skips the server and exits with `init`'s code. Declining falls through to the hint below (exit `2`).
  - Otherwise (a non-interactive stdin, the operator declines the init offer, or no valid choice within the empty-folder prompt's bounded re-ask), it MUST print a one-line hint to stderr and exit `2`. The hint points at `sm tutorial` / `sm example` when the cwd is empty, or at `sm init` / `sm --help` when it is not.

---

## Global flags

These flags apply to every verb unless marked otherwise.

| Flag | Shape | Purpose |
|---|---|---|
| `--json` | boolean | Emit machine-readable output on stdout. Suppresses pretty printing. Human progress goes to stderr. |
| `-v` / `--verbose` | count | Increase log level (`-v` = info, `-vv` = debug, `-vvv` = trace). Logs to stderr. |
| `-q` / `--quiet` | boolean | Suppress all non-error stderr output. Does not affect stdout. |
| `--no-color` | boolean | Disable ANSI color codes. Implementations MUST also auto-disable color when stdout is not a TTY. |
| `-h` / `--help` | boolean | Print verb-specific or top-level help, exit 0. |
| `--db <path>` | string | Override the database file location (escape hatch; primarily for debugging). |

Env-var equivalents are normative:

| Env var | Equivalent flag |
|---|---|
| `SKILL_MAP_JSON=1` | `--json` |
| `NO_COLOR=1` | `--no-color` (also honored per the NO_COLOR standard) |
| `SKILL_MAP_DB=<path>` | `--db <path>` |

CLI flag wins over env var. Env var wins over config file.

### Scope is always project-local

Every `sm` verb operates on the **project scope** (`<cwd>/.skill-map/`).
There is no opt-in global scope, no `-g/--global` flag, no
`SKILL_MAP_SCOPE` env var. Skill-map MUST NOT read anything from
`$HOME` by default, and never adds an out-of-project directory on its
own initiative. The scan reaches outside the project root only through
two explicit, user-driven mechanisms (see §Scan): a positional root
argument to `sm scan [roots...]`, or a symbolic link inside the scanned
tree. A symlink whose real target stays inside a scan root is always
followed; a symlink whose target escapes every scan root is refused by
default (the containment gate) and followed only when the project-local
`scan.followExternalSymlinks` key is set (cycle detection prevents a link
loop from hanging the walk in either mode).
Plugins load from `<cwd>/.skill-map/plugins/` by default; an arbitrary
external location MAY be loaded via the `--plugin-dir <path>` escape
hatch on the `sm plugins …` verb family, user-explicit per invocation.
Project-local plugins are discovered but their code is NOT executed by
`sm scan` / `sm serve` (and the other runtime verbs) until the operator
grants LOCAL trust via `sm plugins trust <id>` (a per-plugin row in the
`config_plugins` DB trust store; `sm plugins trust --all` grants every
discovered drop-in at once); the committed `settings.json` does not and
cannot grant it. Enable / disable (`sm plugins enable / disable`, persisted
in the config layers) is the separate OPERATIONAL axis and grants no trust.
`--plugin-dir` and built-ins are not gated. See
[`architecture.md` §Locality](./architecture.md) (plugin enable vs import
trust) for the normative model.

### User-settings file (narrow, documented exception)

Genuinely per-user, per-machine preferences live in a **single file**
at `~/.skill-map/settings.json`, validated against
[`user-settings.schema.json`](./schemas/user-settings.schema.json).
It holds preferences with no project meaning (today: the update-check
toggle + its throttle bookkeeping, and the telemetry consent flag;
future locale, theme). Constraints:

- **One file, no `.local` partner**: values here are already
  per-machine, so the project / project-local split has no meaning.
- **NOT part of the config layer system**: the project config loader
  (`defaults` → `project` → `project-local` → `override`) MUST NOT
  read or merge this file. Modules owning a user-scope feature read it
  directly through a dedicated helper.
- **Narrow scope**: implementations SHOULD keep the key set small
  (only preferences meaningless inside a project). Anything project-
  scoped goes in `<cwd>/.skill-map/settings.json` instead.
- **Closed list of writers**: a single user-settings store module
  (`src/cli/util/user-settings-store.ts` in the reference impl) is the
  only reader / writer. Every user-scope feature (update-check toggle,
  telemetry consent) goes through it, not new home access points.

Everything else under `$HOME` MUST NOT be touched.

### Telemetry consent

skill-map sends nothing off the machine by default. Opt-in, anonymous
**error reporting** is the one documented exception, governed in full by
[`telemetry.md`](./telemetry.md). The operator-facing contract:

- **Default OFF.** The `telemetry.errorsEnabled` flag in
  `~/.skill-map/settings.json` is absent until the operator decides. Absent
  or `false` means no telemetry SDK is loaded and nothing is sent, on every
  surface (CLI, BFF, UI), zero added latency.
- **Consent prompt (interactive terminals only, second eligible run).** The
  CLI MAY show a one-time consent prompt (yes (default) / no / details),
  but NOT on the operator's first eligible run: that run only records
  `telemetry.firstRunAt` and stays silent so the prompt does not stack on
  the first-`sm scan` provider-lens prompt. The next eligible run shows it,
  persists the choice, and stamps `telemetry.promptedAt` (never shown
  again). When stdout is not a TTY (CI, pipes), nothing is asked or
  recorded and the state stays OFF.
- **Kill switch.** `SKILL_MAP_TELEMETRY=0` forces OFF everywhere regardless
  of the persisted flag. There is no env value that forces ON.
- **No `sm config` key.** Per-machine, so it lives in the user-settings
  file, not project config. `sm config` writes project-local settings only
  and MUST NOT surface this key. Consent is changed after the first run
  through the Settings UI (persisted via the BFF), mirroring the update-
  check toggle. A future `sm telemetry` verb family MAY expose CLI status /
  toggling; not part of this level.

### Active provider lens

The project sees its filesystem through exactly one **active provider lens** at any time, persisted as `activeProvider` in `<cwd>/.skill-map/settings.json` (see [`project-config.schema.json`](./schemas/project-config.schema.json#/properties/activeProvider) and [`architecture.md` §Active Provider Lens](./architecture.md#active-provider-lens) for the architectural rationale).

CLI surfaces:

- **Auto-detect on first scan**: when `activeProvider` is absent, `sm scan` and `sm watch` run a filesystem heuristic driven by each Provider's manifest `detect.markers` (e.g. `.claude/` → `claude`, `.codex/` → `codex`, `.agents/` → `agent-skills`; `AGENTS.md` is deliberately not a marker, it is the vendor-neutral agents.md standard). The marker set is provider-owned, not hardcoded. On unambiguous match, the result is persisted to `settings.json` and the scan proceeds; on no match, the lens defaults to the open-standard `agent-skills` view (the universal default lens) without persisting it, and the scan proceeds silently (a vendor marker added later still auto-detects on the next scan); on ambiguous match (multiple VENDOR markers detected), it prompts interactively (or fails with exit code 2 under `--yes` if no default is configured). **Fallback precedence**: the open default `agent-skills` declares `detect.fallback`, so its `.agents/` marker never competes with a vendor; a project carrying `.codex/` (or `.agent/workflows/`) alongside the shared `.agents/` skill home resolves to that vendor outright, no prompt. Google's Antigravity CLI auto-detects from its own `.agent/workflows/` marker (it stores skills under the open-standard `.agents/skills/` but keeps workflows under `.agent/workflows/`); a project with only `.agents/` and no vendor marker auto-detects as `agent-skills`.
- **Manual override**: `sm config set activeProvider <id>` switches the lens, drops the `scan_*` zone atomically (see [`db-schema.md`](./db-schema.md#zones)), and triggers an immediate rescan under the new lens. `state_*` and `config_*` zones survive.
- **No per-scan flag**: there is no `sm scan --provider=<id>` flag. The lens is a project-level decision; the drop+rescan cost makes per-invocation switching the wrong default UX.

**UI lens-selection surface.** `GET /api/active-provider` returns `{ activeProvider, detected, source, selectable, markerDrift }`. `selectable` is the set of registered **lens** Provider ids (gated Providers, `gatedByActiveLens: true`) enabled right now, resolved against the live per-extension enabled resolver (`config_plugins` layered over `settings.json#/plugins`, same as `GET /api/plugins`), the subset of `providerRegistry` eligible to become the lens. The non-gated `core/markdown` base is never in `selectable` (it is the substrate, not a lens). A disabled lens Provider is dropped from `selectable` but stays in `providerRegistry` (the static boot catalog keeps it so already-scanned nodes still render their chip / icon). Each `providerRegistry` entry carries an `isLens` flag projected from `gatedByActiveLens`; the SPA's active-lens dropdown lists only the `isLens` Providers and renders those absent from `selectable` disabled (greyed, not selectable), so the markdown base never appears in the dropdown and a disabled lens can never be picked. `PATCH /api/active-provider` rejects an `activeProvider` that is not a selectable lens. This mirrors the scan-time contract that a lens pointing at a disabled Provider runs none of its extractors (the runtime soft-warns on that drift); the dropdown closes the loop by refusing to create the drift.

**Provider-marker drift.** `GET /api/active-provider` additionally returns `markerDrift: { added, removed, detected } | null`, non-null when the filesystem-detected marker set differs from the persisted `activeProviderMarkers` snapshot (a Provider directory appeared or vanished since the lens was chosen), applying the same ships-disabled exclusion as the scan-time check. The SPA renders it as a dismissable notice ("new provider markers detected: `<added>`") offering to switch lens (the existing `PATCH /api/active-provider`) or dismiss. Both paths clear the drift. **Switch lens** (`PATCH /api/active-provider`) refreshes the `activeProviderMarkers` snapshot to the detected set as part of the switch (mirroring the CLI's `sm config set activeProvider`, snapshot write #3 in [`architecture.md` §Active Provider Lens](./architecture.md#active-provider-lens)), so a lens change dismisses the notice. **Dismiss** issues `POST /api/active-provider/accept-markers`, which reconciles the snapshot (writes `activeProviderMarkers` = the detected set) without changing the lens, so the drift clears in both the SPA and the CLI, and returns the refreshed envelope (`markerDrift: null`); a later, different marker change drifts again. Unlike the CLI, the server does NOT log the scan-time drift warning: `sm serve` and `POST /api/scan` suppress it (the SPA notice is the operator surface), while `sm scan` / `sm watch` on the CLI keep emitting the one-per-scan `⚠` warn.

---

## Targeted fan-out flags

`--all` is not global. It is only valid on verbs whose contract explicitly lists it:

- `sm jobs submit <extension> --all`
- `sm jobs cancel --all`
- `sm jobs fail --all`
- `sm plugins enable --all`
- `sm plugins disable --all`

For those verbs, `--all` means "apply to every eligible target matching the verb's preconditions" and is mutually exclusive with a positional target or `-n <path>` on the same invocation.

Implementations MUST NOT silently accept `--all` on unrelated verbs. Unsupported `--all` usage is an operational error (exit `2`), like any other invalid flag.

---

## Exit codes

All verbs use this shared table. Additional codes MAY be defined per-verb (documented under the verb).

| Code | Meaning | When emitted |
|---|---|---|
| `0` | OK | Command completed, no issues at or above the configured severity threshold. |
| `1` | Issues found | Command completed, but deterministic issues at `error` severity exist. Applies to `sm scan`, `sm check`, `sm doctor`. |
| `2` | Operational error | Bad flags, a present-but-unreadable / corrupt DB, unreadable file, corrupt config, runtime / environment mismatch (e.g. wrong Node version, missing native dependency), unhandled exception. Accompanied by an error message on stderr. (An *absent* project DB file is `5`, see below.) |
| `3` | Duplicate conflict | Job submission refused because an active duplicate exists (same `extension + version + node + contentHash`). Returned by `sm jobs submit`. |
| `4` | Nonce mismatch | `sm record` called with an `id`/`nonce` pair that does not match. |
| `5` | Not found | A named resource does not exist (node id, job id, plugin id, config key), or the project DB file is absent so a read verb (`sm check`, `list`, `show`, `graph`, `export`, `history`, `orphans`, `db dump` / `reset` / `backup` / `shell`, `job prune`) has nothing to open, run `sm scan` first. An explicit `--db <path>` that does not exist is the same case (see §Server boot resilience). |

Codes 6–15 are reserved. Codes ≥ 16 are free for verb-specific use.

---

## Dry-run

A verb that exposes `-n` / `--dry-run` MUST honour the following contract:

- **No observable side effects.** The command MUST NOT mutate the database, filesystem, config, network, or spawn external processes. Read-only operations needed to compute the preview (e.g. loading the prior `ScanResult`, reading config files, listing FS entries) ARE permitted.
- **No auto-provisioning.** A dry-run MUST NOT create directories, schema files, or DBs that would not exist after the command. If the operation would create a `.skill-map/` scope, dry-run only previews it; the directory must NOT appear on disk.
- **Output mirrors the live mode**, same shape, fields, and `--json` schema, except human-readable output indicates the dry-run state ("would persist …", "would create …", "would delete …", or a "(dry-run)" suffix) and machine-readable output sets a top-level `dryRun: true` field where applicable.
- **Exit codes mirror the live mode.** Same table; dry-run introduces no new codes. A dry-run surfacing an error severity (e.g. "scan would emit an error-severity issue") still exits `1`; one that fails to read the input still exits `2`.
- **Dry-run MUST NOT depend on `--yes` / `--force`.** Verbs offering interactive confirmation for destructive operations MUST allow `--dry-run` to bypass the prompt entirely (nothing being destroyed needs no confirmation).

Dry-run is **per-verb opt-in**; not global. Verbs that do not declare it MUST reject `--dry-run` as an unknown option (exit `2`), like any other unknown flag. The verb catalog below names every verb that exposes the flag and its preview.

---

## Verb catalog

### Setup & state

#### `sm init`

Bootstrap the project scope.

- Creates `./.skill-map/`.
- Provisions the database.
- Runs migrations.
- Runs a first scan.

Flags: `--no-scan` (skip the first scan), `--force` (rewrite an existing config), `-n` / `--dry-run` (preview the scope provisioning, would-create lines for every directory and file the live invocation would write, without touching the filesystem; respects `--force` for the "would-overwrite" preview).

Exit: 0 on success, 2 on failure.

#### `sm tutorial`

Materialize the interactive tester tutorial as a skill folder under the chosen agent's on-disk territory. Companion to the `sm-tutorial` skill: a tester drops into an empty directory, runs `sm tutorial` to seed the skill, opens their agent there and triggers it via one of its trigger phrases (the agent auto-discovers `<skillDir>/sm-tutorial/SKILL.md` on boot). The skill is a single "book" of parts: a tester walks the live-UI prologue, then picks further parts (extend skill-map with plugins/settings/view-slots, the CLI in depth) from an in-skill menu. The verb takes **no positional argument**.

The destination is the selected Provider's `scaffold.skillDir` (e.g. `.claude/skills` for Claude, `.agents/skills` for the open standard adopted by Antigravity); the verb writes `<cwd>/<skillDir>/sm-tutorial/`. Provider selection:

- `--for <provider-id>` selects the Provider explicitly (e.g. `--for claude`, `--for agent-skills`). The id MUST be a registered Provider declaring `scaffold.skillDir`; any other value is a usage error.
- Without `--for`, the default is the first scaffold-capable Provider in catalog order (Claude). The verb requires an empty cwd (see below), so there is no marker to detect: provider auto-detection does not apply.
- Without `--for`, on interactive stdin the verb prompts with a numbered list of Providers declaring `scaffold.skillDir`, marking the default (Claude); an empty answer accepts it. Each option shows the Provider's vendor name, NOT its destination folder (several Providers share `.agents/skills`, so the folder does not identify the lens). For a Provider that carries `scaffold.aka`, the aka vendor leads with the Provider label in parentheses (e.g. the open standard renders as `Google's Antigravity (Standard: Agent skills)`). The `aka` strings are display-only, NOT accepted by `--for`.
- Without `--for`, on non-interactive stdin (pipes, CI) the verb selects the default without prompting, staying scriptable.
- `--experimental` includes Providers flagged `stability: 'experimental'` as scaffold destinations and enables them in the seeded fixture so the demo scan classifies their nodes. Without it, experimental Providers are omitted from the prompt and `--for <experimental-id>` is a usage error (they ship disabled by default). Default behaviour offers the stable, ready destinations (today Claude, the rich-track anchor, and the open-standard `agent-skills`, the basic-track anchor).

Behaviour:

- Writes the full skill folder (`SKILL.md` plus its `references/` sub-folder) under the resolved `<skillDir>/sm-tutorial/`.
- Content is the canonical skill shipped with the implementation. The `SKILL.md` payload is host-agnostic; only the destination varies per Provider. Any conforming implementation MUST embed equivalent tutorial sources (the prose is informative; what is normative is that the verb produces a readable skill folder a compatible agent can consume).
- Requires the cwd to be empty (a listing including dotfiles returns nothing). The tutorial seeds a self-contained scenario and the skill later lays its fixtures and `.skill-map/` directly in the cwd, so the tester can delete the whole directory afterwards without losing prior work; that guarantee only holds when the directory started empty. A non-empty cwd is refused (exit 2) unless `--force`.
- Does NOT require an initialized project and never reads or writes `.skill-map/`. A pre-bootstrap helper: Provider selection reads the built-in Provider catalog directly, not project config.

Flags: `--for <provider-id>` (destination Provider, skips the prompt); `--force` (proceed even when the cwd is not empty, overwriting any existing target folder, without prompting).

Exit: `0` on success; `2` if the cwd is not empty and `--force` was not passed; `2` if an unexpected positional argument is passed (the verb takes no positional; e.g. the removed `master` variant, the advanced walkthrough is now a part inside the single skill, reached from its menu); `2` if `--for` names a Provider that does not exist or declares no `scaffold.skillDir`; `2` on any I/O failure.

#### `sm example`

Materialize a ready-to-explore example project (the "harness") directly into the current working directory, so a new user can run `sm scan` and `sm serve` against a real, pre-wired graph without authoring any files first. This is the concrete counterpart to `sm tutorial`: where `sm tutorial` installs the guided walkthrough skill, `sm example` drops the finished scenario the walkthrough builds toward, a small portfolio handbook (`AGENTS.md`) that mentions a content-editor agent and invokes a publish command, a `check-links` skill the publish command invokes, and the deploy / style docs they reference. It is the same harness the public demo renders. The verb takes **no positional argument** and no provider flag (the example ships the Claude layout).

Behaviour:

- Writes the example project files directly into the cwd: `AGENTS.md` (plus its `.sm` sidecar), `.claude/agents/`, `.claude/commands/`, `.claude/skills/check-links/`, `docs/`, `public/`, `package.json`, `server.js`, and a `.skillmapignore` / `.gitignore`. The content is the canonical example shipped with the implementation; a conforming implementation MUST embed an equivalent wired scenario (the exact files are informative, what is normative is that the verb produces a scannable project a fresh `sm scan` resolves into a connected graph).
- Does NOT write `.skill-map/`: the project ships unscanned, so the user's first `sm scan` provisions the project fresh and auto-detects the lens from the on-disk markers.
- Requires the cwd to be empty (a listing including dotfiles returns nothing), so the user can delete the whole directory afterwards without losing prior work. A non-empty cwd is refused (exit 2) unless `--force` (which proceeds, overwriting any colliding files).
- Does NOT require an initialized project and never reads or writes project config. A pre-bootstrap helper.

Flags: `--force` (proceed even when the cwd is not empty, overwriting any colliding files, without prompting).

Exit: `0` on success; `2` if the cwd is not empty and `--force` was not passed; `2` if an unexpected positional argument is passed (the verb takes no positional); `2` on any I/O failure (including a missing bundled example payload).

#### `sm version`

Prints version matrix:

```
sm           <cli version>
spec         <spec version implemented>
db-schema    <applied migration version>
```

`--json` emits `{ sm, spec, dbSchema }`.

#### `sm doctor`

Diagnostic report:

- DB file integrity (PRAGMA quick_check equivalent).
- Pending migrations (count + list).
- Orphan history rows (count).
- `state_jobs` rows whose `content_hash` is missing from `state_job_contents` (corrupt-state count).
- `state_job_contents` GC stragglers (count of rows referenced by zero `state_jobs` rows; `sm jobs prune` collects these).
- Plugins in error state (list).
- Detected Providers that matched nothing (non-blocking warning).

Exit: 0 if all green, 1 if warnings, 2 if any `error`-level problem. Error-level: DB corruption (`quick_check`) and jobs whose rendered-content row is missing; every other finding is a warning carrying its actionable verb in the message. `--json` emits `{ ok, kind: 'doctor', checks[] }`, one `{ id, status: 'ok'|'warn'|'error', message }` entry per check (`db-integrity`, `migrations`, `orphan-history`, `job-contents`, `job-gc`, `jobs-overdue`, `plugins`, `providers`; the `providers` check MAY repeat, one row per empty detected Provider). `jobs-overdue` warns per `running` job whose elapsed time exceeds its extension's advisory `probExpectedDurationSeconds` (extension resolved from the loaded registry; unresolvable extensions are skipped), naming `sm jobs fail <id>` / `sm jobs cancel <id>` as the actionable verbs; purely advisory, never mutates state (the operator escape hatch for TTL-less zombies, see `job-lifecycle.md` §Reap procedure). There is deliberately NO runner-availability check: skill-map never invokes an agent, so there is no binary of ours to probe.

#### `sm help [<verb>] [--format human|md|json]`

Self-describing introspection.

- `human` (default): pretty terminal output. No argument: compact overview of every verb grouped by category. With a verb (`sm help scan`, `sm scan --help`): that verb's detail view. With a **command namespace** (a prefix owning subcommands but not itself runnable, e.g. `sm help plugins`, `sm plugins --help`, `sm plugins slots --help`): a namespace overview, header line, USAGE, optional DESCRIPTION, then a COMMANDS list of the subcommands. An argument that is neither verb nor namespace exits `5` with an unknown-verb message.
- `md`: canonical markdown for documentation sites. Implementations MUST NOT hand-maintain equivalent markdown; it is generated on demand from this output. With a verb or namespace argument, output is scoped to that verb (or the namespace's subcommands).
- `json`: structured surface dump. Shape:

```json
{
  "cliVersion": "0.1.0",
  "specVersion": "0.1.0",
  "globalFlags": [ { "name": "--json", "type": "boolean", "description": "..." } ],
  "verbs": [ {
    "name": "scan",
    "description": "...",
    "flags": [ ... ],
    "subcommands": [ ... ],
    "exitCodes": [ 0, 1, 2 ]
  } ]
}
```

Consumers: docs generator, shell completion, Web UI form generation, IDE extensions, test harness, agent-skill integrations (`sm-cli` skill).

---

### Config

| Command | Purpose |
|---|---|
| `sm config list` | Effective config after layered merge. |
| `sm config get <key>` | Single value. |
| `sm config set <key> <value> [--yes]` | Write to project config. Privacy-sensitive keys require `--yes` to confirm, see §Privacy-sensitive config below. |
| `sm config reset <key>` | Remove user override; revert to default. |
| `sm config show <key> --source` | Reveals origin: `default` / `project` / `project-local` / `env` / `flag`. |

Config precedence (lowest → highest): library defaults → project config → project-local config → env vars → CLI flags.

Keys are dot-paths (`jobs.minimumTtlSeconds`, `scan.tokenize`). Unknown keys → exit 5.

#### Privacy-sensitive config

Keys whose value expands the project's surface by disk access OUTSIDE the project root (`scan.referencePaths`, and `scan.followExternalSymlinks` which lets the scan dereference symlinks whose target escapes the roots) are gated behind `--yes` so the user never expands the surface by accident. The analyzer:

- `sm config set <privacy-key> <value>` (without `--yes`), when the new value would expand the surface (adding `referencePaths` paths resolving outside the project root, or setting `scan.followExternalSymlinks` to `true`), exits with code `2` and prints the affected detail to stderr (the exposed paths, or the surface the toggle opens), suggesting `--yes` to confirm.
- `sm config set <privacy-key> <value> --yes`, proceeds and prints the same list as a confirmation receipt.
- Writes that NARROW the surface (removing paths) do not require `--yes`.

The Settings UI's Project section enforces the same analyzer via a confirm dialog enumerating the paths.

#### Project-local-only config

The privacy-sensitive keys above PLUS `allowEditSmFiles` are members of `PROJECT_LOCAL_ONLY_KEYS` (see [`architecture.md` §Config layering · Per-key locality](./architecture.md#per-key-locality)). The values are per-user-per-project and MUST NOT travel via the committed repo:

- `sm config set` writes them to `<cwd>/.skill-map/settings.local.json` (gitignored).
- The loader strips them (with a warning) when found in the committed `project` layer (`settings.json`). An older install that wrote one to `settings.json` keeps validating against the schema, but the value is ignored at read time and `sm config show --source` surfaces the warning.

---

### Scan

| Command | Purpose |
|---|---|
| `sm scan` | Full scan. Truncates `scan_*` and repopulates. |
| `sm scan -n <node.path>` | Partial scan: one node. |
| `sm scan --changed` | Incremental: only files changed since last scan (mtime heuristic). |
| `sm scan --watch` | Long-running: watch the roots and trigger an incremental scan after each debounced batch of filesystem events. Alias of `sm watch`. |
| `sm scan compare-with <dump> [roots...]` | Delta report: run a fresh scan in memory and compare against the saved `ScanResult` dump at `<dump>`. Read-only, does not modify the DB. Exit `0` on empty delta, `1` on any drift, `2` on operational error (missing or malformed dump, schema violation). |
| `sm watch [roots...]` | Long-running watcher. Same semantics as `sm scan --watch`, exposed as a top-level verb because the watcher is a loop, not a one-shot scan. |
| `sm refresh <node.path>` | Re-run Extractors against a single node and upsert their outputs into the universal enrichment layer (`node_enrichments`, see [`db-schema.md`](./db-schema.md#node_enrichments)), THEN execute every enabled enrichment Action against the node (Model A, provenance): a deterministic Action whose report schema extends a schema under `enrichments/` and whose manifest declares its IO (`io: ['network']`), executed in-process (`runner = in-process`, execution row recorded), report validated and upserted into `state_enrichments` keyed `(node_id, <qualified action id>)`. Gated by the committed project policy `allowNetworkActions` (default `false`: skipped with a directed advisory). An Action that targets nodes without the annotations it needs (e.g. no `source`) reports a no-op skip, not a failure. Exit `0` on success, `2` on failure, `5` if the node is not in the persisted scan. `--json` emits the report shape declared by [`refresh-report.schema.json`](./schemas/refresh-report.schema.json): `{ ok: true, kind: 'refresh.report', refreshed, nodes[], elapsedMs }`. Error envelope per §Error envelope: `not-found` (missing node), `db-missing` (absent DB), `internal` (read / persist failure). |
| `sm refresh --stale` | Batch form of `sm refresh <node>`, refreshes every node carrying at least one stale enrichment row. The stale set covers `state_enrichments` rows whose `stale_after` has passed OR whose node body changed since the recorded verification (`localBodyHash` drift); Extractor (Model B) writes never set `stale = 1`, so with no enrichment Actions enabled the set stays empty and `--stale` exits `0` with a "nothing to do" advisory. `--json` emits the same envelope as the single-node form ([`refresh-report.schema.json`](./schemas/refresh-report.schema.json)); an empty stale set yields `{ ok: true, kind: 'refresh.report', refreshed: 0, nodes: [], elapsedMs }`. |

`--json` output conforms to `schemas/scan-result.schema.json`. `sm watch` (and `sm scan --watch`) emit one ScanResult per batch, under `--json` this is an `ndjson` stream of ScanResult documents.

**Effective roots** (one-shot `sm scan`):

- `sm scan [roots...]`: positional roots, when given, ARE the effective roots (verbatim); a positional root MAY point outside the project. When omitted: `[cwd]`.
- A symbolic link encountered inside the scanned tree is followed to its target when that target resolves INSIDE a scan root. A link whose real target ESCAPES every scan root is refused by default (the realpath-containment gate): a cloned, hostile repository must not be able to use a committed symlink (`notes.md -> ~/.ssh/id_rsa`, or a directory link `docs/x -> ~/` / `-> /`) to read arbitrary local files into the graph or drive a filesystem-traversal denial of service. The project-local-only `scan.followExternalSymlinks` key (default `false`) opts back into following escaping links wherever they point, for a tree whose links the operator authored and trusts. Cycle detection prevents a link loop from hanging the walk in either mode. A positional root and a symlink are the only ways the scan reaches outside the project: no implicit `$HOME` walk, no opt-in global scope, and Providers cannot opt their own directory in. See §Scope is always project-local at the top of this file.

**Reference paths** (`scan.referencePaths[]`): walked in parallel by the scan to collect existing absolute paths into a side set. These files are NOT parsed or indexed as nodes; the kernel passes the set to analyzers via `IAnalyzerContext.referenceablePaths` so `core/reference-broken` can resolve a link against the filesystem when the in-graph lookup misses.

**Link existence validation (in-tree)**: independent of `scan.referencePaths`, a path-style reference whose target exists on disk under any scan root is NOT flagged broken even when the file is not an indexed node (a `.json` schema, an image, an ignored / oversized / over-ceiling `.md`). The check is a per-link existence probe at analysis time: the file is never read, parsed, or indexed, and a symlink entry counts as existing without being dereferenced. Only references pointing at nothing at all (no node, no on-disk file, no reference-path entry) flag `reference-broken`. Normative definition in [`architecture.md` §Provider · resolution rules](./architecture.md#provider--resolution-rules), rule 3.

The watcher subscribes to the same roots `sm scan` walks and respects `.skillmapignore` and `config.ignore` (and `.gitignore` when opted in) exactly as the one-shot scan does (ignore precedence: bundled defaults → `.gitignore` → `config.ignore` → `.skillmapignore`; later layers may `!`-re-include a path an earlier layer excluded). The `.gitignore` layer participates only while `scan.respectGitignore` is enabled (committed team key, default `false` so a fresh project does not read `.gitignore`); a `settings.json` flip is observed by the meta-watcher, which rebuilds the ignore filter. The live watcher holds OS watches only on the file types a scan opens (the registered providers' `read.extensions`, e.g. `.md` and `.toml`, plus `.sm` sidecars; a provider that ships a custom walker disables the gate, since its file set is not statically known); edits to the config files themselves (`.skillmapignore`, `.gitignore`, `.skill-map/settings.json`) are observed by a dedicated meta-watcher that rebuilds the ignore filter. Filesystem events are grouped using `scan.watch.debounceMs` (default 300ms) before the watcher re-runs the incremental scan and persists. `SIGINT` / `SIGTERM` close the watcher cleanly. Exit code on clean shutdown is 0.

**Cross-filesystem is unsupported.** The live watcher relies on the OS's native file-change notifications (inotify on Linux), which do NOT fire across the WSL to Windows boundary: a project, or a symlink target, under a mounted Windows drive (`/mnt/c/...`). There a one-shot `sm scan` still walks the files (best effort, slow), but the live map never updates and no `--watch-backend` value changes that (both `chokidar` and `parcel` are inotify-based). Skill-map ships no polling fallback; keep the project on the Linux filesystem for a live map.

**Watcher backend** (`--watch-backend <chokidar|parcel>`): on `sm serve`, `sm watch`, and `sm scan --watch`, selects the primary watcher backend for that invocation, overriding `scan.watch.backend` (default `chokidar`). `chokidar` watches one directory at a time and observes changes behind followed symlinks, so a live edit inside a symlinked directory refreshes the map; `parcel` uses a single native `@parcel/watcher` inotify instance that scales to very large trees without the `EMFILE: too many open files` failure, at the cost of not live-watching behind a symlinked directory (the initial walk still follows the link, but later edits under it do not fire an incremental scan). The meta-watcher that tracks the config files is always chokidar. Validation: the value must be `chokidar` or `parcel`, else exits `2` operational; ignored on a non-watching `sm scan` (no live watcher runs).

**Scan ceiling** (`--max-scan <N>`): on `sm scan`, `sm watch` (alias `sm scan --watch`), and `sm serve`, a hard ceiling on the number of files the walker accepts after `.skillmapignore` filtering, before extractors run. Default from `scan.maxScan` (default 5000). The scan walks, parses, analyzes, and reference-validates every file up to this ceiling, so link resolution sees the whole corpus (a large monorepo) and references resolve across it regardless of how many nodes the map renders. The flag fully overrides the setting and is **bidirectional** (raise or lower). At the ceiling, additional files are dropped in stable provider-walker order and `scan_meta.scan_truncated` is set; the `ScanResult` envelope carries `scanCeiling` and `scanTruncated` so the UI raises a persistent banner pointing at the `.skillmapignore` editor in Settings → Project. The CLI prints a human-mode notice naming both escapes: edit `.skillmapignore` (preferred, trims permanently) or re-run with `--max-scan <N>` (force). `sm refresh` operates on a single already-classified node, so the ceiling does not apply there. Validation: integer ≥ 1, else exits `2` operational.

**Map render cap** (`--max-nodes <N>`): the maximum number of nodes the graph map renders onto the canvas at once. Default from `scan.maxNodes` (default 256). This does NOT bound the scan: the full corpus up to `scan.maxScan` is walked and reference-validated, and the folders tree shows all of it; the cap only bounds the Foblex graph projection so a large project stays readable. The effective value is recorded in `scan_meta.max_render_nodes` and carried on `ScanResult.maxRenderNodes`; the UI projects the selected folder branch capped at this number and raises an in-view banner (distinct from the scan-ceiling banner) when the selected branch exceeds the cap, or when the whole corpus exceeds it even though the current branch fits (so the signal survives drilling into a small sub-folder). On `sm scan`, when the scanned corpus has more nodes (`stats.nodesCount`) than the effective cap, the CLI prints an advisory (info) notice naming the lever (`--max-nodes <N>` or `scan.maxNodes`); the full corpus is still scanned and reference-validated, only the graph view is capped, so nothing is lost. The flag fully overrides the setting (bidirectional) and is honoured on `sm scan` / `sm watch` / `sm serve`; on headless `sm scan` nothing renders, but the advisory still fires so the operator knows the map will paginate. Validation: integer ≥ 1, else exits `2` operational.

**File-size skip** (`scan.maxFileSizeBytes`, default 1 MiB): the walker checks each candidate file's on-disk size before reading and skips any larger than the limit. The skip happens at the source (never read, parsed, or indexed), so an accidental binary or generated artefact cannot poison the graph. Every skipped file is reported in the `ScanResult` envelope as `oversizedFiles` (each entry the root-relative, forward-slash path plus byte size) and counted in `stats.filesOversized`. When at least one file is skipped, `sm scan`, `sm watch` (per batch), and `sm serve` (initial scan and every batch) print a **WARN** terminal notice listing the skipped files with a human-readable size, plus a hint pointing at `scan.maxFileSizeBytes` and `.skillmapignore`; the UI raises a matching banner. Unlike the node cap, the limit is config-only (no per-invocation flag).

**Schema-drift rebuild (pre-1.0)**: before persisting, `sm scan`, `sm watch`, and `sm serve` (before listening) detect schema drift on two axes: recorded `scan_meta.scanned_by_version` against the running CLI (a minor or major difference is drift; patch-level is compatible), AND recorded `scan_meta.schema_fingerprint` against the fingerprint recomputed from the bundled migration DDL (any mismatch, or a NULL stored value from a pre-fingerprint DB, is drift). The fingerprint axis catches an inline `001_initial.sql` column add within the same `major.minor` the version axis cannot see. When either trips, the local cache predates a schema change, so the DB is deleted and rebuilt from scratch by this run (`.sm` sidecars untouched, the source of truth). On an interactive terminal the rebuild is confirmed first (`sm scan` rebuilds on the next persist; `sm serve` prompts before booting, aborts with a nonzero exit if declined); `--yes` (and every non-interactive caller: piped stdin, CI, the BFF scan route, the watcher) rebuilds without prompting. Declining aborts (exit `2`) without deleting anything. A DB never scanned (no `scan_meta` row) is not drift. Verbs that are NOT drift-owning split by their relationship to the DB:

- **Read-only verbs** keep the advisory (warn on an older DB or fingerprint mismatch, refuse on a newer or different-major DB) and then attempt the read. When the read itself FAILS because of the drift (a query touching a column the stored schema predates), the failure MUST surface as the same clean drift advisory (operational error, exit `2`, naming `sm scan` as the remedy), NEVER as a raw SQL error. Rationale: observed live, `sm findings` printed the advisory and then crashed with `no such column`, which contradicts the advisory's own "some columns may be missing" framing.
- **Non-drift-owning WRITE verbs** (`sm jobs submit` / `cancel` / `fail` / `prune`, `sm record`, `sm findings prune`, any verb inserting or mutating rows) MUST refuse cleanly on either drift axis with the drift advisory (exit `2`), before loading the plugin runtime and before touching any table: writing into a drifted schema risks partial or corrupt rows, and secondary reads during boot (e.g. the plugin trust store) silently misbehave on a drifted DB. Rationale: observed live, `sm jobs submit` against a drifted DB reported `extension <id> not found` because the trust read degraded to untrusted, a misleading symptom three layers away from the cause. The advisory names the actual problem and its remedy.

See [`db-schema.md` §Schema drift (pre-1.0)](./db-schema.md#schema-drift-pre-10).

Exit: 0 on clean (or clean watcher shutdown), 1 if error-severity issues exist (one-shot scan only; the watcher does not flip exit code on per-batch issues), 2 on operational error.

---

### Browse

| Command | Purpose |
|---|---|
| `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N]` | Tabular listing. `--json` emits an array conforming to `node.schema.json`. |
| `sm show <node.path>` | Node detail: weight (tokens triple-split), frontmatter, links in/out, issues, findings, and any stored per-node summary. A stored summary (written by `sm record` for a summarizer Action, one whose report schema extends the canonical node-summary schema under `summaries/`, see [`job-lifecycle.md` §Record](./job-lifecycle.md#record-callback)) renders in a `Summary` section as the summarizer action id + the report headline, marked `(stale)` when the node's body changed since the summary was generated (`body_hash_at_generation` differs from the current `scan_nodes.body_hash`). `--json` emits a detail object with the raw link rows plus a `summaries` array, each entry carrying a `stale` boolean. Pretty output groups identical-shape links (same endpoint, kind, normalized trigger) onto one line and lists the union of extractor ids in a `sources:` field; the section header reports both the raw row count and the unique-after-grouping count, e.g. `Links out (12, 9 unique)`. Storage keeps one row per extractor (`scan_links` unchanged); grouping is purely read-time presentation. |
| `sm check [-n <node.path>] [--analyzers <ids>]` | Print all current issues. Equivalent to `sm scan --json \| jq '.issues'` but faster (reads from DB). `-n` restricts to issues whose `nodeIds` include the path; `--analyzers <ids>` accepts a comma-separated list of qualified or short analyzer ids and restricts the issue read. Deterministic-only by construction (CI-safe): probabilistic analyzers never contribute to `sm check` (their surface is `sm jobs submit` on the way in and `sm findings` on the way out; the transitional `--include-prob` / `--async` stubs were retired with the findings pipeline). |
| `sm findings prune [--dry-run] [--yes]` | Delete STALE `state_findings` rows (body hash drifted since generation, or the node no longer exists in `scan_nodes`); fresh rows are never touched. The read-time mitigation (`sm findings` hides stale rows by default) makes this pure hygiene: the only other eraser is a fresh record for the pair. Destructive; without `--dry-run` prompts for interactive confirmation reporting the row count (per the §Dry-run analyzer for destructive verbs); `--yes` bypasses for non-interactive callers; `--dry-run` reports without deleting and never prompts. `--json` envelope: `{ deleted, wouldDelete, elapsedMs }`. Full findings management (dismiss / acknowledge / snooze) is a later, separate surface. |
| `sm findings [-n <node.path>] [--extension <ids>] [--type <slug>] [--severity <s>] [--since <iso>] [--threshold <0..1>] [--stale] [--fixed]` | Read `state_findings`: the judgments recorded by probabilistic finder Analyzers plus the kernel-derived safety rows (`injection-detected` / `content-suspicious` / `content-malformed`). Filters: `-n` by node path; `--extension` comma-separated qualified or short extension ids (same matching as `sm check --analyzers`); `--type` by finding slug; `--severity` minimum severity; `--since` ISO date on `generated_at`; `--threshold` minimum confidence. The default view shows what needs attention (open and `human-decision` rows), hiding two disjoint kinds of row: **`fixed`** rows (`resolution = 'fixed'`, already handled) and **stale** rows (body hash drifted since generation; a fixed-and-stale row counts as fixed, state precedence). `--fixed` shows ONLY the fixed bucket (marked with `resolution_actor` (`fixer` / `human`), the fixer id and its note); `--stale` shows ONLY the stale bucket (marked); together, only their union. The bucket flags are FILTERS, not additive reveals: with either present the needs-attention rows are omitted, and the excluded-count reporting below does not apply (it exists to keep the DEFAULT view honest; an explicit bucket filter is the operator's own narrowing, exactly like `--type`). A bucket-filtered view whose query matched rows but none land in the requested bucket renders a neutral no-match line, never the clean-verdict line; a query returning no rows at all keeps the clean verdict (still the only clean-verdict output). Open rows and **`human-decision`** rows always show (a `human-decision` finding is the fixer's proposal awaiting the author's choice, the highest-priority TODO). **Excluded rows MUST be reported, never silently swallowed**: an empty result reads `No fresh findings` plus the hidden breakdown and its remedy (`N fixed`, `M stale`), NEVER a bare `No findings` (which asserts a clean node while rows sit hidden); a populated listing footers the same breakdown; and any hidden row that is `human-decision` is named explicitly (a proposal staled by a sibling fix would otherwise vanish). `--json` carries `fixedExcluded` and `staleExcluded` counts. A `fixed` row is a state, NOT a verdict: it records that a fix happened, never that the defect is verified gone, re-running the finder is how the operator confirms (clean deletes it, still-present reopens it). A node with no rows at all is the only clean-verdict output. Exit 0 regardless of content: findings are probabilistic, advisory by construction, and never drive exit codes (the deterministic sibling with exit-code semantics is `sm check`). `--json` emits `{ ok, kind: 'findings', findings[], total, fixedExcluded, staleExcluded }`, each entry mirroring the `state_findings` row (camelCase, including `model` and the `resolution*` fields, `resolutionActor` included, when set) plus a derived `stale` boolean. Human mode prefixes each finding row with its numeric id (right-aligned per section, the handle for `sm findings resolve <id>`) and renders the model name alongside the confidence when present. See [`db-schema.md` §state_findings](./db-schema.md). |
| `sm findings resolve <finding.id> [--note <text>]` | Mark an OPEN or `human-decision` finding `fixed` by the OPERATOR ("I already handled this"): sets `resolution = 'fixed'`, `resolution_actor = 'human'`, `resolution_by = NULL` (no fixer ran), and the optional `--note`. It records a human decision, it does NOT verify the defect is gone (only re-running the finder does); the row hides from the default view like any `fixed` row and stays re-checkable. Exit 5 if the id does not exist; exit 2 if it is already `fixed`. `--json` emits the updated finding row. This is the CLI surface for the finding-management action the UI wraps (Step 16/17). |
| `sm findings dismiss <finding.id> [--note <text>]` | Silence a finding the operator has judged acceptable (a false positive, or an intentional pattern the finder keeps flagging). Durable, not a row state: it writes a standing `annotations.suppressions` entry to the node's `.sm` sidecar (through the gated sidecar write channel, same consent as `sm bump`) keyed by the finding's emitting extension and `type`, then deletes the matching rows. The finder's record path drops matching findings before they land, so the judgment CLASS stays silenced across re-runs until the entry is removed from the `.sm` file (suppression grain is per (extension, type), findings have no stable cross-run identity). Kernel safety-lane findings (`injection-detected` / `content-suspicious` / `content-malformed`) are NOT dismissible (exit 2). Exit 5 if the id does not exist. `--json` emits the written suppression entry. Distinct from `resolve` (which marks a finding FIXED, a resolution) and from `prune` (which clears stale rows): dismiss says "this judgment does not apply here, stop making it".
| `sm graph [--format ascii\|mermaid\|dot\|json]` | Render the full graph via the named formatter. `--format json` is the built-in JSON formatter: stringifies the persisted `ScanResult` ([`scan-result.schema.json`](./schemas/scan-result.schema.json)), byte-equivalent to `sm scan --json` modulo whitespace. The global `--json` flag is ignored on `sm graph` (formats are picked via `--format`, never via the global flag). |
| `sm export <query> --format json\|md\|mermaid` | Filtered export. Query syntax is implementation-defined pre-1.0. |
| `sm orphans` | History rows whose target node is missing. |
| `sm orphans reconcile <orphan.path> --to <new.path>` | Migrate history rows from the old path to the new one after a rename. Use case: the scan's rename heuristic missed a match (semantic-only rename, body rewrite) and the user wants to stitch history manually. |
| `sm orphans undo-rename <new.path> [--from <old.path>] [--force]` | Reverse a medium- or ambiguous-confidence auto-rename. Requires an active `auto-rename-medium` or `auto-rename-ambiguous` issue on `<new.path>`. For `auto-rename-medium`, omit `--from` (the previous path is read from `issue.data_json`). For `auto-rename-ambiguous`, `--from <old.path>` is REQUIRED to pick one of the candidates in `data_json.candidates`. Migrates `state_*` FKs back and resolves the issue; the previous path becomes an `orphan` (its file no longer exists in FS). Destructive; prompts for confirmation unless `--force`. Exit `5` if no active auto-rename issue targets `<new.path>`, or if `--from` references a path not in `data_json.candidates`. |

---

### Actions

| Command | Purpose |
|---|---|
| `sm actions list` | Registered action types (manifest view). |
| `sm actions show <id>` | Full manifest, including declared `preconditions`, `expectedDurationSeconds`, report schema ref. |

Actions are not invoked via `sm actions`. Probabilistic extensions (Actions AND finder Analyzers) queue via `sm jobs submit` (below); deterministic enrichment Actions (`io: ['network']` + an `enrichments/` report schema) execute via `sm refresh`; the remaining deterministic Actions dispatch in-process (`POST /api/actions/:id`, `sm bump`, ...).

#### Sidecar bump (Step 9.6.4)

The built-in deterministic `core/node-bump` Action is the canonical write channel for `<basename>.sm` annotation sidecars; the verbs below are its CLI surface plus a few sidecar-management helpers. The `bump` verb stays top-level (high frequency, ROADMAP-named); the administrative helpers live under the `sm sidecars` sub-namespace to avoid colliding with `sm refresh` (which targets the enrichment layer, not sidecars). All sidecar-touching verbs are deterministic: they invoke `core/node-bump` (or `FilesystemSidecarStore` directly) in-process and never queue jobs.

| Command | Purpose |
|---|---|
| `sm bump <node.path> [--force] [--yes]` | Single-node bump. Wraps `core/node-bump`. Refuses on a fresh node (`{ ok: false, reason: 'fresh' }`, exit `2`) unless `--force`; with `--force` on a fresh node the verb is a silent no-op (exit `0`, no stdout). On a stale node (or first-time creation) increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, and stamps the audit block (`audit.lastBumpedAt` + `audit.lastBumpedBy`; on first creation also `audit.createdAt` + `audit.createdBy`). The `by` fields carry the Git author name (`git config user.name`) when the project is a Git repository, else the channel literal `'cli'`. Exit `5` if the node is not in the persisted scan. `--json` emits the report shape declared by `bump-report.schema.json`. `--yes` confirms consent for `.sm` writes, see §`.sm` write consent below. |
| `sm bump --pending [--staged] [--force] [--yes]` | Batch bump. Walks every node whose sidecar overlay reports drift in `node.path` ASC order and bumps each. `--staged` runs `git add <sidecar-path>` after each successful bump so the content lands in the same commit; `git add` failure degrades to a stderr warning, the batch keeps running. Empty stale set → exit `0` with a "nothing to do" advisory. `--json` envelope: `{ bumped, refused, skipped, errors[], elapsedMs }`. Exit `0` on a clean run; `1` when at least one per-node error landed in `errors[]`. **Git error matrix for `--staged`**: not inside a git repo (no `.git/` parent of `cwd`) → exit `5`; `git` binary not on PATH (spawn ENOENT) → exit `2`. Both checks run BEFORE any sidecar write so a misconfigured environment never produces partial state. `--yes` confirms consent for `.sm` writes, see §`.sm` write consent below. |
| `sm sidecars refresh <node.path> [--yes]` | Hash-only update on the sidecar. Refreshes `for.{bodyHash, frontmatterHash}` to match the live node WITHOUT bumping `annotations.version` or touching the audit block. Useful when a body change is editorial-only and the user doesn't want a version increment. Distinct from top-level `sm refresh` (enrichment layer, Step A.8): different storage, different concept; the sub-namespace prefix prevents the collision. Exit `5` if the node has no sidecar or is not in the persisted scan. No-op on a fresh node (informational stderr, exit `0`). `--yes` confirms consent for `.sm` writes, see §`.sm` write consent below. |
| `sm sidecars prune [--dry-run] [--yes]` | Delete orphan `.sm` files (sidecars whose `<basename>.md` does not exist on disk). Destructive; without `--dry-run` prompts for interactive confirmation listing every file to be deleted (per the §Dry-run analyzer for destructive verbs). `--yes` (alias `--force`) bypasses the destructive-confirmation prompt for non-interactive callers (CI, the pre-commit hook, scripts), NOT the `.sm` write-consent gate (delete is not a write). With `--dry-run` reports what would be deleted without touching disk and never prompts. Different domain from `sm orphans` (node graph, rename heuristic); this operates on the filesystem layer. `--json` envelope: `{ deleted, wouldDelete, errors, items[], elapsedMs }`. Exit `1` when delete failures landed in `errors`. |
| `sm sidecars annotate <node.path> [--force] [--yes]` | Pure scaffolding. Writes a minimal `.sm` next to the `.md` with the `identity:` block populated and an empty `annotations: {}` block, ready for editing. Refuses if the file exists; `--force` overwrites. The optional legacy-frontmatter migration helper (`--from-frontmatter`) is deferred, no released consumer demands it. `--yes` confirms consent for `.sm` writes, see §`.sm` write consent below. |
| `sm hooks install pre-commit-bump [--dry-run]` | Install (or chain into) a git pre-commit hook that runs `sm bump --pending --staged` so staged drift in `.sm` sidecars auto-bumps before the commit lands. Idempotent: re-running detects the skill-map marker and no-ops. When the repo already has a custom `pre-commit`, the verb appends the skill-map block rather than replacing it. `--dry-run` prints the planned content with `--- target: <path> ---` markers and writes nothing. Exit `5` if no `.git/` parent is found at or above `cwd`; exit `2` on write failures or unknown hook flavours. |

**`.sm` round-trip contract.** The `bump` verb, `sm sidecars refresh`, and `sm sidecars annotate` write through `FilesystemSidecarStore`, which re-serialises the merged result via `js-yaml` `dump` with `sortKeys: true`. **`.sm` files are managed artifacts; comments and key order are not preserved on round-trip.** Author commentary belongs in the markdown body or a separate doc, not inside `.sm`. The integrity guarantee: the merged YAML always validates against `sidecar.schema.json` + `annotations.schema.json` and is written atomically (`.tmp + rename`).

A hand-edited sidecar like this:

```yaml
identity:
  path: agents/reviewer.md
  bodyHash: 3dd7d0...
  frontmatterHash: 271d1e...

annotations:
  version: 3
  # Deprecated because the v0.6 architecture replaced this skill.
  # See decision #142 in ROADMAP for context.
  stability: deprecated
  tags:
    - review
    - typescript  # only TS, not JS
```

…becomes the following after one `sm bump`:

```yaml
annotations:
  stability: deprecated
  tags:
    - review
    - typescript
  version: 4
audit:
  createdAt: '2026-05-07T10:00:00.000Z'
  createdBy: cli
  lastBumpedAt: '2026-05-07T10:00:00.000Z'
  lastBumpedBy: cli
identity:
  bodyHash: 3dd7d0...
  frontmatterHash: 271d1e...
  path: agents/reviewer.md
```

Comments dropped, keys re-sorted alphabetically. The `sm sidecars annotate` scaffold prints a banner reminding the author of this contract on first creation; that banner itself is dropped on the first bump.

Tracked as **R6** in the §Step 9.6 review queue: open by design, defer the `js-yaml` → `yaml` (eemeli) swap that would preserve comments + key order until a user complaint surfaces.

##### BFF endpoint, `POST /api/sidecar/bump` (Step 9.6.5, BFF half)

The Hono BFF exposes the single-node bump flow over REST so the UI can drive the same Action / Store the CLI uses. Behaviour mirrors `sm bump <node.path> [--force]` 1:1: same `core/node-bump` Action, `FilesystemSidecarStore`, fresh-vs-stale refusal semantics. The only differences are the invoker channel fallback (`'ui'` vs `'cli'`, used only when no Git author resolves) and the wire shape. Supersedes Decision A5 of 9.6.4 (which left the invoker a literal): both routes now stamp the Git `user.name` when the project is a Git repository, else the channel literal. Batch (`--pending`) is intentionally CLI-only at 9.6.5; surfacing it over REST needs a job-style progress channel and lands later.

| Field | Value |
|---|---|
| Method + path | `POST /api/sidecar/bump` |
| Request body | `{ "nodePath": <string, required>, "force"?: <boolean, default false>, "confirm"?: <boolean, default false> }` (JSON). `nodePath` is the canonical scope-root-relative `Node.path`. `confirm` is the per-request `.sm` write-consent bypass, see §`.sm` write consent below. |
| 200 envelope | `{ "schemaVersion": "1", "kind": "sidecar.bumped", "value": { "nodePath": <string>, "version": <int|null>, "status": "fresh" }, "elapsedMs": <int> }`. The `kind` value is part of the canonical `rest-envelope.schema.json#/properties/kind/enum` and validates under the action-result `oneOf` variant (`value` + `elapsedMs` siblings, no `filters` / `counts` / `kindRegistry`). |
| 409 envelope | `{ "ok": false, "error": { "code": "sidecar-fresh", "message": <string>, "details": null } }`. Returned when the target node is fresh and `force !== true`. The `'sidecar-fresh'` code is added to `app.ts`'s `TErrorCode` union. |
| 412 envelope | `{ "ok": false, "error": { "code": "confirm-required", "message": <string>, "details": { "key": "allowEditSmFiles" } } }`. Returned when `allowEditSmFiles` is `false` and `confirm !== true`. The UI catches this and opens a ConfirmDialog; on accept it retries the POST with `{ ..., "confirm": true }`, the kernel then persists `allowEditSmFiles: true` to `<cwd>/.skill-map/settings.local.json` and performs the bump. See §`.sm` write consent below. |
| 404 envelope | Standard `'not-found'` envelope. Returned when the DB is missing OR `nodePath` is not in the persisted scan. |
| 400 envelope | Standard `'bad-query'` envelope. Body must be a JSON object with `nodePath` (non-empty string); `force` / `confirm` (when present) must be booleans. |
| 200 force-on-fresh | Per the Action spec, `force: true` on a fresh node is a silent no-op; the response carries the existing `version` (read off the sidecar overlay) and `status: 'fresh'`. **No WS broadcast** in this case (no-op = no event; nothing changed on disk, sending `sidecar.bumped` would tell every connected UI to refresh state that hasn't moved). |

**WS event, `sidecar.bumped`** (Step 9.6.5; canonical envelope shape locked in 9.6.7 / R9). After every successful bump that materialises a write, the BFF broadcasts a `sidecar.bumped` event over `/ws` so all connected clients refresh in lockstep. The event uses the canonical `IWsEventEnvelope` wire shape (matches every other kernel→broadcaster bridge, `scan.*`, `watcher.*`, etc.):

```jsonc
{
  "type": "sidecar.bumped",
  "timestamp": "<ISO 8601 string>",   // server wall-clock at broadcast time
  "data": {
    "nodePath": "<scope-root-relative path>",
    "version": <int|null>,            // new value of annotations.version (`null` if absent)
    "status": "fresh"                 // status after the bump
  }
}
```

Emission analyzers:

- Emitted on a successful 200 bump (stale → fresh, or first-time-create → fresh).
- **NOT** emitted on a force-on-fresh no-op 200 (nothing changed on disk).
- **NOT** emitted on 409 / 404 / 400 (no write happened).

The `type` value is a normative addition to the event-type registry; if a future spec section catalogues every WS event type, `sidecar.bumped` joins `scan.started` / `scan.completed` / `watcher.error` / `emitter.error` there.

##### BFF endpoint, `GET /api/annotations/registered` (Step 9.6.6, BFF half)

Read-only catalog of plugin-contributed annotation keys. A pure projection of `kernel.getRegisteredAnnotationKeys()`, populated once by `registerEnabledExtensions` at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec. The endpoint exists so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime.

| Field | Value |
|---|---|
| Method + path | `GET /api/annotations/registered` |
| Request | None, no query params, no body, no auth (matches `/api/plugins`, `/api/config`). |
| 200 envelope | `{ "schemaVersion": "1", "kind": "annotations.registered", "items": IRegisteredAnnotationKey[], "counts": { "total": <int> } }`. The `kind` value is part of the canonical `rest-envelope.schema.json#/properties/kind/enum` and validates under the catalog `oneOf` variant (`items` + `counts.total` only, no `filters` / `kindRegistry` / `returned`, the catalog ships in its entirety on every response and does not paginate). |
| Item shape | `IRegisteredAnnotationKey` per `src/kernel/types/annotation-catalog.ts`: `{ pluginId: string, key: string, location: 'namespaced' \| 'root', ownership: 'exclusive' \| 'shared', schema: Record<string, unknown> }`. The inline JSON Schema declared in the contributing plugin's manifest (NOT the AJV-compiled validator). |
| Invariants | Read-only, no side effects, never throws after kernel boot. Catalog small (typically 0–50 entries); no pagination, filters, or caching headers. Mutating the returned `items` array does not affect subsequent calls; the kernel's view is frozen. |
| Empty case | Booted with no plugin contributions (or `--no-plugins`): `{ "items": [], "counts": { "total": 0 } }`. |
| Refresh policy | Discovery happens once at `sm serve` boot. Installing a new plugin requires a server restart (matches the watcher's "loaded ONCE at boot" contract). |

##### `.sm` write consent

Every verb in this section that writes `.sm` (the `bump` table rows, `sm sidecars refresh`, `sm sidecars annotate`, and the BFF's `POST /api/sidecar/bump`) consults the `allowEditSmFiles` setting (see [`architecture.md` §Config layering · Per-key locality](./architecture.md#per-key-locality) and §Annotation system · Write consent). Behaviour:

- **`allowEditSmFiles === true`**, the verb proceeds silently. No prompt, no flag mutation, identical to pre-consent behaviour.
- **`allowEditSmFiles === false` and the operator passes `--yes` (CLI) or `{ "confirm": true }` (BFF body)**, the kernel persists `allowEditSmFiles: true` to `<cwd>/.skill-map/settings.local.json` (gitignored) and proceeds. The flag flip is durable; the next invocation won't re-ask.
- **`allowEditSmFiles === false` and the operator did NOT confirm**:
  - **CLI on a TTY**, the verb prints a one-paragraph explanation of what `.sm` files are and where they land, then runs an interactive `confirm()` prompt. Accept proceeds (same as `--yes`); decline aborts without persisting the rejection (exit `2`, the verb's `errors[]` carries one entry with code `confirm-required`). The next invocation re-asks; declining is never "remembered".
  - **CLI without a TTY** (CI, piped stdin, agent harness), the verb exits `2` immediately with a stderr message: `consent required: pass --yes to allow .sm sidecars in this project (writes to .skill-map/settings.local.json, gitignored)`.
  - **BFF**, the route returns 412 `confirm-required` (envelope in the bump-endpoint table above). The UI catches the code and opens a `ConfirmationService.confirm({ ... })` dialog; on accept it retries with `{ "confirm": true }`; on reject the action is silently abandoned (no toast spam, the user opted out).

`sm sidecars prune --yes` is unaffected: `--yes` on `prune` bypasses the destructive-delete confirmation prompt (the verb deletes orphans, does not write `.sm`). Same spelling, orthogonal concerns.

---

### Jobs

See `job-lifecycle.md` for the state machine; this table is the CLI surface.

**Processing-agent gate.** `sm jobs submit` refuses (exit 2) when the project has no processing agent set up, i.e. the `sm-process-jobs` skill is not installed under any Provider scaffold destination: the queue is processed by external agents, so the jobs would sit queued forever. The refusal explains the mechanism and names the remedy (`sm agent install`, then ask the agent to process the queue). An installed-but-outdated skill passes with a refresh advisory. Full semantics: [`job-lifecycle.md` §Submit](./job-lifecycle.md#submit), processing-agent gate.

**Submit target resolution.** `<extension>` is any PROBABILISTIC extension, Action or finder Analyzer; the queue is kind-agnostic. It accepts a qualified id (`<plugin>/<ext>`) or a bare extension id (unique-suffix matching, same rule as `sm jobs list --extension`). An id matching no extension at all refuses with exit 5 (not found); an id whose only match is deterministic refuses with exit 2. If one plugin ships a probabilistic Action AND a probabilistic Analyzer under the same extension id, the bare/qualified form refuses with exit 2 and an advisory naming the `<kind>:` prefixed disambiguator (`action:<plugin>/<ext>` / `analyzer:<plugin>/<ext>`), which is always accepted. The resolved kind freezes onto the job row (`extension_kind`), so record-time routing never re-resolves it.

| Command | Purpose |
|---|---|
| `sm jobs submit <extension> -n <node.path>` | Enqueue a single job. A finder submit over a node whose `.sm` sidecar suppresses the finder's judgment (a standing `sm findings dismiss`) queues anyway but emits a stderr advisory naming the suppressed types, so the operator can reconsider the agent pass before spending it (`job-lifecycle.md` §Submit, suppressed-judgment advisory; omitted under `--json`). |
| `sm jobs submit <extension> --all` | Fan out to every node matching the extension's preconditions. |
| `sm jobs submit ... --force` | Bypass duplicate detection. |
| `sm jobs submit ... --ttl <seconds>` | Arm an expiry for this job (positive seconds; the reaper may then mark it `abandoned`). `0` explicitly disarms, overriding any config policy. Absent every source (flag, `jobs.perExtensionTtl`, `jobs.ttlSeconds`) the job never expires, the default (Decision #139: interactive processing runs may hold a claim for hours). |
| `sm jobs submit ... --priority <n>` | Override job priority. Integer; higher runs first. Default `0`. Negative allowed (deprioritize). Frozen on `state_jobs.priority` at submit time. |
| `sm jobs list [--status ...] [--extension ...] [--node ...]` | List jobs. `--extension` accepts a qualified `<plugin>/<ext>` id or a bare extension id (renamed from `--action` when Analyzers joined the queue). `--json` emits the job rows WITHOUT the `nonce` (the record credential travels only on `submit --json` / `claim --json`, see `job-lifecycle.md` §Atomic claim · Nonce exposure). |
| `sm jobs show <job.id>` | Detail: current state, claim timestamp, TTL remaining, runner, content hash. `--json` omits the `nonce`, same rule as `sm jobs list`. |
| `sm jobs preview <job.id> \| --last` | Print the rendered MD content of the job without executing. Reads from `state_job_contents`; there is no on-disk artifact. `--last` previews the most recently submitted job (newest `createdAt`, any status; no jobs at all → exit 5). Pass exactly one of `<job.id>` or `--last` (neither, or both, is a usage error → exit 2). |
| `sm jobs claim [--filter <extension>]` | The process primitive for external agents. Reaps expired running jobs FIRST (`job-lifecycle.md` §Reap procedure), then runs the atomic claim: return next queued job id, mark it running (`runner = agent`). Exit 0 with id on stdout; exit 1 if queue empty. `--filter` accepts a qualified `<plugin>/<ext>` id or a bare extension id (same matching as `sm jobs list --extension`). `--json` returns `{id, nonce, content}`, drivers that intend to call `sm record` afterwards MUST use the `--json` form to receive the nonce. A claimed job whose content row is missing (DB corruption) is marked `failed` / `job-file-missing` and the verb exits 2 with a corruption advisory, in plain and `--json` modes alike (see `job-lifecycle.md` §Atomic claim). |
| `sm jobs status [<job.id>]` | Counts (per status) or single-job status. |
| `sm jobs cancel <job.id> \| --all` | Move a `queued` / `running` job to the terminal `cancelled` state (no `failureReason`; `cancelled` is a distinct state, not a `failed` sub-reason). `--all` cancels every `queued` and `running` job. Already-terminal job → exit 2; missing id → exit 5. |
| `sm jobs fail <job.id> \| --all` | Symmetric to cancel: move a `queued` / `running` job to the terminal `failed` state with reason `user-failed`. `--all` fails every `queued` and `running` job. Already-terminal job → exit 2; missing id → exit 5. |
| `sm jobs prune` | Retention GC: deletes terminal jobs (`completed` / `failed` / `cancelled`) past their configured retention window (`jobs.retention.*`) AND collects orphaned `state_job_contents` rows in the same transaction. |

Submit returns the job id on stdout in pretty mode, or a `Job` object conforming to `job.schema.json` in `--json` mode.

---

### Record (callback)

```
sm record --id <job.id> --nonce <n> --status completed \
         --report <path-or-dash> \
         --tokens-in N --tokens-out N --duration-ms N \
         --model <name>
```

Closes a running job with success. `--report` accepts a filesystem path the kernel reads, or `-` to read the JSON payload from stdin. The kernel stores the parsed JSON inline on `state_executions.report_json`; the path / stdin source is ingestion-only, not retained. `--model <name>` is the agent's self-declared model id (unverifiable, like the token counts): persisted on `state_executions.model` and denormalized onto the `state_findings.model` / `state_summaries.model` rows the same record writes, so every probabilistic analysis answers "which model, when" without joins. The canonical process skill instructs agents to declare it.

```
sm record --id <job.id> --nonce <n> --status failed --error "..."
```

Closes a running job with failure. The `--error` value is stored verbatim in the execution record.

Exit: 0 on success; 4 on nonce mismatch; 2 when the job is not in `running` state (a late callback after a reap / cancel, see [`job-lifecycle.md`](./job-lifecycle.md) §Record step 3); 5 only when the job id (or the project DB) does not exist; 2 otherwise (bad flags, unreadable report, report-invalid).

`--json` streams the synthetic run envelope as ndjson on stdout, the canonical job-event emission (`spec/job-events.md`: `run.started(mode=external)` → `job.claimed` replay → `job.callback.received` → `job.completed` \| `job.failed` → `run.summary`); there is no other JSON output, the envelope IS the machine-readable result (`job.callback.received.data.executionId` carries the new execution id).

Authentication: the nonce is the sole credential. An implementation MUST reject a mismatched or absent nonce.

### Agent process skill

The distributable half of the agent process protocol (`job-lifecycle.md` §Runners): a runtime-agnostic skill file teaching ANY agent the claim → execute → record loop. skill-map materialises it into the active lens's own skill territory; it never invokes the agent.

| Verb | Behavior |
|---|---|
| `sm agent install [--for <provider>]` | Materialise the canonical `sm-process-jobs` skill folder into the lens's `scaffold.skillDir` (`<skillDir>/sm-process-jobs/SKILL.md`; same destination selection as `sm tutorial`, `--for` overrides the active lens). Idempotent with a three-state outcome: fresh install writes the folder; when a copy exists with DIFFERENT bytes (an older CLI's install) it is rewritten and reported as an update; identical bytes are a no-op reported as already up to date. The outcome wording mirrors the UI affordance (Install / Update / Up to date), both driven by the same byte comparison the `status` verb's `stale` field uses. A Provider without `scaffold.skillDir` is refused with exit 2 and a directed advisory. |
| `sm agent uninstall [--for <provider>]` | Remove the materialised skill folder. Not installed → exit 0 with an advisory (idempotent). |
| `sm agent status [--for <provider>]` | Report install state for the lens: `installed` / `not installed`, plus a `stale` marker when the materialised content differs from this CLI's canonical copy (an older install; rerun `sm agent install`). Exit 0 in all three states; the report is the result. `--json` emits `{ provider, skillDir, installed, stale }`. |

The skill content is canonical and CLI-versioned (it ships inside the binary); implementations MUST NOT require a network fetch or a separate package to install it. The materialised folder is excluded from scans by default (a bundled `sm-process-jobs/` ignore pattern; `!sm-process-jobs/` in `.skillmapignore` re-includes it): the process skill is skill-map infrastructure, not project content, so it never surfaces as a node in the map or the server. The protocol it teaches is exactly the public verb surface: `sm jobs claim --json` (exit 1 = queue empty), execute the self-contained rendered content, `sm record --id --nonce --status completed --report -` (a schema-rejected report closes the job as `failed / report-invalid`, there is no retry), `--status failed --error` for jobs the agent cannot execute.

---

### History

| Command | Purpose |
|---|---|
| `sm history [-n <node.path>] [--extension <id>] [--status ...] [--since <date>] [--until <date>]` | Filter execution records. `--extension` accepts a qualified or bare extension id (renamed from `--action` when Analyzers joined the queue; `state_executions.extension_id` was already kind-agnostic). `--json` emits an array of `execution-record.schema.json` objects. |
| `sm history stats [--since <date>] [--until <date>] [--period day\|week\|month] [--top N]` | Aggregates over `state_executions` in the window. `--json` emits a document conforming to `history-stats.schema.json`: totals, tokens per action, executions per period (granularity from `--period`, default `month`), top N nodes by frequency (default 10), error rates (global + per-action + per failure reason). |

---

### Plugins

| Command | Purpose |
|---|---|
| `sm plugins list [<id>]` | No id: auto-discovered plugins with status, one row per plugin (`--json` emits the aggregate discovered-plugin registry). With a bare plugin id: that plugin's manifest plus its extension detail (kind / version / per-extension status; `--json` emits the single `DiscoveredPlugin`). A qualified `<plugin>/<ext>` id is rejected with a redirect to `sm plugins show`. |
| `sm plugins show <plugin>/<ext>` | Single-extension detail (Kind / Version / Stability / Description / Preconditions / Entry; `--json` emits the single extension object). For a PROBABILISTIC extension (Action or finder Analyzer) the detail additionally renders its two contract files, the extension's essence under the forms model: a `Prompt` section with the verbatim `prompt.md` template (sanitized for terminal output; the raw bytes ride `--json` as `promptTemplate`) and a `Report schema` section with the pretty-printed `report.schema.json` (`--json`: `reportSchema` object). This is the inspection surface for what a queued job will carry BEFORE submitting (the post-render counterpart is `sm jobs preview`). Accepts only a qualified `<plugin>/<ext>` id; a bare plugin id is rejected with a redirect to `sm plugins list <id>`. |
| `sm plugins enable <id>... \| --all [--local]` | Operational toggle ON. Persists the per-extension `enabled` in the config layers (`plugins.<id>.extensions.<ext>.enabled`), defaulting to the shared `settings.json`; `--local` writes `settings.local.json` instead. Does NOT grant import trust (use `sm plugins trust`). Accepts one or more ids; batches are all-or-nothing (any unknown / mismatched id aborts before any write) and repeated ids are deduped. `--all` applies to every discovered plugin. |
| `sm plugins disable <id>... \| --all [--local]` | Operational toggle OFF; does not delete the plugin directory and does not revoke trust. Persists `enabled: false` in the config layers (`--local` targets `settings.local.json`). Eagerly purges each id's rows from `scan_contributions` so its UI chips disappear before the next scan (plugin-managed state in `state_plugin_kvs` / dedicated tables is preserved, see `plugin-kv-api.md`). Accepts one or more ids; batches are all-or-nothing and repeated ids are deduped. `--all` applies to every discovered plugin. |
| `sm plugins trust <id>... \| --all` | Grant LOCAL import trust: the operator's security consent to import and run this plugin's code on this machine. Persists a per-plugin row in the `config_plugins` (DB) trust store, keyed by the bare plugin id (a qualified `<plugin>/<ext>` collapses to its plugin). Local only, never committed, so it cannot travel in a clone. Distinct from `enable`: a plugin runs only when it is both enabled (config) and trusted. Accepts one or more ids; batches are all-or-nothing and repeated ids are deduped. `--all` applies to every discovered plugin. |
| `sm plugins untrust <id>... \| --all` | Revoke local import trust: drops the plugin's `config_plugins` trust row, so it reverts to discovered-but-unexecuted on the next scan / restart. Does NOT change the enable state and does NOT delete the plugin directory. Same id / batch semantics as `trust`. |
| `sm plugins config <plugin>/<ext> [<settingId> [<value>]] [--reset]` | Read or write the operator-supplied values for an extension's declared `settings`. No `settingId`: table of each declared setting with its effective value and the layer that set it (`--json` emits the resolved set). With `<settingId> <value>`: coerce the shell string to the setting's input-type, validate, then write under `plugins.<pluginId>.extensions.<extId>.settings.<settingId>` (a normal setting lands in `settings.json`; a `secret`-typed one is forced into `settings.local.json`, gitignored, never committed); prints a "re-scan to apply" reminder. `--reset` drops the override back to the manifest default. Requires a qualified `<plugin>/<ext>` id; a bare plugin id is rejected with a redirect to `sm plugins list <id>`. `secret` values are redacted as `<redacted>` in output. |
| `sm plugins doctor` | Revalidate all plugins against current spec version; update `status` fields. `--json` emits the report shape declared by [`plugins-doctor.schema.json`](./schemas/plugins-doctor.schema.json): `{ ok: true, kind: 'plugins.doctor', counts, issues[], warnings[], elapsedMs }`. |

---

### Database

See `db-schema.md` for the table catalog.

| Command | Purpose |
|---|---|
| `sm db reset [-n / --dry-run]` | Drop `scan_*` only. Keep `state_*` and `config_*`. Non-destructive, no confirmation required. `--dry-run` prints the row counts that would be deleted per `scan_*` table without touching the DB. |
| `sm db reset --state [-n / --dry-run]` | Drop `scan_*` AND `state_*` (including `state_plugin_kvs` and every `plugin_<id>_*` table). Keep `config_*`. Destructive. `--dry-run` previews the deletion without touching the DB. |
| `sm db reset --hard [-n / --dry-run]` | Delete the DB file entirely. Keep the plugins folder so the next boot re-discovers them. Destructive. `--dry-run` reports the file path and size that would be deleted without unlinking it. |
| `sm db backup [--out <path>]` | WAL checkpoint + file copy. |
| `sm db restore <path> [-n / --dry-run]` | Swap the DB. Destructive. `--dry-run` validates the source file (existence, header, schema version) and reports what would be overwritten without touching the live DB. |
| `sm db shell` | Interactive SQL shell (implementations backed by SQLite use `sqlite3`; others use equivalent). |
| `sm db browser [<path>] [--rw]` | Open the DB in DB Browser for SQLite (`sqlitebrowser` GUI). Read-only by default (`-R`) so a concurrent `sm scan` writer is safe; pass `--rw` to enable writes. The `sqlitebrowser` binary MUST be on `PATH`. Non-destructive, no confirmation prompt. Detaches from the terminal so the shell stays usable. |
| `sm db dump [--tables ...]` | SQL dump. |
| `sm db migrate [--dry-run \| --status \| --to <n> \| --kernel-only \| --plugin <id> \| --no-backup]` | Migration controls. |

Destructive verbs (`reset --state`, `reset --hard`, `restore`) require interactive confirmation unless `--yes` (non-interactive mode for scripts) or `--force` (alias, kept for backward compatibility) is passed. `sm db reset` without a modifier is non-destructive and never prompts. **`--dry-run` short-circuits the confirmation prompt** (per §Dry-run analyzer: dry-run MUST NOT depend on `--yes` / `--force`).

---

### Server

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--db <path>] [--no-built-ins] [--no-plugins] [--open\|--no-open] [--dev-cors] [--ui-dist <path>] [--no-ui] [--no-watcher]` | Start Hono + WebSocket for the Web UI. Single-port mandate: SPA + REST + WS under one listener. Default port 4242, default host 127.0.0.1 (loopback-only through v0.6.0; multi-host deferred, see §Server). Watcher on by default (Decision #121: a server with stale DB is a footgun); pass `--no-watcher` for CI / read-only deployments. `--no-ui` skips the SPA bundle (dev workflow alongside the Angular dev server); see §Server flags. |

#### Server

*(Stability: experimental, locks at v0.6.0.)*

The reference implementation ships a Hono BFF rooted at `src/server/`. One Node process serves the Angular SPA, the REST API under `/api/*`, the WebSocket at `/ws`, and (only when `mcp.server.enabled`) a read-only MCP server at `/mcp` ([`mcp-server.md`](./mcp-server.md)), single-port, no proxy. Loopback-only through v0.6.0: no per-connection auth on `/ws` or `/mcp`; combining `--dev-cors` with a non-loopback `--host` is rejected (exit 2).

**Host + Origin gate.** Every request runs through a first-stage middleware before any route handler. Two invariants are enforced, with the canonical error envelope `403` + `{ ok: false, error: { code: 'host-not-allowed' | 'origin-not-allowed', message: <terse>, details: null } }` on violation. The gate stays opaque to probes (no per-request state in `details`); the discriminator lives in `error.code` and matches the canonical envelope shared by every other `/api/*` error.

1. **`Host` header hostname**, must be a loopback name (`127.0.0.1`, `localhost`, `::1`); the port half is ignored. Closes the DNS-rebinding lane where a malicious page in the operator's own browser resolves an attacker-controlled hostname to 127.0.0.1 and the server would otherwise accept. The hostname is what DNS rebinding flips; port pinning adds no defence and would break ephemeral test ports and operator-overridden ports. Missing `Host` (legacy HTTP/1.0) is tolerated.
2. **`Origin` header hostname**, enforced only on `/api/*`, `/ws`, and `/mcp` (the last only while the MCP server is enabled). Missing / empty / `null` (sandboxed or `file://`) is accepted; otherwise the origin's hostname must be loopback and its scheme `http` / `https`. Cross-origin attacker domains, non-HTTP schemes (`file://`), and malformed origins are rejected. Same port-agnostic posture as the Host gate, so a Vite dev UI on a different loopback port passes without `--dev-cors`. Static-asset requests (e.g. `/`, `/index.html`) skip the Origin check: they carry no Origin in normal navigation and the bundle is the public surface.

**Boot resilience**: `sm serve` boots even when the project DB is missing. `/api/health` reports `db: 'missing'` so the SPA renders an empty-state CTA instead of failing the connection. Explicit `--db <path>` that doesn't exist is the exception, exits 5 (NotFound) per `§Exit codes`.

**Boot output**: after the listener binds, `sm serve` writes a startup banner to **stderr**. Stdout is reserved for `--json` payloads on other verbs and stays empty here. The banner shape depends on `isTTY(stderr)` and the standard color toggles (`NO_COLOR`, `FORCE_COLOR`, `--no-color`):

- **TTY + color**: an ASCII-art figlet logo split into a violet upper half and a green lower half, a dim version line right-aligned under the logo, then a dim-labelled data block (`Server <url>`, `Path <cwd>`, `DB <path>`) and the `Press Ctrl+C to stop.` hint. The `Path` row shows the running cwd; when under the user's home, the prefix is replaced with `~`. The URL value is green with an underline. Implementations MAY choose any figlet-style rendering and palette consistent with the violet-upper / green-lower split; the reference impl uses xterm 256-color codes (`\x1b[38;5;141m` violet, `\x1b[38;5;42m` green) and does NOT degrade to 16-color terminals, users on legacy terminals MUST set `NO_COLOR`.
- **TTY + `NO_COLOR` (or `--no-color`)**: same figlet block + version + data block, with zero ANSI escapes.
- **Non-TTY (pipes / redirects)**: banner suppressed; the verb emits two flat lines, `sm serve: listening on http://<host>:<port> (db=<path>)` then `sm serve: opening <url>/ in your browser. Press Ctrl+C to stop.` (or `sm serve: visit <url>/ ...` under `--no-open`). This shape is **stable**; tooling scraping those lines (CI capture, `tee log.txt`) MUST keep working across releases.

**Discovery file (`serve.json`)**: after the listener binds, the verb writes `<scopeRoot>/.skill-map/serve.json` (shape: [`schemas/serve-info.schema.json`](schemas/serve-info.schema.json)) recording the RESOLVED host/port, `pid`, `scopeRoot`, `startedAt`, `smVersion`, and a random per-session `token`; it deletes the file on shutdown. Short-lived local processes (the activity bridge, [`provider-activity.md`](./provider-activity.md)) read it to find and authenticate against the project's running server. Runtime artifact, not user config: written atomically, gitignored (`sm init` adds the entry), overwritten on boot, and readers fail open when it is stale (a hard kill cannot clean up).

**Endpoints** (the table is the authoritative surface; rows carry the sub-step marker where semantics landed after the v14.2 baseline):

| Path | Status | Shape |
|---|---|---|
| `GET /api/health` | implemented | `{ ok: true, schemaVersion, specVersion, implVersion, db: 'present'\|'missing', cwd: string, dbPath: string }`. `cwd` is the absolute project root the BFF resolves against (`runtimeContext.cwd`); `dbPath` is the absolute project DB path (`IServerOptions.dbPath`). Both surfaced so the SPA's About panel can show "you are looking at <project>" + the DB location without a second endpoint. |
| `GET /api/scan` | implemented | latest persisted `ScanResult` (1:1 with `scan-result.schema.json`; byte-equal to `sm scan --json` modulo whitespace). DB absent → empty `ScanResult` shape (zero `nodes` / `links` / `issues`). |
| `GET /api/scan?meta=1` | implemented | metadata-only `ScanResult`: every scalar field plus `stats` (real `COUNT(*)`-derived counts) and `scanCeiling` / `scanTruncated` / `maxRenderNodes` / `tokenizer` / `oversizedFiles`, but `nodes` / `links` / `issues` are empty arrays. Reads only `scan_meta` + counts (never selects the node/link/issue rows), so the SPA hydrates its header and banners at boot without the full-corpus payload (paired with `/api/folders` for the tree and `/api/branch` for the map). DB absent → empty `ScanResult` shape. |
| `GET /api/scan?fresh=1` | implemented | runs an in-memory scan and returns the produced `ScanResult` without persistence. Rejects with `bad-query` (400) when the server was started with `--no-built-ins` or `--no-plugins` (would yield empty / partial results). |
| `POST /api/scan` | implemented | Run a fresh scan **and persist it** through the same `runScanWithRenames` + `persistScanResult` pipeline the watcher uses. Body empty (`{}` or none). Response: the persisted `ScanResult` inline (same shape as `GET /api/scan`). Side effects: broadcasts `scan.started` then `scan.completed` over `/ws` so other clients refresh; the per-batch sequence is identical to a watcher-driven batch. **Concurrency**: only one scan may run at a time across the whole BFF process. A POST arriving while a watcher batch (or another POST) is in flight is rejected with `409 scan-busy` so the caller can retry. **Pipeline gate**: rejected with `400 bad-query` when the server started with `--no-built-ins` or `--no-plugins` (a partial pipeline would persist a misleading DB the next watcher boot must reconcile). **DB gate**: rejected with `500 db-missing` when the project DB is absent; the read-side `/api/scan` degrades to the empty shape, but a write path cannot, so it fails fast. |
| `GET /api/nodes?kind=&hasIssues=&path=&limit=&offset=` | implemented | `RestEnvelope` (`kind: 'nodes'`), paginated, filtered list. Filters share the `kind=` / `has=issues` / `path=<glob>` grammar with `sm export`. `hasIssues=false` is a server-side post-filter (not representable in the kernel grammar). Pagination defaults `offset=0`, `limit=100`; max `limit=1000`. |
| `GET /api/nodes/:pathB64[?include=body]` | implemented | Single-node detail envelope: `{ schemaVersion, kind: 'node', item: Node, links: { incoming: Link[], outgoing: Link[] }, issues: Issue[] }`. `:pathB64` is base64url (RFC 4648 §5, no padding) of `node.path`. Missing node or malformed `pathB64` → 404 `not-found`. **`?include=body`** (Step 14.5.a), opt-in flag adding `item.body: string \| null` to the response. The body is read from disk on demand at request time (the kernel persists `bodyHash` only). `null` means the source file was missing / unreadable when the request landed (the watcher re-emits `scan.completed` on catch-up). Without the flag, `item.body` is `undefined` and the handler does not touch the filesystem. |
| `GET /api/links?kind=&from=&to=` | implemented | `RestEnvelope` (`kind: 'links'`), list of links. Filters: `kind` (CSV whitelist of `link.kind`), `from` (exact match on `link.source`), `to` (exact match on `link.target`). No pagination at v14.2. |
| `GET /api/issues?severity=&analyzerId=&node=` | implemented | `RestEnvelope` (`kind: 'issues'`), list of issues. Filters: `severity` (CSV from `error\|warn\|info`), `analyzerId` (CSV; qualified or short suffix per `sm check --analyzers`), `node` (filter to issues whose `nodeIds` includes the path). No pagination at v14.2. |
| `GET /api/folders` | implemented | `RestEnvelope` (`kind: 'folders'`), lightweight full-corpus projection: one entry per scanned node `{ path, kind, linksInCount, linksOutCount, tokensTotal, modifiedAtMs, errorCount, warnCount, sidecarStatus }`. Only cheap scalar columns of `scan_nodes` (no frontmatter, body, links, signals, or contributions), so the SPA folders tree renders the whole corpus (up to `scan.maxScan`) with per-node data columns + per-folder issue badges without hydrating the full `ScanResult`. `tokensTotal` / `modifiedAtMs` are nullable (tokenization disabled / unknown mtime). `errorCount` / `warnCount` are the count of error / warn issues whose `nodeIds` include that path (the same incidence the tree rolls up across descendants). `sidecarStatus` is the node's sidecar drift status (`scan_nodes.sidecar_status`), `null` when there is no parseable sidecar, so the folders tree can flag per-row staleness without hydrating the branch payload. No pagination (the complete tree is the point; the corpus is already bounded by `scan.maxScan`). DB absent → zero items. |
| `GET /api/branch?path=<prefix>&path=<prefix>&limit=<n>` | implemented | Branch projection for the map. `path` is **repeatable**: the response is the UNION of the subtrees under every given prefix (forward-slash; a node matches a prefix when its path equals it or starts with `<prefix>/`). No `path` (or a single empty one) = the whole corpus. The union is capped at `limit` nodes (default and effective max = the scan's `maxRenderNodes`), so the response stays bounded regardless of how many prefixes are sent. Direct shape (no envelope wrap, like `/api/scan`): `{ schemaVersion, kind: 'branch', branch: { paths, total, rendered, truncated, cap }, nodes: Node[], links: Link[], issues: Issue[] }`, where `paths` echoes the requested prefixes. `nodes` is the first `rendered` nodes of the union in stable path order; `links` carries only edges whose source AND **resolved target** are in `nodes` (the resolved target is `resolvedTarget`, the node a trigger-style `invokes` / `mentions` link points to, falling back to the raw `target` for path-style links; a genuinely-broken link whose target resolves to no node is excluded); `issues` carries those touching `nodes`. `truncated` is `total > cap`. Lets the SPA render a multi-folder selection without hydrating the full `ScanResult`. DB absent → empty branch (zero nodes). Validation: `limit` integer ≥ 1 else 400 `bad-query`. |
| `GET /api/graph?format=ascii\|json\|md` | implemented | formatter-rendered graph. `Content-Type` per format: `text/plain` (ascii), `application/json` (json), `text/markdown` (md / mermaid). Default `format=ascii`. Unknown format → 400 `bad-query`. |
| `GET /api/config` | implemented | `RestEnvelope` (`kind: 'config'`), merged effective config (defaults → user → user-local → project → project-local → override). |
| `GET /api/plugins` | implemented | `RestEnvelope` (`kind: 'plugins'`), list of installed plugins (built-in + drop-in) with status. Item shape: `{ id, version, kinds, status, reason, source: 'built-in'\|'project', description?: string, locked?: boolean, startsAsDisabled?: boolean, trusted?: boolean, extensions?: Array<{ id, kind, version, enabled, description?: string, stability?: 'experimental'\|'beta'\|'stable'\|'deprecated', locked?: boolean }> }`. The plugin row has no granular toggle axis; its `status` aggregates the children (`'enabled'` when at least one extension is enabled, else `'disabled'`). An **untrusted** drop-in reads `'disabled'` regardless of the config-enable axis (its code never loaded, see §Plugin enable vs import trust in `architecture.md`), so a `beta` plugin that ships config-enabled still shows `'disabled'` until it is trusted, never a misleading `'enabled'` for code that is not running. The `description` carries the manifest-declared description (built-ins: hardcoded on `IBuiltInPlugin`; drop-ins: `plugin.json#/description`); each `extensions[]` entry carries its manifest's `description` per `IExtensionBase` (`extensions/base.schema.json#/properties/description`), plus the optional `stability` lifecycle label per `extensions/base.schema.json#/properties/stability` (omitted when undeclared; missing means `stable`. The SPA badges only non-default values, `experimental` / `beta` / `deprecated`, next to the extension row; `stable` renders nothing. Presentation-only EXCEPT `experimental` and `deprecated`, which each flip the extension's installed default to disabled). The SPA's Settings list renders descriptions as muted secondary text and indexes them for substring search alongside the ids. The `extensions` array is present whenever the plugin declares any extension AND loaded successfully. Each entry's `enabled` reflects the per-extension config resolution (`settings.local.json` over `settings.json` over installed default, where the default is `false` for `experimental` and `deprecated` extensions and `true` otherwise); enable no longer reads from the DB. The optional `locked: true` flag is stamped when the plugin id (or qualified extension id) appears in the host's lock-list (`src/server/locked-plugins.ts`); locked items render the toggle disabled in the SPA and any `PATCH` returns `403 locked`. Omitted when false. The optional `trusted: true` flag is stamped on a drop-in plugin that carries a local import-trust grant (a `config_plugins` trust row); omitted when false, so an untrusted project-local plugin reads `trusted` absent (built-ins omit it, they are never trust-gated). The optional `startsAsDisabled: true` flag is stamped on a drop-in plugin (never built-ins) that was config-disabled at `sm serve` boot (discovery-time `status: 'disabled'` for a reason OTHER than untrust), so the handlers were never bucketed into the runtime; an untrusted plugin carries the one-time untrusted boot notice instead and does NOT get `startsAsDisabled`. The SPA renders a per-row hint when `startsAsDisabled` is set AND the user re-enables at least one of the plugin's extensions in the buffered state, since re-enabling requires `sm serve` restart (the rest of the toggle pipeline applies live). Omitted when false. |
| `PATCH /api/plugins/:id` | implemented | **Bundle (aggregate) macro endpoint**: fans the toggle out across every extension inside the plugin. `:id` MUST be a top-level plugin id (no slash); qualified-id form is the sibling route below. Body `{ enabled: boolean }` (JSON). Writes the per-extension `enabled` (`plugins.<id>.extensions.<ext>.enabled`) for every child to the config layers (the shared `settings.json`); locked children are silently dropped, mirroring the CLI's bulk-mode lock semantics. Response is the canonical `RestEnvelope` (`kind: 'plugins'`) reflecting the post-write state. **Lock**, rejected with 403 `locked` when the plugin id itself is in the host lock-list (`src/server/locked-plugins.ts`). **Apply window**, the override applies on the next scan; both the BFF and the watcher build a fresh resolver from the config layers before composing extensions, so the toggle is honoured without restarting `sm serve`. The endpoint purges `scan_contributions` rows for each disabled extension immediately so the UI stops rendering its chips before the next scan. **Exception**, drop-in plugins whose discovery-time `status` was `'disabled'` (carried as `startsAsDisabled: true`) are NOT in the runtime extension buckets; re-enabling them via PATCH persists the override but requires `sm serve` restart for the handlers to load. The SPA surfaces this per-row. The endpoint does NOT broadcast a WS event today. |
| `PATCH /api/plugins/:pluginId/extensions/:extensionId` | implemented | Canonical per-extension toggle. Body `{ enabled: boolean }`. Both segments are URL-path-segment-encoded (no slash inside `:pluginId` or `:extensionId`). 404 `not-found` when the plugin id is unknown or the extension id does not belong to that plugin. **Lock**, rejected with 403 `locked` when either the plugin id or the qualified `pluginId/extensionId` appears in the host lock-list. Same persistence + apply-window semantics as the bundle macro form (including the `startsAsDisabled` exception). The SPA's buffered Settings modal posts here for every per-row flip. |
| `PATCH /api/plugins` | implemented | Bulk toggle. Body `{ "changes": Array<{ "id": string, "enabled": boolean }> }` where each `id` is either a bare plugin id (bundle cascade macro, same semantics as `PATCH /api/plugins/:id`) or a qualified `<plugin>/<extension>` id. Empty `changes` is a no-op (returns the current `GET /api/plugins` envelope). The route validates the **entire batch** before writing; any invalid entry (`unknown-plugin` / `locked`) rejects the whole request with the offending id in `error.details.id`, DB untouched. Valid batches apply in **one SQLite transaction**: bare plugin ids expand to child qualified ids before persistence; the per-extension `enabled` is written to the config layers per resulting key, then one grouped `scan_contributions` purge per disabled extension (enables skip the purge). Response is the same `RestEnvelope` (`kind: 'plugins'`) shape as `GET /api/plugins`, reflecting the post-write state; the SPA replaces its modal state from it. Apply-window and `startsAsDisabled` exception semantics match the per-id routes. The single-id `PATCH /api/plugins/:id` and qualified-id sibling stay available for CLI / external automation; the bulk variant lets the SPA stage edits in a buffered modal and ship the final delta atomically. |
| `PATCH /api/plugins/:id/trust` | implemented | Plugin-level LOCAL import-trust toggle (the security axis, separate from enable). `:id` MUST be a bare plugin id (no slash). Body `{ trusted: boolean }` (JSON). Writes (true) or clears (false) the plugin's row in the `config_plugins` (DB) trust store. Built-ins and locked ids are rejected with 403 `locked` (they are never trust-gated). Response is the canonical `RestEnvelope` (`kind: 'plugins'`) reflecting the post-write `trusted` projection. Granting trust lets an enabled plugin's code import on the next scan / `sm serve` restart (handlers load on restart, like the `startsAsDisabled` case); revoking reverts the plugin to discovered-but-unexecuted. Does NOT touch the enable axis. For the bulk case, `sm plugins trust --all` (CLI) grants a `config_plugins` row to every discovered drop-in at once; there is no config-key or committed way to grant import trust. |
| `POST /api/activity` | implemented | Live-activity ingest (see [`provider-activity.md`](./provider-activity.md)). Body `{ provider: string, event: <raw provider hook payload> }`; the per-session token from `serve.json` MUST arrive in the `x-skill-map-token` header. The handler resolves the Provider, calls its `mapEvent(raw)`, resolves each signal against the scanned node set, feeds the execution-stats accumulator, broadcasts one stats-enriched `node.activity` WS event per resolved signal plus one `agent.spawn` event per spawn relation, records conversation content only while the capture gate is on, then discards the raw event. Responses: `202` accepted with `{ ok, resolved, spawns }` (also when nothing resolved; the bridge never needs the outcome), `403 token-mismatch` on missing/wrong token (before any body processing), `400 bad-query` on malformed body. **Privacy**: the request body may carry prompts / command text / file contents; it is excluded from error reporting and access logs and never persisted. |
| `GET /api/activity/install?provider=<id>` | implemented | Live-activity install-status probe for the SPA (contract: [`provider-activity.md` §Install management over HTTP](./provider-activity.md)). Returns `{ provider, supported, installed, configPath, configWired, bridgePresent, events }`. Unknown provider id → 404 `not-found`; missing `provider` param → 400 `bad-query`. No token (operator UI surface, not the bridge's ingest path). |
| `POST /api/job-events` | implemented (Step 16 piece 1 follow-up) | Live job-transition ingest, the push leg of [`job-events.md` §Transport](./job-events.md): every job-transitioning CLI verb (`sm jobs submit` / `claim` / `cancel` / `fail`, `sm record`) POSTs its event envelope here (discovery via `serve.json`, per-session token in `x-skill-map-token`, best-effort fire-and-forget: the verb never blocks or fails on the server's account). Body = one canonical event envelope (`type` in the `job.*` catalog, `timestamp`, `runId`, `jobId`, `data`); the server validates the shape and rebroadcasts it VERBATIM over `/ws`, no DB read or write (the row already carries the truth; this is a cache-invalidation hint). Responses: `202` `{ ok: true }`, `403 token-mismatch` (before any body processing), `400 bad-query` on malformed body. |
| `POST /api/jobs/:jobId/cancel` | implemented (Step 16, launcher stop) | HTTP face of `sm jobs cancel <id>` for the inspector's launcher stop/restart affordance (a zombie running job, e.g. a killed agent holding a claim, must be resolvable without the CLI). Moves a `queued` / `running` job to terminal `cancelled` via the same adapter transition as the verb, broadcasts the canonical `job.cancelled` envelope (`job-events.md`) so every client's launcher resets live, and answers `204 No Content` (mirror of the favorites mutations). Already-terminal job → `409` code `job-terminal`; unknown id → `404 not-found`; missing DB → `404`. Restart is client-side composition: cancel, then the normal `POST /api/nodes/:pathB64/jobs` resubmit. |
| `POST /api/activity/install` | implemented | HTTP equivalent of `sm activity install`. Body `{ provider: string, confirm?: boolean }`; without `confirm: true` → `412 confirm-required` and NO file is touched (server-enforced consent gate; the SPA shows the confirm dialog and retries). Semantics identical to the CLI verb (refresh-on-reinstall, non-destructive merge, bridge + sibling package.json written). Returns the refreshed status envelope. Unknown provider → 404; provider without `activity` / unimplemented install kind → 400. |
| `POST /api/activity/uninstall` | implemented | HTTP equivalent of `sm activity uninstall`, but consent-gated like install (`confirm: true` required, else 412; deliberately stricter than the CLI verb, which does not prompt). Removes exactly the marked entries, deletes `.skill-map/activity/`, idempotent. Returns the refreshed status envelope plus `removed: boolean` (`false` = nothing was wired). |
| `GET /api/agent/install?provider=<id>` | implemented | Agent-process-skill install probe for the SPA (the Settings → Project button; CLI counterpart: `sm agent status`, §Agent process skill). Returns `{ provider, supported, skillDir, installed, stale }`; `supported: false` (with `skillDir: null`) when the Provider declares no `scaffold.skillDir`. Missing `provider` param → 400 `bad-query`; unknown provider id → 404 `not-found`. The `stale` field drives the button's three states (Install / Update / Up to date). |
| `POST /api/agent/install` | implemented | HTTP equivalent of `sm agent install`. Body `{ provider: string, confirm?: boolean }`; without `confirm: true` → `412 confirm-required` and nothing is written (same server-enforced consent gate as the activity endpoints). Same three-state semantics as the CLI verb; returns the refreshed status envelope plus `outcome: "installed" \| "updated" \| "up-to-date"`. Unknown provider → 404; provider without `scaffold.skillDir` → 400. |
| `POST /api/agent/uninstall` | implemented | HTTP equivalent of `sm agent uninstall`, consent-gated like install (412 without `confirm: true`). Idempotent; returns the refreshed status envelope plus `removed: boolean`. |
| `GET /api/activity/summary` | implemented | Execution-stats snapshot for client hydration (contract: [`provider-activity.md` §Execution stats](./provider-activity.md)). Returns `{ since, nodes: { <nodePath>: { count, lastStartAt, lastOwner, distinctOwners } }, pairs: { "<parent>>><childNodePath>": { count, lastStartAt } } }`, in-memory only, reset on every serve boot. No token (operator UI surface). |
| `GET /api/activity/node/<pathB64>` | implemented | Per-node activity detail for the inspector: `{ stats, recent, spawns, captureEnabled, runs }`. `spawns` lists RETAINED records only; with the capture gate off the list is always empty (live spawn metadata rides the `agent.spawn` WS stream instead). `runs` (Step 16 follow-up, user decision 2026-07-17) is the node's AI-run history from `state_executions` (the DB, so it survives server restarts unlike the ephemeral runtime stats): newest-first, capped at 20, each `{ executionId, extensionId, status, model, durationMs, finishedAt, failureReason }`, so the inspector's Activity timeline can interleave BOTH provenances (runtime activity vs skill-map's own analysis runs) behind a user-switchable filter. Unknown path → 404 `not-found`; a missing DB degrades to `runs: []` (the runtime half still answers). |
| `GET /api/activity/spawns/<spawnId>` | implemented | One RETAINED spawn record (the spawn-edge click surface) with its `prompt` / `response` halves; `captureEnabled` rides every 200. Records exist only while the gate is on, so gate-off answers 404 like an unknown id. |
| `GET /api/activity/capture` | implemented | Conversation-capture gate probe: `{ enabled: boolean }` (contract: [`provider-activity.md` §Conversation capture](./provider-activity.md)). |
| `POST /api/activity/capture` | implemented | Toggles the conversation-capture gate. Body `{ enabled: boolean, confirm?: boolean }`; without `confirm: true` → `412 confirm-required` and nothing changes (server-enforced consent, same gate as install). Turning the gate off clears the in-memory conversation store immediately. The setting persists in the project-local config layer. |
| `GET /api/preferences` | implemented | Per-machine user settings envelope, read from `~/.skill-map/settings.json` through the user-settings store (the documented `$HOME` exception, see §User-settings file; no project config layer participates). Shape: `{ updateCheck: { enabled }, telemetry: { errorsEnabled, usageCliEnabled, usageUiEnabled, anonymousId, environment } }`. `anonymousId` (the PostHog `distinct_id` shared by CLI + UI usage, `null` until a usage toggle is first enabled) and `environment` (`'dev'`\|`'prod'`) are read-only on the wire. Consent contract: [`telemetry.md`](./telemetry.md). Always 200; an absent or malformed settings file reports the shipped defaults. |
| `PATCH /api/preferences` | implemented | Mutates the per-machine toggles. Body: any non-empty subset of `{ updateCheck: { enabled: boolean }, telemetry: { errorsEnabled?, usageCliEnabled?, usageUiEnabled?: boolean } }` (AJV, `additionalProperties: false` at every level; `{}` → 400 `bad-query`). `telemetry.anonymousId` is never writable; turning a usage toggle ON mints the anonymous id when absent (idempotent, re-enabling never rotates it). Persist failure (permissions, disk) → 400 with a directed message. Response: the refreshed `GET` envelope. |
| `GET /api/project-preferences` | implemented | Project-scope preferences envelope, assembled from the merged config layers (defaults reported when unset): `{ allowSidecarWriters, scan: { referencePaths, followExternalSymlinks }, tutorialReminderDismissed, ui: { liveUpdates, realtimeActivity }, mcpServerEnabled }`. `mcpServerEnabled` projects the config key `mcp.server.enabled` (the opt-in read-only MCP server, see [`mcp-server.md`](./mcp-server.md)). Every key except `allowSidecarWriters` is `PROJECT_LOCAL_ONLY` (see [`architecture.md` §Per-key locality](./architecture.md#per-key-locality)). |
| `PATCH /api/project-preferences` | implemented | Mutates one or more sub-keys of the project-preferences envelope. Body requires at least one mutable key; unknown keys are rejected at every level (400 `bad-query`). Two persistence classes: `allowSidecarWriters` and `scan.respectGitignore` write to the **committed `project` layer** (team policy); every other key writes to the gitignored `project-local` layer. **Consent gates (412 `confirm-required` unless the body carries `confirm: true`)**: a `scan.referencePaths` entry that exposes paths outside the project root (the 412 names the exposed paths), and turning ON `scan.followExternalSymlinks`, each a surface expansion only the local operator may approve; turn-OFFs and no-ops are never gated. `scan.respectGitignore` is ungated (it never reads outside the project root). **Existence gate**: every NEW `scan.referencePaths` entry must resolve to an existing directory (after `~` expansion) else 400. `tutorialReminderDismissed` and `ui.*` are ungated (they neither expand disk access nor trust code); `ui.*` only steers the SPA's live channel, so it reloads the config cache without a watcher restart, while scan-surface changes (`allowSidecarWriters`, `scan.respectGitignore`, an actual `referencePaths` add / remove, `followExternalSymlinks`) also trigger a best-effort watcher restart. Persist failure → 400. Response: the refreshed `GET` envelope. |
| `GET /api/project-ignore` | implemented | `{ patterns: string[] }`, the current pattern list of the project-root `.skillmapignore` file (gitignore syntax). Dedicated route rather than a `project-preferences` sub-key because the backing is a project-root file artifact, not a config-layer key. |
| `PATCH /api/project-ignore` | implemented | Replaces the whole `.skillmapignore` pattern list. Body `{ patterns: string[] }` (AJV; each entry one line, control characters rejected). The server re-trims and de-duplicates before persisting; an entry that is empty after trim, or a duplicate, → 400 `bad-query`. **No consent gate** (patterns can only NARROW the scan surface) and **no existence gate** (globs need not resolve on disk). An actual set change (add / remove, ignoring order) triggers a best-effort watcher restart. Response: the refreshed `GET` envelope. |
| `PUT /api/favorites/:pathB64` | implemented | Marks the node as favorited (`state_node_favorites`, [`db-schema.md`](./db-schema.md)). `:pathB64` is the same base64url codec as `/api/nodes/:pathB64`. Idempotent; success → `204 No Content` (no envelope, clients update optimistically). Malformed `pathB64`, a path absent from the scanned node set, or a missing DB → 404 `not-found`. Favorites are read back via the `isFavorite` decoration on node payloads (`node.schema.json#/properties/isFavorite`). |
| `DELETE /api/favorites/:pathB64` | implemented | Drops the favorite. Idempotent, `204 No Content`; **no existence check**, un-favoriting a path the kernel no longer knows about is a no-op (absence-of-row = not favorited). Malformed `pathB64` → 404 `not-found`. |
| `GET /api/nodes/:pathB64/findings` | implemented (Step 16 piece 1) | The node's `state_findings` rows as a list envelope (`kind: "findings"`), mirroring the `sm findings -n <path>` default view: FRESH open rows in `items` (severity, `type`, `message`, `detail`, `confidence`, `model`, `extensionId`/`Version`, `origin`, resolution fields, `generatedAt`, `id`), with the excluded-count honesty carried on `counts` (`fixedExcluded`, `staleExcluded` beside `total` / `returned`) so the UI can render the same "N fixed, M stale hidden" line as the CLI. Query flags `?fixed=1` / `?stale=1` are bucket FILTERS (only that bucket, mirroring `--fixed` / `--stale`). Malformed `pathB64` / unknown node / missing DB → 404 `not-found`. |
| `GET /api/nodes/:pathB64/prob-extensions` | implemented (Step 16 piece 1) | The node's probabilistic launcher list (`kind: "node.prob-extensions"`), classified manifest-mechanically per [`ROADMAP.md` §Step 16](../ROADMAP.md): `finders` (probabilistic Analyzers whose precondition matches the node), `fixers` (probabilistic Actions declaring `precondition.analyzerIds`, INCLUDED ONLY when the node has ≥ 1 matching OPEN finding, `resolution IS NULL`, stale included, `findingCount` on the entry; a resolved row, fixed or human-decision, no longer drives the button, per [`job-lifecycle.md` §Findings injection](./job-lifecycle.md), Selection), `standalone` (probabilistic Actions without `analyzerIds`, always included when their precondition matches). Each entry: `id`, `description`, live `state` (`idle` / `queued` / `running`, from `state_jobs` for this node+extension), `jobId` (the ACTIVE queued/running job's id, `null` when idle; the handle the UI's stop/restart affordance cancels), `lastJudged: { at, model } | null` (latest recorded execution). Reuses the boot-cached plugin runtime (audit M3); the fixer join is `matchesQualifiedExtensionFilter`, the same primitive as the auto-fix hook. 404 rules as above. |
| `GET /api/update-status` | implemented | Read-only projection of the kernel update-check cache (`_kernel.update-check` in `config_preferences`; the `core/update-check` boot hook is the only writer, see §User-settings file and [`architecture.md` §Hook](./architecture.md)). Shape: `{ current, latest, isOutdated, checkedAt, shownAt }`. Never probes the registry. Empty cache / missing DB degrades to `{ current: <cli version>, latest: null, isOutdated: false, checkedAt: null, shownAt: null }`. Always 200, no envelope wrap (non-essential surface, the UI degrades gracefully). |
| `ALL /api/*` (other) | reserved | structured 404 envelope (see below); future endpoints land in subsequent sub-steps. |
| `GET /ws` | implemented (v14.4.a) | accepts WebSocket upgrade and registers the client with the BFF broadcaster. Server-push only, the server fans `scan.*` (and forthcoming `issue.*`) events to every connected client. See **WebSocket protocol** below. |
| `POST /mcp` | gated (`mcp.server.enabled`) | MCP Streamable HTTP endpoint: client → server JSON-RPC 2.0 (`initialize`, `tools/*`, `resources/*`). Read-only tools + graph resources. Mounted only when the MCP server is enabled; otherwise absent (falls through to the SPA `*` handler). Full contract in [`mcp-server.md`](./mcp-server.md). |
| `GET /mcp` | gated (`mcp.server.enabled`) | MCP server → client SSE stream carrying `notifications/resources/updated` and `notifications/*/list_changed`, fed by the same in-process broadcaster as `/ws`. See [`mcp-server.md`](./mcp-server.md). |
| `GET *` | implemented | static asset from the resolved UI bundle, falling back to `index.html` for SPA deep links. |

List endpoints conform to [`schemas/api/rest-envelope.schema.json`](schemas/api/rest-envelope.schema.json). The `/api/scan` and `/api/health` responses carry their underlying `ScanResult` / `IHealthResponse` shapes directly (no envelope wrap). The `/api/graph` response carries the formatter's native textual output.

**`kindRegistry` envelope field.** Every payload-bearing variant of the REST envelope (`nodes` / `links` / `issues` / `plugins` lists, the `node` single, the `config` value envelope) embeds a required `kindRegistry: { [kindName]: { providerId, label, color, colorDark?, emoji?, icon? } }` field. Sentinel envelopes (`health`, `scan`, `graph`) are exempt, carrying no wire-level payload. The BFF assembles the registry once at boot from EVERY built-in Provider's `kinds[*].ui` block (regardless of boot-time enabled verdict; their module code is statically imported by `built-ins.ts` and always in memory) PLUS every drop-in user Provider that loaded successfully at boot (see [`architecture.md` §Provider · `ui` presentation](architecture.md#provider--ui-presentation)), then attaches it to every applicable response. Built-ins are listed unconditionally (a user re-enabling one mid-session expects its kinds to render on the next scan); the runtime enabled/disabled axis is enforced at SCAN-TIME by `composeScanExtensions` reading the fresh resolver, not by hiding kinds. Drop-ins that loaded as `disabled` carry `startsAsDisabled: true` on `GET /api/plugins` and need `sm serve` restart to register (module code never imported). The UI consumes `kindRegistry` directly to render kind palettes, list rows, and inspector headers; built-in and user-plugin kinds render identically. A kind in a payload (e.g. `node.kind`) without a matching `kindRegistry` entry is a contract violation; the kernel rejects Providers without a `ui` block at load time so the registry is always complete.

**`providerRegistry` envelope field.** The same payload-bearing envelopes embed a required `providerRegistry: { [providerId]: { label, color, colorDark?, emoji?, icon?, hideChip? } }` field (sibling of `kindRegistry`). Sentinel envelopes (`health`, `scan`, `graph`), action-result envelopes (`sidecar.bumped`), and catalog envelopes (`annotations.registered`, `contributions.registered`) are exempt. Same boot-time assembly as `kindRegistry`, from EVERY built-in Provider's top-level `presentation` block PLUS every drop-in user Provider loaded at boot. The UI consumes `providerRegistry` to render the active-lens dropdown, topbar lens chip, and per-node provider chip from the real registered-Provider set, never a hardcoded list; `hideChip: true` (the universal `markdown` fallback) suppresses only the per-card chip. The static boot catalog of Provider identity; the dynamic active lens (current value + filesystem-detected candidates + the enabled `selectable` set) is served separately by `GET /api/active-provider`.

**`contributionsRegistry` envelope field.** Same payload-bearing envelopes also embed `contributionsRegistry: { "<pluginId>/<extensionId>/<contributionId>": { pluginId, extensionId, contributionId, slot, label?, tooltip?, icon?, emptyText?, emitWhenEmpty } }`. Same boot-time assembly as `kindRegistry`, ALL built-in declarations plus drop-in user plugins loaded at boot. The `slot` value comes from the closed catalog in `spec/schemas/view-slots.schema.json`. A view contribution emitted by an extension whose qualified id is missing from the registry is dropped by the UI's slot host (mirrors the kindRegistry contract; `startsAsDisabled` drop-ins illustrate the absence path).

##### BFF endpoint, `POST /api/nodes/:pathB64/jobs` (Step 16 piece 1)

The UI's job-submit surface: enqueue a probabilistic extension against one node from the inspector's launcher buttons. Goes through the SAME shared submit machinery as `sm jobs submit` (`prepareSubmitContext` → `submitOneJob`, the `submitFixerJob` composition), so every submit rule is inherited, never re-implemented: duplicate refusal, fixer findings injection, fixer supersede, drift verification, TTL/priority resolution from config. Pull-only intact: the BFF enqueues, the user's external agent processes.

| Field | Value |
|---|---|
| Method + path | `POST /api/nodes/:pathB64/jobs` |
| Request body | `{ "extension": <string, required> }` (JSON, AJV). Qualified or bare probabilistic extension id, same matching rules as the CLI submit target resolution. |
| Processing-agent gate | This is an OPERATOR surface, so the gate applies exactly as on the CLI (`job-lifecycle.md` §Submit): no installed processing skill → `409` with error code `no-processing-agent` and the same mechanism-explaining advisory (the UI renders it with the `sm agent install` CTA). The BFF probes `processingSkillPresence` itself; the shared helper stays gate-free (the auto-fix hook path must keep bypassing). |
| 200 envelope | `{ "schemaVersion": "1", "kind": "job.submitted", "value": { "jobId": <string>, "nodePath": <string>, "extensionId": <string>, "supersededIds": <string[]> }, "elapsedMs": <int> }`. Validates under the action-result `oneOf` variant of `rest-envelope.schema.json` (like `sidecar.bumped`). A non-empty `supersededIds` reports the fixer-supersede cancellations. NO nonce: the record credential never travels to the UI (the processing agent claims it via `sm jobs claim --json`). |
| 409 envelopes | Error codes: `duplicate-job` (active identical job; `details.existingId`), `no-processing-agent` (the gate), `no-findings` (fixer over a node with zero matching findings, defensive: the UI hides that button), `job-running` (running sibling holds its claim, never superseded). |
| 400 / 404 / 422 | `400 bad-query` (body shape, non-probabilistic or ambiguous extension id, mirroring the CLI exit-2 refusals); `404 not-found` (malformed `pathB64`, unknown node, unknown extension, missing DB); `409 node-drifted` when the on-disk body no longer matches the scanned hash (advisory names `sm scan`). |
| WS event | On success the BFF broadcasts `job.submitted` using the canonical catalog envelope (`job-events.md` §`job.submitted`: `type`, unix-ms `timestamp`, `runId` mode `queue`, `jobId`, `data: { nodePath, extensionId, supersededIds }`), the SAME shape the CLI push leg delivers through `POST /api/job-events`, so consumers see one `job.*` flavor regardless of which surface submitted. The `job.claimed` / `job.completed` / `job.failed` / `job.cancelled` pushes drive the `running` → done transitions. |

**Error envelope** (mirrors `§Machine-readable output analyzers`):

```json
{
  "ok": false,
  "error": {
    "code": "not-found" | "bad-query" | "db-missing" | "internal",
    "message": "<human-readable>",
    "details": { ... } | null
  }
}
```

HTTP status mapping: `400` → `bad-query`, `403` → `locked` (`PATCH /api/plugins[...]`), `host-not-allowed` / `origin-not-allowed` (loopback gate), or `token-mismatch` (`POST /api/activity`), `404` → `not-found`, `409` → `sidecar-fresh` (`POST /api/sidecar/bump`) or `scan-busy` (`POST /api/scan`), `412` → `confirm-required`, `500` → `internal` / `db-missing`.

Error code sources at v14.2:

- `not-found` (404), unknown `/api/*` path; missing node on `/api/nodes/:pathB64`; malformed `pathB64` (treated as "no such node" for uniform client UX).
- `bad-query` (400), `ExportQueryError` from `parseExportQuery`; pagination beyond `limit ≤ 1000`; non-integer / negative `limit` / `offset`; unknown formatter on `/api/graph`; `?fresh=1` when the server started with `--no-built-ins` or `--no-plugins`.
- `internal` (500), uncaught error during a request (e.g. config-load failure, DB corruption via `loadScanResult`).
- `db-missing` (500), emitted by mutation endpoints (`PATCH /api/plugins/:id`, `PATCH /api/plugins/:pluginId/extensions/:extensionId`, `PATCH /api/plugins`) when the project DB is absent. Read-side routes degrade to the empty shape (`/api/scan`) or zero items (list endpoints) instead; mutation endpoints cannot persist without a DB so they fail fast.
- `not-found` (404) on `PATCH /api/plugins/:id`, unknown plugin id (no built-in, no discovered drop-in). The qualified-id form returns the same when either segment misses. The bulk `PATCH /api/plugins` returns the same with `error.details.id` set to the first offending id; the batch is rejected before any DB write.
- `bad-query` (400) on `PATCH /api/plugins/:id`, malformed body (missing `enabled`, wrong type), or `:id` contains a slash (the qualified-id sibling is `PATCH /api/plugins/:pluginId/extensions/:extensionId`). The qualified-id sibling returns 404 `not-found` for an unknown plugin or extension id. The bulk `PATCH /api/plugins` returns 400 for a malformed `changes` array or missing/typeless `enabled`, with `error.details.id` set to the first offending entry's id.
- `locked` (403) on `PATCH /api/plugins/:id` and the qualified-id sibling, the target plugin id or qualified extension id is in the host lock-list (`src/server/locked-plugins.ts`). Hardcoded, host-only, not user-editable; `GET /api/plugins` mirrors it by stamping `locked: true` on the affected items. The bulk `PATCH /api/plugins` returns the same with `error.details.id` set to the first locked entry; rejected before any DB write.
- `bad-query` (400) on `POST /api/scan`, the server started with `--no-built-ins` or `--no-plugins` (partial pipeline would persist a misleading DB).
- `scan-busy` (409) on `POST /api/scan`, another scan (a watcher batch or another POST) is already in flight. Retry once it resolves; the WS `scan.completed` envelope is the unambiguous "now safe" signal.
- `host-not-allowed` / `origin-not-allowed` (403) on every endpoint: first-stage loopback gate rejected the request because the `Host` or `Origin` header hostname is not loopback (`127.0.0.1`, `localhost`, `::1`). Closes DNS rebinding (Host) and cross-origin abuse (Origin). Always-on; the envelope `details` is `null` so the response is opaque to probes.

**Flag surface**:

| Flag | Default | Purpose |
|---|---|---|
| `--port N` | `server.port` config, else `4242` | Listening port. Precedence: flag > `server.port` (project config, layered) > built-in default. `0` = OS-assigned (handle reports the bound port; flag-only, not expressible via config). |
| `--host <ip>` | `server.host` config, else `127.0.0.1` | Listening host. Precedence: flag > `server.host` (project config, layered) > built-in default. Implementations MUST NOT bind `0.0.0.0` by default; the loopback rule applies regardless of which layer supplied the value. |
| `--db <path>` | `<cwd>/.skill-map/skill-map.db` | Override the DB file location. Missing explicit `--db` exits 5. |
| `--no-built-ins` | off | Skip built-in plugin registration (parity with `sm scan --no-built-ins`). |
| `--mcp` / `--no-mcp` | `mcp.server.enabled` config, else off | Mount (or refuse to mount) the read-only MCP server at `/mcp` for this invocation. Precedence: flag > `mcp.server.enabled` (project config, layered) > built-in default (off). Off by default; the endpoint mounts at boot, so toggling only the config key needs an `sm serve` restart. Full contract in [`mcp-server.md`](./mcp-server.md). |
| `--no-plugins` | off | Skip drop-in plugin discovery. |
| `--open` / `--no-open` | `--open` | Auto-open the SPA in the user's default browser after listen. |
| `--dev-cors` | off | Enable permissive CORS for the Angular dev-server proxy workflow. Loopback-only when set. |
| `--ui-dist <path>` | auto | Override the UI bundle directory. Hidden flag, used by the demo build pipeline + tests; everyday users never need it. Mutually exclusive with `--no-ui` (rejected with exit 2). |
| `--no-ui` | off | Skip serving the Angular SPA bundle. The root `/` (and any SPA fallback) responds with an inline dev-mode placeholder pointing at `npm run ui:dev` + `http://localhost:4200/`. For local development alongside the Angular dev server with HMR; pairs with `--no-open` (default `--open` plus `--no-ui` would auto-open the placeholder, so a non-fatal stderr warning is emitted then). Mutually exclusive with `--ui-dist <path>` (rejected with exit 2). `/api/*` and `/ws` stay fully functional; only the static SPA is suppressed. |
| `--no-watcher` | off | Disable the chokidar-fed scan-and-broadcast loop. CI / read-only deployments only; without the watcher, `/ws` stays open but no `scan.*` events fire. Combining with `--no-built-ins` is rejected (the watcher cannot run with an empty pipeline; would persist empty scans on every batch). |

**WebSocket protocol** *(Stability: experimental, locks at v0.6.0)*:

The `/ws` endpoint is the live-events channel for the SPA. Clients connect once at bootstrap, the server pushes events as they happen, and the SPA reconciles its in-memory store against the deltas. The wire envelope and `scan.*` payload shapes are normative in [`job-events.md`](./job-events.md); the BFF emits them verbatim.

- **Wire format**: each event is a single WebSocket text frame carrying one JSON object conforming to `job-events.md` §Common envelope (`type`, `timestamp`, `runId?`, `jobId? | null`, `data`).
- **Event catalog at v14.4.a**:
  - `scan.started` (per `job-events.md` §Scan events line 325).
  - `scan.progress` (per `job-events.md` line 345, emitted by the kernel orchestrator at every node; throttling deferred).
  - `scan.completed` (per `job-events.md` line 363).
  - `extractor.completed` (per `job-events.md` line 384) and `analyzer.completed` (per `job-events.md` line 404) ride along as side effects of the same emitter bridge.
  - `extension.error` (kernel-internal, emitted when an extension violates its declared contract; the BFF forwards verbatim).
  - `watcher.started` and `watcher.error`, BFF-internal advisories. Non-normative; consumers MUST ignore unknown event types per the forward-compatibility analyzer.
  - `node.activity` (experimental), live-activity signal `{ nodePath, phase: 'start'|'end', owner?, ownerScope?, sticky?, keepAlive?, stats? }` broadcast when `POST /api/activity` resolves a provider runtime hook event to a scanned node. Shape normative in [`provider-activity.md`](./provider-activity.md) §WS event.
  - `agent.spawn` (experimental), spawn-relation frame `{ spawnId, phase: 'start'|'handoff'|'end', parentOwner, parentNodePath?, childKind?, childName?, childNodePath?, childOwner?, pairCount? }` broadcast per spawn relation reported by a provider signal; conversation content never rides it. Shape normative in [`provider-activity.md`](./provider-activity.md) §WS event: `agent.spawn`.
- **Deferred**: `issue.added` / `issue.resolved` (per `job-events.md` §Issue events line 446) and `scan.failed`. The 14.4.a surface fans out only events the kernel emitter already produces; diff-based issue events and a dedicated batch-failure event need more plumbing inside the BFF watcher loop.
- **Connection lifecycle**:
  1. Client opens `ws://<host>:<port>/ws`. The server completes the handshake and registers the socket with the broadcaster.
  2. Server pushes events. The client sends no application frames; `onMessage` is intentionally not registered for app data (transport-level pong frames are answered by the browser automatically, see **Keep-alive** below). A future client-initiated subscribe / filter request lands in a follow-up.
  3. Server has NO state push on connect (no replay of last events). The client SHOULD poll `/api/scan` once on connect to seed initial state, then rely on `/ws` for deltas.
  4. On normal disconnect: client closes with code 1000 ('normal closure') or 1001 ('going away'). The broadcaster unregisters silently.
  5. On server shutdown (SIGINT / SIGTERM): the broadcaster sends close code 1001 + reason `'server shutdown'` to every client, then closes the http listener.
  6. **Backpressure**: if a client's outbound buffer (`bufferedAmount`) exceeds an implementation-defined threshold (reference impl: 4 MiB), the broadcaster closes that client with code 1009 ('message too big') and unregisters it. Clients SHOULD reconnect after backpressure eviction with a fresh `/api/scan` poll.
  7. **Reconnect responsibility**: the server does NOT reconnect on the client's behalf or replay missed events. The client SHOULD treat `/ws` as a best-effort delta channel and re-seed via `/api/scan` whenever the connection drops. To avoid a re-seed storm against a flapping endpoint, the client SHOULD reset its reconnect backoff only after a connection stays open long enough to be considered stable; a socket that opens then drops before that window counts as a failed attempt, so the backoff keeps escalating and eventually surfaces a non-fatal 'connection lost' state instead of reconnecting in a tight loop.
- **Keep-alive (heartbeat)**: the server sends an RFC 6455 ping control frame to every connected client on a fixed interval (implementation-defined; reference impl: 30s). The browser answers each ping with an automatic pong, transparent to the page's JS `WebSocket` API, so the connection never sits idle and an intermediary that drops idle sockets (the Angular dev-server proxy under `pnpm dev`, a hosted nginx / load balancer) leaves it alone. The same exchange is dead-peer detection: a client that has not ponged since the previous interval is terminated server-side (it vanished without a close frame, e.g. host sleep or NAT timeout). This complements the `bufferedAmount` backpressure eviction (which only fires when there is an event to send), so a silent half-open socket on an idle workspace is still reaped. Purely transport keep-alive, absent from the event catalog above.
- **Loopback-only assumption (Decision #119)**: no per-connection authentication on `/ws` through v0.6.0. The transport security boundary is the `--host` flag (defaults to `127.0.0.1`); the server rejects `--dev-cors` combined with a non-loopback `--host` precisely because that would expose `/ws` over the network without auth. Multi-host serve and an auth model re-open post-v0.6.0.

**Graceful shutdown**: SIGINT / SIGTERM trigger a graceful close; the verb returns exit 0 on clean shutdown. Bind failure (port in use, EACCES) returns exit 2. The shutdown sequence drains the in-flight watcher batch (if any), closes every WS client with code 1001, then closes the http listener.

---

### Activity

*(Stability: experimental. Full contract: [`provider-activity.md`](./provider-activity.md).)*

| Command | Purpose |
|---|---|
| `sm activity install <provider> [--yes]` | Wire the live-activity bridge into `<provider>`'s PROJECT-LOCAL hook config, per the Provider's `activity.install` descriptor (`kind: json-hooks` merges hook entries into the provider's settings file; `kind: plugin-file` writes an in-process plugin file). Consent-prompted (TTY y/N, `--yes` for non-interactive); the prompt names the exact file to be modified. The merge is NON-destructive: pre-existing operator hooks are preserved and skill-map's entries are marked so `uninstall` can remove exactly them. Also writes the bridge artifact under `.skill-map/activity/`. Errors: unknown provider id or a Provider without `activity` → exit 2; declined prompt → exit 0, nothing written. |
| `sm activity uninstall <provider>` | Reverse `install` exactly: remove skill-map's marked entries from the provider config (leaving operator hooks untouched) and delete the bridge artifact when no installed provider references it anymore. Idempotent; uninstalling a provider that was never installed is a no-op (exit 0). |
| `sm activity status [provider]` | Read-only install-state report for activity-capable providers (all of them, or just the named one): `installed`, `not installed`, or `partial` (hook config wired but the bridge artifact missing; a re-install repairs it; the inverse never counts as partial because the bridge artifact is shared across hook-file providers; `plugin-file` providers derive everything from their single plugin file). Names each provider's config path. Never writes. Unknown provider id or a provider without `activity` → exit 2; otherwise exit 0. |

The bridge itself is NOT a CLI verb: it is a zero-dependency script (or in-process plugin file) whose behavior is normative in [`provider-activity.md` §Bridge contract](./provider-activity.md), including the hard invisibility invariants (always exit 0, empty stdout, fail-open when the server is down).

The same install / uninstall operations (plus an install-status probe) are exposed over HTTP by `sm serve` so the SPA can wire a provider from Settings; contract in [`provider-activity.md` §Install management over HTTP](./provider-activity.md), endpoint rows in the Server table above.

### Introspection

- `sm help --format json`, structured CLI surface dump.
- `sm help --format md`, canonical markdown, generated on demand (not a committed artifact).

These two formats are NORMATIVE: any change to verbs, flags, or exit codes MUST reflect in `--format json` output immediately. Third-party consumers rely on it.

### Conformance

| Command | Purpose |
|---|---|
| `sm conformance run [--scope spec\|provider:<id>\|all]` | Run the conformance suite. `--scope spec` runs only the kernel-agnostic cases bundled with `@skill-map/spec` (default fixture: `preamble-v2.txt`, case: `kernel-empty-boot`). `--scope provider:<id>` runs only the named built-in Provider's suite (today: `provider:claude`). `--scope all` (default) runs every visible scope in registry order. Exit 0 on a clean sweep; exit 1 if any case failed; exit 2 on a configuration error (unknown scope, missing binary). `--json` emits the report shape declared by [`conformance-result.schema.json`](./schemas/conformance-result.schema.json): `{ ok: true, kind: 'conformance.result', totals, scopes[], elapsedMs }`. Error envelope per §Error envelope: `bad-query` (unknown scope), `internal` (missing binary). |

Per-Provider conformance suites live next to the Provider's manifest under `<plugin-dir>/conformance/{cases,fixtures}/`. The verb discovers them by walking the built-in Provider directory (and, post-job-subsystem, the plugin loader's discovery output). External consumers, alt-impl authors, and Provider authors validating their own work drive the same suite via this verb without bespoke scripts.

---

## Machine-readable output analyzers

When `--json` is set:

1. Stdout contains ONLY the JSON document (or ndjson lines, for streaming verbs like `sm watch --json` and `sm record --json`).
2. Stderr carries logs, progress, and errors.
3. Non-zero exit codes still apply; consumers MUST NOT infer success from the presence of stdout.
4. Error payloads on stdout (when the verb emits structured errors) conform to:

   ```json
   {
     "ok": false,
     "error": {
       "code": "<short-code>",
       "message": "<human-readable>",
       "details": { ... }
     }
   }
   ```

5. Streaming verbs MUST flush after each line (ndjson).

---

## Elapsed time

Every verb that does non-trivial work MUST report its own wall-clock duration. Coverage is broad on purpose: operators and agents need to notice regressions without instrumenting the host.

### Scope

**In scope**: any verb that walks the filesystem, hits the DB, spawns a subprocess, or renders a report. Examples: `sm scan`, `sm check`, `sm list`, `sm show`, `sm findings`, `sm history`, `sm history stats`, `sm graph`, `sm export`, `sm jobs submit`, `sm jobs claim`, `sm jobs preview`, `sm record`, `sm doctor`, `sm db backup`, `sm db restore`, `sm db dump`, `sm db migrate`, `sm plugins list`, `sm plugins doctor`, `sm init`, `sm conformance run`.

**Exempt**: informational verbs that return well under a millisecond and would clutter output, `sm --version`, `sm --help`, `sm version`, `sm help`, `sm config get`, `sm config list`, `sm config show`.

### Pretty output (TTY)

The last line written to stderr MUST be `done in <formatted>` where `<formatted>` is:

- `< 1000ms` → `<N>ms` (integer, no decimals).
- `≥ 1s` and `< 60s` → `<N.N>s` (one decimal).
- `≥ 60s` → `<M>m <S>s` (integer minutes + integer seconds).

Examples: `done in 34ms`, `done in 2.4s`, `done in 1m 42s`.

The line is suppressed by `--quiet`. It goes to stderr so it never pollutes stdout, including in `--json` mode.

### JSON output (`--json`)

When the verb's `--json` output is a top-level **object**, the schema includes an `elapsedMs` top-level field (integer, milliseconds). Stdout then carries the timing inside the document. Stderr still emits the `done in …` line unless `--quiet`.

When the verb's `--json` output is a top-level **array** or an **ndjson stream**, the schema does NOT include `elapsedMs` (there is no object to attach it to). Stderr is the sole carrier of the timing line.

Schemas that already express the command's wall-clock under a nested field (e.g. `scan-result.schema.json` → `stats.durationMs`) MUST treat that field as the elapsed time of the scan command itself. Adding a top-level `elapsedMs` to those schemas for redundancy is a minor bump and MAY happen later; until then, consumers read the nested field.

### Implementations

Implementations MUST measure from the moment the verb starts its own work (after Clipanion / arg-parsing overhead) to the moment before writing the terminal output. Sub-millisecond verbs exempt per §Scope MAY skip the measurement entirely.

### Stability

The `done in …` stderr line, its format grammar, and the `elapsedMs` field contract are **stable** as of spec v1.0.0. Changing the grammar, the time units, or the location (stderr ↔ stdout) is a major bump. Adding `elapsedMs` to a schema that previously omitted it is a minor bump.

---

## See also

- [`architecture.md`](./architecture.md), CLI as a driving adapter; kernel-first design; dependency analyzers.
- [`job-lifecycle.md`](./job-lifecycle.md), state machine behind `sm jobs` verbs.
- [`job-events.md`](./job-events.md), event stream emitted via `--json` (the `sm record` synthetic envelope).
- [`db-schema.md`](./db-schema.md), tables behind `sm db` verbs.
- [`conformance/`](./conformance/README.md), test suite exercising CLI behavior.

---

## Stability

The **verb list** is stable as of spec v1.0.0. Adding a verb is a minor bump. Removing a verb is a major bump.

**Adding** a flag is a minor bump. Changing a flag's type or removing a flag is a major bump. Changing a flag's default is a major bump.

**Exit codes 0–5** are stable. Redefining any of these meanings is a major bump. Adding codes in the reserved range (6–15) is a minor bump.

`--json` output shapes conform to the schemas under `schemas/`. Shape changes follow schema versioning (see `versioning.md`).
