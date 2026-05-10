# CLI contract

Normative description of the `sm` CLI surface: verbs, flags, exit codes, machine-readable output. Any conforming implementation MUST expose a CLI binary that satisfies this contract. The binary name (`sm`) and long alias (`skill-map`) are normative.

---

## Binary

- Primary: `sm`.
- Long alias: `skill-map`. MUST resolve to the same binary. A symlink, shim, or alias in `bin` field of `package.json` is acceptable.
- Help invocation: `sm --help` and `sm -h` MUST print top-level help and exit with code 0.
- Bare invocation: `sm` with no arguments starts the Web UI server (equivalent to `sm serve`) when a `.skill-map/` project is initialized in the current working directory. When no project is found in the cwd, it MUST print a one-line hint to stderr pointing the user to `sm init` and `sm --help`, then exit with code `2`.

---

## Global flags

These flags apply to every verb unless marked otherwise.

| Flag | Shape | Purpose |
|---|---|---|
| `-g` / `--global` | boolean | Operate on the global scope (`~/.skill-map/`) instead of project scope (`./.skill-map/`). |
| `--json` | boolean | Emit machine-readable output on stdout. Suppresses pretty printing. Human progress goes to stderr. |
| `-v` / `--verbose` | count | Increase log level (`-v` = info, `-vv` = debug, `-vvv` = trace). Logs to stderr. |
| `-q` / `--quiet` | boolean | Suppress all non-error stderr output. Does not affect stdout. |
| `--no-color` | boolean | Disable ANSI color codes. Implementations MUST also auto-disable color when stdout is not a TTY. |
| `-h` / `--help` | boolean | Print verb-specific or top-level help, exit 0. |
| `--db <path>` | string | Override the database file location (escape hatch; primarily for debugging). |

Env-var equivalents are normative:

| Env var | Equivalent flag |
|---|---|
| `SKILL_MAP_SCOPE=global` | `-g` |
| `SKILL_MAP_JSON=1` | `--json` |
| `NO_COLOR=1` | `--no-color` (also honored per the NO_COLOR standard) |
| `SKILL_MAP_DB=<path>` | `--db <path>` |

CLI flag wins over env var. Env var wins over config file.

---

## Targeted fan-out flags

`--all` is not global. It is only valid on verbs whose contract explicitly lists it:

- `sm job submit <action> --all`
- `sm job run --all`
- `sm job cancel --all`
- `sm plugins enable --all`
- `sm plugins disable --all`

For those verbs, `--all` means "apply to every eligible target matching the verb's preconditions" and is mutually exclusive with a positional target or `-n <path>` on the same invocation.

Implementations MUST NOT silently accept `--all` on unrelated verbs. Unsupported `--all` usage is an operational error (exit `2`), the same as any other unknown or invalid flag.

---

## Exit codes

All verbs use this shared table. Additional codes MAY be defined per-verb (documented under the verb).

| Code | Meaning | When emitted |
|---|---|---|
| `0` | OK | Command completed, no issues at or above the configured severity threshold. |
| `1` | Issues found | Command completed, but deterministic issues at `error` severity exist. Applies to `sm scan`, `sm check`, `sm doctor`. |
| `2` | Operational error | Bad flags, missing DB, unreadable file, corrupt config, runtime / environment mismatch (e.g. wrong Node version, missing native dependency), unhandled exception. Accompanied by an error message on stderr. |
| `3` | Duplicate conflict | Job submission refused because an active duplicate exists (same `action + version + node + contentHash`). Returned by `sm job submit`. |
| `4` | Nonce mismatch | `sm record` called with an `id`/`nonce` pair that does not match. |
| `5` | Not found | A named resource does not exist (node id, job id, plugin id, config key). |

Codes 6–15 are reserved. Codes ≥ 16 are free for verb-specific use.

---

## Dry-run

A verb that exposes `-n` / `--dry-run` MUST honour the following contract:

- **No observable side effects.** The command MUST NOT mutate the database, the filesystem, the config, the network, or spawn external processes. Read-only operations needed to compute the preview (e.g. loading the prior `ScanResult`, reading existing config files, listing FS entries) ARE permitted.
- **No auto-provisioning.** A dry-run MUST NOT create directories, schema files, or DBs that would not exist after the command. If the operation would create a `.skill-map/` scope, dry-run only previews the creation; the directory must NOT appear on disk.
- **Output mirrors the live mode** — same shape, same fields, same `--json` schema — except that human-readable output explicitly indicates the dry-run state ("would persist …", "would create …", "would delete …", or a clear "(dry-run)" suffix) and machine-readable output sets a top-level `dryRun: true` field where applicable.
- **Exit codes mirror the live mode.** Same exit code table; the dry-run posture does not introduce new codes. A dry-run that surfaces an error severity (e.g. "scan would emit an error-severity issue") still exits `1`; a dry-run that fails to read the input still exits `2`.
- **Dry-run MUST NOT depend on `--yes` / `--force`.** Verbs that offer interactive confirmation for destructive operations MUST allow `--dry-run` to bypass the prompt entirely (no confirmation needed when nothing is being destroyed).

Dry-run is **per-verb opt-in**. The flag is not global; verbs that do not declare it MUST reject `--dry-run` as an unknown option (exit `2`), the same as any other unknown flag. The verb catalog below names every verb that exposes the flag and what its preview looks like.

---

## Verb catalog

### Setup & state

#### `sm init`

Bootstrap the current scope.

- Creates `./.skill-map/` (project) or `~/.skill-map/` (global).
- Provisions the database.
- Runs migrations.
- Runs a first scan.

Flags: `--no-scan` (skip the first scan), `--force` (rewrite an existing config), `-n` / `--dry-run` (preview the scope provisioning — would-create lines for every directory and file the live invocation would write — without touching the filesystem; respects `--force` for the "would-overwrite" preview).

Exit: 0 on success, 2 on failure.

#### `sm tutorial`

Materialize the interactive tester tutorial as `sm-tutorial.md` in the current working directory. Companion to the `sm-tutorial` Claude Code skill: a tester drops into an empty directory, runs `sm tutorial` to seed the tutorial source, then opens Claude Code there and triggers the skill (which reads the file as its onboarding payload).

- Writes `<cwd>/sm-tutorial.md` (single file, top-level — no subdirectory).
- Content is the canonical `SKILL.md` shipped with the implementation. Any conforming implementation MUST embed an equivalent tutorial source (the prose itself is informative; what is normative is that `sm tutorial` produces a single readable file at `<cwd>/sm-tutorial.md` that a Claude Code skill can consume).
- Does NOT require an initialized project — runs in any directory, including empty ones, and never reads or writes `.skill-map/`.
- Is NOT scope-aware: `-g` is accepted (inherited global flag) but has no effect; the file is always written under the cwd.

Flags: `--force` (overwrite an existing `sm-tutorial.md` without prompting).

Exit: `0` on success; `2` if `<cwd>/sm-tutorial.md` already exists and `--force` was not passed (operational error — refusing to clobber); `2` on any I/O failure.

#### `sm version`

Prints version matrix:

```
sm           <cli version>
kernel       <kernel version>
spec         <spec version implemented>
db-schema    <applied migration version>
```

`--json` emits `{ sm, kernel, spec, dbSchema }`.

#### `sm doctor`

Diagnostic report:

- DB file integrity (PRAGMA quick_check equivalent).
- Pending migrations (count + list).
- Orphan history rows (count).
- `state_jobs` rows whose `content_hash` is missing from `state_job_contents` (corrupt-state count).
- `state_job_contents` GC stragglers (count of rows referenced by zero `state_jobs` rows; `sm job prune` collects these).
- Plugins in error state (list).
- LLM runner availability (`claude` binary on PATH, version).
- Detected Providers that matched nothing, or whose `explorationDir` does not exist on disk (non-blocking warning).

Exit: 0 if all green, 1 if warnings, 2 if any `error`-level problem.

#### `sm help [<verb>] [--format human|md|json]`

Self-describing introspection.

- `human` (default): pretty terminal output.
- `md`: canonical markdown for documentation sites. Implementations MUST NOT hand-maintain equivalent markdown; `context/cli-reference.md` (in the reference impl) is regenerated from this output in CI.
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
| `sm config set <key> <value> [--yes]` | Write to user config (scope-aware: `-g` writes to global). Privacy-sensitive keys require `--yes` to confirm — see §Privacy-sensitive config below. |
| `sm config reset <key>` | Remove user override; revert to default or higher-scope value. |
| `sm config show <key> --source` | Reveals origin: `default` / `project` / `global` / `env` / `flag`. |

Config precedence (lowest → highest): library defaults → user config → env vars → CLI flags.

Keys are dot-paths (`jobs.minimumTtlSeconds`, `scan.tokenize`). Unknown keys → exit 5.

#### Privacy-sensitive config

Keys whose value opens disk access OUTSIDE the project root (today: `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`) are gated behind `--yes` so the user never expands the scan surface by accident. The rule:

- `sm config set <privacy-key> <value>` (without `--yes`) — when the new value would expand the surface (toggling `includeHome` from `false`→`true`, or adding paths to `extraRoots` / `referencePaths` that resolve outside the project root) — exits with code `2` and prints the full list of paths the change would expose to stderr, suggesting `--yes` to confirm.
- `sm config set <privacy-key> <value> --yes` — proceeds with the write and prints the same list as a confirmation receipt.
- Writes that NARROW the surface (toggling `includeHome` from `true`→`false`, removing paths) do not require `--yes`.

The Settings UI's Project section enforces the same rule via a confirm dialog that enumerates the paths.

---

### Scan

| Command | Purpose |
|---|---|
| `sm scan` | Full scan. Truncates `scan_*` and repopulates. |
| `sm scan -n <node.path>` | Partial scan: one node. |
| `sm scan --changed` | Incremental: only files changed since last scan (mtime heuristic). |
| `sm scan --watch` | Long-running: watch the roots and trigger an incremental scan after each debounced batch of filesystem events. Alias of `sm watch`. |
| `sm scan -g` / `sm scan --global` | Global scan. Roots default to every active Provider's `explorationDir` resolved against `~` (typically `~/.claude`, `~/.gemini`, `~/.agents`); the cwd is NOT included. Config + DB resolve from the global scope (`~/.skill-map/...`). Mutually exclusive with explicit positional roots — passing both is rejected with exit `2`. |
| `sm scan compare-with <dump> [roots...]` | Delta report: run a fresh scan in memory and compare against the saved `ScanResult` dump at `<dump>`. Read-only — does not modify the DB. Exit `0` on empty delta, `1` on any drift, `2` on operational error (missing or malformed dump, schema violation). |
| `sm watch [roots...]` | Long-running watcher. Same semantics as `sm scan --watch`, exposed as a top-level verb because the watcher is a loop, not a one-shot scan. |
| `sm refresh <node.path>` | Re-run Extractors against a single node and upsert their outputs into the universal enrichment layer (`node_enrichments`, see [`db-schema.md`](./db-schema.md#node_enrichments)). Extractors are deterministic-only — they run synchronously and persist. Exit `0` on success, `2` on failure, `5` if the node is not in the persisted scan. |
| `sm refresh --stale` | Batch form of `sm refresh <node>` — refreshes every node carrying at least one stale enrichment row. With Extractors deterministic-only, the stale set is empty in this revision (Extractor writes never set `stale = 1`) so `--stale` always exits `0` with a "nothing to do" advisory. The verb is preserved for the future Action-prob enrichment revision (see [`architecture.md` §Extractor · enrichment layer](./architecture.md#extractor--enrichment-layer)) where queued LLM jobs will populate stale rows. |

`--json` output conforms to `schemas/scan-result.schema.json`. `sm watch` (and `sm scan --watch`) emit one ScanResult per batch — under `--json` this is an `ndjson` stream of ScanResult documents.

**Effective roots** (one-shot `sm scan`):

- `sm scan [roots...]`: when positional roots are given, they ARE the effective roots (verbatim). When omitted: the effective roots are `[cwd]` plus the appended sets below.
- `scan.includeHome === true` appends every active Provider's `explorationDir` resolved against `~` to the effective roots.
- `scan.extraRoots[]` is appended verbatim (entries starting with `~` resolve against the user home; relative entries resolve against the project root).
- `sm scan -g`: effective roots are the active Providers' `explorationDir` only; `scan.includeHome` and `scan.extraRoots` are ignored. The cwd is NOT included. Config + DB resolve from the global scope.

**Reference paths** (`scan.referencePaths[]`): walked in parallel by the scan to collect existing absolute paths into a side set. Files there are NOT parsed and NOT indexed as nodes; the kernel passes the set to rules via `IRuleContext.referenceablePaths` so `core/broken-ref` can resolve a link against the filesystem when the in-graph lookup misses.

The watcher subscribes to the same roots that `sm scan` walks and respects `.skillmapignore` plus `config.ignore` exactly as the one-shot scan does. Filesystem events are grouped using `scan.watch.debounceMs` (default 300ms) before the watcher re-runs the incremental scan and persists. `SIGINT` / `SIGTERM` close the watcher cleanly. Exit code on clean shutdown is 0.

Exit: 0 on clean (or clean watcher shutdown), 1 if error-severity issues exist (one-shot scan only — the watcher does not flip exit code based on per-batch issues), 2 on operational error.

---

### Browse

| Command | Purpose |
|---|---|
| `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N]` | Tabular listing. `--json` emits an array conforming to `node.schema.json`. |
| `sm show <node.path>` | Node detail: weight (bytes/tokens triple-split), frontmatter, links in/out, issues, findings, summary. `--json` emits a detail object with the raw link rows. Pretty output groups identical-shape links (same endpoint, kind, normalized trigger) onto one line and lists the union of extractor ids in a `sources:` field; the section header reports both the raw row count and the unique-after-grouping count, e.g. `Links out (12, 9 unique)`. Storage keeps one row per extractor (`scan_links` is unchanged) — the grouping is purely a read-time presentation choice. |
| `sm check [-n <node.path>] [--rules <ids>] [--include-prob] [--async]` | Print all current issues. Equivalent to `sm scan --json \| jq '.issues'` but faster (reads from DB). `-n` restricts to issues whose `nodeIds` include the path; `--rules <ids>` accepts a comma-separated list of qualified or short rule ids and restricts the issue read accordingly. Default behaviour is deterministic-only (CI-safe, status quo). `--include-prob` is the opt-in flag for probabilistic Rule dispatch (spec § A.7): the verb loads the plugin runtime, finds Rules with `mode === 'probabilistic'` (filtered by `--rules` if set), and emits a stderr advisory naming the rule ids. Full prob dispatch requires the job subsystem (Step 10); until then `--include-prob` is a stub — prob rules never produce issues, never alter the exit code, and `--async` (reserved companion: returns job ids without waiting once jobs land) is a no-op the advisory simply mentions. The flag does NOT extend to `sm scan` or `sm list`. |
| `sm findings [--kind ...] [--since ...] [--threshold <n>]` | Probabilistic findings (injection, stale summaries, low confidence). `--json` emits an array of finding objects. |
| `sm graph [--format ascii\|mermaid\|dot]` | Render the full graph via the named formatter. |
| `sm export <query> --format json\|md\|mermaid` | Filtered export. Query syntax is implementation-defined pre-1.0. |
| `sm orphans` | History rows whose target node is missing. |
| `sm orphans reconcile <orphan.path> --to <new.path>` | Migrate history rows from the old path to the new one after a rename. Use case: the scan's rename heuristic missed a match (semantic-only rename, body rewrite) and the user wants to stitch history manually. |
| `sm orphans undo-rename <new.path> [--from <old.path>] [--force]` | Reverse a medium- or ambiguous-confidence auto-rename. Requires an active `auto-rename-medium` or `auto-rename-ambiguous` issue on `<new.path>`. For `auto-rename-medium`, omit `--from` — the previous path is read from `issue.data_json`. For `auto-rename-ambiguous`, `--from <old.path>` is REQUIRED to pick one of the candidates listed in `data_json.candidates`. Migrates `state_*` FKs back and resolves the issue; the previous path becomes an `orphan` (its file no longer exists in FS). Destructive; prompts for confirmation unless `--force`. Exit `5` if no active auto-rename issue targets `<new.path>`, or if `--from` references a path not in `data_json.candidates`. |

---

### Actions

| Command | Purpose |
|---|---|
| `sm actions list` | Registered action types (manifest view). |
| `sm actions show <id>` | Full manifest, including declared `preconditions`, `expectedDurationSeconds`, report schema ref. |

Actions are not invoked via `sm actions`; invocation is via `sm job submit` (see below).

#### Sidecar bump (Step 9.6.4)

The built-in deterministic `core/bump` Action is the canonical write channel for `<basename>.sm` annotation sidecars; the verbs below are its CLI surface plus a few sidecar-management helpers. The `bump` verb stays top-level (high frequency, ROADMAP-named); the administrative helpers live under the `sm sidecar` sub-namespace to avoid colliding with the existing `sm refresh` (which targets the enrichment layer, not sidecars). All sidecar-touching verbs are deterministic — they invoke `core/bump` (or the `FilesystemSidecarStore` directly) in-process and never queue jobs.

| Command | Purpose |
|---|---|
| `sm bump <node.path> [--force]` | Single-node bump. Wraps `core/bump`. Refuses on a fresh node (`{ ok: false, reason: 'fresh' }`, exit `2`) unless `--force` is passed; with `--force` on a fresh node the verb is a silent no-op (exit `0`, no stdout). On a stale node (or first-time creation) increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, and stamps the audit block (`audit.lastBumpedAt` + `audit.lastBumpedBy: 'cli'`; on first creation also `audit.createdAt` + `audit.createdBy: 'cli'`). Exit `5` if the node is not in the persisted scan. `--json` emits the report shape declared by `bump-report.schema.json`. |
| `sm bump --pending [--staged] [--force]` | Batch bump. Walks every node whose sidecar overlay reports drift in `node.path` ASC order and bumps each. `--staged` runs `git add <sidecar-path>` after each successful bump so the new content lands in the same commit; `git add` failure degrades to a stderr warning, the batch keeps running. Empty stale set → exit `0` with a "nothing to do" advisory. `--json` envelope: `{ bumped, refused, skipped, errors[], elapsedMs }`. Exit `0` on a clean run; `1` when at least one per-node error landed in `errors[]`. **Git error matrix for `--staged`**: not inside a git repo (no `.git/` parent of `cwd`) → exit `5`; `git` binary not on PATH (spawn ENOENT) → exit `2`. Both checks run BEFORE any sidecar write so a misconfigured environment never produces partial state. |
| `sm sidecar refresh <node.path>` | Hash-only update on the sidecar. Refreshes `for.{bodyHash, frontmatterHash}` to match the live node WITHOUT bumping `annotations.version` and WITHOUT touching the audit block. Useful when the user knows a body change is editorial-only and doesn't want to spend a version increment. Distinct from the top-level `sm refresh` (which targets the enrichment layer at Step A.8) — different storage, different concept; the sub-namespace prefix prevents the collision. Exit `5` if the node has no sidecar or is not in the persisted scan. No-op on a fresh node (informational stderr, exit `0`). |
| `sm sidecar prune [--dry-run] [--yes]` | Delete orphan `.sm` files (sidecars whose accompanying `<basename>.md` does not exist on disk). Destructive — without `--dry-run` prompts for interactive confirmation listing every file to be deleted (per the §Dry-run rule for destructive verbs). `--yes` (alias `--force`) bypasses the prompt for non-interactive callers (CI, the pre-commit hook, scripts). With `--dry-run` reports what would be deleted without touching disk and never prompts. Different domain from `sm orphans` — that verb operates on the node graph (rename heuristic); this one operates on the filesystem layer. `--json` envelope: `{ deleted, wouldDelete, errors, items[], elapsedMs }`. Exit `1` when delete failures landed in `errors`. |
| `sm sidecar annotate <node.path> [--force]` | Pure scaffolding. Writes a minimal `.sm` next to the `.md` with the `identity:` block populated and an empty `annotations: {}` block, ready for editing. Refuses if the file exists; `--force` overwrites. The optional legacy-frontmatter migration helper (`--from-frontmatter`) is deferred — no released consumer demands it. |
| `sm hooks install pre-commit-bump [--dry-run]` | Install (or chain into) a git pre-commit hook that runs `sm bump --pending --staged` so any staged drift in `.sm` sidecars auto-bumps before the commit lands. Idempotent: re-running detects the skill-map marker and no-ops. When the repo already has a custom `pre-commit`, the verb appends the skill-map block to the existing file rather than replacing it. `--dry-run` prints the planned content with `--- target: <path> ---` markers and writes nothing. Exit `5` if no `.git/` parent is found at or above `cwd`; exit `2` on write failures or unknown hook flavours. |

**`.sm` round-trip contract.** The `bump` verb, `sm sidecar refresh`, and `sm sidecar annotate` write through `FilesystemSidecarStore`, which re-serialises the merged result via `js-yaml` `dump` with `sortKeys: true`. **`.sm` files are managed artifacts; comments and key order are not preserved on round-trip.** Author commentary belongs in the markdown body or in a separate documentation file, not inside `.sm`. The integrity guarantee is that the merged YAML always validates against `sidecar.schema.json` + `annotations.schema.json` and that the file is written atomically (`.tmp + rename`).

Concretely, a hand-edited sidecar like this:

```yaml
identity:
  path: agents/reviewer.md
  bodyHash: 3dd7d0...
  frontmatterHash: 271d1e...

annotations:
  version: 3
  # Deprecated because v0.6 architecture supersedes this skill.
  # See decision #142 in ROADMAP for context.
  stability: deprecated
  supersededBy: agents/reviewer-v2.md
  tags:
    - review
    - typescript  # only TS, not JS
```

…becomes the following after one `sm bump`:

```yaml
annotations:
  stability: deprecated
  supersededBy: agents/reviewer-v2.md
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

Comments dropped, keys re-sorted alphabetically. **`.sm` files cannot preserve free-form commentary across bumps — narrative documentation lives in the `.md` body, which is never touched.** The `sm sidecar annotate` scaffold prints a banner reminding the author of this contract on first creation; that banner itself is dropped on the first bump.

Tracked as **R6** in the §Step 9.6 review queue: open by design, defer the `js-yaml` → `yaml` (eemeli) swap that would preserve comments + key order until a user complaint surfaces. The swap is a small piece of work (one new dep, one Document-aware merge helper); the bias is to ship simple now and add fidelity when there is concrete demand.

##### BFF endpoint — `POST /api/sidecar/bump` (Step 9.6.5, BFF half)

The Hono BFF exposes the single-node bump flow over REST so the UI can drive the same Action / Store the CLI uses. Behaviour mirrors `sm bump <node.path> [--force]` 1:1: same `core/bump` Action, same `FilesystemSidecarStore`, same fresh-vs-stale refusal semantics. The only differences from the CLI verb are the invoker label (`'ui'` vs `'cli'` — Decision A5 of 9.6.4 left this as a literal) and the wire shape. Batch (`--pending`) is intentionally CLI-only at 9.6.5 — surfacing it over REST needs a job-style progress channel and lands later.

| Field | Value |
|---|---|
| Method + path | `POST /api/sidecar/bump` |
| Request body | `{ "nodePath": <string, required>, "force"?: <boolean, default false> }` (JSON). `nodePath` is the canonical scope-root-relative `Node.path`. |
| 200 envelope | `{ "schemaVersion": "1", "kind": "sidecar.bumped", "value": { "nodePath": <string>, "version": <int|null>, "status": "fresh" }, "elapsedMs": <int> }`. The `kind` value is part of the canonical `rest-envelope.schema.json#/properties/kind/enum` and validates under the action-result `oneOf` variant (`value` + `elapsedMs` siblings, no `filters` / `counts` / `kindRegistry`). |
| 409 envelope | `{ "ok": false, "error": { "code": "sidecar-fresh", "message": <string>, "details": null } }`. Returned when the target node is fresh and `force !== true`. The `'sidecar-fresh'` code is added to `app.ts`'s `TErrorCode` union. |
| 404 envelope | Standard `'not-found'` envelope. Returned when the DB is missing OR `nodePath` is not in the persisted scan. |
| 400 envelope | Standard `'bad-query'` envelope. Body must be a JSON object with `nodePath` (non-empty string); `force` (when present) must be a boolean. |
| 200 force-on-fresh | Per the Action spec, `force: true` on a fresh node is a silent no-op — the response carries the existing `version` (read off the sidecar overlay) and `status: 'fresh'`. **No WS broadcast** is emitted in this case (decision: no-op = no event; nothing changed on disk, sending `sidecar.bumped` would tell every connected UI to refresh state that hasn't moved). |

**WS event — `sidecar.bumped`** (Step 9.6.5; canonical envelope shape locked in 9.6.7 / R9). After every successful bump that materialises a write, the BFF broadcasts a `sidecar.bumped` event over `/ws` so all connected clients refresh in lockstep. The event uses the canonical `IWsEventEnvelope` wire shape (matches every other kernel→broadcaster bridge — `scan.*`, `watcher.*`, etc.):

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

Emission rules:

- Emitted on a successful 200 bump (stale → fresh, or first-time-create → fresh).
- **NOT** emitted on a force-on-fresh no-op 200 (nothing changed on disk).
- **NOT** emitted on 409 / 404 / 400 (no write happened).

The `type` value is a normative addition to the event-type registry — if a future spec section catalogues every WS event type, `sidecar.bumped` joins `scan.started` / `scan.completed` / `watcher.error` / `emitter.error` there.

##### BFF endpoint — `GET /api/annotations/registered` (Step 9.6.6, BFF half)

Read-only catalog of plugin-contributed annotation keys. The endpoint is a pure projection of `kernel.getRegisteredAnnotationKeys()` — populated once by `registerEnabledExtensions` at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec. The endpoint exists so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime.

| Field | Value |
|---|---|
| Method + path | `GET /api/annotations/registered` |
| Request | None — no query params, no body, no auth (matches `/api/plugins`, `/api/config`). |
| 200 envelope | `{ "schemaVersion": "1", "kind": "annotations.registered", "items": IRegisteredAnnotationKey[], "counts": { "total": <int> } }`. The `kind` value is part of the canonical `rest-envelope.schema.json#/properties/kind/enum` and validates under the catalog `oneOf` variant (`items` + `counts.total` only, no `filters` / `kindRegistry` / `returned` — the catalog ships in its entirety on every response and does not paginate). |
| Item shape | `IRegisteredAnnotationKey` per `src/kernel/types/annotation-catalog.ts`: `{ pluginId: string, key: string, location: 'namespaced' \| 'root', ownership: 'exclusive' \| 'shared', schema: Record<string, unknown> }`. The inline JSON Schema as declared in the contributing plugin's manifest (NOT the AJV-compiled validator). |
| Invariants | Read-only, no side effects, never throws after kernel boot. The catalog is small (typically 0–50 entries); no pagination, no filters, no caching headers. Mutating the returned `items` array does not affect subsequent calls — the kernel's view is frozen. |
| Empty case | When the kernel was booted with no plugin contributions (or `--no-plugins`): `{ "items": [], "counts": { "total": 0 } }`. |
| Refresh policy | Same as the rest of the BFF's plugin surface — discovery happens once at `sm serve` boot. An operator that installs a new plugin restarts the server (matches the watcher's "loaded ONCE at boot" contract). |

---

### Jobs

See `job-lifecycle.md` for the state machine; this table is the CLI surface.

| Command | Purpose |
|---|---|
| `sm job submit <action> -n <node.path>` | Enqueue a single job. |
| `sm job submit <action> -n <node.path> --run` | Enqueue + spawn subprocess runner immediately. |
| `sm job submit <action> --all` | Fan out to every node matching the action's preconditions. |
| `sm job submit ... --force` | Bypass duplicate detection. |
| `sm job submit ... --ttl <seconds>` | Override computed TTL. |
| `sm job submit ... --priority <n>` | Override job priority. Integer; higher runs first. Default `0`. Negative allowed (deprioritize). Frozen on `state_jobs.priority` at submit time. |
| `sm job list [--status ...] [--action ...] [--node ...]` | List jobs. |
| `sm job show <job.id>` | Detail: current state, claim timestamp, TTL remaining, runner, content hash. |
| `sm job preview <job.id>` | Print the rendered MD content of the job without executing. Reads from `state_job_contents`; there is no on-disk artifact. |
| `sm job claim [--filter <action>]` | Atomic primitive: return next queued job id, mark it running. Exit 0 with id on stdout; exit 1 if queue empty. `--json` returns `{id, nonce, content}` — drivers that intend to call `sm record` afterwards MUST use the `--json` form to receive the nonce. |
| `sm job run` | Full CLI-runner loop: claim + spawn + record. Runs one job. |
| `sm job run --all` | Drain the queue (sequential through `v1.0`; in-runner parallelism deferred). |
| `sm job run --max N` | Drain at most N jobs. |
| `sm job status [<job.id>]` | Counts (per status) or single-job status. |
| `sm job cancel <job.id> \| --all` | Force a running job to `failed` state with reason `user-cancelled`. `--all` cancels every `queued` and `running` job. |
| `sm job prune` | Retention GC: deletes terminal jobs past the configured retention window AND collects orphaned `state_job_contents` rows in the same transaction. |

Submit returns the job id on stdout in pretty mode, or a `Job` object conforming to `job.schema.json` in `--json` mode.

---

### Record (callback)

```
sm record --id <job.id> --nonce <n> --status completed \
         --report <path-or-dash> \
         --tokens-in N --tokens-out N --duration-ms N \
         --model <name>
```

Closes a running job with success. `--report` accepts either a filesystem path the kernel reads, or `-` to read the JSON payload from stdin. The kernel stores the parsed JSON inline on `state_executions.report_json`; the path / stdin source is ingestion-only and not retained.

```
sm record --id <job.id> --nonce <n> --status failed --error "..."
```

Closes a running job with failure. The `--error` value is stored verbatim in the execution record.

Exit: 0 on success; 4 on nonce mismatch; 5 if job id is not `running`; 2 otherwise.

Authentication: the nonce is the sole credential. An implementation MUST reject a mismatched or absent nonce.

---

### History

| Command | Purpose |
|---|---|
| `sm history [-n <node.path>] [--action <id>] [--status ...] [--since <date>] [--until <date>]` | Filter execution records. `--json` emits an array of `execution-record.schema.json` objects. |
| `sm history stats [--since <date>] [--until <date>] [--period day\|week\|month] [--top N]` | Aggregates over `state_executions` in the window. `--json` emits a document conforming to `history-stats.schema.json`: totals, tokens per action, executions per period (granularity from `--period`, default `month`), top N nodes by frequency (default 10), error rates (global + per-action + per failure reason). |

---

### Plugins

| Command | Purpose |
|---|---|
| `sm plugins list` | Auto-discovered plugins with status. `--json` emits an array of `DiscoveredPlugin`. |
| `sm plugins show <id>` | Full manifest + compat detail. |
| `sm plugins enable <id> \| --all` | Toggle on. Persists in `config_plugins`. `--all` applies to every discovered plugin. |
| `sm plugins disable <id> \| --all` | Toggle off; does not delete the plugin directory. `--all` applies to every discovered plugin. |
| `sm plugins doctor` | Revalidate all plugins against current spec version; update `status` fields. |

---

### Database

See `db-schema.md` for the table catalog.

| Command | Purpose |
|---|---|
| `sm db reset [-n / --dry-run]` | Drop `scan_*` only. Keep `state_*` and `config_*`. Non-destructive — no confirmation required. `--dry-run` prints the row counts that would be deleted per `scan_*` table without touching the DB. |
| `sm db reset --state [-n / --dry-run]` | Drop `scan_*` AND `state_*` (including `state_plugin_kvs` and every `plugin_<id>_*` table). Keep `config_*`. Destructive. `--dry-run` previews the deletion without touching the DB. |
| `sm db reset --hard [-n / --dry-run]` | Delete the DB file entirely. Keep the plugins folder so the next boot re-discovers them. Destructive. `--dry-run` reports the file path and size that would be deleted without unlinking it. |
| `sm db backup [--out <path>]` | WAL checkpoint + file copy. |
| `sm db restore <path> [-n / --dry-run]` | Swap the DB. Destructive. `--dry-run` validates the source file (existence, header, schema version) and reports what would be overwritten without touching the live DB. |
| `sm db shell` | Interactive SQL shell (implementations backed by SQLite use `sqlite3`; others use equivalent). |
| `sm db browser [<path>] [--rw]` | Open the DB in DB Browser for SQLite (`sqlitebrowser` GUI). Read-only by default (`-R`) so a concurrent `sm scan` writer is safe; pass `--rw` to enable writes. The `sqlitebrowser` binary MUST be on `PATH`. Non-destructive — no confirmation prompt. Detaches from the terminal so the shell stays usable. |
| `sm db dump [--tables ...]` | SQL dump. |
| `sm db migrate [--dry-run \| --status \| --to <n> \| --kernel-only \| --plugin <id> \| --no-backup]` | Migration controls. |

Destructive verbs (`reset --state`, `reset --hard`, `restore`) require interactive confirmation unless `--yes` (non-interactive mode for scripts) or `--force` (alias, kept for backward compatibility) is passed. `sm db reset` without a modifier is non-destructive and never prompts. **`--dry-run` short-circuits the confirmation prompt entirely** (per §Dry-run rule: dry-run MUST NOT depend on `--yes` / `--force`).

---

### Server

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--scope project\|global] [--db <path>] [--no-built-ins] [--no-plugins] [--open\|--no-open] [--dev-cors] [--ui-dist <path>] [--no-ui] [--no-watcher]` | Start Hono + WebSocket for the Web UI. Single-port mandate: SPA + REST + WS under one listener. Default port 4242, default host 127.0.0.1 (loopback-only through v0.6.0; multi-host deferred — see §Server). The watcher is on by default (Decision #121: a server with stale DB is a footgun); pass `--no-watcher` for CI / read-only deployments. `--no-ui` skips the SPA bundle (dev workflow alongside the Angular dev server); see §Server flags. |

#### Server

*(Stability: experimental — locks at v0.6.0.)*

The reference implementation ships a Hono BFF rooted at `src/server/`. One Node process serves the Angular SPA, the REST API under `/api/*`, and the WebSocket at `/ws` — single-port mandate, no proxy. Loopback-only assumption through v0.6.0: no per-connection auth on `/ws`; combining `--dev-cors` with a non-loopback `--host` is rejected (exit 2).

**Boot resilience**: `sm serve` boots even when the project DB is missing. `/api/health` reports `db: 'missing'` so the SPA can render an empty-state CTA instead of failing the connection. Explicit `--db <path>` that doesn't exist is the exception — that exits 5 (NotFound) per `§Exit codes`.

**Boot output**: after the listener binds, `sm serve` writes a startup banner to **stderr**. Stdout is reserved for `--json` payloads on other verbs and stays empty here. The banner shape depends on `isTTY(stderr)` and the standard color toggles (`NO_COLOR`, `FORCE_COLOR`, `--no-color`):

- **TTY + color**: an ASCII-art figlet logo split into a violet upper half and a green lower half, a dim version line right-aligned under the logo, then a dim-labelled data block (`Server <url>`, `Scope <project|global>`, `Path <cwd>`, `DB <path>`) and the `Press Ctrl+C to stop.` hint. The `Path` row shows the cwd the verb is running from; when it sits under the user's home, the prefix is replaced with `~` for legibility. The URL value is rendered in green with an underline. Implementations MAY choose any figlet-style rendering and any palette consistent with the violet-upper / green-lower split; the reference impl uses xterm 256-color codes (`\x1b[38;5;141m` violet, `\x1b[38;5;42m` green) and does NOT degrade to 16-color terminals — users on legacy terminals MUST set `NO_COLOR`.
- **TTY + `NO_COLOR` (or `--no-color`)**: same figlet block + version + data block, with zero ANSI escapes.
- **Non-TTY (pipes / redirects)**: banner suppressed; the verb emits two flat lines — `sm serve: listening on http://<host>:<port> (scope=<scope>, db=<path>)` followed by `sm serve: opening <url>/ in your browser. Press Ctrl+C to stop.` (or `sm serve: visit <url>/ ...` under `--no-open`). This shape is **stable**; tooling that scrapes those lines (CI capture, `tee log.txt`) MUST keep working across releases.

**Endpoints (v14.2 surface)**:

| Path | Status | Shape |
|---|---|---|
| `GET /api/health` | implemented | `{ ok: true, schemaVersion, specVersion, implVersion, scope: 'project'\|'global', db: 'present'\|'missing', cwd: string, dbPath: string }`. `cwd` is the absolute project root the BFF resolves against (`runtimeContext.cwd`); `dbPath` is the absolute project DB path (`IServerOptions.dbPath`). Both are surfaced so the SPA's About panel can show "you are looking at <project>" + the DB location without a second endpoint. |
| `GET /api/scan` | implemented | latest persisted `ScanResult` (1:1 with `scan-result.schema.json`; byte-equal to `sm scan --json` modulo whitespace). DB absent → empty `ScanResult` shape (zero `nodes` / `links` / `issues`). |
| `GET /api/scan?fresh=1` | implemented | runs an in-memory scan and returns the produced `ScanResult` without persistence. Rejects with `bad-query` (400) when the server was started with `--no-built-ins` or `--no-plugins` (would yield empty / partial results). |
| `POST /api/scan` | implemented | Run a fresh scan **and persist it** through the same `runScanWithRenames` + `persistScanResult` pipeline the watcher uses. Body is empty (`{}` or no body). Response: the persisted `ScanResult` inline (same shape as `GET /api/scan`). Side effects: broadcasts `scan.started` then `scan.completed` over `/ws` so other connected clients can refresh — the per-batch sequence is identical to a watcher-driven batch. **Concurrency**: only one scan may run at a time across the whole BFF process. A POST that arrives while a watcher batch is in flight (or while another POST is in flight) is rejected with `409 scan-busy` so the caller can decide whether to retry. **Pipeline gate**: rejected with `400 bad-query` when the server was started with `--no-built-ins` or `--no-plugins` (a partial pipeline would persist a misleading DB the next watcher boot would have to reconcile). **DB gate**: rejected with `500 db-missing` when the project DB file is absent — the read-side `/api/scan` degrades to the empty shape, but a write path cannot, so it fails fast. |
| `GET /api/nodes?kind=&hasIssues=&path=&limit=&offset=` | implemented | `RestEnvelope` (`kind: 'nodes'`) — paginated, filtered list. Filters share the `kind=` / `has=issues` / `path=<glob>` grammar with `sm export`. `hasIssues=false` is a server-side post-filter (not representable in the kernel grammar). Pagination defaults `offset=0`, `limit=100`; max `limit=1000`. |
| `GET /api/nodes/:pathB64[?include=body]` | implemented | Single-node detail envelope: `{ schemaVersion, kind: 'node', item: Node, links: { incoming: Link[], outgoing: Link[] }, issues: Issue[] }`. `:pathB64` is base64url (RFC 4648 §5, no padding) of `node.path`. Missing node or malformed `pathB64` → 404 `not-found`. **`?include=body`** (Step 14.5.a) — opt-in flag that adds `item.body: string \| null` to the response. The body is read from disk on demand at request time (the kernel persists `bodyHash` only). `null` indicates the source file was missing / unreadable when the request landed (the watcher will re-emit `scan.completed` when it catches up). Without the flag, `item.body` is `undefined` and the handler does not touch the filesystem. |
| `GET /api/links?kind=&from=&to=` | implemented | `RestEnvelope` (`kind: 'links'`) — list of links. Filters: `kind` (CSV whitelist of `link.kind`), `from` (exact match on `link.source`), `to` (exact match on `link.target`). No pagination at v14.2. |
| `GET /api/issues?severity=&ruleId=&node=` | implemented | `RestEnvelope` (`kind: 'issues'`) — list of issues. Filters: `severity` (CSV from `error\|warn\|info`), `ruleId` (CSV; qualified or short suffix per `sm check --rules`), `node` (filter to issues whose `nodeIds` includes the path). No pagination at v14.2. |
| `GET /api/graph?format=ascii\|json\|md` | implemented | formatter-rendered graph. `Content-Type` per format: `text/plain` (ascii), `application/json` (json), `text/markdown` (md / mermaid). Default `format=ascii`. Unknown format → 400 `bad-query`. |
| `GET /api/config` | implemented | `RestEnvelope` (`kind: 'config'`) — merged effective config (defaults → user → user-local → project → project-local → override). |
| `GET /api/plugins` | implemented | `RestEnvelope` (`kind: 'plugins'`) — list of installed plugins (built-in + drop-in) with status. Item shape: `{ id, version, kinds, status, reason, source: 'built-in'\|'project'\|'global', granularity: 'bundle'\|'extension', description?: string, locked?: boolean, extensions?: Array<{ id, kind, version, enabled, description?: string, locked?: boolean }> }`. The `granularity` field reflects the manifest declaration (built-ins: hardcoded per `built-in-plugins/built-ins.ts`; drop-ins: from `plugin.json#/granularity`, default `'bundle'`). The `description` field on the bundle item carries the manifest-declared description (built-ins: hardcoded on `IBuiltInBundle`; drop-ins: `plugin.json#/description`); each `extensions[]` entry carries its extension manifest's `description` per `IExtensionBase` (`extensions/base.schema.json#/properties/description`). The SPA's Settings list renders the descriptions as muted secondary text and includes them in its substring-search index alongside the ids. The `extensions` array is present **only** when `granularity === 'extension'` AND the plugin loaded successfully; each entry's `enabled` reflects the per-extension override resolution (DB > settings.json > installed default). For `granularity: 'bundle'` plugins the array is omitted (the bundle is the only toggle-able key). The optional `locked: true` flag is stamped when the bundle id (or qualified extension id) appears in the host's lock-list (`src/server/locked-plugins.ts`); locked items render the toggle disabled in the SPA and any `PATCH` against them returns `403 locked`. The flag is omitted when false. |
| `PATCH /api/plugins/:id` | implemented | Toggle one plugin's user override. `:id` MUST be a top-level bundle id; qualified-id form (`bundle/extension`) is the sibling route below. Body `{ enabled: boolean }` (JSON). Persists to `config_plugins` via `IConfigPluginsPort.set` — same path the CLI's `sm plugins enable\|disable` uses. Response is the canonical `{ id, version, kinds, status, reason, source }` row for the affected plugin (post-write `status` reflects the new override resolution). **Granularity** — rejected with 400 `bad-query` when the target bundle declares `granularity: 'extension'` (only the qualified-id form is toggle-able for those). **Lock** — rejected with 403 `locked` when the bundle id is in the host lock-list (`src/server/locked-plugins.ts`). **Restart required** — the loaded plugin runtime is boot-cached; the new value applies on the next `sm scan` or `sm serve` restart. The endpoint does NOT broadcast a WS event today. |
| `PATCH /api/plugins/:bundleId/extensions/:extensionId` | implemented | Qualified-id form for `granularity: 'extension'` bundles (today: `core` + any user plugin that opts in). Body `{ enabled: boolean }`. Both segments are URL-path-segment-encoded (no slash inside `:bundleId` or `:extensionId`). Rejected with 400 `bad-query` when the target bundle declares `granularity: 'bundle'` (use the sibling route above). **Lock** — rejected with 403 `locked` when either the bundle id or the qualified `bundleId/extensionId` appears in the host lock-list. Same persistence + restart-required semantics as the bundle form. |
| `ALL /api/*` (other) | reserved | structured 404 envelope (see below); future endpoints land in subsequent sub-steps. |
| `GET /ws` | implemented (v14.4.a) | accepts WebSocket upgrade and registers the client with the BFF broadcaster. Server-push only — the server fans `scan.*` (and forthcoming `issue.*`) events to every connected client. See **WebSocket protocol** below. |
| `GET *` | implemented | static asset from the resolved UI bundle, falling back to `index.html` for SPA deep links. |

List endpoints conform to [`schemas/api/rest-envelope.schema.json`](schemas/api/rest-envelope.schema.json). The `/api/scan` and `/api/health` responses carry their underlying `ScanResult` / `IHealthResponse` shapes directly (no envelope wrap). The `/api/graph` response carries the formatter's native textual output.

**`kindRegistry` envelope field.** Every payload-bearing variant of the REST envelope (`nodes` / `links` / `issues` / `plugins` lists, the `node` single, the `config` value envelope) embeds a required `kindRegistry: { [kindName]: { providerId, label, color, colorDark?, emoji?, icon? } }` field. Sentinel envelopes (`health`, `scan`, `graph`) are exempt — they carry no payload at the wire level. The BFF assembles the registry once at boot from every enabled Provider's `kinds[*].ui` block (see [`architecture.md` §Provider · `ui` presentation](architecture.md#provider--ui-presentation)) and attaches the same map to every applicable response. The UI consumes `kindRegistry` directly to render kind palettes, list rows, and inspector headers — built-in and user-plugin kinds render identically. A kind appearing in a response payload (e.g. `node.kind`) without a matching `kindRegistry` entry is a contract violation; the kernel rejects Providers without a `ui` block at load time so the registry is always complete for whatever kinds appear in the response.

**Error envelope** (mirrors `§Machine-readable output rules`):

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

HTTP status mapping: `400` → `bad-query`, `404` → `not-found`, `409` → `sidecar-fresh` (`POST /api/sidecar/bump`) or `scan-busy` (`POST /api/scan`), `500` → `internal` / `db-missing`.

Error code sources at v14.2:

- `not-found` (404) — unknown `/api/*` path; missing node on `/api/nodes/:pathB64`; malformed `pathB64` (treated as "no such node" so the client UX is uniform).
- `bad-query` (400) — `ExportQueryError` from `parseExportQuery`; pagination beyond `limit ≤ 1000`; non-integer / negative `limit` / `offset`; unknown formatter on `/api/graph`; `?fresh=1` when the server started with `--no-built-ins` or `--no-plugins`.
- `internal` (500) — uncaught error during a request (e.g. config-load failure, DB corruption surfacing through `loadScanResult`).
- `db-missing` (500) — emitted by mutation endpoints (`PATCH /api/plugins/:id`, `PATCH /api/plugins/:bundleId/extensions/:extensionId`) when the project DB is absent. Read-side routes uniformly degrade to the empty shape (`/api/scan`) or zero items (list endpoints) so they do not emit this code; mutation endpoints cannot persist without a DB so they fail fast instead of silently dropping the write.
- `not-found` (404) on `PATCH /api/plugins/:id` — unknown plugin id (no built-in bundle, no discovered drop-in matches). The qualified-id form returns the same code when either segment misses.
- `bad-query` (400) on `PATCH /api/plugins/:id` — granularity mismatch (bundle-level call against a `granularity: 'extension'` bundle, or qualified-id call against a `granularity: 'bundle'` bundle), malformed body (missing `enabled`, wrong type), unknown extension id under a known bundle.
- `locked` (403) on `PATCH /api/plugins/:id` and the qualified-id sibling — the target bundle id or qualified extension id is in the host lock-list (`src/server/locked-plugins.ts`). The list is hardcoded, host-only, and not user-editable; `GET /api/plugins` mirrors the same rule by stamping `locked: true` on the affected items.
- `bad-query` (400) on `POST /api/scan` — the server was started with `--no-built-ins` or `--no-plugins` (partial pipeline would persist a misleading DB).
- `scan-busy` (409) on `POST /api/scan` — another scan (a watcher batch or another POST) is already in flight. Retry once the in-flight scan resolves; the WS `scan.completed` envelope is the unambiguous "now safe" signal.

**Flag surface**:

| Flag | Default | Purpose |
|---|---|---|
| `--port N` | `4242` | Listening port. `0` = OS-assigned (handle reports the bound port). |
| `--host <ip>` | `127.0.0.1` | Listening host. Implementations MUST NOT bind `0.0.0.0` by default. |
| `--scope project\|global` | `project` | Effective scope for `/api/*` reads. Alias for `-g/--global`. |
| `--db <path>` | resolved per spec § Global flags | Override the DB file location. Missing explicit `--db` exits 5. |
| `--no-built-ins` | off | Skip built-in plugin registration (parity with `sm scan --no-built-ins`). |
| `--no-plugins` | off | Skip drop-in plugin discovery. |
| `--open` / `--no-open` | `--open` | Auto-open the SPA in the user's default browser after listen. |
| `--dev-cors` | off | Enable permissive CORS for the Angular dev-server proxy workflow. Loopback-only when set. |
| `--ui-dist <path>` | auto | Override the UI bundle directory. Hidden flag — used by the demo build pipeline + tests; everyday users never need it. Mutually exclusive with `--no-ui` (rejected with exit 2). |
| `--no-ui` | off | Skip serving the Angular SPA bundle. The root `/` (and any SPA fallback) responds with an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Intended for local development alongside the Angular dev server with HMR; pairs with `--no-open` (default `--open` plus `--no-ui` would auto-open the placeholder, so a non-fatal stderr warning is emitted in that combination). Mutually exclusive with `--ui-dist <path>` (rejected with exit 2). The server keeps `/api/*` and `/ws` fully functional; only the static SPA is suppressed. |
| `--no-watcher` | off | Disable the chokidar-fed scan-and-broadcast loop. Use only for CI / read-only deployments — without the watcher, `/ws` stays open but no `scan.*` events ever fire. Combining with `--no-built-ins` is rejected (the watcher cannot run with an empty pipeline; would persist empty scans on every batch). |

**WebSocket protocol** *(Stability: experimental — locks at v0.6.0)*:

The `/ws` endpoint is the live-events channel for the SPA. Clients connect once at bootstrap, the server pushes events as they happen, and the SPA reconciles its in-memory store against the deltas. The wire envelope and `scan.*` payload shapes are normative in [`job-events.md`](./job-events.md) — the BFF emits them verbatim.

- **Wire format**: each event is a single WebSocket text frame carrying one JSON object that conforms to `job-events.md` §Common envelope (`type`, `timestamp`, `runId?`, `jobId? | null`, `data`).
- **Event catalog at v14.4.a**:
  - `scan.started` (per `job-events.md` §Scan events line 325).
  - `scan.progress` (per `job-events.md` line 345 — emitted by the kernel orchestrator at every node; throttling deferred to a follow-up).
  - `scan.completed` (per `job-events.md` line 363).
  - `extractor.completed` (per `job-events.md` line 384) and `rule.completed` (per `job-events.md` line 404) ride along as side effects of the same emitter bridge.
  - `extension.error` (kernel-internal — emitted when an extension violates its declared contract; the BFF forwards verbatim).
  - `watcher.started` and `watcher.error` — BFF-internal advisories. Non-normative; consumers MUST ignore unknown event types per the forward-compatibility rule.
- **Deferred to a follow-up**: `issue.added` / `issue.resolved` (per `job-events.md` §Issue events line 446) and `scan.failed`. The 14.4.a surface fans out only the events the kernel emitter already produces; the diff-based issue events and a dedicated batch-failure event require additional plumbing inside the BFF watcher loop.
- **Connection lifecycle**:
  1. Client opens `ws://<host>:<port>/ws`. The server completes the WS handshake and registers the underlying socket with the broadcaster.
  2. Server pushes events. The client sends nothing at v14.4.a — `onMessage` is intentionally not registered. A future heartbeat / subscribe / filter request lands in a follow-up.
  3. Server has NO state push on connect (no replay of last events). The client SHOULD poll `/api/scan` once on connect to seed initial state, then rely on `/ws` for deltas.
  4. On normal disconnect: client closes with code 1000 ('normal closure') or 1001 ('going away'). The broadcaster unregisters silently.
  5. On server shutdown (SIGINT / SIGTERM): the broadcaster sends close code 1001 + reason `'server shutdown'` to every client, then closes the http listener.
  6. **Backpressure**: if a client's outbound buffer (`bufferedAmount`) exceeds an implementation-defined threshold (the reference impl uses 4 MiB), the broadcaster closes that client with code 1009 ('message too big') and unregisters it. Clients SHOULD reconnect after backpressure eviction with a fresh `/api/scan` poll.
  7. **Reconnect responsibility**: the server does NOT reconnect on the client's behalf and does NOT replay missed events on reconnect. The client SHOULD treat `/ws` as a best-effort delta channel and re-seed via `/api/scan` whenever the connection drops.
- **Loopback-only assumption (Decision #119)**: no per-connection authentication on `/ws` through v0.6.0. The transport security boundary is the `--host` flag (defaults to `127.0.0.1`); the server rejects `--dev-cors` combined with a non-loopback `--host` precisely because that combination would expose `/ws` over the network without auth. Multi-host serve and an auth model re-open post-v0.6.0.

**Graceful shutdown**: SIGINT / SIGTERM trigger a graceful close; the verb returns exit 0 on clean shutdown. Bind failure (port in use, EACCES) returns exit 2. The shutdown sequence drains the in-flight watcher batch (if any), closes every WS client with code 1001, then closes the http listener.

---

### Introspection

- `sm help --format json` — structured CLI surface dump.
- `sm help --format md` — canonical markdown, CI-enforced for the reference impl's `context/cli-reference.md`.

These two formats are NORMATIVE: any change to verbs, flags, or exit codes MUST reflect in `--format json` output immediately. Third-party consumers rely on this.

### Conformance

| Command | Purpose |
|---|---|
| `sm conformance run [--scope spec\|provider:<id>\|all]` | Run the conformance suite. `--scope spec` runs only the kernel-agnostic cases bundled with `@skill-map/spec` (default fixture: `preamble-v1.txt`, case: `kernel-empty-boot`). `--scope provider:<id>` runs only the named built-in Provider's suite (today: `provider:claude`). `--scope all` (default) runs every visible scope in registry order. Exit 0 on a clean sweep; exit 1 if any case failed; exit 2 on a configuration error (unknown scope, missing binary). |

Per-Provider conformance suites live next to the Provider's manifest under `<plugin-dir>/conformance/{cases,fixtures}/`. The verb discovers them by walking the built-in Provider directory (and, post-job-subsystem, the plugin loader's discovery output). External consumers — alt-impl authors, Provider authors validating their own work — drive the same suite via this verb without reaching into bespoke scripts.

---

## Machine-readable output rules

When `--json` is set:

1. Stdout contains ONLY the JSON document (or ndjson lines, for streaming verbs like `sm job run`).
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

Every verb that does non-trivial work MUST report its own wall-clock duration. Coverage is broad on purpose — operators and agents need to notice regressions without instrumenting the host.

### Scope

**In scope**: any verb that walks the filesystem, hits the DB, spawns a subprocess, or renders a report. Examples: `sm scan`, `sm check`, `sm list`, `sm show`, `sm findings`, `sm history`, `sm history stats`, `sm graph`, `sm export`, `sm job submit`, `sm job run`, `sm job claim`, `sm job preview`, `sm record`, `sm doctor`, `sm db backup`, `sm db restore`, `sm db dump`, `sm db migrate`, `sm plugins list`, `sm plugins doctor`, `sm init`, `sm conformance run`.

**Exempt**: informational verbs that return in well under a millisecond and would clutter the output — `sm --version`, `sm --help`, `sm version`, `sm help`, `sm config get`, `sm config list`, `sm config show`.

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

Schemas that already express the command's wall-clock under a nested field (e.g. `scan-result.schema.json` → `stats.durationMs`) MUST treat that field as the elapsed time of the scan command itself. Adding a top-level `elapsedMs` to those schemas for redundancy is a minor bump and MAY happen later for consistency; until then, consumers read the nested field.

### Implementations

Implementations MUST measure from the moment the verb starts its own work (after Clipanion / arg-parsing overhead) to the moment before writing the terminal output. Sub-millisecond verbs exempt per §Scope MAY skip the measurement entirely.

### Stability

The `done in …` stderr line, its format grammar, and the `elapsedMs` field contract are **stable** as of spec v1.0.0. Changing the grammar, the time units, or the location (stderr ↔ stdout) is a major bump. Adding `elapsedMs` to a schema that previously omitted it is a minor bump.

---

## See also

- [`architecture.md`](./architecture.md) — CLI as a driving adapter; kernel-first design; dependency rules.
- [`job-lifecycle.md`](./job-lifecycle.md) — state machine behind `sm job` verbs.
- [`job-events.md`](./job-events.md) — event stream emitted via `--json` and `--stream-output`.
- [`db-schema.md`](./db-schema.md) — tables behind `sm db` verbs.
- [`../context/cli-reference.md`](../context/cli-reference.md) — auto-generated reference from `sm help --format md`.
- [`conformance/`](./conformance/README.md) — test suite exercising CLI behavior.

---

## Stability

The **verb list** is stable as of spec v1.0.0. Adding a verb is a minor bump. Removing a verb is a major bump.

**Adding** a flag is a minor bump. Changing a flag's type or removing a flag is a major bump. Changing a flag's default is a major bump.

**Exit codes 0–5** are stable. Redefining any of these meanings is a major bump. Adding codes in the reserved range (6–15) is a minor bump.

`--json` output shapes conform to the schemas under `schemas/`. Shape changes follow schema versioning (see `versioning.md`).
