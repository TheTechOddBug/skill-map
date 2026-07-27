# Spec changelog

## 0.88.0

### Minor Changes

- Adds `annotations.issueSuppressions` to the sidecar annotations schema: standing operator dismissals of deterministic analyzer issues keyed by (analyzer, value), applied at emission time (documented in db-schema §scan_issues together with the `data.target` value contract). The CLI contract gains the `sm issues dismiss / undismiss / suppressions` verb rows and the per-node issue dismiss/undismiss server routes.

## 0.87.0

### Minor Changes

- Map visibility flips to a deviation model (spec §Map scope overrides): rail checkboxes start CHECKED, unchecking excludes the subtree, and overrides inherit nearest-ancestor-wins. `/api/branch` and MCP `get_branch` gain `exclude` / `excludeRoot` params evaluated server-side before the render cap; bare `?path=` keeps its historical union meaning via an inference rule, so existing callers are unaffected. The old localStorage include-set migrates automatically.

  ## User-facing

  The file checkboxes now tell the truth: everything starts checked, unchecking a folder hides it from the map, and re-checking something inside brings just that part back. New files show up on the map by default. Use the new header checkbox to hide or show everything at once.

### Patch Changes

- Session anchors no longer dock beside the AGENTS.md / CLAUDE.md card: the instructions-node affinity was retired after live use (the session cluster parked away from the agents actually running). A session now floats above the centroid of the agents it runs; capsule-only sessions hover above the graph top. Clamp, collision dodge and drag overrides are unchanged. Placement note updated in `spec/provider-activity.md`.

  ## User-facing

  Live session capsules now float above the agents they are running instead of docking next to AGENTS.md, so the activity reads right where the work happens. Drag still wins if you prefer them elsewhere.

## 0.86.0

### Minor Changes

- Removed the agent doorbell (wake-on-submit): the `jobs.wakeOnSubmit` key, the `POST /api/agent/doorbell` route, the Settings toggle, and the registration in the generated OpenCode activity plugin. It served one runtime with no path to the others; parking (`sm jobs claim --wait` or the MCP `claim_job` wait) covers the same need at zero idle cost. The activity ingest tolerates and ignores the `agentEndpoint` field plugins generated before the removal still send.

  ## User-facing

  The "Wake an agent when jobs are queued" switch is gone from Settings, Project. To process the queue, keep an agent watching it (ask it to run the processing skill) or process on demand; nothing else changes.

- Dual-base link resolution: a backticked prose path that misses file-relatively now retries against the scan root before being flagged broken (unless it carries an explicit `./` / `../` prefix), and markdown links support GitHub's root-relative form, `[x](/docs/foo.md)` resolves from the scan root instead of being skipped. Closes the false "Broken pointer" on root-relative mentions written from nested folders, the dominant convention in agent docs.

  ## User-facing

  Fewer false "Broken pointer" errors: a path in backticks written from the project root (like docs usually do) now resolves even when the file mentioning it lives in a subfolder, and `[text](/path/from/root.md)` links now work like on GitHub.

### Patch Changes

- Interrupted or failed sub-agent spawns no longer linger on the live map: the claude adapter maps the main-context `Stop` to a new node-less `turnEnd` frame that sweeps the turn's dead sync spawn relations (re-run `sm activity install claude` to wire it), and a completion-less relation is no longer kept alive by its own session's heartbeats. Also fixes the client event guard rejecting the node-less `sessionScope` form (Codex's turn-end release went unprocessed).

  ## User-facing

  If you cancel or interrupt your agent while it delegates work, the dashed live arrow and its capsule now disappear when the turn ends instead of sticking around for the rest of your session. Re-run `sm activity install claude` once so the new turn-end hook gets wired.

- The graph now renders an ephemeral agent capsule for a spawned runtime sub-agent that matches no scanned node (a vendor built-in with no file on disk), aggregated per parent and name with a live-run count and released with its last live relation; a session spawning only built-ins previously drew nothing. Session anchors float beside the project-instructions card (`AGENTS.md` / `CLAUDE.md`), and dragging a live anchor no longer snaps back mid-drag. Spec: `provider-activity.md` §agent.spawn.

  ## User-facing

  When your agent spawns built-in helpers that are not files in your project (an explorer, a planner), the map now shows them as live dashed capsules with a run counter, hanging off whoever spawned them. Your session bubble also docks next to your AGENTS.md / CLAUDE.md card.

- New project-local `ui.showRuntimeAgents` preference (default `true`, subordinate to `ui.realtimeActivity`): gates the map's ephemeral capsules for runtime sub-agents that match no scanned node. Rides the standard preferences pipeline (`project-config` schema, `GET/PATCH /api/project-preferences`, a third toggle in Settings > Project's Real Time block); switching it off restores the pre-capsule rendering without touching resolved-node spawn edges or session anchors.

  ## User-facing

  New toggle in Settings > Project, "Show runtime sub-agents": turn off the floating capsules for your agent's built-in helpers if you prefer the map to show only your own files. On by default.

## 0.85.1

### Patch Changes

- Move the generated-artifact ignore rules into a committed `.skill-map/.gitignore` written by the tool itself, replacing the four entries `sm init` appended to the project-root `.gitignore`. The list now also covers the SQLite `-wal` / `-shm` sidecars, the operations log and the generated activity bridge, which the old entries never matched. `sm init`, the scan persist step and `sm activity install` each top it up, so an older project is fixed on its next scan; a `!` negation opts an entry out.

  ## User-facing

  Skill-map no longer writes to your project's `.gitignore`: it keeps its own inside `.skill-map/`, covering everything it generates. The database sidecars, the operations log and the activity bridge no longer show up as files to commit. Older projects are fixed on the next scan.

## 0.85.0

### Minor Changes

- New agent doorbell (`jobs.wakeOnSubmit`, off by default, project-local): instead of an agent parked on a blocking claim, the server wakes a registered runtime when a submit survives a short settle window unclaimed, starting a fresh session that drains the queue in `once` mode and stops. OpenCode's activity plugin registers its local API as the wake endpoint (`POST /api/agent/doorbell`, refreshed per activity event); the wake is loopback-only, cooldown-bounded, and never fires for the boot ping.

  ## User-facing

  Turn on "Wake an agent when jobs are queued" (Settings, Project) and OpenCode starts a session by itself when work arrives, processes the queue, and stops. Nothing sits parked, idle costs zero.

- New `GET /api/agent/presence` reports whether a processing agent has been observed claiming work since the server started, and the inspector's second warning uses it instead of the live MCP session count. That count was the wrong proxy: an agent parked on the CLI `sm jobs claim --wait` talks straight to SQLite and holds no MCP session, so a healthy setup warned forever. Both claim paths count now, and a startup ping learns the answer without waiting for traffic.

  ## User-facing

  The inspector no longer claims no agent is available when one is running through the CLI: it now reports whether an agent has actually picked up work.

- `claim_job`'s blocking `wait` now emits a `notifications/progress` heartbeat every ~15s while parked, when the request carried a `progressToken`. OpenCode calls every MCP tool with `resetTimeoutOnProgress: true` and a 60s default timeout, so its park died at the first minute; with the heartbeat it parks indefinitely. The skill's claim guidance is per-runtime now: Codex and OpenCode park on the MCP claim, Claude Code keeps the free CLI wait.

  ## User-facing

  An OpenCode agent watching the queue can now wait for jobs on a single parked call, spending no tokens while idle, instead of the wait dying after a minute.

- Provider manifests gain `detect.subsumes`, the candidate ids a Provider absorbs during lens auto-detection because it reads that runtime's territory itself. `opencode` declares `['claude']`: it reads `.claude/skills/` and `CLAUDE.md` by design while Claude Code never reads `.opencode/`, so that pair was never a real tie, yet detection prompted over it. One-way (a mutual pair keeps the ambiguity) and applied after the `fallback` rule, so it only ever collapses a would-be prompt.

  ## User-facing

  A project with both `.claude/` and `.opencode/` now picks OpenCode on its own instead of asking, since OpenCode reads Claude's skills too. Two unrelated runtimes still ask.

- Agent presence now flips on an MCP `claim_job` ATTEMPT, not only on a won claim (a parked agent is attending by definition), and gains explicit negative evidence: a liveness ping cancelled while still unclaimed flips `attending` back to false until a later claim or attempt, so a manual Check moves the connected state both ways. The inspector re-probes presence the moment the MCP client connects, so warnings and buttons update together. `lastClaimAt` stays claim-only.

  ## User-facing

  The "no agent has picked up work yet" notice clears as soon as your agent parks on the queue, and a Check nobody answers flips the state back to disconnected, so what you see always matches reality.

- A Provider can now declare that it READS a skill territory another Provider owns, via `scaffold.sharedWith`. Antigravity and OpenCode both read the open `.agents/skills` territory that `agent-skills` owns, so `sm agent install` / `status` and the Quick Start row refused under those lenses even though a skill materialised there is discovered by their runtimes. Per-lens probes now resolve them; destination-choice verbs keep listing owners only, so one territory offers one row.

  ## User-facing

  You can now install and check the processing skill from the Antigravity and OpenCode lenses, instead of having to switch to the Agent Skills lens first.

- Provider activity adapters declare `spawnCustody`, and a `blocking` runtime's owner-scoped end now carries `terminal: true`, releasing the spawns that owner parents instead of counting as a pause. The pause-is-not-end rule is Claude-shaped: OpenCode blocks the parent inside the `task` call, so an idle parent is finished. Without this a spawn whose completion never arrives, the shape a refused call leaves, stayed drawn for the full five-minute decay window.

  ## User-facing

  A delegation arrow that ends badly (the runtime refused the call, the agent crashed) now clears as soon as the session finishes, instead of hanging on the map for five minutes.

- A spawn that names no parent is now anchored on the agent node its owner is known to be running, through a boot-scoped `owner -> agent node` index fed by agent claims and completed relations. OpenCode's `task` event reports only the spawning session, so every delegation hung off a synthetic session capsule while the real parent glowed elsewhere. The capsule stays the fallback for an owner running no scanned node.

  ## User-facing

  Delegation arrows now start at the agent that actually delegated, instead of a generic "Session" bubble, on runtimes that do not name the parent.

- The `job.completed` event now carries the job's frozen `nodeId` (spec `job-events.md`), and the UI keys the tagger's tag proposal on it: the pre-filled editor offer no longer evaporates when you navigate while the agent works, cannot open over the wrong node's tags, and re-offers itself when you return to the judged node until it is saved or superseded.

  ## User-facing

  Auto-tag suggestions now wait for you: if you browse other files while your agent infers tags, the pre-filled tag editor opens when you come back to the file it judged instead of getting lost.

- The auto-tagger now PROPOSES tags instead of writing them. A record-time write could only honour a standing `.sm` grant (a record callback cannot prompt), so a project without it burned a model call and silently produced nothing. The tags now ride the completion event and open the ordinary tags editor pre-filled, where the operator saves them under the usual consent handshake. The prompt also receives the node's CURRENT tags, so it proposes what is missing rather than near-duplicates.

  ## User-facing

  Auto-tag now suggests tags in the tag editor for you to keep or drop, instead of silently doing nothing when sidecar edits are not allowed, and it stops proposing near-duplicates of tags you already have.

### Patch Changes

- The kernel safety lane is now replaced per NODE instead of per reporting extension. A safety row states a fact about the node's content, and every probabilistic report carries a complete safety verdict on the body it read, so scoping the replace to the extension kept one copy of the same fact per extension that ever ran: six finders over one trapped file recorded the same injection six times. The finder lane keeps its per-extension supersede.

  ## User-facing

  A file with a prompt-injection trap no longer collects one duplicate warning per AI check you run: the safety flag is recorded once per file.

- `GET /api/mcp/status` now reports `url`, the endpoint a client should register, built by the server from its own bind. Quick Start's MCP row uses it instead of the page origin, which named the dev proxy's port under a split dev setup. The row also stops assuming every runtime has an `mcp` CLI verb: Antigravity and OpenCode have none, so they copy a whole config document plus the file it goes in, always a personal one (OpenCode's global config, never the project file a team commits).

  ## User-facing

  The MCP setup command now carries the port your server is really on, and Antigravity and OpenCode get a ready config file to save. It always points at your own config, never at a file your repository shares with the team.

## 0.84.0

### Minor Changes

- Codex live-map + queue parity, additive (Claude unchanged). A subagent whose own end signal Codex drops (nested spawn) now releases at turn end: the main-context `Stop` maps to a node-less session-scoped `node.activity` frame (`sessionScope` + `session`) that clears every owner of the session, instead of glowing until the 5-minute decay. And MCP `claim_job` gains an opt-in `wait` (seconds) for a server-side blocking long-poll, so a runtime that cannot park a shell command drains without polling.

### Patch Changes

- Kernel safety-lane findings of type `content-suspicious` (the passive self-report a probabilistic run emits when it judges a node's content suspicious) are now recorded at severity `warn` instead of `info`, matching their siblings `injection-detected` and `content-malformed`. They surface as warnings across `sm findings` and the UI instead of info-level notes.

  ## User-facing

  Content flagged as suspicious now surfaces as a warning instead of an info note, so it stands out in scans and the findings list.

## 0.83.0

### Minor Changes

- The web UI's topbar tutorial reminder now shows two messages in sequence instead of one: a Quick Start nudge first, then the `sm tutorial` nudge, one dismiss advancing to the next. The project-local config key backing it changed shape from the boolean `tutorialReminderDismissed` to the integer `tutorialReminderStep` (0-2); `GET`/`PATCH /api/project-preferences` reflect the new key.

  ## User-facing

  The "New to skill-map?" topbar reminder now shows a Quick Start tip first, then the `sm tutorial` tip on your next visit after dismissing it.

## 0.82.0

### Minor Changes

- A host-reserved `locked` manifest flag replaces the hardcoded kernel lock-list so the kernel names no plugin identity; five dedicated `inspector.surface.*` slots (version, stability, tags, summary, auto-tag) replace the retired payload-level `surface` re-homing field; the plugin listing wire gains a presentation `order`; and `GET /api/folders` severity badges now sum fresh unresolved findings alongside deterministic issues.

  ## User-facing

  **The files tree now badges AI findings.** A file or folder with unresolved AI findings shows an error/warn badge in the tree, matching its card chips, not just deterministic checks. The `?debug=1` overlay also rings the version, stability, tags, summarize and auto-tag surfaces.

- The opt-in `/mcp` server (`mcp.server.enabled` / `sm serve --mcp`) is no longer read-only: the same toggle also exposes queue tools (submit/claim/record/cancel/fail jobs, plus list/get and extension discovery) and findings-lifecycle tools (list, resolve, dismiss, reopen, undismiss, delete), thin wrappers over the shared claim/record engines the CLI verbs already use, so an MCP host can drive the job queue and manage findings over one endpoint. Loopback-only and unauthenticated as before.

  ## User-facing

  **Your MCP assistant can now run the queue, not just read the map.** One toggle (Settings > Project, or `sm serve --mcp`) lets a connected AI assistant drive the job queue and manage findings over `/mcp`, from submitting and recording jobs to resolving or dismissing findings.

- The `sm-process-jobs` agent process skill becomes a 3-file progressive-disclosure set (`SKILL.md` always loaded, `mcp.md`/`cli.md` read on demand), installed and status-checked atomically by the agent-skill engine. It now defaults to resident/watch (`once` drains a single pass), probes for MCP tools first (silent in hybrid mode, one-time ordered 3-step setup tip when absent), and renames the queue-processing sense `drain` to `process`. README and spec MCP docs updated for the queue-aware server.

  ## User-facing

  **The process skill now runs resident and tries MCP first.** `sm agent install` writes a 3-file skill that stays resident to process the job queue, uses the MCP tools when present, and when the MCP server is off tips you how to turn it on.

- A new Quick Start panel (rocket icon in the topbar) reports what each capability needs across Live update, Real Time and AI Actions, one live status and action per row. `GET /api/health` gains an `mcp` boolean (the live `/mcp` state, separate from the `mcpServerEnabled` preference). A hidden `locked` system extension `core/ai-ping-action` (absent from every catalog; `list_extensions` skips locked ids) backs the agent-liveness check: a claimed ping proves an agent is draining the queue.

  ## User-facing

  **New: a Quick Start panel (rocket icon, top right).** One place to see what each feature needs, live updates, real-time activity, capture, and the AI/MCP pieces, with the status of each and a button to turn it on. It can even check whether an agent is answering the job queue.

## 0.81.0

### Minor Changes

- The per-node Activity section tightens retention: the runtime recent-executions ring and the AI-run history each cap at 15 (was 20), and the conversation view renders at most 10 threads per node. `spec/provider-activity.md` lowers the normative `runs` cap to 15. AI-run rows now show the full qualified extension id and surface a run status only when it deviates from `completed` (failed and cancelled runs show their state).

  ## User-facing

  **Leaner Activity timeline.** Each node keeps its 15 most recent runs and up to 10 conversations. AI-run rows now show each run's full name and only flag its status when it failed or was cancelled.

- The inspector's Activity section interleaves two provenances: live runtime activity and skill-map's own AI-run history from `state_executions` (persistent). `GET /api/activity/node/:pathB64` gains a lean `runs` array (newest-first, capped 20; no report/nonce). The two are distinguished behind a three-way filter (all / runtime / AI runs) persisted at inspector level; the old Executions/Last-start/Contexts/Totals stat grid was dropped.

  ## User-facing

  The inspector's Activity panel now shows a combined timeline of live agent activity and skill-map's own analysis runs, with a filter to focus on either.

- The CLI contract gains §Agent drain skill: `sm agent install / uninstall / status` materialise the canonical, CLI-versioned `sm-run-queue` skill into the active lens's `scaffold.skillDir`, teaching any agent runtime the claim → execute → record drain protocol (byte-exact staleness probe, idempotent reinstall, no separate package and no network fetch).

- The HTTP API gains the agent-drain-skill install surface, mirroring the activity-hooks endpoints: `GET /api/agent/install?provider=` (status probe with `supported` / `installed` / `stale`, the fields behind the UI button's Install / Update / Up to date states), and the 412-consent-gated `POST /api/agent/install` (three-state `outcome`) and `POST /api/agent/uninstall` (`removed`). The materialised skill folder is a bundled ignore default: skill-map infrastructure never surfaces as a node.

- The node card's aggregate `warn` / `error` severity chips now sum both provenances: deterministic issues PLUS a node's unresolved, non-stale findings (open + `human-decision`). `issue-counter` and `sm scan` are unchanged; the findings are added at read time by the BFF node decoration under issue-counter's own chip ids, with a provenance-breakdown tooltip, on every endpoint that embeds contributions (`/api/nodes`, `/api/scan`, `/api/branch`).

  ## User-facing

  A node's error/warning count on the map card now includes its AI findings, not just deterministic issues, so a node flagged only by an analysis run still shows a count. Hover the chip to see the split.

- New built-in fixer `core/ai-reference-action` (stable, enabled by default), the first fixer for a DETERMINISTIC analyzer: it repairs broken reference links that `core/reference-broken` flagged by injecting that analyzer's Issues (`scan_issues`) into a `## Issues to resolve` job section keyed on the broken target. The agent repoints each link at its real in-project target, asking permission before searching outside the project; the inspector button shows only on nodes with such Issues.

  ## User-facing

  New fix-it job for broken links: after a scan flags a broken reference, queue `core/ai-reference-action` and the agent repoints the link to where the file actually lives in your project (asking first before it looks outside the project).

- Three inspector AI-actions fixes. The two-state finder button reflects its FIXER's job: `prob-extensions` computes `state` / `jobId` over `{finder} ∪ fixerIds`, so clicking Fix shows queued/running, not nothing. A plugin toggled mid-session is honored without restarting `sm serve`: the launcher and submit endpoints re-read the enabled set per request via a fresh resolver (drop-ins that booted disabled still need a restart). And the Automatic toggle is relabelled "Auto-fixer".

  ## User-facing

  Clicking a finder's Fix now shows the fixer running instead of looking like nothing happened; enabling AI-action plugins takes effect without restarting the server; and the auto toggle is now labelled "Auto-fixer".

- The `core/annotation-stale` drift analyzer graduates from experimental to stable, so a default scan now surfaces sidecar (`.sm`) drift out of the box as an `info` issue; its read-only detection is safe on by default while the companion writer `core/node-bump` stays experimental (opt-in), decoupling the former bump pair. The `sidecar-end-to-end` conformance case now expects the extra issue, and the inspector drops the `never bumped` audit empty-state.

  ## User-facing

  **Drift shows out of the box.** Scans now flag when a skill's `.sm` sidecar has fallen out of sync with its `.md`, no need to enable anything first. The inspector's Metadata section also drops the old `never bumped` line.

- Add `POST /api/jobs/cancel-all` and `POST /api/jobs/prune[?status=]`, the bulk write endpoints behind the queue inspector toolbar. cancel-all moves every queued/running job to terminal cancelled and broadcasts one `job.cancelled` per id; prune deletes terminal jobs immediately (all terminal states, or just one via `?status=completed|failed|cancelled`) as a silent GC with no WS event. A non-terminal or unknown status returns `400 bad-query`. Additive; route rows land in `cli-contract.md`.

- Add `GET /api/jobs?status=&extension=&node=`, the cross-corpus job-queue list read endpoint (HTTP face of `sm jobs list`), plus a new registry-less `kind: 'jobs'` list variant in the REST envelope schema. Each row is a public `Job` projection carrying every field except the `nonce`, all three filters are optional, and an unknown `status` value returns `400 bad-query`. Additive API surface; a route row lands in `cli-contract.md`.

- Extensions gain an optional `defaultEnabled` manifest field that overrides the stability-derived installed default; the bump contract now accepts a versionless fresh sidecar and stamps `version: 1` (only a fresh sidecar already carrying a version refuses); summaries get a normative `DELETE /api/nodes/:pathB64/summary` route; the auto-fix hook leaves the normative narrative; and a new architecture §Storage rule seals machine output to the DB vs human curation to the `.sm` sidecar.

- Removes the `writesSummary` flag from the Action contract. An Action is now a summarizer iff its `report.schema.json` extends a canonical `summaries/<kind>.schema.json` via `$ref`; `sm record` detects the signal from the schema and upserts the validated report into `state_summaries`. The kernel AJV now registers the `summaries/*` schemas so report schemas can reference them.

- The job lifecycle gains a normative disable cascade (`job-lifecycle.md` §Cancellation): disabling an extension also cancels its `queued` jobs through the same primitive as `sm jobs cancel`, one `job.cancelled` event per affected id plus one aggregated operations-log line; `running` jobs stay untouched and re-enabling resurrects nothing. `cli-contract.md` documents the cascade on `sm plugins disable` and the three `PATCH /api/plugins` toggle routes.

- The `sm doctor` contract section now pins the error-level vs warning split (DB corruption and missing job-content rows are the two error-level findings) and the `--json` envelope: `{ ok, kind: 'doctor', checks[] }` with one `{ id, status, message }` entry per check over the closed eight-check id vocabulary.

- Schema-drift hygiene for non-drift-owning verbs: read verbs whose query fails because of drift now surface the clean drift advisory (exit 2, naming `sm scan` as the remedy) instead of a raw SQL error, and every row-mutating verb (the `sm job` family, `sm record`, `sm findings prune`, `sm refresh`, `sm plugins trust` / `enable` / `disable`, `sm orphans reconcile` / `undo-rename`) refuses cleanly on drift BEFORE loading the plugin runtime, instead of misleading symptoms like `extension not found`.

  ## User-facing

  When skill-map's local cache predates an upgrade, commands now tell you exactly that and how to fix it (`sm scan`), instead of crashing with a database error or claiming an extension does not exist.

- Two conformance cases lock the dual-mode dispatch contract: `extension-mode-routing` (a probabilistic Action submitted via `sm job submit` lands as a queued `state_jobs` row, asserted through `sm job list --json`) and `extension-mode-routing-deterministic` (a deterministic Action is refused with exit 2 and the in-process advisory). Coverage row for `job.schema.json` moves to partial.

- Suppressed-judgment advisory on finder submits: `sm jobs submit` over a node whose `.sm` sidecar suppresses the finder's judgment (a standing `sm findings dismiss`) now warns on stderr, naming the suppressed types, before the agent pass is spent, and queues anyway (the kernel safety lane is never suppressed, and a finder may emit types the suppression does not cover). Human mode only; the `--json` stdout contract is unchanged (`spec/job-lifecycle.md` §Submit).

  ## User-facing

  Queuing an analysis on a file where you already dismissed that finding now warns you upfront that the result will be dropped, so you can skip the run instead of paying for it.

- The finding state `declined` is renamed `human-decision` (Decision #143): it is a fixer's proposal awaiting the author's choice, not a dead-end. A `fixed` finding now records who decided it via `resolution_actor` (`human` / `fixer`): any user interaction is `human`, only a zero-interaction autonomous fix is `fixer`. The fixer report's `resolved[]` entry declares `state` plus `by` when fixed, and a new `sm findings resolve <id>` verb lets the operator mark a finding fixed-by-human directly.

  ## User-facing

  Findings a fix could not settle now read `human-decision` (your call), not "declined". Fixed findings show whether you or the agent decided them, and `sm findings resolve <id>` lets you mark one handled yourself.

- Findings gain a lifecycle state (Decision #142): a fixer puts a finding into `fixed` or `declined` (the report's `resolved[]` declares `state`, not an `applied` boolean). A `fixed` finding hides from the default `sm findings` view, marked with the fixer that handled it, and stays re-checkable (re-running the finder verifies and closes it); `declined` stays visible as the author's decision. The exclusion line reports `fixed` and `stale` counts separately, and `--fixed` reveals the fixed rows.

  ## User-facing

  Once a fix runs, that finding moves to a `fixed` state and drops out of your default `sm findings` list (see it with `--fixed`), instead of lingering as if still open. Re-run the finder to confirm it is really gone.

- Fixer jobs can target a finding subset: `sm jobs submit --finding <id>` (BFF `findingIds`) freezes the ids on the job, the injection narrows to them, and the supersede/duplicate/running gates become overlap-scoped; `fixerBusy` joins the prob-extensions wire. Finding resolution adds a row-grain `dismissed` state via `sm findings dismiss` (`--class` keeps the sidecar suppression) and a new `sm findings reopen` verb plus BFF routes; five optimization finder/fixer pairs ship experimental.

  ## User-facing

  **Finer-grained finding control.** Fixing or dismissing one finding now affects only that finding (dismissing a whole kind stays available in the CLI), fix buttons no longer flicker while a fix starts, and `sm findings reopen` undoes a dismissal.

- `sm findings` grows three verb rows in the CLI contract (`clear` for wholesale deletion, `suppressions`, `undismiss`), dismiss is respecified as a read-time suppression lens sourced from the write-through annotations mirror (db-schema read rule, eraser list, single-node self-heal), finder submits auto-undismiss the suppressed class (job-lifecycle), and the findings REST envelope requires the new `dismissedExcluded` count.

- Two findings additions (Decision #144). `sm findings dismiss <id>` silences a finding the operator judged acceptable by writing a durable `annotations.suppressions` entry to the node's `.sm` sidecar (keyed by extension + type); the finder's record path then drops matching findings so the judgment stays silenced across re-runs, unlike a row a re-scan erases. And the finder-to-fixer chain can run automatically via the opt-in `core/auto-fix` hook (ships disabled) on `job.completed`.

  ## User-facing

  `sm findings dismiss <id>` permanently silences a finding you have decided is fine (it stays gone across re-scans, recorded in the file's `.sm` sidecar). Enable the new `core/auto-fix` plugin to have fixers run automatically after their finder.

- The findings REST envelope honesty counts reduce to the `dismissedExcluded` / `fixedExcluded` pair (stale rows now ride `items` inline, flagged per row, with `?stale=1` demoted to a narrowing filter), the serve route table adds `DELETE /api/nodes/:pathB64/findings/:id` (per-row hard delete that also lifts a last-row suppression), the activity summary gains `runNodes` (persistent-run node list), and `annotation-stale` emits card contributions only, no issue (conformance case updated).

- Semantic capabilities ship as extensions, not verbs (Decision #137): the planned LLM-verb set is dropped and `sm findings` becomes the generic reader of the new `state_findings` table. Probabilistic Analyzers (finders) share the job queue via `prompt.md` plus a report schema extending the new canonical `findings/report.schema.json`; `sm record` routes analyzer reports to findings and derives safety rows from any probabilistic report. `state_jobs` renames `action_id` to `extension_id`.

- `sm findings` no longer reports a clean node while hiding stale judgments. The default filter excludes stale rows, but the empty result printed a bare `No findings` with a success glyph, which reads as "nothing was found" when the finders had in fact judged the node and an edit merely aged their verdicts. Human mode now says `No fresh findings` plus the hidden count and its remedy, listings footer the hidden count, and `--json` carries `staleExcluded`.

  ## User-facing

  `sm findings` used to say "No findings" after you edited a file, hiding results that were merely outdated. It now tells you how many are hidden and how to see them (`--stale`) or refresh them.

- Fixer findings injection (Decision #141) plus the first fixer `core/ai-redundancy-action`. Submitting a probabilistic Action that declares `precondition.analyzerIds` now injects the node's non-stale matching findings into a `## Findings to resolve` section of the rendered job (folded into `promptTemplateHash`), and refuses when the node has none. `core/ai-redundancy-action` (stable) resolves `core/ai-redundancy-analyzer` findings via a template-mandated file edit.

  ## User-facing

  New fix-it jobs: after an AI review flags issues, queue a matching fixer (like `core/ai-redundancy-action` for repetition) and the draining agent edits the file to resolve exactly what was flagged.

- A fixer submit now SUPERSEDES a stale queued sibling: when a queued job exists for the same fixer and node but with a different rendered content (the findings or body changed), the old job is cancelled and the new one enqueued in one transaction, instead of both sitting in the queue and wasting an agent pass on findings already resolved. An identical submit keeps the duplicate refusal, and a running job is never superseded.

  ## User-facing

  Re-queueing a fix for a file no longer piles up outdated fix jobs: the newer one replaces the stale queued one automatically. Jobs an agent is already working on are left alone.

- A fixer's outcome now rides the finding it addressed. `state_findings` gains four `resolution*` columns; injected findings carry their `id`, the fixer echoes it back per `resolved[]` entry, and `sm record` stamps the claim onto the matching row in the record transaction, scoped to the job's node and the fixer's `analyzerIds`. `sm findings` and `sm show` render it: `applied` as an unverified claim, `declined` with its note, and the stale excluded-count line names hidden declined rows.

  ## User-facing

  A fixer's outcome now travels with the finding: see which ones it says it fixed, and, crucially, which it refused and why. Its "you need to decide this" note is no longer lost, `sm findings` names those rows even when they are hidden.

- Fixer selection is now open-findings-only: `selectFixerFindings` filters to `resolution IS NULL`, so a `fixed` or `human-decision` row no longer feeds a fixer submit, its injection, or the inspector's `findingCount` / launcher visibility (a resolved judgment is decided, not "to resolve"). Stale-but-open rows still ride flagged as before. Fixes the launcher showing a `(1)` count on a node the operator already corrected (`spec/job-lifecycle.md` §Findings injection, Selection).

  ## User-facing

  A fix action no longer counts findings you already resolved: the number beside a fixer button now reflects only what still needs fixing.

- Fixers no longer refuse a node whose findings merely went stale. Staleness is node-level, so any fix stales every finding on the node, including ones about untouched sections whose defects are still present; excluding them discarded valid judgments and forced a re-detection between fixes. The injection now includes stale findings flagged `stale: true`, the agent verifies each against the current body and declines what no longer applies, and submit refuses only when no matching findings exist.

  ## User-facing

  You can now queue every fixer for a file in a row: fixing one issue no longer blocks the rest with "no findings to resolve". Agents check each older finding against the current text and skip the ones already gone.

- The Action manifest's `precondition` gains a `frontmatterMissing` gate (the action applies only while the node's frontmatter is missing at least one listed field), and the `node.prob-extensions` envelope now carries a third `issueFixers` bucket (`IssueFixerEntry`) for probabilistic Actions whose `analyzerIds` resolve to a deterministic analyzer; the `standalone` bucket no longer lists them.

- Identifier agreement reworked in `architecture.md`: every built-in kind now declares `identifierMismatch: 'warn'` (a node answering to two names is ambiguity worth a warning even where the runtime documents the override as legal), while the `info` tier stays in the enum for external providers. The `core/contribution-orphan` bullet is gone from the analyzer catalog and `IAnalyzerContext.viewContributions` is now described as a generic context surface.

- Step 16 piece 1, the inspector findings workbench: three BFF endpoints (`GET /api/nodes/:pathB64/findings` with honesty counts, `GET .../prob-extensions` classifying finder / fixer / standalone launchers, `POST .../jobs` via the same submit engine as the CLI, extracted to `core/jobs/submit-engine.ts`), three new REST envelope kinds, and the inspector "Judgments" card: fresh findings with provenance plus launcher buttons (fixers appear only when a matching finding exists).

  ## User-facing

  The node inspector now shows the AI findings for the file and lets you run analyzers from buttons: detectors are always available, and fix actions appear only when there is a finding for them to resolve. Queued work still runs through your own agent.

- Add a distinct `cancelled` terminal job state and a symmetric `sm job fail` verb. `sm job cancel` now moves a queued/running job to `cancelled` (no `failureReason`) instead of `failed`, while `sm job fail` forces `failed` with reason `user-failed`, which replaces the removed `user-cancelled` value across the job, execution-record, history-stats, and db-schema enums. Adds `jobs.retention.cancelled` (default 30d) and documents the three write-side schema-drift response modes in `db-schema.md`.

- Rendered job content becomes self-contained (Decision #138): the submit render inlines the report contract verbatim after the extension template (the extension's `report.schema.json` plus the canonical envelope chain), hashed into `promptTemplateHash`, so a draining agent learns the exact output shape, enums included, without disk access. Alongside, `sm findings prune` deletes stale findings rows on demand (destructive-verb pattern with `--dry-run` / `--yes`).

  ## User-facing

  Queued jobs now carry their exact answer format inside the prompt, so agents draining your queue stop guessing (and failing) on report fields. New `sm findings prune` clears out findings that refer to file versions you have since edited.

- Live job-transition push: every job-transitioning CLI verb (`sm jobs submit` / `claim` / `cancel` / `fail`, `sm record`) now pushes its event envelope to the running server (`POST /api/job-events`, discovered and token-authenticated via `serve.json`, best-effort fire-and-forget), which rebroadcasts it verbatim over `/ws`. The catalog gains `job.submitted` / `job.cancelled` and the `queue` runId mode; the BFF submit route's broadcast uses the same canonical envelope.

  ## User-facing

  The inspector now updates the moment your agent picks up or finishes a job: state changes made from the terminal show up live in the browser without reloading.

- `sm jobs claim` gains `--wait`: on an empty queue it blocks, re-reaping and re-claiming every `--interval` seconds (flag -> `jobs.claimWaitSeconds` config -> default 2) until a job is claimable, instead of exiting 1; `--timeout <seconds>` bounds the wait. The `sm-process-jobs` skill gains a resident watch mode that arms the blocking claim and processes each job as it arrives. Progress stays on stderr, so the `--json` handover is byte-unchanged.

  ## User-facing

  Leave your agent watching the queue: `sm jobs claim --wait` waits for the next job instead of stopping when the queue is empty, so it wakes up only when there is work. Set how often it checks with `--interval` seconds, or the `jobs.claimWaitSeconds` setting.

- Processing-agent gate on `sm jobs submit`: with no `sm-process-jobs` skill installed under any Provider destination, the submit now refuses (exit 2) with an advisory explaining the pull-only mechanism and the remedy (`sm agent install`), instead of enqueuing work nothing will ever claim. An installed-but-outdated skill passes with a refresh advisory; the auto-fix hook's internal fixer submits bypass the gate. New conformance case `jobs-submit-agent-gate`.

  ## User-facing

  Submitting an analysis job now checks that an agent is actually set up to run it: if you never ran `sm agent install`, the submit stops and tells you how the queue works instead of leaving the job waiting forever.

- The inspector's AI-actions launcher gains a Stop control for an active job: `POST /api/jobs/:jobId/cancel` moves a queued/running job to `cancelled` through the same transition as `sm jobs cancel`, broadcasts the canonical `job.cancelled` envelope, and answers 204 (409 `job-terminal` on an already-closed job). Each prob-extension entry now carries the active `jobId`. This resolves the zombie case (a killed agent holding a claim) without dropping to the CLI, no global TTL needed.

  ## User-facing

  You can now stop a running or queued analysis from the inspector: a killed or stuck agent's job no longer sits there forever, one click cancels it.

- `sm record --model <name>` is now persisted instead of dropped: the agent's self-declared model id lands on `state_executions.model` and is denormalized onto the `state_findings.model` / `state_summaries.model` rows the same record writes, so every probabilistic analysis answers "which model, when" without joins. `sm findings` renders it alongside the confidence, and the drain skill instructs agents to declare it.

  ## User-facing

  Analyses now remember which AI model produced them: agents report their model when closing a job, and `sm findings` / `sm show` display it next to each result together with its date.

- Model A provenance enrichment lands in the contract: Actions gain the declared `io: ['network']` purity carve-out (injected `ctx.fetch`, gated by the new committed `allowNetworkActions` policy, default false), `sm refresh` executes enrichment Actions in-process with an `enrichments/` write-through convention mirroring the summaries one, and `enrichments/github.schema.json` pins the verification report shape (`verified`, `method: raw-sha | api-ref`, `resolvedSha`, body-hash comparison fields).

- First built-in finder Analyzer: `core/ai-redundancy-analyzer` (probabilistic, stable, enabled by default) judges a node for internal redundancy through the job queue and lands `type: redundancy` rows in `state_findings`; its report schema narrows the finding type so the finder can only emit its own judgment. The spec gains the `findings-contract` / `findings-contract-kind` conformance pair covering the rendered findings-envelope report contract and the frozen `extensionKind: analyzer` job row.

  ## User-facing

  New AI review that flags repeated instructions inside a file, on by default: queue it with `sm job submit ai-redundancy-analyzer` and read the judgments with `sm findings`.

- New `cli-contract.md` §Operations log: every mutating operation appends one JSONL line to the gitignored `.skill-map/operations.log` (`{at, op, target, extension?, channel, outcome, id?/detail?}`), fire-and-forget, silent without a `.skill-map/` directory, single-generation 1 MiB rotation. The REST envelope schema's value-envelope variant gains the `config.resolution` kind backing the new `GET /api/config/resolution` route.

- Jobs never expire by default (Decision #139): an interactive drain can hold a claim while its user deliberates. `state_jobs.ttl_seconds` is nullable; expiry arms only from explicit operator sources (`--ttl`, with `0` disarming, `jobs.perExtensionTtl`, or the global opt-in `jobs.ttlSeconds`), the estimate-driven grace formula and its `graceMultiplier` / `minimumTtlSeconds` config keys are retired, and the new `jobs-overdue` doctor check advises on long-running TTL-less jobs.

  ## User-facing

  Queued jobs no longer time out on their own, so an agent can pause mid-job and ask you how to proceed without losing the work. Set `--ttl` (or the `jobs.ttlSeconds` setting) if you want expiring jobs back; `sm doctor` now flags jobs running far longer than expected.

- Enable/disable now applies a pair toggle over Modelo B edges: enabling a fixer action also enables the analyzer(s) in its `precondition.analyzerIds` (and vice versa), and disabling is reference-counted, so a companion falls only when its last enabled edge partner goes down. Covers `sm plugins enable / disable` and the `PATCH /api/plugins*` routes (bulk form keeps explicit-wins semantics). Normative wording in `plugin-author-guide.md` §Paired extensions.

  ## User-facing

  **Reviews and their fixes now switch together.** Turning on a fix also turns on the review that feeds it, and turning off a review turns off its fix unless another review still uses it. No more half-armed pairs after toggling one side in the Settings panel or the CLI.

- `sm plugins show <plugin>/<ext>` now renders a probabilistic extension's two contract files inline: the verbatim `prompt.md` template under a Prompt section and the pretty-printed `report.schema.json` under a Report schema section (`--json` gains `promptTemplate` / `reportSchema`). The prompt is the extension's essence under the forms model, so the inspector surfaces it without disk spelunking.

  ## User-facing

  `sm plugins show` now displays the full prompt and answer format of any LLM-backed extension, so you can read exactly what a queued job will ask an agent to do before submitting anything.

- Lands the deferred `preamble-bitwise-match` conformance case: a `ai-summarizer-action` job submitted over a scanned markdown node must render content containing `preamble-v1.txt` byte-for-byte, read back via `sm job preview --last`. The case format grows `setup.priorInvokes` (ordered staging invocations that must exit 0, run after the fixture copy) and the `stdout-contains-verbatim` assertion; the CLI contract adds the `--last` selector to `sm job preview`.

- Preamble v2 (Decision #140): rule 4 now permits file edits ONLY when the extension template explicitly directs an edit as the job's purpose (unblocking fixer Actions; code execution and URL fetching stay absolutely forbidden, user-content can never mandate anything), the wording moves from "runs actions" to "prepares analysis jobs" with "extension" throughout, and the closing line names the Report contract section. Conformance fixture recut as `preamble-v2.txt`; every job re-keys.

  ## User-facing

  The safety instructions inside every queued job got a v2: agents may now edit files when a job's own instructions say so (never because of file content), which enables upcoming fix-it jobs.

- The queue is pull-only: skill-map never invokes an agent. `RunnerPort` leaves the architecture (§Execution handover: external agents drain via `sm job claim` + `sm record`), the `sm job run` verbs leave the contract, the `runner` enum becomes `agent | in-process`, reap moves to the start of every claim, and the job-events catalog prunes the spawn-path events, with `sm record --json`'s synthetic `r-ext-` envelope as the canonical emission.

- Two internal spec contradictions reconciled. `interfaces/security-scanner.md` is rewritten over the findings pipeline: scanners are finder Analyzers extending the findings envelope (categories become finding `type` slugs, stable cross-run ids retired, kernel safety slugs reserved). And the architecture mode matrix now matches the schemas and runtime: Action `mode` is optional, defaulting to `deterministic`; a probabilistic Action missing `mode` still fails at load via the `prompt.md` rule.

- `core/ai-summarizer-action` graduates from experimental back to stable / enabled by default now that its UI surface landed: a new `GET /api/nodes/:pathB64/summary` route (spec route-table row, direct shape) serves the node's stored summaries with per-row staleness, and the inspector header gains a sparkles button that queues the summarizer and expands the analysis (subject, key facts, quality notes, confidence, stale mark, re-run) under the identity strip.

  ## User-facing

  **Analyze any file from its header.** A magic button next to the file's title runs an AI analysis; when it finishes (or the file already has one) the header shows what the file covers, key facts and quality notes. Outdated analyses are marked and can be re-run in one click.

- Summarizer Actions (report schema extends `summaries/<kind>`) drive a `state_summaries` write-through when `sm record` closes a completed job, shown by `sm show` with a `(stale)` marker. Tightens the `</user-content>` escaping to be case/whitespace-insensitive, adds a submit-time body-hash drift check refusing stale bytes, hides the `nonce` from `job list`/`show --json`, has read verbs advise not refuse on schema drift, and reconciles the `sm record` exit codes (2 = not running, 5 = not found).

- New canonical tagger-report schema `tags/markdown.schema.json` (1-8 lowercase kebab-case topical tags) plus the `job-lifecycle.md` §Tags write-through contract (record-side union merge into sidecar `annotations.tags`, standing `.sm` consent only, storage-rule delegated-curation carve-out), and enabled-gate wording: `POST /api/actions/:id` answers 404 for a disabled Action, `sm bump` refuses while `core/node-bump` is disabled, and boot/shutdown hook dispatch honours the enabled toggle.

- The inspector's AI-actions launcher becomes two-state finder buttons plus an Automatic toggle: a finder with a matching fixer is ONE button that morphs Detect ⇄ Fix by the node's open findings (the fixers row is retired), and the toggle makes it one-click detect+fix. Backing it, a per-job `autoFix` flag frozen at submit (`--auto-fix`, POST body, or toggle) chains all matching fixers at record. `prob-extensions` reshapes to `{ finders, standalone }` with `fixerIds` + `hasOpenFindings`.

  ## User-facing

  Each analysis button in the inspector now detects, then turns into its fix once something is found, so there is one button instead of two. Flip the Automatic toggle to make it detect and fix in a single click.

- The summarizer is universal: the per-kind summary schemas (`summaries/{skill,agent,command,hook}.schema.json`) are removed and `summaries/markdown.schema.json` becomes the single canonical node-summary shape (`markdown` names the body format every node shares, not the node kind). The summarizer detection convention in `job-lifecycle.md` §Record is now "report schema extends a schema under `summaries/`"; per-kind summarizers are dropped from the plan.

- The collection verb namespaces go plural (breaking, pre-1.0): `sm job` becomes `sm jobs` and `sm sidecar` becomes `sm sidecars`, aligning them with `plugins` / `actions` / `findings` under one rule (a browsed collection is plural). No singular alias. The queue-processing concept renames from "drain" to "process", and the agent skill is renamed `sm-run-queue` to `sm-process-jobs`.

  ## User-facing

  `sm job ...` is now `sm jobs ...` and `sm sidecar ...` is `sm sidecars ...` (no old aliases, update scripts). The queue-processing skill is renamed `sm-process-jobs`; run `sm agent install` to get it.

- The `inspector.action.button` payload gains an optional `surface` enum (`version` | `stability` | `tags`) plus the `view-slots.md` §Re-homed surfaces contract: a payload declaring a surface IS the named UI surface instead of a generic Actions button, the UI selects it by this declaration and dispatches the payload's `actionId` (never matching extension ids), and when several contributions claim one surface the first by priority order wins.

### Patch Changes

- Schema-drift advisories now point at `sm scan` alone: scan is a drift-owning verb that deletes and recreates the drifted DB by itself, so the previously prescribed `sm db reset --hard` first step was a redundant detour for the same outcome. The write-refusal, read-failure, and read-warn advisories all drop it (`spec/db-schema.md` §Schema drift).

  ## User-facing

  When your project database is outdated after an upgrade, the error now just says to run `sm scan` (which rebuilds it in one step) instead of a two-command sequence.

- The `sm findings` bucket flags become filters: `--fixed` now shows ONLY the fixed rows and `--stale` ONLY the stale ones (their union when combined), instead of appending the hidden bucket to the default listing. The excluded-count reporting stays a default-view-only honesty device; an explicit bucket filter is the operator's own narrowing, like `--type`.

  ## User-facing

  `sm findings --fixed` now lists just the fixed findings (and `--stale` just the stale ones) instead of mixing them into the full list, so reviewing what a fixer did no longer means scrolling past everything else.

- `sm findings` human output now prefixes each finding row with its numeric id (right-aligned per node section so the severity glyphs stay in one column), the handle you pass to `sm findings resolve <id>`. Previously the id showed only in `--json`, forcing a jq/grep detour to act on a finding.

  ## User-facing

  `sm findings` now shows each finding's id at the start of its row, so you can pass it straight to `sm findings resolve <id>` without digging through `--json`.

- Correct the job `contentHash` formula to include `node.path` and NUL-delimit its inputs. The rendered content embeds `node.path` via `<user-content id>`, so the previous formula (which omitted it) let two nodes with identical body and frontmatter share one content row while rendering different text, breaking the "same hash, same content" invariant. Also clarify that `--force` bypasses the duplicate pre-check but never the unique partial index, so it only re-runs terminal jobs.

## 0.81.0-rc.2

### Minor Changes

- Fixer jobs can target a finding subset: `sm jobs submit --finding <id>` (BFF `findingIds`) freezes the ids on the job, the injection narrows to them, and the supersede/duplicate/running gates become overlap-scoped; `fixerBusy` joins the prob-extensions wire. Finding resolution adds a row-grain `dismissed` state via `sm findings dismiss` (`--class` keeps the sidecar suppression) and a new `sm findings reopen` verb plus BFF routes; five optimization finder/fixer pairs ship experimental.

  ## User-facing

  **Finer-grained finding control.** Fixing or dismissing one finding now affects only that finding (dismissing a whole kind stays available in the CLI), fix buttons no longer flicker while a fix starts, and `sm findings reopen` undoes a dismissal.

- The Action manifest's `precondition` gains a `frontmatterMissing` gate (the action applies only while the node's frontmatter is missing at least one listed field), and the `node.prob-extensions` envelope now carries a third `issueFixers` bucket (`IssueFixerEntry`) for probabilistic Actions whose `analyzerIds` resolve to a deterministic analyzer; the `standalone` bucket no longer lists them.

- Identifier agreement reworked in `architecture.md`: every built-in kind now declares `identifierMismatch: 'warn'` (a node answering to two names is ambiguity worth a warning even where the runtime documents the override as legal), while the `info` tier stays in the enum for external providers. The `core/contribution-orphan` bullet is gone from the analyzer catalog and `IAnalyzerContext.viewContributions` is now described as a generic context surface.

- Enable/disable now applies a pair toggle over Modelo B edges: enabling a fixer action also enables the analyzer(s) in its `precondition.analyzerIds` (and vice versa), and disabling is reference-counted, so a companion falls only when its last enabled edge partner goes down. Covers `sm plugins enable / disable` and the `PATCH /api/plugins*` routes (bulk form keeps explicit-wins semantics). Normative wording in `plugin-author-guide.md` §Paired extensions.

  ## User-facing

  **Reviews and their fixes now switch together.** Turning on a fix also turns on the review that feeds it, and turning off a review turns off its fix unless another review still uses it. No more half-armed pairs after toggling one side in the Settings panel or the CLI.

- The `inspector.action.button` payload gains an optional `surface` enum (`version` | `stability` | `tags`) plus the `view-slots.md` §Re-homed surfaces contract: a payload declaring a surface IS the named UI surface instead of a generic Actions button, the UI selects it by this declaration and dispatches the payload's `actionId` (never matching extension ids), and when several contributions claim one surface the first by priority order wins.

## 0.81.0-rc.1

### Minor Changes

- Extensions gain an optional `defaultEnabled` manifest field that overrides the stability-derived installed default; the bump contract now accepts a versionless fresh sidecar and stamps `version: 1` (only a fresh sidecar already carrying a version refuses); summaries get a normative `DELETE /api/nodes/:pathB64/summary` route; the auto-fix hook leaves the normative narrative; and a new architecture §Storage rule seals machine output to the DB vs human curation to the `.sm` sidecar.

- The job lifecycle gains a normative disable cascade (`job-lifecycle.md` §Cancellation): disabling an extension also cancels its `queued` jobs through the same primitive as `sm jobs cancel`, one `job.cancelled` event per affected id plus one aggregated operations-log line; `running` jobs stay untouched and re-enabling resurrects nothing. `cli-contract.md` documents the cascade on `sm plugins disable` and the three `PATCH /api/plugins` toggle routes.

- New `cli-contract.md` §Operations log: every mutating operation appends one JSONL line to the gitignored `.skill-map/operations.log` (`{at, op, target, extension?, channel, outcome, id?/detail?}`), fire-and-forget, silent without a `.skill-map/` directory, single-generation 1 MiB rotation. The REST envelope schema's value-envelope variant gains the `config.resolution` kind backing the new `GET /api/config/resolution` route.

- `core/ai-summarizer-action` graduates from experimental back to stable / enabled by default now that its UI surface landed: a new `GET /api/nodes/:pathB64/summary` route (spec route-table row, direct shape) serves the node's stored summaries with per-row staleness, and the inspector header gains a sparkles button that queues the summarizer and expands the analysis (subject, key facts, quality notes, confidence, stale mark, re-run) under the identity strip.

  ## User-facing

  **Analyze any file from its header.** A magic button next to the file's title runs an AI analysis; when it finishes (or the file already has one) the header shows what the file covers, key facts and quality notes. Outdated analyses are marked and can be re-run in one click.

- New canonical tagger-report schema `tags/markdown.schema.json` (1-8 lowercase kebab-case topical tags) plus the `job-lifecycle.md` §Tags write-through contract (record-side union merge into sidecar `annotations.tags`, standing `.sm` consent only, storage-rule delegated-curation carve-out), and enabled-gate wording: `POST /api/actions/:id` answers 404 for a disabled Action, `sm bump` refuses while `core/node-bump` is disabled, and boot/shutdown hook dispatch honours the enabled toggle.

## 0.81.0-rc.0

### Minor Changes

- The per-node Activity section tightens retention: the runtime recent-executions ring and the AI-run history each cap at 15 (was 20), and the conversation view renders at most 10 threads per node. `spec/provider-activity.md` lowers the normative `runs` cap to 15. AI-run rows now show the full qualified extension id and surface a run status only when it deviates from `completed` (failed and cancelled runs show their state).

  ## User-facing

  **Leaner Activity timeline.** Each node keeps its 15 most recent runs and up to 10 conversations. AI-run rows now show each run's full name and only flag its status when it failed or was cancelled.

- The inspector's Activity section interleaves two provenances: live runtime activity and skill-map's own AI-run history from `state_executions` (persistent). `GET /api/activity/node/:pathB64` gains a lean `runs` array (newest-first, capped 20; no report/nonce). The two are distinguished behind a three-way filter (all / runtime / AI runs) persisted at inspector level; the old Executions/Last-start/Contexts/Totals stat grid was dropped.

  ## User-facing

  The inspector's Activity panel now shows a combined timeline of live agent activity and skill-map's own analysis runs, with a filter to focus on either.

- The CLI contract gains §Agent drain skill: `sm agent install / uninstall / status` materialise the canonical, CLI-versioned `sm-run-queue` skill into the active lens's `scaffold.skillDir`, teaching any agent runtime the claim → execute → record drain protocol (byte-exact staleness probe, idempotent reinstall, no separate package and no network fetch).

- The HTTP API gains the agent-drain-skill install surface, mirroring the activity-hooks endpoints: `GET /api/agent/install?provider=` (status probe with `supported` / `installed` / `stale`, the fields behind the UI button's Install / Update / Up to date states), and the 412-consent-gated `POST /api/agent/install` (three-state `outcome`) and `POST /api/agent/uninstall` (`removed`). The materialised skill folder is a bundled ignore default: skill-map infrastructure never surfaces as a node.

- The node card's aggregate `warn` / `error` severity chips now sum both provenances: deterministic issues PLUS a node's unresolved, non-stale findings (open + `human-decision`). `issue-counter` and `sm scan` are unchanged; the findings are added at read time by the BFF node decoration under issue-counter's own chip ids, with a provenance-breakdown tooltip, on every endpoint that embeds contributions (`/api/nodes`, `/api/scan`, `/api/branch`).

  ## User-facing

  A node's error/warning count on the map card now includes its AI findings, not just deterministic issues, so a node flagged only by an analysis run still shows a count. Hover the chip to see the split.

- New built-in fixer `core/ai-reference-action` (stable, enabled by default), the first fixer for a DETERMINISTIC analyzer: it repairs broken reference links that `core/reference-broken` flagged by injecting that analyzer's Issues (`scan_issues`) into a `## Issues to resolve` job section keyed on the broken target. The agent repoints each link at its real in-project target, asking permission before searching outside the project; the inspector button shows only on nodes with such Issues.

  ## User-facing

  New fix-it job for broken links: after a scan flags a broken reference, queue `core/ai-reference-action` and the agent repoints the link to where the file actually lives in your project (asking first before it looks outside the project).

- Three inspector AI-actions fixes. The two-state finder button reflects its FIXER's job: `prob-extensions` computes `state` / `jobId` over `{finder} ∪ fixerIds`, so clicking Fix shows queued/running, not nothing. A plugin toggled mid-session is honored without restarting `sm serve`: the launcher and submit endpoints re-read the enabled set per request via a fresh resolver (drop-ins that booted disabled still need a restart). And the Automatic toggle is relabelled "Auto-fixer".

  ## User-facing

  Clicking a finder's Fix now shows the fixer running instead of looking like nothing happened; enabling AI-action plugins takes effect without restarting the server; and the auto toggle is now labelled "Auto-fixer".

- The `core/annotation-stale` drift analyzer graduates from experimental to stable, so a default scan now surfaces sidecar (`.sm`) drift out of the box as an `info` issue; its read-only detection is safe on by default while the companion writer `core/node-bump` stays experimental (opt-in), decoupling the former bump pair. The `sidecar-end-to-end` conformance case now expects the extra issue, and the inspector drops the `never bumped` audit empty-state.

  ## User-facing

  **Drift shows out of the box.** Scans now flag when a skill's `.sm` sidecar has fallen out of sync with its `.md`, no need to enable anything first. The inspector's Metadata section also drops the old `never bumped` line.

- Add `POST /api/jobs/cancel-all` and `POST /api/jobs/prune[?status=]`, the bulk write endpoints behind the queue inspector toolbar. cancel-all moves every queued/running job to terminal cancelled and broadcasts one `job.cancelled` per id; prune deletes terminal jobs immediately (all terminal states, or just one via `?status=completed|failed|cancelled`) as a silent GC with no WS event. A non-terminal or unknown status returns `400 bad-query`. Additive; route rows land in `cli-contract.md`.

- Add `GET /api/jobs?status=&extension=&node=`, the cross-corpus job-queue list read endpoint (HTTP face of `sm jobs list`), plus a new registry-less `kind: 'jobs'` list variant in the REST envelope schema. Each row is a public `Job` projection carrying every field except the `nonce`, all three filters are optional, and an unknown `status` value returns `400 bad-query`. Additive API surface; a route row lands in `cli-contract.md`.

- Removes the `writesSummary` flag from the Action contract. An Action is now a summarizer iff its `report.schema.json` extends a canonical `summaries/<kind>.schema.json` via `$ref`; `sm record` detects the signal from the schema and upserts the validated report into `state_summaries`. The kernel AJV now registers the `summaries/*` schemas so report schemas can reference them.

- The `sm doctor` contract section now pins the error-level vs warning split (DB corruption and missing job-content rows are the two error-level findings) and the `--json` envelope: `{ ok, kind: 'doctor', checks[] }` with one `{ id, status, message }` entry per check over the closed eight-check id vocabulary.

- Schema-drift hygiene for non-drift-owning verbs: read verbs whose query fails because of drift now surface the clean drift advisory (exit 2, naming `sm scan` as the remedy) instead of a raw SQL error, and every row-mutating verb (the `sm job` family, `sm record`, `sm findings prune`, `sm refresh`, `sm plugins trust` / `enable` / `disable`, `sm orphans reconcile` / `undo-rename`) refuses cleanly on drift BEFORE loading the plugin runtime, instead of misleading symptoms like `extension not found`.

  ## User-facing

  When skill-map's local cache predates an upgrade, commands now tell you exactly that and how to fix it (`sm scan`), instead of crashing with a database error or claiming an extension does not exist.

- Two conformance cases lock the dual-mode dispatch contract: `extension-mode-routing` (a probabilistic Action submitted via `sm job submit` lands as a queued `state_jobs` row, asserted through `sm job list --json`) and `extension-mode-routing-deterministic` (a deterministic Action is refused with exit 2 and the in-process advisory). Coverage row for `job.schema.json` moves to partial.

- Suppressed-judgment advisory on finder submits: `sm jobs submit` over a node whose `.sm` sidecar suppresses the finder's judgment (a standing `sm findings dismiss`) now warns on stderr, naming the suppressed types, before the agent pass is spent, and queues anyway (the kernel safety lane is never suppressed, and a finder may emit types the suppression does not cover). Human mode only; the `--json` stdout contract is unchanged (`spec/job-lifecycle.md` §Submit).

  ## User-facing

  Queuing an analysis on a file where you already dismissed that finding now warns you upfront that the result will be dropped, so you can skip the run instead of paying for it.

- The finding state `declined` is renamed `human-decision` (Decision #143): it is a fixer's proposal awaiting the author's choice, not a dead-end. A `fixed` finding now records who decided it via `resolution_actor` (`human` / `fixer`): any user interaction is `human`, only a zero-interaction autonomous fix is `fixer`. The fixer report's `resolved[]` entry declares `state` plus `by` when fixed, and a new `sm findings resolve <id>` verb lets the operator mark a finding fixed-by-human directly.

  ## User-facing

  Findings a fix could not settle now read `human-decision` (your call), not "declined". Fixed findings show whether you or the agent decided them, and `sm findings resolve <id>` lets you mark one handled yourself.

- Findings gain a lifecycle state (Decision #142): a fixer puts a finding into `fixed` or `declined` (the report's `resolved[]` declares `state`, not an `applied` boolean). A `fixed` finding hides from the default `sm findings` view, marked with the fixer that handled it, and stays re-checkable (re-running the finder verifies and closes it); `declined` stays visible as the author's decision. The exclusion line reports `fixed` and `stale` counts separately, and `--fixed` reveals the fixed rows.

  ## User-facing

  Once a fix runs, that finding moves to a `fixed` state and drops out of your default `sm findings` list (see it with `--fixed`), instead of lingering as if still open. Re-run the finder to confirm it is really gone.

- `sm findings` grows three verb rows in the CLI contract (`clear` for wholesale deletion, `suppressions`, `undismiss`), dismiss is respecified as a read-time suppression lens sourced from the write-through annotations mirror (db-schema read rule, eraser list, single-node self-heal), finder submits auto-undismiss the suppressed class (job-lifecycle), and the findings REST envelope requires the new `dismissedExcluded` count.

- Two findings additions (Decision #144). `sm findings dismiss <id>` silences a finding the operator judged acceptable by writing a durable `annotations.suppressions` entry to the node's `.sm` sidecar (keyed by extension + type); the finder's record path then drops matching findings so the judgment stays silenced across re-runs, unlike a row a re-scan erases. And the finder-to-fixer chain can run automatically via the opt-in `core/auto-fix` hook (ships disabled) on `job.completed`.

  ## User-facing

  `sm findings dismiss <id>` permanently silences a finding you have decided is fine (it stays gone across re-scans, recorded in the file's `.sm` sidecar). Enable the new `core/auto-fix` plugin to have fixers run automatically after their finder.

- The findings REST envelope honesty counts reduce to the `dismissedExcluded` / `fixedExcluded` pair (stale rows now ride `items` inline, flagged per row, with `?stale=1` demoted to a narrowing filter), the serve route table adds `DELETE /api/nodes/:pathB64/findings/:id` (per-row hard delete that also lifts a last-row suppression), the activity summary gains `runNodes` (persistent-run node list), and `annotation-stale` emits card contributions only, no issue (conformance case updated).

- Semantic capabilities ship as extensions, not verbs (Decision #137): the planned LLM-verb set is dropped and `sm findings` becomes the generic reader of the new `state_findings` table. Probabilistic Analyzers (finders) share the job queue via `prompt.md` plus a report schema extending the new canonical `findings/report.schema.json`; `sm record` routes analyzer reports to findings and derives safety rows from any probabilistic report. `state_jobs` renames `action_id` to `extension_id`.

- `sm findings` no longer reports a clean node while hiding stale judgments. The default filter excludes stale rows, but the empty result printed a bare `No findings` with a success glyph, which reads as "nothing was found" when the finders had in fact judged the node and an edit merely aged their verdicts. Human mode now says `No fresh findings` plus the hidden count and its remedy, listings footer the hidden count, and `--json` carries `staleExcluded`.

  ## User-facing

  `sm findings` used to say "No findings" after you edited a file, hiding results that were merely outdated. It now tells you how many are hidden and how to see them (`--stale`) or refresh them.

- Fixer findings injection (Decision #141) plus the first fixer `core/ai-redundancy-action`. Submitting a probabilistic Action that declares `precondition.analyzerIds` now injects the node's non-stale matching findings into a `## Findings to resolve` section of the rendered job (folded into `promptTemplateHash`), and refuses when the node has none. `core/ai-redundancy-action` (stable) resolves `core/ai-redundancy-analyzer` findings via a template-mandated file edit.

  ## User-facing

  New fix-it jobs: after an AI review flags issues, queue a matching fixer (like `core/ai-redundancy-action` for repetition) and the draining agent edits the file to resolve exactly what was flagged.

- A fixer submit now SUPERSEDES a stale queued sibling: when a queued job exists for the same fixer and node but with a different rendered content (the findings or body changed), the old job is cancelled and the new one enqueued in one transaction, instead of both sitting in the queue and wasting an agent pass on findings already resolved. An identical submit keeps the duplicate refusal, and a running job is never superseded.

  ## User-facing

  Re-queueing a fix for a file no longer piles up outdated fix jobs: the newer one replaces the stale queued one automatically. Jobs an agent is already working on are left alone.

- A fixer's outcome now rides the finding it addressed. `state_findings` gains four `resolution*` columns; injected findings carry their `id`, the fixer echoes it back per `resolved[]` entry, and `sm record` stamps the claim onto the matching row in the record transaction, scoped to the job's node and the fixer's `analyzerIds`. `sm findings` and `sm show` render it: `applied` as an unverified claim, `declined` with its note, and the stale excluded-count line names hidden declined rows.

  ## User-facing

  A fixer's outcome now travels with the finding: see which ones it says it fixed, and, crucially, which it refused and why. Its "you need to decide this" note is no longer lost, `sm findings` names those rows even when they are hidden.

- Fixer selection is now open-findings-only: `selectFixerFindings` filters to `resolution IS NULL`, so a `fixed` or `human-decision` row no longer feeds a fixer submit, its injection, or the inspector's `findingCount` / launcher visibility (a resolved judgment is decided, not "to resolve"). Stale-but-open rows still ride flagged as before. Fixes the launcher showing a `(1)` count on a node the operator already corrected (`spec/job-lifecycle.md` §Findings injection, Selection).

  ## User-facing

  A fix action no longer counts findings you already resolved: the number beside a fixer button now reflects only what still needs fixing.

- Fixers no longer refuse a node whose findings merely went stale. Staleness is node-level, so any fix stales every finding on the node, including ones about untouched sections whose defects are still present; excluding them discarded valid judgments and forced a re-detection between fixes. The injection now includes stale findings flagged `stale: true`, the agent verifies each against the current body and declines what no longer applies, and submit refuses only when no matching findings exist.

  ## User-facing

  You can now queue every fixer for a file in a row: fixing one issue no longer blocks the rest with "no findings to resolve". Agents check each older finding against the current text and skip the ones already gone.

- Step 16 piece 1, the inspector findings workbench: three BFF endpoints (`GET /api/nodes/:pathB64/findings` with honesty counts, `GET .../prob-extensions` classifying finder / fixer / standalone launchers, `POST .../jobs` via the same submit engine as the CLI, extracted to `core/jobs/submit-engine.ts`), three new REST envelope kinds, and the inspector "Judgments" card: fresh findings with provenance plus launcher buttons (fixers appear only when a matching finding exists).

  ## User-facing

  The node inspector now shows the AI findings for the file and lets you run analyzers from buttons: detectors are always available, and fix actions appear only when there is a finding for them to resolve. Queued work still runs through your own agent.

- Add a distinct `cancelled` terminal job state and a symmetric `sm job fail` verb. `sm job cancel` now moves a queued/running job to `cancelled` (no `failureReason`) instead of `failed`, while `sm job fail` forces `failed` with reason `user-failed`, which replaces the removed `user-cancelled` value across the job, execution-record, history-stats, and db-schema enums. Adds `jobs.retention.cancelled` (default 30d) and documents the three write-side schema-drift response modes in `db-schema.md`.

- Rendered job content becomes self-contained (Decision #138): the submit render inlines the report contract verbatim after the extension template (the extension's `report.schema.json` plus the canonical envelope chain), hashed into `promptTemplateHash`, so a draining agent learns the exact output shape, enums included, without disk access. Alongside, `sm findings prune` deletes stale findings rows on demand (destructive-verb pattern with `--dry-run` / `--yes`).

  ## User-facing

  Queued jobs now carry their exact answer format inside the prompt, so agents draining your queue stop guessing (and failing) on report fields. New `sm findings prune` clears out findings that refer to file versions you have since edited.

- Live job-transition push: every job-transitioning CLI verb (`sm jobs submit` / `claim` / `cancel` / `fail`, `sm record`) now pushes its event envelope to the running server (`POST /api/job-events`, discovered and token-authenticated via `serve.json`, best-effort fire-and-forget), which rebroadcasts it verbatim over `/ws`. The catalog gains `job.submitted` / `job.cancelled` and the `queue` runId mode; the BFF submit route's broadcast uses the same canonical envelope.

  ## User-facing

  The inspector now updates the moment your agent picks up or finishes a job: state changes made from the terminal show up live in the browser without reloading.

- `sm jobs claim` gains `--wait`: on an empty queue it blocks, re-reaping and re-claiming every `--interval` seconds (flag -> `jobs.claimWaitSeconds` config -> default 2) until a job is claimable, instead of exiting 1; `--timeout <seconds>` bounds the wait. The `sm-process-jobs` skill gains a resident watch mode that arms the blocking claim and processes each job as it arrives. Progress stays on stderr, so the `--json` handover is byte-unchanged.

  ## User-facing

  Leave your agent watching the queue: `sm jobs claim --wait` waits for the next job instead of stopping when the queue is empty, so it wakes up only when there is work. Set how often it checks with `--interval` seconds, or the `jobs.claimWaitSeconds` setting.

- Processing-agent gate on `sm jobs submit`: with no `sm-process-jobs` skill installed under any Provider destination, the submit now refuses (exit 2) with an advisory explaining the pull-only mechanism and the remedy (`sm agent install`), instead of enqueuing work nothing will ever claim. An installed-but-outdated skill passes with a refresh advisory; the auto-fix hook's internal fixer submits bypass the gate. New conformance case `jobs-submit-agent-gate`.

  ## User-facing

  Submitting an analysis job now checks that an agent is actually set up to run it: if you never ran `sm agent install`, the submit stops and tells you how the queue works instead of leaving the job waiting forever.

- The inspector's AI-actions launcher gains a Stop control for an active job: `POST /api/jobs/:jobId/cancel` moves a queued/running job to `cancelled` through the same transition as `sm jobs cancel`, broadcasts the canonical `job.cancelled` envelope, and answers 204 (409 `job-terminal` on an already-closed job). Each prob-extension entry now carries the active `jobId`. This resolves the zombie case (a killed agent holding a claim) without dropping to the CLI, no global TTL needed.

  ## User-facing

  You can now stop a running or queued analysis from the inspector: a killed or stuck agent's job no longer sits there forever, one click cancels it.

- `sm record --model <name>` is now persisted instead of dropped: the agent's self-declared model id lands on `state_executions.model` and is denormalized onto the `state_findings.model` / `state_summaries.model` rows the same record writes, so every probabilistic analysis answers "which model, when" without joins. `sm findings` renders it alongside the confidence, and the drain skill instructs agents to declare it.

  ## User-facing

  Analyses now remember which AI model produced them: agents report their model when closing a job, and `sm findings` / `sm show` display it next to each result together with its date.

- Model A provenance enrichment lands in the contract: Actions gain the declared `io: ['network']` purity carve-out (injected `ctx.fetch`, gated by the new committed `allowNetworkActions` policy, default false), `sm refresh` executes enrichment Actions in-process with an `enrichments/` write-through convention mirroring the summaries one, and `enrichments/github.schema.json` pins the verification report shape (`verified`, `method: raw-sha | api-ref`, `resolvedSha`, body-hash comparison fields).

- First built-in finder Analyzer: `core/ai-redundancy-analyzer` (probabilistic, stable, enabled by default) judges a node for internal redundancy through the job queue and lands `type: redundancy` rows in `state_findings`; its report schema narrows the finding type so the finder can only emit its own judgment. The spec gains the `findings-contract` / `findings-contract-kind` conformance pair covering the rendered findings-envelope report contract and the frozen `extensionKind: analyzer` job row.

  ## User-facing

  New AI review that flags repeated instructions inside a file, on by default: queue it with `sm job submit ai-redundancy-analyzer` and read the judgments with `sm findings`.

- Jobs never expire by default (Decision #139): an interactive drain can hold a claim while its user deliberates. `state_jobs.ttl_seconds` is nullable; expiry arms only from explicit operator sources (`--ttl`, with `0` disarming, `jobs.perExtensionTtl`, or the global opt-in `jobs.ttlSeconds`), the estimate-driven grace formula and its `graceMultiplier` / `minimumTtlSeconds` config keys are retired, and the new `jobs-overdue` doctor check advises on long-running TTL-less jobs.

  ## User-facing

  Queued jobs no longer time out on their own, so an agent can pause mid-job and ask you how to proceed without losing the work. Set `--ttl` (or the `jobs.ttlSeconds` setting) if you want expiring jobs back; `sm doctor` now flags jobs running far longer than expected.

- `sm plugins show <plugin>/<ext>` now renders a probabilistic extension's two contract files inline: the verbatim `prompt.md` template under a Prompt section and the pretty-printed `report.schema.json` under a Report schema section (`--json` gains `promptTemplate` / `reportSchema`). The prompt is the extension's essence under the forms model, so the inspector surfaces it without disk spelunking.

  ## User-facing

  `sm plugins show` now displays the full prompt and answer format of any LLM-backed extension, so you can read exactly what a queued job will ask an agent to do before submitting anything.

- Lands the deferred `preamble-bitwise-match` conformance case: a `ai-summarizer-action` job submitted over a scanned markdown node must render content containing `preamble-v1.txt` byte-for-byte, read back via `sm job preview --last`. The case format grows `setup.priorInvokes` (ordered staging invocations that must exit 0, run after the fixture copy) and the `stdout-contains-verbatim` assertion; the CLI contract adds the `--last` selector to `sm job preview`.

- Preamble v2 (Decision #140): rule 4 now permits file edits ONLY when the extension template explicitly directs an edit as the job's purpose (unblocking fixer Actions; code execution and URL fetching stay absolutely forbidden, user-content can never mandate anything), the wording moves from "runs actions" to "prepares analysis jobs" with "extension" throughout, and the closing line names the Report contract section. Conformance fixture recut as `preamble-v2.txt`; every job re-keys.

  ## User-facing

  The safety instructions inside every queued job got a v2: agents may now edit files when a job's own instructions say so (never because of file content), which enables upcoming fix-it jobs.

- The queue is pull-only: skill-map never invokes an agent. `RunnerPort` leaves the architecture (§Execution handover: external agents drain via `sm job claim` + `sm record`), the `sm job run` verbs leave the contract, the `runner` enum becomes `agent | in-process`, reap moves to the start of every claim, and the job-events catalog prunes the spawn-path events, with `sm record --json`'s synthetic `r-ext-` envelope as the canonical emission.

- Two internal spec contradictions reconciled. `interfaces/security-scanner.md` is rewritten over the findings pipeline: scanners are finder Analyzers extending the findings envelope (categories become finding `type` slugs, stable cross-run ids retired, kernel safety slugs reserved). And the architecture mode matrix now matches the schemas and runtime: Action `mode` is optional, defaulting to `deterministic`; a probabilistic Action missing `mode` still fails at load via the `prompt.md` rule.

- Summarizer Actions (report schema extends `summaries/<kind>`) drive a `state_summaries` write-through when `sm record` closes a completed job, shown by `sm show` with a `(stale)` marker. Tightens the `</user-content>` escaping to be case/whitespace-insensitive, adds a submit-time body-hash drift check refusing stale bytes, hides the `nonce` from `job list`/`show --json`, has read verbs advise not refuse on schema drift, and reconciles the `sm record` exit codes (2 = not running, 5 = not found).

- The inspector's AI-actions launcher becomes two-state finder buttons plus an Automatic toggle: a finder with a matching fixer is ONE button that morphs Detect ⇄ Fix by the node's open findings (the fixers row is retired), and the toggle makes it one-click detect+fix. Backing it, a per-job `autoFix` flag frozen at submit (`--auto-fix`, POST body, or toggle) chains all matching fixers at record. `prob-extensions` reshapes to `{ finders, standalone }` with `fixerIds` + `hasOpenFindings`.

  ## User-facing

  Each analysis button in the inspector now detects, then turns into its fix once something is found, so there is one button instead of two. Flip the Automatic toggle to make it detect and fix in a single click.

- The summarizer is universal: the per-kind summary schemas (`summaries/{skill,agent,command,hook}.schema.json`) are removed and `summaries/markdown.schema.json` becomes the single canonical node-summary shape (`markdown` names the body format every node shares, not the node kind). The summarizer detection convention in `job-lifecycle.md` §Record is now "report schema extends a schema under `summaries/`"; per-kind summarizers are dropped from the plan.

- The collection verb namespaces go plural (breaking, pre-1.0): `sm job` becomes `sm jobs` and `sm sidecar` becomes `sm sidecars`, aligning them with `plugins` / `actions` / `findings` under one rule (a browsed collection is plural). No singular alias. The queue-processing concept renames from "drain" to "process", and the agent skill is renamed `sm-run-queue` to `sm-process-jobs`.

  ## User-facing

  `sm job ...` is now `sm jobs ...` and `sm sidecar ...` is `sm sidecars ...` (no old aliases, update scripts). The queue-processing skill is renamed `sm-process-jobs`; run `sm agent install` to get it.

### Patch Changes

- Schema-drift advisories now point at `sm scan` alone: scan is a drift-owning verb that deletes and recreates the drifted DB by itself, so the previously prescribed `sm db reset --hard` first step was a redundant detour for the same outcome. The write-refusal, read-failure, and read-warn advisories all drop it (`spec/db-schema.md` §Schema drift).

  ## User-facing

  When your project database is outdated after an upgrade, the error now just says to run `sm scan` (which rebuilds it in one step) instead of a two-command sequence.

- The `sm findings` bucket flags become filters: `--fixed` now shows ONLY the fixed rows and `--stale` ONLY the stale ones (their union when combined), instead of appending the hidden bucket to the default listing. The excluded-count reporting stays a default-view-only honesty device; an explicit bucket filter is the operator's own narrowing, like `--type`.

  ## User-facing

  `sm findings --fixed` now lists just the fixed findings (and `--stale` just the stale ones) instead of mixing them into the full list, so reviewing what a fixer did no longer means scrolling past everything else.

- `sm findings` human output now prefixes each finding row with its numeric id (right-aligned per node section so the severity glyphs stay in one column), the handle you pass to `sm findings resolve <id>`. Previously the id showed only in `--json`, forcing a jq/grep detour to act on a finding.

  ## User-facing

  `sm findings` now shows each finding's id at the start of its row, so you can pass it straight to `sm findings resolve <id>` without digging through `--json`.

- Correct the job `contentHash` formula to include `node.path` and NUL-delimit its inputs. The rendered content embeds `node.path` via `<user-content id>`, so the previous formula (which omitted it) let two nodes with identical body and frontmatter share one content row while rendering different text, breaking the "same hash, same content" invariant. Also clarify that `--force` bypasses the duplicate pre-check but never the unique partial index, so it only re-runs terminal jobs.

## 0.80.0

### Minor Changes

- The antigravity activity adapter now maps a live MCP tool call to a PATH signal on the `mcp://<server>` node. Antigravity funnels every MCP call through a generic `call_mcp_tool` wrapper carrying the server in `toolCall.args.ServerName`, so the adapter reads that (not a `mcp__<server>__<tool>` name like Claude / Codex) and lights the same node `core/mcp-tools` draws from frontmatter. The `PreToolUse` matcher widens to `^(view_file|call_mcp_tool)$`; re-run the activity installer.

  ## User-facing

  Under the Antigravity lens, calling an MCP tool (like Notion) now lights its node on the map in real time, the same as Claude and Codex. Re-run the activity installer so the hook catches MCP calls.

- OpenCode gains config-side MCP discovery: the opencode provider declares an `mcpConfig` source over `opencode.json`, and the JSON dialect now tolerates OpenCode's `mcp` top-level key plus its `type: remote/local` / `enabled` server shape (unlike Antigravity, OpenCode's MCP config is project-local and committable). So an `mcp://<server>` node materialises config-side from `opencode.json`, the same node `core/mcp-tools` draws from a skill's `tools:` frontmatter.

  ## User-facing

  Under the OpenCode lens, MCP servers declared in your project's `opencode.json` now appear on the map as `mcp://` nodes, even when no skill references them.

- The opencode activity adapter now maps a live MCP tool call to a PATH signal on the `mcp://<server>` node, closing the last live-invocation gap. OpenCode names MCP tools `<server>_<tool>` in `input.tool` with no explicit marker (a Notion call arrives as `notion_notion-create-pages`), so the adapter reads the server as the prefix before the first `_` and lets the resolver drop non-`mcp://` misses. The plugin already forwards every `tool.execute.before`, so this needs no reinstall.

  ## User-facing

  Under the OpenCode lens, calling an MCP tool (like Notion) now lights its node on the map in real time, completing live MCP invocation for all four supported runtimes.

- Virtual nodes (e.g. `mcp://<server>` derived from a skill's `tools:` frontmatter by `core/mcp-tools`) now survive a cached rescan. `scan_nodes` gains `virtual` + `derived_from_json` columns so a DB-loaded prior recognises synthetic nodes, and the walker carries them forward when their source is a cache hit (the source's extractor is skipped, so nothing re-emits the node). Previously such a node vanished on the first incremental / `sm serve` rescan even though its source still referenced it.

  ## User-facing

  An MCP node drawn from a skill's tool list (with no separate MCP config file, as under the Antigravity lens) no longer disappears from the map after the live watcher's first rescan.

## 0.79.0

### Minor Changes

- Codex now lights the map live when the model calls an MCP tool. The `codex` activity adapter maps a `PreToolUse` for an `mcp__<server>__<tool>` call to a PATH signal on the `mcp://<server>` node (matcher widened to `^(spawn_agent|mcp__.+)$`), reusing the shared `mapMcpInvocation` (Codex reports the same `mcp__` hook tool name as Claude). The `realtime-codex` fixture gains a deepwiki MCP server and a `demo-skill-mcp`.

  ## User-facing

  When your Codex session calls an MCP tool, skill-map now lights up that MCP node on the map live, the same as Claude Code.

- Promotes the `core/mcp-tools` extractor from `experimental` to `beta`, so it now ships ENABLED by default. A project whose skills or agents declare `tools: [mcp__<server>__<tool>]` in frontmatter gets the `mcp://<server>` nodes and reference edges on the map out of the box, no manual enable needed. Justified now that config-side discovery and live invocation (claude + codex) have landed.

  ## User-facing

  MCP tools declared in your skills or agents now show on the map by default: skill-map draws the `mcp://<server>` node and an arrow to it without you enabling anything.

## 0.78.0

### Minor Changes

- Bare `sm` (no arguments) in a folder that has files but no `.skill-map/` project now offers to bootstrap it: on an interactive terminal it shows a yes/no confirm (default yes) that runs `sm init` and, on success, continues into the Web UI server (`sm serve`). Declining, a non-interactive stdin, or an empty folder keep the previous behavior (the getting-started menu or the one-line hint plus exit 2).

  ## User-facing

  Run `sm` in a folder that already has files but no project and it now offers to set skill-map up for you; accept and it initializes, scans, and opens the map.

- MCP support lands in three parts. A declarative `mcpConfig` Provider capability and a shared kernel MCP parser materialise `mcp://<server>` nodes from a project's config files, canonical over the consumer-side `core/mcp-tools` emission. Live MCP tool calls light the same node: `node.activity` gains `detail`/`access` and the recent ring records typed `mcp`/`read` entries with `caller`/`target`. A read-only MCP server (`spec/mcp-server.md`) is specified on `sm serve` at `/mcp` (off by default).

  ## User-facing

  The map now shows the MCP servers your project configures and lights them live when an agent calls a tool. The inspector logs each MCP tool call and file read with who ran it. `sm serve` gains an opt-in read-only MCP server at `/mcp` (spec only so far).

- Implements the read-only MCP server for `sm serve`: an opt-in Streamable HTTP endpoint at `/mcp` (stateful sessions) exposing four query tools (query_graph, get_node, list_issues, get_branch) and skillmap:// resources for graph, issues, activity, and per-node views, with live `notifications/resources/updated` off the scan broadcaster. Enabled via `--mcp` / `--no-mcp` or the project-local `mcp.server.enabled` (off by default, toggleable from Settings > Project), behind the loopback-Origin gate.

  ## User-facing

  `sm serve --mcp`, `mcp.server.enabled`, or a Settings > Project toggle now exposes an opt-in, read-only Model Context Protocol server at `/mcp`, so an MCP host like Claude Code can query your project graph as tools and read it as resources, with live updates as the map changes.

- The blanket `pluginTrust.projectEnabled` opt-in (the config key plus its Settings toggle that trusted every plugin the project enables) is removed. Plugin import trust is now per-plugin only: `sm plugins trust <id>` / the Settings Trust button, or `sm plugins trust --all` to trust every discovered drop-in at once. A single config toggle can no longer widen the local code-execution surface. Settings > Plugins also gains a consolidated restart notice when a drop-in changes trust or enable state.

  ## User-facing

  The "Trust plugins this project enables" setting is gone. Trust plugins one by one (the Trust button, or `sm plugins trust <id>`), or run `sm plugins trust --all` to trust them all. Settings now shows a clear "restart to apply" notice after a plugin trust or enable change.

### Patch Changes

- `sm activity install` for `plugin-file` providers (opencode-style) now writes an ESM-pinning `package.json` (`{ "type": "module" }`) next to the generated in-process plugin so the vendor runtime loads its `export`-based `.js` without a `MODULE_TYPELESS_PACKAGE_JSON` warning (or a hard parse error under a CommonJS host). Written only when the plugin dir has no `package.json` (never clobbering the vendor's shared dir); uninstall removes it only when it is exactly ours.

  ## User-facing

  `sm activity install` now drops a small package.json next to a plugin-file provider's hook so your tool loads it without a module-type warning. It won't overwrite a package.json already in that folder.

- `sm plugins create` now emits a root `package.json` (`{ "private": true, "type": "module" }`) so Node loads a plugin's ESM `.js` extensions without the `MODULE_TYPELESS_PACKAGE_JSON` warning, and `sm plugins upgrade [<id>]` backfills it on older plugins (adding a missing `type` without clobbering a non-module one). The plugin author guide documents the module-type requirement and the Provider `activity` capability, and the quickstart adds the `sm plugins trust` step.

  ## User-facing

  New drop-in plugins now ship a package.json so Node loads them without a module-type warning. Run `sm plugins upgrade` to add it to plugins you created earlier. The plugin docs now cover the trust step and how a provider wires live activity.

## 0.77.0

### Minor Changes

- Lowers the default scan corpus ceiling `scan.maxScan` from 50000 to 5000 files. Projects above the limit now truncate by default (extra files are left out of the map, not scanned or reference-validated), and `sm scan` prints a reworded advisory pointing at `.skillmapignore` to filter noisy folders (e.g. node_modules/, dist/, build/) or `--max-scan <N>` to raise the limit. Fully overridable per project via `scan.maxScan` in settings.json or per invocation via `--max-scan`.

  ## User-facing

  skill-map now scans up to 5000 files by default (was 50000). Larger projects get a terminal notice suggesting you filter noisy folders with .skillmapignore, or raise the limit with --max-scan. You can set any value under scan.maxScan in .skill-map/settings.json.

### Patch Changes

- `POST /api/activity` now emits one diagnostic log line per ingested event so an operator debugging a Provider's live-activity wiring (`sm serve --log-level info`) sees whether a hook fired and where it ended up, instead of the silent 202 short-circuits. The line names the provider, a sanitized hook-type discriminator, and the outcome (resolved with counts / no-signals / no-nodes / unresolved at INFO; no-provider and token mismatch at WARN). The event body is never logged.

  ## User-facing

  Run `sm serve --log-level info` to see one line per live-activity event: which provider and hook fired, and whether it resolved, mapped nothing, or was dropped (e.g. an untrusted provider). Hard drops and token mismatches show even at the default level.

- Switching the active-provider lens from the marker-drift notice now dismisses it. `PATCH /api/active-provider` refreshes the `activeProviderMarkers` snapshot to the detected set as part of the switch (mirroring the CLI's `sm config set activeProvider`), so the drift banner clears on a lens change instead of lingering. Previously only the explicit Dismiss (`POST /api/active-provider/accept-markers`) reconciled the snapshot, so switching lens left the notice up.

  ## User-facing

  The "new provider markers detected" banner now goes away after you switch lens from it, not only when you press its dismiss button.

- `sm scan` now prints an info advisory when the scanned corpus has more nodes than the map render cap (`scan.maxNodes`, default 256): the full corpus is still scanned and reference-validated, only the graph view paginates. The in-map render-cap banner is now corpus-aware, so it also fires when the whole project exceeds the cap while the selected branch fits, keeping the signal visible when you drill into a small sub-folder.

  ## User-facing

  When your project has more files than the map can show at once (256 by default), sm scan now tells you in the terminal, and the map banner appears even while you are viewing a small folder. Nothing is lost, the map just draws part of the project at a time.

- Fixes `GET /api/plugins` reporting `status: 'enabled'` for an untrusted drop-in plugin that ships config-enabled (e.g. a `beta` provider). Its code never loads without a local trust grant, so the row now reads `status: 'disabled'` with the untrusted reason (per spec/architecture.md) instead of misleadingly showing as active. Plugin-level, so it covers every kind (provider, extractor, analyzer, action, formatter, hook).

  ## User-facing

  An untrusted drop-in plugin no longer shows as enabled in the plugins list. Until you trust it (Settings, or sm plugins trust), it reads disabled with a hint to trust it, since its code does not run without your trust grant.

## 0.76.0

### Minor Changes

- External drop-in Providers now reach parity with built-ins. A `kinds/<name>/kind.json` may declare `identifiers` / `identifierMismatch`, and the provider manifest accepts `resolution` and `reservedNames`. The loader strips the `activity` capability's runtime-only fields from the validated view, so a drop-in can ship a live-activity adapter; the scan claims a drop-in lens's territory ahead of the markdown fallback; and `sm activity` resolves trusted drop-in Providers, not only built-ins.

- The reference-broken verdict gains an on-disk existence probe: a path-style link whose target exists under any scan root no longer flags broken even when the file is not an indexed node (JSON schemas, images, ignored or oversized markdown). The lazy memoized probe runs in `collectBrokenLinks`, threaded by the scan runner, the watcher, and `scan compare-with`. With those false positives gone, `BROKEN_PENALTY` hardens from 0.5 to 0.75: a broken edge folds to 0.25, above the reserved 0.1.

  ## User-facing

  Links to files that really exist on disk (JSON, images, docs) no longer show as broken references. Only links pointing at genuinely missing files flag now, and they stand out more: their arrows render much fainter on the map.

- The scan now folds the project root `.gitignore` into its ignore stack only when the new committed `scan.respectGitignore` key is enabled (default `false`): out of the box a git-ignored note is still indexed unless the bundled defaults, `config.ignore`, or `.skillmapignore` exclude it. The one-shot scan, `sm scan compare-with`, and the live watcher all honour the flag, and a team-shared toggle sits at the end of Settings > Project.

  ## User-facing

  Skill-map no longer skips the files your `.gitignore` skips by default, so notes you keep out of git now show up on the map. A new team-shared toggle at the end of Settings > Project ("Use .gitignore") turns the old behavior back on for the whole project.

### Patch Changes

- `sm init` now also adds `.skill-map/backups/` to the project `.gitignore`, alongside `settings.local.json`, `skill-map.db`, and `serve.json`. The backups directory (pre-migrate DB snapshots and `sm db backup` output) is a per-machine runtime artifact and must never travel via the shared repo.

  ## User-facing

  `sm init` now keeps the `.skill-map/backups/` folder out of git, so your local database backups never get committed to the shared repo.

## 0.75.0

### Minor Changes

- Move the web UI's "Live updates" and "Real-time node activity" preferences from browser localStorage to the project-local config: new `ui.liveUpdates` / `ui.realtimeActivity` keys in `project-config.schema.json` (project-local only, stripped from the committed layer), read and written through `GET/PATCH /api/project-preferences` and persisted in `.skill-map/settings.local.json`. The SPA loads them before opening the live socket; the former localStorage keys are simply no longer read.

  ## User-facing

  The Live updates and Real-time node activity switches now live in Settings > Project and stick to the project instead of the browser: flip them once and every browser profile on this checkout sees the same choice.

- architecture.md gains §Kernel check · frontmatter diagnostics, the normative backing for the kernel-stamped vocabulary (`frontmatter-parse-error`, `frontmatter-malformed` with its five-hint set including `early-close`, and `frontmatter-invalid` covering absent blocks) and the one-lane-per-node routing; the sidecar identity contract's canonical YAML recipe now names js-yaml 5's `schema: CORE_SCHEMA`, the byte-identical successor of the retired `noCompatMode: true`.

- architecture.md §Provider · kind identifiers now specifies the per-kind `identifierMismatch` knob and the `core/name-mismatch` contract: a node whose normalised `frontmatter.name` diverges from its filename/dirname handle is flagged with the kind's declared severity (warn for the open-standard skill kind, info for documented-legal overrides). It also defines the two-tier `core/name-collision` verdict: error for two declared names, warn for declared-vs-file-derived shadowing.

- cli-contract.md now specifies that `sm scan`/`sm watch` contain the scan to the project by default: a symlink whose real target escapes the scan roots is skipped rather than followed, defeating a committed hostile symlink that reads arbitrary local files. A new project-local-only `scan.followExternalSymlinks` boolean (default false) in project-config.schema.json opts back in.

### Patch Changes

- Closes the remaining cli-ruler audit findings: the REST contract table in cli-contract.md now documents the implemented preferences, project-preferences, project-ignore, favorites, and update-status endpoints, and architecture.md enumerates all eight PROJECT_LOCAL_ONLY_KEYS members. On the src side, published package metadata and the Claude provider schema descriptions drop their em dashes, and a stale $HOME docstring now points at the closed caller list.

- architecture.md corrected two stale statements saying the `core/update-check` hook subscribes to `shutdown`; it subscribes to `boot` (the lifecycle-event table's `boot` row already said so), and the update banner renders above the verb's output.

## 0.74.0

### Minor Changes

- Live-activity abstraction hardening for future providers: the in-process plugin template keeps only the shared envelope and splices provider-owned hook registrations (new `pluginHooksSource` runtime field, opencode's generated plugin stays byte-identical), uninstall removes the shared bridge dir only when no other json-hooks provider remains wired, duplicated adapter idioms moved to a shared kernel kit, and the install descriptor became a per-kind discriminated union with a schema gate.

  ## User-facing

  Turning live activity off for one agent no longer breaks it for other agents wired in the same project: the shared bridge now stays in place until the last agent unwires.

## 0.73.1

### Patch Changes

- Antigravity live-activity fix: the conversation Stop only releases the owner's claims when the conversation is FULLY idle (fullyIdle is not false). The runtime fires Stop on every mid-run nap while subagents work (live-verified 2026-07-05), and releasing there darkened the whole chain prematurely; nap stops now disclaim, a missing fullyIdle keeps the old behavior for older runtimes. The per-provider spec table also pins why spawn relations are unmappable on this runtime.

  ## User-facing

  On Antigravity, the map no longer goes dark while the main conversation waits for its subagents; everything stays lit until the whole conversation actually finishes.

- Codex live-activity parity: the codex adapter wires the spawn_agent Pre/PostToolUse pair (matcher-scoped, the only tool events) and emits spawn relations with the prompt on start and the child agent_id parsed from the JSON-string response on handoff, plus the stop's last_assistant_message as the conversation response via the generic report path. No custody (codex parents never pause), no execution totals (the payloads carry none); spec table updated from the 2026-07-05 probe.

  ## User-facing

  Codex sessions now get the same live map extras as Claude: spawn arrows between agents, per-edge conversation counters, and opt-in agent-to-agent conversation viewing. Execution totals stay empty on Codex, its runtime does not report them.

- OpenCode live-activity spawn parity: the in-process plugin forwards tool.execute.after wiring-filtered to the task tool, and the adapter emits spawn relations from the task pair (callID as spawnId, prompt on start, the child sessionID plus its final report unwrapped from the task_result envelope on completion, relation-only since the task event never names the parent agent). session.idle confirmed nap-free; spec table updated from the 2026-07-05 probe.

  ## User-facing

  OpenCode sessions now draw spawn arrows with per-edge conversation counters and opt-in conversation viewing, with the child's full reply captured natively; the demo fixture mirrors the Claude one (3-turn conversation, unlinked scout, report skill).

## 0.73.0

### Minor Changes

- Live activity: sync spawn completions now carry an execution summary (durationMs, tokens, toolUses, extracted from the runtime's live-verified completion totals) on the spawn relation. The stats accumulator folds them into per-node aggregates (toolUses, tokens, summarizedRuns on the stats shape), retained conversation records keep the per-run summary, and the inspector Activity section plus the conversation dialog turn heads display them.

  ## User-facing

  Agent runs now show how long they took, how many tools they used, and how many tokens they consumed, both per conversation turn in the chat dialog and aggregated in the node's Activity panel.

- Live activity: per-pair spawn counters in the stats accumulator (metadata, independent of the capture gate), exposed as a pairs map on GET /api/activity/summary and as an overwrite-only pairCount field on agent.spawn frames, feeding the UI's edge conversation-count labels and the historical edge click-through into the threaded conversation dialog.

  ## User-facing

  Graph edges now show how many agent conversations passed through them, and clicking an edge that carries a count reopens the same chat dialog the inspector shows, even after the live run ended.

- Live activity v1.1: ephemeral per-node execution stats in the BFF (keepAlive-aware counting, summary endpoint, stats riding node.activity frames), stateless agent.spawn WS frames from the new spawn relation on activity signals, sessionized main owners (main:<session_id>) in claude and codex, and opt-in conversation capture (activity.captureConversations, consent-gated, off by default) retaining both spawn halves, with async responses attached from the child's terminal stop report.

  ## User-facing

  Nodes now show how many times your AI assistant ran them, live dashed arrows connect agents to the agents they spawn (with a session marker when spawned from your chat), a topbar switch toggles Real Time, and you can opt in to view agent-to-agent conversations from the map.

## 0.72.0

### Minor Changes

- New read-only verb `sm activity status [provider]` (normative row in cli-contract.md §Activity): one line per activity-capable provider reporting installed, not installed, or partial (config wired but the shared bridge artifact missing; the inverse reads as not installed because the bridge is shared across hook-file providers), and the `activity install`/`uninstall` help texts now describe both install shapes with opencode examples.

  ## User-facing

  **Check where live activity stands with `sm activity status`.** One line per provider tells you if its hook is installed, missing, or half-broken, plus the exact re-install command that repairs it.

- Antigravity joins live activity: the contract gains three additive install-descriptor fields (`install.group`, `install.commandCwd`, `events[].entryShape`) and a node-less owner-release signal form, the bridge derives its scope root from its own installed location instead of the spawn cwd, and the new adapter lights everything the agent reads via `view_file` and releases the whole chain on conversation `Stop` (demo fixture: `fixtures/realtime-antigravity/`).

  ## User-facing

  **The live map now works with Antigravity.** Run `sm activity install antigravity` and watch skills, workflows and notes light up as the agent reads them, going dark the moment it finishes. Skills invoked with a slash stay dark (Antigravity reports no event for them).

- The opencode adapter closes the four-provider live-activity set and implements the spec's `plugin-file` install kind: `sm activity install opencode` writes one self-contained in-process plugin at `.opencode/plugin/skill-map-activity.js` (wiring and bridge in a single marker-stamped file, a foreign file at that path is never touched) forwarding named skill / command / agent signals, markdown reads by path, and the native `session.idle` owner release (demo fixture: `fixtures/realtime-opencode/`).

  ## User-facing

  **Live activity now covers OpenCode, completing the set.** Run `sm activity install opencode`: skills, commands and agents light up by name (even asked in prose), markdown reads glow by path, and each session goes dark the instant it idles.

### Patch Changes

- The codex provider ships the second live-activity adapter: `sm activity install codex` wires `.codex/hooks.json` (same json-hooks convention as claude) and maps `$skill` prompt tokens (same dollar grammar as the `dollar-skill` extractor) plus named SubagentStart/Stop boundaries. The codex row of the spec's informative per-provider table is rewritten to the shipped facts, README gains a live-activity section with a support matrix, and a demo fixture lands at `fixtures/realtime-codex/`.

  ## User-facing

  **Live activity now works with Codex.** Install its hook from Settings or with `sm activity install codex`, then watch your `$skills` and named agents light up on the map as they run (file reads stay dark for now, Codex does not yet expose them).

## 0.71.0

### Minor Changes

- The live-activity hook is now manageable over HTTP: `spec/provider-activity.md` gains a normative install-management contract (status probe plus install/uninstall that MUST answer 412 and touch nothing without `confirm: true`), the BFF serves the three routes on a shared `core/activity` engine (CLI verbs byte-identical), and Settings → Project offers install/uninstall for the active lens, with the real-time toggle hinting when the hook is missing.

  ## User-facing

  **Wire the activity hook from Settings.** Install or remove the live-activity hook for your assistant right from Settings → Project, with a clear confirmation before anything touches your files. The real-time toggle now tells you when the hook is missing.

- Live node activity now ends natively instead of by TTL decay: activity signals and the `node.activity` wire gain optional `ownerScope` (a terminal subagent stop releases every claim that owner holds) and `sticky` (lifecycle claims get a long safety-net window), the Claude adapter keeps a spawning parent lit via spawn custody handed to the child only while it still runs (`async_launched`), and `spec/provider-activity.md` is now published and hashed in the spec index.

  ## User-facing

  **Map lights now follow your agents natively.** A node switches off the moment its agent actually finishes instead of fading on a timer, and an agent that delegates work stays lit until its whole delegation chain completes.

## 0.70.0

### Minor Changes

- Live activity now lights markdown nodes: activity signals gain a path-based form (`{ path, phase, owner? }`, resolved by exact `node.path` match across providers), and the claude adapter maps `Read` tool events to path signals with a filter-first early disclaim (non-`.md` reads and paths outside the scope root never reach the node set). `sm activity install` switches to refresh semantics so re-running updates skill-map's own hook entries in place.

  ## User-facing

  **Markdown files light up too.** When Claude Code reads any scanned `.md` (your notes, docs, a skill's file), its node now glows on the live map like skills and agents do. Re-run `sm activity install claude` once to pick up the new wiring.

- Backticked `@handle` mentions and `/command` / `$skill` invocations now become graph links: the new `claude/backtick-mention`, `core/backtick-slash`, and `codex/backtick-dollar` extractors match inside code spans and fences, gated post-walk so only tokens resolving to a real entity survive (npm scopes, decorators, shell tokens never link nor flag broken). Claude mentions also resolve to skills and markdown docs via priority-ordered matrices, and usage-example self-loops no longer warn.

  ## User-facing

  Names in backticks or code fences now link on the map when they exist: `@my-agent`, `@my-skill`, `@some-doc`, `/my-command`, and `$my-skill` all connect. Unrelated code tokens (npm packages, shell paths) stay ignored, and a doc showing its own command no longer warns.

## 0.69.0

### Minor Changes

- Live node activity v1 (contract in `spec/provider-activity.md`): Providers gain an optional `activity` capability, `sm serve` publishes `.skill-map/serve.json` (bind address plus per-session token) and serves a token-gated `POST /api/activity` that resolves provider hook events to scanned nodes and broadcasts `node.activity` over `/ws`, `sm activity install|uninstall` wires a zero-dependency bridge into the provider's hook config, and the map lights executing nodes. Ships the `claude` adapter.

  ## User-facing

  **Watch your map light up as your assistant works.** With `sm serve` running, run `sm activity install claude`: every skill, agent, or command Claude Code invokes now glows on the map in real time, and the path between an agent and the skill it runs lights up as one chain.

- Add `server.port` / `server.host` project-config keys, resolved through the normal config layering (defaults, project, project-local) with the `--port` / `--host` flags as the per-invocation override, mirroring the `scan.watch.backend` precedent; `sm serve` records the resolved values in `serve.json` and the loopback-only rule applies regardless of which layer supplied the host.

  ## User-facing

  **Pin your port in config.** Set `server.port` (and optionally `server.host`) in `.skill-map/settings.json` and `sm serve` always boots there, no flags needed; `--port` still wins for a one-off run.

### Patch Changes

- Document that cross-filesystem WSL to Windows is unsupported. The inotify-based live watcher (`chokidar` / `parcel`) receives no events on a mounted Windows drive (`/mnt/c`), so `sm serve` / `sm watch` never refresh the map there, and a symlink to a Windows path is followed on a one-shot `sm scan` but not live-watched. Added to `spec/cli-contract.md` §Scan (the watcher paragraph). No behavior change and no polling fallback ships; keep the project on the Linux filesystem for a live map.

## 0.68.0

### Minor Changes

- Remove the `scan.followSymlinks` setting: the scan walker now always follows symbolic links, to targets inside or outside the project, guarded only by cycle detection (the realpath-containment gate is gone). Change `scan.watch.backend` to `chokidar` (default) or `parcel` and drop the `auto` value, and add a `--watch-backend <chokidar|parcel>` flag on `sm serve` / `sm watch` / `sm scan --watch` that overrides the setting per invocation.

  ## User-facing

  Symlinked folders are now always indexed, even when the link points outside your project. The file watcher defaults to `chokidar`; pass `--watch-backend parcel` on `sm serve` / `sm watch` for very large trees (scales better, but no live updates behind symlinks).

- Surface provider-marker drift in the web UI instead of the server log. `sm serve` / `POST /api/scan` no longer log the `Provider markers changed` warning; `GET /api/active-provider` now returns a `markerDrift` field and the SPA shows a dismissable notice to switch lens or dismiss. Dismissing (`POST /api/active-provider/accept-markers`) reconciles the `activeProviderMarkers` snapshot so the drift clears in both UI and CLI. `sm scan` / `sm watch` keep the warning.

  ## User-facing

  **Marker-change notice moved into the map.** If a new provider folder (like `.claude/`) appears, the map shows a dismissable banner to switch lens or keep your current one, instead of repeating a warning in the server console. Dismissing it remembers your choice.

## 0.67.1

### Patch Changes

- Make the primary scan watcher backend selectable via `scan.watch.backend` (`auto` default, `parcel`, `chokidar`). `auto` uses `@parcel/watcher` (a single native inotify instance that scales to huge trees without chokidar's `EMFILE` failure) and switches to `chokidar` when `scan.followSymlinks` is on so symlinked dirs keep updating live. The meta-watcher stays on chokidar. Defaults preserve existing behaviour.

  ## User-facing

  **Watcher scales to large repos.** The file watcher now uses a native single-instance backend, so `sm serve` / `sm watch` no longer crash with `EMFILE: too many open files` on projects with very many folders. Set `scan.watch.backend` (auto / parcel / chokidar) to force a backend.

- Add an opt-in `scan.followSymlinks` setting (default `false`). When enabled, the scan walker follows symlinked directories and files instead of skipping them, so a softlinked `.claude/skills` is indexed. Following is gated by cycle detection and realpath containment (a link is followed only when its target stays inside the scan roots), and the incremental watcher re-scan applies the same policy as a full scan.

  ## User-facing

  **Scan symlinked folders.** Turn on `scan.followSymlinks` in settings to index skills behind a symbolic link (for example a `.claude/skills` that points elsewhere). Off by default; links pointing outside your project are never followed.

## 0.67.0

### Minor Changes

- Fold the project `.gitignore` into the scan and watcher ignore filter (precedence: bundled defaults, `.gitignore`, `config.ignore`, `.skillmapignore`, where later layers may `!`-re-include) and scope the live watcher to only the file types a scan opens: the registered providers' `read.extensions` (`.md` everywhere, `.toml` under codex) plus `.sm` sidecars. A provider that ships a custom walker disables the extension gate.

  ## User-facing

  **Quieter live map, cleaner scans.** The scan and live map now also respect your project's `.gitignore`, and the live watcher only reacts to `.md`, `.toml`, `.sm`, and `.skillmapignore` changes, so edits elsewhere (including `node_modules`) no longer cause a rescan.

## 0.66.0

### Minor Changes

- Add a dismissable topbar reminder pointing first-time users at `sm tutorial`. Its dismissal persists via a new project-local `tutorialReminderDismissed` config key (`.skill-map/settings.local.json`), read and written through the project-preferences BFF route.

  ## User-facing

  **Tutorial reminder.** The map's header now shows a one-time reminder to run `sm tutorial`, with a dismiss button that remembers your choice for this project.

## 0.65.1

### Patch Changes

- Add an `opencode` built-in provider lens for the OpenCode CLI. Under the opencode lens, skill-map classifies OpenCode agents (`.opencode/agent/*.md`) and commands (`.opencode/commands/*.md`), and discovers skills from the three homes OpenCode reads (`.opencode/skills/`, `.claude/skills/`, `.agents/skills/`). Claude compatibility is asymmetric: OpenCode reads Claude skills but not Claude agents or commands, so those fall through to markdown. A `.opencode/` folder auto-detects the lens (beta).

  ## User-facing

  skill-map now recognizes OpenCode projects. Open a repo with a `.opencode/` folder and the map shows your OpenCode agents, commands, and skills (including the Claude-compatible skills OpenCode reads). Pick the OpenCode lens from the lens dropdown.

## 0.65.0

### Minor Changes

- The kernel now flags an unclosed backtick in a node body during the scan walk: an opening fenced block (``` or ~~~) that is never closed, or an inline span whose backtick run has no equal-length closer. The verdict is derived from the same code-strip scanner the prose extractors rely on, so it pinpoints the body-syntax defect where a dangling fence swallows the rest of the file and prose extractors stop emitting edges. The warning is persisted and reused across incremental scans.

  ## User-facing

  Scans now warn when a Markdown file has an unclosed backtick (a code fence ```never closed, or an inline`code` span missing its closer). The warning carries the offending line so you can fix it before it breaks how the file's links are read.

## 0.64.0

### Minor Changes

- Fix the OpenAI Codex connector model, which cloned Claude's grammar and was wrong per the official docs. Under the codex lens, skills are now invoked with `$name` (new `dollar-skill` extractor) not `/name`, `@` is a path-resolved file reference (new `at-file` extractor) not an agent mention, and codex plus the neutral `agent-skills` lens no longer flag skill names as reserved (a `$`-skill cannot shadow a `/` command). Claude and Antigravity are unchanged.

  ## User-facing

  Codex projects: a skill now connects via `$name` (not `/name`), `@file.md` references a file, and a skill named like a built-in (e.g. `model`) is no longer wrongly flagged as a reserved-name collision. `/` is left to Codex's own built-in commands.

- Lens auto-detection now gives a vendor marker precedence over the open-standard `agent-skills` fallback. The `agent-skills` provider declares `detect.fallback`, so its `.agents/` marker resolves a lens only when no vendor marker is present. A project carrying `.codex/` (or `.agent/workflows/`) alongside the shared `.agents/skills/` home now resolves to that vendor outright instead of prompting `codex` vs `agent-skills`. Several vendor markers together still surface an ambiguous prompt.

  ## User-facing

  Codex and Antigravity projects no longer hit a spurious "which lens?" prompt on first scan: a `.codex/` (or `.agent/workflows/`) project is detected as that lens even though it also uses the shared `.agents/skills/` folder. `/` is left to the vendor's own behavior.

- Add an optional `presentation.invocationSigil` to the Provider manifest: the single glyph a lens's runtime uses to invoke a skill (`/` for Claude and Antigravity, `$` for Codex). The BFF projects it into `providerRegistry`, and the link-kind palette now paints the `invokes` edge-kind glyph (and its tooltip example) for the active lens instead of a hardcoded `/`. Lenses with no `/`/`$` invocation channel (`agent-skills`, `markdown`) omit it.

  ## User-facing

  Under the Codex lens, the Invokes connector filter on the graph now shows a `$` glyph, matching how Codex invokes skills, instead of a `/`.

## 0.63.0

### Minor Changes

- Split plugin enable (operational) from import trust (security). Enable/disable now persist to the config layers, not the DB; `config_plugins` becomes a per-plugin local trust store. New `sm plugins trust / untrust` verbs, a trust PATCH route, a Settings UI Trust control, and a `pluginTrust.projectEnabled` opt-in grant or revoke consent to run a project-local plugin. It runs only when enabled AND trusted, so disabling one no longer re-reads as untrusted.

  ## User-facing

  Plugins now have two separate switches: enable (is it part of the project, shared) and trust (may its code run on your machine). New `sm plugins trust` / `untrust` plus a Trust button in Settings. A plugin you disabled stays disabled instead of nagging that it is untrusted.

## 0.62.1

### Patch Changes

- Reworked the `sm tutorial` destination prompt to list providers by vendor name rather than their shared destination folder (several providers share `.agents/skills`), with the open standard shown aka-first. Reorganized the interactive tutorial book: the 'Connect the harness' part is merged into 'The project from zero' so building and wiring the harness is one continuous part, alongside a chapter-by-chapter copy pass across the Claude, Codex and open-standard tracks.

  ## User-facing

  The `sm tutorial` picker now lists each agent by name (Claude, OpenAI Codex, Google's Antigravity) instead of its install folder. The guided tutorial is tighter: building and connecting your project's harness is now one continuous part, with clearer copy throughout.

## 0.62.0

### Minor Changes

- New normative import-trust boundary for project-local plugins: a drop-in plugin under `<cwd>/.skill-map/plugins/` is discovered but its extension code is NOT imported or executed by the runtime verbs until the operator grants local trust via `sm plugins enable <id>`. The committed `settings.json` baseline cannot grant it, so cloning and scanning a repo no longer auto-executes its plugins; built-ins and `--plugin-dir` stay ungated. Defined in architecture.md §Locality.

### Patch Changes

- Reconciled the exit-codes table in `cli-contract.md`: code `2` no longer claims a missing DB (it covers a present-but-unreadable or corrupt DB), and code `5` now documents an absent project DB file, so a read verb with nothing to open exits `5` (run `sm scan` first). This matches the reference CLI, which ~20 read verbs already honour, and the existing server boot-resilience clause; no behaviour changed.

- The `sm tutorial` book now adapts to the active provider lens via two tracks: a rich track (Claude / Codex, with agents, commands, slash and mentions) and a basic track (the open-standard Agent Skills / Antigravity family, skills and markdown wired by markdown references). Scaffolding for the open standard now lays a complete references-based campaign instead of a Claude-shaped book with gaps, and the provider/lens narration was corrected to the current model.

  ## User-facing

  `sm tutorial` now runs end to end beyond Claude: a basic skills-and-references book on the open Agent Skills standard (agent-skills / Antigravity) and a rich book for OpenAI Codex, each matching how scans resolve your project.

## 0.61.0

### Minor Changes

- Give the Antigravity provider its own `workflow` kind and promote it to `beta` (enabled by default). Under the antigravity lens, `.agent/workflows/<name>.md` (singular `.agent`) classifies as a `workflow` node (handle = filename) while skills keep the open-standard `.agents/skills/` classifier. The slash extractor now runs under antigravity, so `/name` resolves to both skills and workflows, reserved verbs are flagged on both, and `.agent/workflows/` auto-detects the lens.

  ## User-facing

  **Antigravity is on by default now.** A project with a `.agent/workflows/` folder auto-detects the Antigravity lens; those files show up as workflows (not plain Markdown), and a `/name` reference links to the matching workflow or skill.

## 0.60.0

### Minor Changes

- The lens selector now offers a single open lens, `agent-skills` ("Agent Skills"), promoted to stable and locked and made the universal default for projects with no vendor marker (replacing the old `markdown` default). The non-gated `core/markdown` becomes the invisible base: it still classifies every orphan `.md` but is no longer a selectable lens. A new `isLens` flag drives the dropdown, and `PATCH /api/active-provider` rejects non-lens ids.

  ## User-facing

  The provider lens picker is simpler: one open "Agent Skills" lens (the default when no vendor like Claude or Codex is detected) replaces the old separate "Markdown" and "Open Skills" entries. Plain `.md` files are still mapped, same as before.

- The Codex lens now classifies open-standard Agent Skills (`.agents/skills/<name>/SKILL.md`, the layout OpenAI Codex actually reads) as `codex`/`skill`, by composing the `agent-skills` open-standard pieces over a new multi-rule `read`. A provider's `read` may now be an array of rules so one provider reads several file families with different parsers (Codex reads `.toml` agents and `.md` skills), and a `/skill-name` invocation in an agent prompt resolves to its skill.

  ## User-facing

  OpenAI Codex projects now show their Agent Skills (`.agents/skills/<name>/SKILL.md`) on the map as skill nodes next to the Codex agents, and a slash invocation from an agent to a skill is drawn as a link.

- The provider / active-lens labels now follow one consistent naming pattern: vendor lenses use a possessive `<Vendor>'s <product>` form ("Anthropic's Claude", "OpenAI's Codex", "Google's Antigravity") and the vendor-neutral open standard uses a `Standard: <name>` prefix ("Standard: Agent skills"). The non-selectable `core/markdown` base keeps its internal "Markdown" label. The provider schema and kernel JSDoc document the pattern.

  ## User-facing

  The provider lens names now read consistently: "Anthropic's Claude", "OpenAI's Codex", "Google's Antigravity", and "Standard: Agent skills". The change shows up in the lens dropdown, the topbar lens chip, and the per-node provider chips.

- The inspector now renders OpenAI Codex agents (`.codex/agents/*.toml`) like a Markdown node: the TOML `developer_instructions` field becomes the Body section (rendered as Markdown) and the other TOML keys the Definition/metadata card, instead of showing the raw TOML file. A new optional `bodyField` on each `providerRegistry` entry (projected from the provider's `read.bodyField`) drives the split, so it stays provider-driven with no hardcoded provider id.

  ## User-facing

  Codex agents (`.codex/agents/*.toml`) now open in the inspector with a proper metadata section and a readable, Markdown-rendered body, instead of a wall of raw TOML.

- The OpenAI Codex provider is now beta (enabled by default): a `.codex/` directory auto-detects the codex lens and `.codex/agents/*.toml` files classify as agents. A Codex agent's prompt (the TOML `developer_instructions` field) flows through the link extractors via the new declarative `read.bodyField` knob, so `@mention` and `[link]` references inside it surface in the graph. `AGENTS.md` is no longer a detection marker (it is the vendor-neutral agents.md standard, common in non-Codex repos).

  ## User-facing

  OpenAI Codex is now a built-in provider. Open a project with a `.codex/` folder and skill-map maps your Codex sub-agents plus the links inside their developer instructions, the same way it does for Claude. Pick it anytime from the provider lens.

- Make `name`/`description` per-kind requirements instead of universal ones: the frontmatter base only defines the two fields, and `required` moves to the kinds whose vendor mandates them (Claude agent, Codex agent, Agent Skills skill), leaving the `markdown` fallback and Claude skill/command optional. Per-kind schemas are re-certified against current vendor docs, and the redundant base check in `core/schema-violation` is dropped so each per-kind schema is the single source of truth.

  ## User-facing

  **Frontmatter checks now follow each vendor's rules.** Plain Markdown files and Claude skills/commands without a `name` or `description` are no longer flagged, and Codex/Claude model fields accept current values like `xhigh` reasoning effort and the `fable` model alias.

- The OpenAI Codex provider and plugin id was renamed from `openai` to `codex`, aligning the id with its `.codex/` marker and the product-name scheme of the other built-ins. The lens value (`activeProvider`), `node.provider`, the conformance scope (`provider:codex`), and qualified extension ids (`codex/codex`) change accordingly. Breaking but greenfield (no released consumers); the displayed lens label "OpenAI's Codex" is unchanged.

  ## User-facing

  The OpenAI Codex provider id is now `codex` (was `openai`). If you set it by hand, use `codex` in `sm config set activeProvider` or `sm plugins enable`. The name shown in the app is unchanged.

## 0.59.0

### Minor Changes

- The vendor-neutral open-skills Provider (`agent-skills`, lens "Open Skills") gains an open-standard base reserved-name catalog under `skill`: a user skill shadowing a universal built-in like `help`/`config` is now flagged by `core/name-reserved`, and Antigravity inherits the base by manifest composition and appends its own verbs. Its `skill` frontmatter schema now enforces the open-standard `name` pattern/length and `description` length. Shared primitives renamed to a `COMMONS_*` vocabulary.

  ## User-facing

  With the Open Skills lens active, a skill you authored that shares a name with a built-in command (like `help` or `config`) now gets a warning, and skill names or descriptions that break the open-standard format (bad characters, too long) are flagged too.

## 0.58.0

### Minor Changes

- Bare `sm` in an empty folder now offers a getting-started menu: on an interactive terminal it asks whether to run the guided tutorial (`sm tutorial`) or drop a ready-to-explore example project (`sm example`), then dispatches the chosen verb. In a non-empty folder, or on a non-interactive stdin, it still prints a one-line hint and exits 2, now pointing at `sm tutorial` / `sm example` when the folder is empty and at `sm init` otherwise.

  ## User-facing

  Run `sm` in an empty folder and it now asks how you want to start: a guided tutorial, or a ready-made example project to explore. Pick one and it sets it up for you.

- New `sm example` verb: drops a ready-to-explore example project (the same wired harness the public demo renders) into an empty directory, so a new user can run `sm scan` then `sm serve` against a real connected graph without authoring files first. The payload is the single canonical `fixtures/demo-scope/` fixture, shared with the web demo, and ships unscanned (no `.skill-map/`). Refuses a non-empty cwd unless `--force`.

  ## User-facing

  New `sm example` command: run it in an empty folder to drop a small ready-made project, then `sm scan` and `sm serve` to explore it as a live graph. The fastest way to try skill-map without setting up your own files first.

## 0.57.0

### Minor Changes

- The active provider lens no longer has an unlensed (permissive) state. A project with no marker now resolves to the universal `markdown` lens (never null, never persisted, so a later vendor marker still auto-detects) instead of running every provider at once. The Settings dropdown drops the dead `(none)` entry and keeps Markdown as a selectable neutral lens, and `sm serve` now re-scans under the chosen lens after a switch instead of re-detecting it from disk.

  ## User-facing

  A repo with no `.claude/`, `.codex/`, or `.agents/` now opens in the Markdown view instead of mixing every platform together, with no warning. Pick Markdown anytime from Settings to see your files as plain markdown. The empty `(none)` option is gone.

- Removed the `comingSoon` provider flag: not-ready providers use `stability: 'experimental'`, shipping disabled by default (not classified, auto-detected, or selectable until enabled). `openai`, `antigravity`, `agent-skills` are experimental; `agent-skills` is gated to its own lens (only `core/markdown` stays universal). Antigravity reuses the agent-skills classifier, dropping the kernel's cross-provider reservedNames lens-scope. `sm tutorial --experimental` offers them as destinations.

  ## User-facing

  The lens dropdown no longer shows "(coming soon)" rows. Not-ready providers (OpenAI Codex, Antigravity, Open Skills) are hidden until you enable them with `sm plugins enable <id>`; `sm tutorial --experimental` offers them as tutorial destinations.

## 0.56.1

### Patch Changes

- The `/api/branch` map projection now keeps an edge when its RESOLVED target is a rendered node, not only when the raw authored target is. Trigger-style `invokes` / `mentions` links store the trigger (`/cmd`, `@agent`) in `target` and the real node path in `resolvedTarget`; the old filter matched the raw target alone, so every resolved trigger edge was dropped from the graph and the map showed only path-style `references`. Genuinely-broken links (no resolved node) stay excluded.

  ## User-facing

  The graph map again draws `invokes` and `mentions` arrows (a command running a skill, an agent referenced by name), not just plain file references. A recent change had hidden every resolved trigger edge from the map.

## 0.56.0

### Minor Changes

- Splits the scan cap into two knobs: `scan.maxScan` (corpus ceiling, default 50000) bounds what the walk parses and reference-validates, while `scan.maxNodes` (default 256) now caps only the graph render. References resolve across the whole corpus, so large repos no longer flag links to unrendered files as broken. Adds the `--max-scan` flag and the `/api/folders`, `/api/branch`, and `/api/scan?meta=1` endpoints that back the lazy folders tree and branch-scoped map.

  ## User-facing

  Large repos now scan and validate references across the whole tree; check folders (with per-folder issue counts) to choose what the map shows. Map palettes count what is shown; a Reset filters button clears it all; the refresh button spins while any scan runs.

### Patch Changes

- Restores the files rail's per-row stale-clock icon, dropped when the rail switched to building from the lightweight `GET /api/folders` payload (which carried the error / warn counts but not the sidecar drift status). The endpoint now emits a `sidecarStatus` field (the persisted `scan_nodes.sidecar_status`, `null` when there is no parseable sidecar), threaded from the kernel loader through the BFF into the rail so staleness flags corpus-wide in demo and `sm serve` mode.

  ## User-facing

  The files rail again flags out-of-date nodes with the clock icon, so you can see at a glance which files have drifted since their last review.

- Body extractors now strip raw HTML (comments and tag tokens) before matching, alongside the existing code-region strip. A markdown link commented out as `<!-- [x](old.md) -->` or hidden in an attribute value (`<img alt="[x](y.md)">`) no longer produces a phantom edge. The strip is bounded to comments and tag tokens, so markdown nested inside a `<div>` block still resolves; `core/backtick-path` is unaffected (HTML is not a code region).

  ## User-facing

  Scanning `.md` files that contain HTML no longer creates phantom links or false broken-reference warnings from links that were commented out or tucked inside HTML attributes.

## 0.55.1

### Patch Changes

- Add a `comingSoon` flag to a Provider's `presentation` (spec + kernel). A coming-soon Provider ships in the registry (node chips still render) but is never selectable as the active lens: auto-detect skips its markers, the BFF drops it from `GET /api/active-provider`'s `selectable` set, and the UI greys it with a `(coming soon)` suffix. `openai`, `antigravity`, and `agent-skills` are marked coming-soon, so only `claude` is selectable today.

  ## User-facing

  Only the Claude provider is selectable for now. Codex, Antigravity and Open Skills appear greyed out as "coming soon" in the provider lens, and projects auto-detect Claude without a lens prompt.

## 0.55.0

### Minor Changes

- `sm version` no longer prints the `kernel` row, and `sm version --json` drops the `kernel` field: the matrix is now `{ sm, spec, dbSchema }`. The CLI and kernel ship in one package and always carried the identical number, so the second row was redundant noise rather than information; the row returns the day the kernel publishes as its own package. Pre-1.0 breaking change shipped as a minor per the versioning policy.

  ## User-facing

  `sm version` no longer shows a separate `kernel` line, it always matched `sm` exactly. The matrix now lists sm, spec, runtime, and db-schema.

## 0.54.0

### Minor Changes

- New committed project setting `allowSidecarWriters` (default `true`) lets shared projects forbid every extension that writes `.sm` annotation sidecars. Actions declare the capability via `writes: ['sidecar']` on their manifest; when the policy is `false` the scan composer drops those actions (buttons never render) and the sidecar store refuses the write (BFF 403 `sidecar-writers-forbidden`), a hard gate that wins over the per-machine `allowEditSmFiles` consent.

  ## User-facing

  Shared projects can now turn off sidecar writers: a new Project setting stops actions from creating or editing the `.sm` files next to your notes. It is saved in the committed settings.json so it applies to the whole team and cannot be overridden locally.

### Patch Changes

- The inspector tag row (`<sm-node-tags>`) is now an inline editor: `core/node-set-tags` no longer self-projects an `inspector.action.button`; a pencil opens an add / remove editor (shown even with no tags) that offers the tags already present in the graph as click-to-add chips, derived live from the loaded scan; typing a brand-new tag still works. The author guide's self-projection example switched from Edit tags to Set stability.

  ## User-facing

  Edit a node's tags right where they are shown: click the pencil in the inspector's tag row to add or remove them inline, with one-click chips for tags already used in your graph (you can still type new ones). The separate Edit tags button is gone.

- Add a standalone plugin quickstart doc (a short scaffold then fill then run path with the plugin-lifecycle diagram and links into the full author guide), indexed in the spec README and published in the package. The now-redundant Quick start section was removed from the author guide and its unique co-located-files note (text.ts, the colocated test) folded into the Manifest section as a "Files by convention" paragraph.

- Editorial pass tightening the spec prose docs for concision (lossless, no normative change: no schema, field, enum, exit code, or MUST/SHOULD touched, and the verbatim prompt preamble still matches the conformance fixture), plus a new non-normative "Plugin lifecycle at a glance" overview atop the plugin author guide with an ASCII diagram of the deterministic flow (Provider, Extractor, Analyzer, Action, Formatter) and Hook off to the side, each with a one-line purpose and short example.

## 0.53.0

### Minor Changes

- Ship the `core/node-bump` action and the `core/annotation-stale` analyzer as `experimental`, so the sidecar bump/drift surface is disabled by default (Decision #128). Gated as a unit: with the action disabled no Bump button projects, and with the drift analyzer disabled no stale finding fires. The `sidecar-end-to-end` conformance case drops its `annotation-stale` assertion accordingly (a default scan now surfaces only `annotation-orphan`; the node still carries the derived `sidecar.status`).

  ## User-facing

  The Bump button and the sidecar drift ("stale") finding are off by default now. Staleness still shows on the node's status; re-enable with `sm plugins enable core/node-bump core/annotation-stale` or the Settings toggles.

## 0.52.0

### Minor Changes

- Remove the `supersede` feature end to end. The `supersedes` link kind is dropped from the global link-kind enum, the `annotations.supersedes` and `supersededBy` sidecar fields are removed from the spec, and the three built-ins that powered it (the `core/annotations` extractor, the `core/node-supersede` action, the `core/node-superseded` analyzer) are deleted. Scans no longer produce supersede links, and the inspector drops the Supersede button and the superseded-by banner.

  ## User-facing

  The Supersede inspector button, the "superseded by" banner, and supersede links on the map are gone. The `supersedes` and `supersededBy` keys in `.sm` sidecars are no longer recognized, remove them from any sidecar that still declares them.

## 0.51.0

### Minor Changes

- Normalize every built-in analyzer finding into one canonical message shape via the shared `formatFinding` helper: an optional backtick-quoted subject line, then `L<line>: <what>; <why>` (the `L<line>:` prefix only when the finding maps to body line(s)). Remediation advice moves out of `message` into `Issue.fix.summary`. `issue.schema.json` documents the grammar as normative; all 14 message-emitting analyzers were migrated, so `sm check` and the UI Inspector read consistently.

  ## User-facing

  **Finding messages now read the same way everywhere.** Each one shows the offending subject on its own line, then `L<line>: what; why`, with the fix hint shown separately instead of appended. Output in `sm check` and the Inspector is more consistent and easier to scan.

- Redesign the link-confidence scoring model: the kernel seeds a 1.0 baseline on every link (the per-extractor emit floor is dropped) and the score-phase detectors subtract a fixed penalty on top, so `core/name-reserved` lands a reserved link at 0.1 and `core/reference-broken` a broken one at 0.5, while disabling a detector leaves its link at 1.0. The built-in `core/score-resolution` analyzer is deleted (its 1.0 is now the baseline), so a clean resolved link records no `scan_link_scores` row.

  ## User-facing

  **Link confidence now starts at 1.0 and each rule subtracts a fixed amount.** A clean link reads 1.0, a reserved one 0.1, a broken one 0.5. Turning a rule off leaves its links at full confidence. The internal score-resolution scorer was retired.

- Rename the built-in analyzer `core/link-conflict` to `core/link-kind-conflict`. The rule flags two detectors emitting different `kind` values for the same `(source, target)` pair, so the id now names what it actually checks (a kind disagreement). Folder, id, texts, spec, and tests were renamed together, no compatibility alias. The rule also gains a `fix.summary` remediation hint (drop one conflicting source, or ignore the overlap deliberately).

  ## User-facing

  **The `link-conflict` rule is now `link-kind-conflict`.** If you enabled or disabled it via `sm plugins`, re-apply the toggle under the new id; the old id is no longer recognized. The warning it raises is unchanged.

- Rename `core/signal-collision` to `core/extractor-collision` (the rule surfaces two extractors colliding over the same span of text; "Signal" was internal IR jargon) and drop the dead `extractorDisabled` / `belowFloor` rejection stubs from the resolver schema, the `ISignalResolution` type, and the analyzer. The finding now carries the canonical `L<line>:` prefix and a `fix.summary` hint (rephrase one token, or accept the winner).

  ## User-facing

  **`signal-collision` is now `extractor-collision`** and reads clearer: it points at the body line, names the two extractors that overlapped, and suggests how to resolve it (rephrase one token, accept the winner, or flip the tiebreak).

- Rename `core/trigger-collision` to `core/name-collision` and key it on the resolution identifier instead of the slashed trigger. It fires (`error`) when two or more name-resolvable nodes (kinds whose `identifiers` include `frontmatter.name`) declare the same normalised `name`. The subject is the bare name (the old `/` sigil was wrong for agents), and case / separator invocation variants no longer false-positive.

  ## User-facing

  **`trigger-collision` is now `name-collision`** and fires only when two files declare the same resolvable name (a command and an agent both named `deploy`, say), across any name-resolvable kind. Plain notes, addressed by path, never collide.

- Make the link-confidence scoring mechanism spec-official. `analyzer.schema.json` gains a `phase` enum so external analyzers can declare `phase: 'score'` and adjust link confidence via `ctx.adjustConfidence(link, op)` (op kinds `set` / `delta` / `ceil` / `floor`), folded deterministically and clamped to [0,1] before the read-only phases. The spec now documents the phase, the fold, and the `scan_link_scores` attribution table, with a `score-phase-confidence` conformance case locking it.

  ## User-facing

  **Plugin authors can ship a `score`-phase analyzer that adds or subtracts link confidence.** Declare `phase: 'score'` and call `ctx.adjustConfidence(link, op)` to compose on top of the kernel's own scoring; every adjustment is recorded in `scan_link_scores` for auditing.

- The `/ws` server now pings every client every 30s so idle connections survive intermediary proxies and half-open peers get terminated, and the SPA's WebSocket client resets its reconnect backoff only after a connection stays open long enough to be stable. Together these stop a flapping connection from looping at 1s and re-seeding `GET /api/scan` in a tight poll storm; an unrecoverable drop now escalates to the non-fatal 'connection lost' state.

  ## User-facing

  **The live view stops hammering the server on a dropped connection.** Idle tabs stay connected instead of silently dropping, and a connection that cannot recover now shows a clear 'connection lost' notice instead of retrying scans forever in the background.

## 0.50.0

### Minor Changes

- Plugin extensions declare operator-configurable `settings` in their manifest, read at scan time via `ctx.settings` and resolved through the config layers under `plugins.<id>.extensions.<extId>.settings`. The `sm plugins config <plugin>/<ext>` verb, `GET`/`PATCH /api/plugins`, and per-plugin sections in Settings all read and write them; `secret` values route to the gitignored project-local file (no encryption). Adds a `number` (decimal) input-type to the catalog.

  ## User-facing

  Plugin extensions can expose options: edit them per plugin in Settings (one global Apply) or via `sm plugins config <plugin>/<ext>` (saved in `.skill-map/settings.json`; secrets stay local, never committed). Run `sm scan` to apply. New decimal `number` option type.

## 0.49.0

### Minor Changes

- Inspector action buttons are now self-projected by the dispatching Action instead of a sibling projector Analyzer: an Action may declare a `ui` button plus an optional deterministic scan-time `project(ctx)` (read-only graph) that emits its own `inspector.action.button` per node. The pure projector analyzers `core/supersede` and `core/tags` were removed and `core/annotation-stale` trimmed to its badge + issue (the Bump button moved to `core/node-bump`).

  ## User-facing

  No change to how the inspector behaves: the Supersede, Edit tags, and Bump buttons look and work exactly as before, they are just now produced by the action they trigger rather than a separate analyzer.

- Extensions declaring `stability: 'deprecated'` now also ship DISABLED by default, joining `experimental` in the ships-disabled set: a deprecated extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override), the same opt-in `experimental` uses. `beta` / `stable` keep running. No built-in is deprecated today, so the default scan is unchanged until one is marked.

  ## User-facing

  Deprecated plugin extensions now start **disabled**, like experimental ones: they show an off toggle (with the deprecated badge) in Settings and `sm plugins list`, and don't run until you enable them. Enabling one keeps it working while you migrate off it.

- Extensions declaring `stability: 'experimental'` now ship DISABLED by default: their installed default flips from enabled to disabled, so the extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override). `beta` / `deprecated` / `stable` keep running. Built-ins flipped to experimental: `core/mcp-tools` and the Supersede declarer (`core/supersede` button + `core/node-supersede` action).

  ## User-facing

  Experimental plugin extensions now start **disabled**: an off toggle (with the experimental badge) in Settings and `sm plugins list`, not running until you enable them. The MCP tools extractor and the Supersede button are experimental, so both are off until you turn them on.

- The scan now captures each file's modification time (`mtime`) from the walker's existing `lstat`, persisted on `scan_nodes.modified_at_ms` and surfaced on the node wire shape as `modifiedAtMs` (nullable for virtual / derived nodes). The files table gains a sortable "Modified" column at the end, rendered as an ISO short date with a full date+time tooltip; sorting orders by the raw timestamp and sinks fileless nodes to the bottom. The value never participates in `bodyHash` / `frontmatterHash`.

  ## User-facing

  The files table has a new **Modified** column showing when each file was last edited (for example `2026-06-13`). Click the header to sort newest or oldest first, and hover a cell to see the exact date and time.

- `sm plugins show` is now extension-only: it takes a qualified `<plugin>/<ext>` id and renders one extension's detail. The whole-plugin view (manifest plus extension rows) moves to `sm plugins list <id>`, and the top-level `sm plugins list` index drops the per-extension name sub-lines. A bare `show <plugin>` id and a qualified `list <plugin>/<ext>` id are each rejected with a directed redirect to the other verb.

  ## User-facing

  **Plugin commands split by altitude.** `sm plugins list <id>` now shows a whole plugin's extensions (kinds, versions, status); `sm plugins show` is for a single `<plugin>/<ext>` extension. The plain `sm plugins list` stays a clean index, one row per plugin.

### Patch Changes

- `core/backtick-path` now matches bare `.md` filenames inside code spans, not only slashed paths: a backticked `` `algo4.md` `` becomes a `points` edge the way the runtime follows it. The `/` separator is now optional, with the first path segment anchored to a word char so globs and placeholders (`{PROJECT}-x.md`, `*-S.md`) stay rejected. Slashless names like `SKILL.md` match too; a self-reference becomes a self-loop, other misses flag via `core/reference-broken`.

  ## User-facing

  Backticked filenames now become links even without a folder: writing `` `algo4.md` `` inside code formatting (not just `` `docs/algo4.md` ``) draws an arrow to that file in the graph, matching how an agent actually follows the reference.

- Broken graph edges now render fainter than resolved ones. `core/markdown-link` emits the spec's `0.95` (unambiguous syntax) instead of a hardcoded `1.0`, and the post-walk confidence-lift transform adds a `BROKEN_TARGET_CONFIDENCE = 0.5` downgrade for links that resolve to nothing (no path and no name-index match, like `core/reference-broken`). A dangling `[x](missing.md)`, `@missing.md`, or `/no-such-command` now sits at `0.5`, below a resolved `1.0` and above a reserved `0.1`.

  ## User-facing

  Broken links in the graph now appear fainter than working ones: a markdown link, `@file`, or `/command` pointing at something that does not exist renders at low opacity, so dangling references stand out at a glance instead of looking like solid edges.

- The post-walk confidence-lift transform no longer bumps a link to `1.0` when its resolved target is a `virtual: true` node (today only `core/mcp-tools`' `mcp://<server>` nodes, reconstructed from frontmatter, never verified on disk). The edge still resolves (`resolvedTarget` set, navigable) but keeps its extractor emit confidence, so an MCP edge stays `0.85`: an unverified entity is not full certainty, like the reserved-target downgrade.

## 0.48.0

### Minor Changes

- Adds the `core/backtick-path` extractor: relative `.md` paths written inside inline code spans and fenced blocks become edges, resolved like markdown links. The token grammar is pinned in `spec/architecture.md` (new section "Extractor: code-region file references"), unresolved targets surface via `core/reference-broken`, and the kernel exports `extractCodeRegions`, the exact inverse mask of `stripCodeBlocks`.

  ## User-facing

  Skills that tell the agent to read a bundled doc with a backtick path (like `references/rules.md`) now show those arrows on the map, and a backtick path pointing at a missing file is flagged as a broken reference.

- Extensions can declare an optional `stability` lifecycle label (`experimental`, `beta`, `stable`, `deprecated`) in their manifest. Presentation-only: non-default values render as a badge in `sm plugins list` / `sm plugins show` and the Settings plugins panel; missing means `stable` and the kernel never gates behaviour on it. Declared in the spec's extension base schema and threaded through the loader, the BFF, and the SPA. `core/mcp-tools` is the first built-in flagged `experimental`.

  ## User-facing

  **Plugin maturity at a glance.** Extensions can now carry an experimental, beta, or deprecated badge next to their name in the Settings plugins panel and in `sm plugins list`, so you can tell which parts of a plugin are still settling before relying on them.

- Adds the `points` link kind to the closed enum: `core/backtick-path` now emits `points` instead of `references`, so a backtick path and a markdown link to the same target persist as two coexisting edges instead of merging, and `core/link-conflict` treats `points` as compatible with every other kind (no false conflict warns). `core/reference-broken` labels the kind "pointer".

  ## User-facing

  Backtick paths get their own "Points" connector kind: a new palette toggle with a backtick glyph, its own edge colour per theme, and arrows separate from markdown-link references on the map.

## 0.47.0

### Minor Changes

- Inspector action-button adopters: `core/node-stability`, `core/supersede` and a new `core/tags` analyzer emit Set stability / Supersede / Edit tags buttons, each parametrized via an input-type prompt pre-loaded with the current value, backed by deterministic actions `core/node-set-stability`, `core/node-set-tags`, `core/node-supersede`.

  ## User-facing

  The inspector now offers Supersede, Set stability and Edit tags buttons; each opens a small form pre-filled with the node's current value.

- Plugins can now contribute action buttons to the inspector: a new `inspector.action.button` slot renders buttons that dispatch a kernel Action via `POST /api/actions/:id`, and the two header badge sub-slots collapse into one `inspector.header.badge` slot. The `.sm` write consent splits into `confirm` (one-shot) and `always` (persists `allowEditSmFiles`). `core/annotation-stale` now emits the Bump button and stale badge as contributions instead of hardcoded UI.

  ## User-facing

  The inspector now renders the Bump button and the stale indicator from a plugin instead of hardcoded UI. Writing a `.sm` sidecar now asks for consent every time, with an "always allow" checkbox that persists the permission for the project.

- Inspector body view contributions now render one collapsible section per plugin (titled by the trusted `pluginId`, collapsed by default) instead of a shared drawer; the `inspector.body.section` slot is retired. New optional inspector-only `order` fields on `plugin.json` (sorts sections) and the extension manifest (sorts bricks) drive layout, default 100. `inspector.action.button` is now uncapped.

  ## User-facing

  Plugin contributions in the inspector now appear as one collapsed section per plugin, ordered by the new `order` fields you can set in `plugin.json` and your extension manifest. The inspector also shows every action button a plugin contributes.

- Runtime contribution rejections (an undeclared ref, or a payload that fails the slot's schema) are now persisted per scan to a `scan_contribution_errors` table. `sm plugins doctor` prints a per-plugin "Runtime contribution errors" section and exits non-zero when any exist; `GET /api/plugins` embeds a per-plugin `runtimeContributionErrors[]` field the Settings panel renders as a warning badge plus a collapsible list. The `extension.error` scan event still fires.

  ## User-facing

  `sm plugins doctor` now reports view-contribution errors from your last scan (and exits non-zero if any), and the Settings plugin panel shows a per-plugin warning badge with the failed emissions, so a plugin whose chips silently vanished now tells you why.

- View contributions are now emitted by object reference, not a string id: declare each as a const in the `ui` map and pass it to `ctx.emitContribution(ref, payload)`. The kernel recovers the id by object identity and rejects an undeclared ref with a loud `extension.error`. The payload is type-checked at author time via generated `SlotPayload<slot>` types (AJV still enforces it at runtime). The three list-payload fields were renamed: breakdown `bars`, key-values `pairs`, link-list `links`.

- The `sm tutorial` verb drops its `master` positional variant and now materializes a single `sm-tutorial` skill, restructured into a "book" of ordered parts and chapters with a manifest-driven menu. The advanced walkthrough (plugins, settings, view-slots) and the CLI deep-dive are parts inside that one skill, reached from its menu after the live-UI prologue. `sm tutorial master` exits 2; `.claude/skills/sm-master/` is removed.

  ## User-facing

  `sm tutorial master` is gone. Run `sm tutorial`: the advanced parts (plugins, settings, view-slots) and the CLI in depth are now chapters you pick from a menu inside the tutorial, after the live-UI prologue.

### Patch Changes

- Plugin load failures read better. A wrong view-slot value collapses AJV's `must be equal to constant` wall into one `<path> is not a valid value` linking to the slot catalog (`spec/view-slots.md`) on GitHub; other manifest errors link to the kind schema. The warning is one non-repetitive line, `plugin <id> (<status>), all extensions skipped: <reason>`. Plugin-load warnings also no longer print twice at `sm serve` boot.

  ## User-facing

  Clearer plugin errors: a wrong view-slot name now gives a short message linking to the slot catalog, and the warning spells out that the plugin and all its extensions were skipped. It also no longer appears twice when the server starts.

- Harden test and conformance coverage for the emit-by-reference view-contribution refactor: orchestrator rejection-path and renderer unit tests, `sm plugins doctor` runtime-error coverage, two new conformance cases (renamed list payloads with off-shape rejections, and a manifest declaring all 14 slots) plus a fixture-drift fix. The conformance suite now runs in CI via `validate:test`, and the `plugins doctor` docs gain a runtime-error note. No CLI or normative spec change.

## 0.46.0

### Minor Changes

- The active-provider lens dropdown in Settings → Project now greys out (and refuses to select) any Provider the operator has disabled. `GET /api/active-provider` gained a `selectable` field listing the Provider ids that are enabled right now; the SPA renders Providers absent from it as disabled instead of offering a lens whose extractors would never run.

  ## User-facing

  Disabling a provider plugin now removes it as a choice in **Settings → Project → Active provider**. The provider stays listed but greyed out and labelled `(disabled)`, so you can no longer switch the lens to a provider whose extractors would not run.

- `sm bump` and the BFF bump route (`POST /api/sidecar/bump`) now stamp `audit.lastBumpedBy` / `audit.createdBy` with the project's Git author name (`git config user.name`) when the node lives in a Git repository, falling back to the channel literal (`'cli'` / `'ui'`) otherwise. This supersedes Decision A5, which kept the invoker a literal.

  ## User-facing

  Bumping a node now records **who** bumped it: the audit `by` fields show your Git author name (`git config user.name`) instead of `cli` / `ui`, when the project is a Git repo. It falls back to `cli` / `ui` outside a Git repo or when no `user.name` is configured.

### Patch Changes

- The `core/annotation-stale` analyzer is now neutral instead of warning-tinted: drift is informational, not a warning. Its footer chip (`staleIcon`) carries no severity (the clock renders in the foreground colour instead of the warn tint), and the stale Findings issue is lowered from `warn` to `info`. As `info`, it no longer counts toward the card's warn chip (the issue-counter buckets error/warn only) and never affected `sm check`'s exit code (info and warn are both non-failing).

## 0.45.1

### Patch Changes

- Fuse the standalone files and map views into one workspace at `/`: a resizable files rail, the graph, and a floating inspector linked through the shared `?path` selection. The rail curates which nodes the map shows via per-file/per-folder visibility checkboxes, folder-depth presets, and an isolate-chain gesture (persisted to localStorage); the layout reset re-arranges only the visible nodes. Retires the `/files` and `/map` routes and the stability / has-issues / stale filters.

  ## User-facing

  The Files and Map tabs are gone: skill-map opens on one screen, file tree left, graph right. Tick files or folders (or the 0/1/2 depth buttons) to pick what the map shows; the tree's map icon isolates a node's whole chain. "Re-arrange layout" tidies just what's visible.

## 0.45.0

### Minor Changes

- `sm plugins create <kind> <plugin-id>` now takes the extension kind as a required first positional and scaffolds a loader-clean stub for each of the six kinds (provider, extractor, analyzer, action, formatter, hook). The slot / input-type catalog gains a single source of truth: the spec enums become `oneOf` const+description, and the kernel + CLI mirrors are generated from it by `scripts/generate-view-catalog.js`, guarded by `view-catalog:check` in `validate:compile`.

  ## User-facing

  `sm plugins create` now takes the extension kind as a required first argument: `sm plugins create <kind> <plugin-id>` (kinds: provider, extractor, analyzer, action, formatter, hook). Previously it only scaffolded extractors.

## 0.44.0

### Minor Changes

- Wired the `tokenizer` project-config key to actually select the scan encoder. It is now a closed enum (`cl100k_base` default, `o200k_base`); the resolved name is recorded in `scan_meta.tokenizer` / `ScanResult.tokenizer` and an out-of-set value is dropped with a warning and falls back to the default. The orchestrator lazily loads only the chosen `js-tiktoken` rank table, and an incremental scan recomputes per-node token counts when the persisted encoder differs from the resolved one.

  ## User-facing

  **Pick your tokenizer.** `tokenizer` in settings.json now selects the encoder for token counts: `cl100k_base` (default, GPT-4) or `o200k_base` (GPT-4o). Any other value is ignored with a warning. Changing it recomputes counts on the next scan.

### Patch Changes

- Detect database schema drift by fingerprint. A sha256 of the migration DDL is stored in `scan_meta.schema_fingerprint` per scan and checked at open, so a DB whose columns fell behind an inline schema edit is caught instead of failing later as a cryptic `no such column` error. Write paths (`sm scan`, `sm serve`) prompt to rebuild (or `--yes`); read verbs warn and point at `sm scan` / `sm db reset`.

  ## User-facing

  skill-map now notices when your local DB schema is out of date (not just an older version): `sm scan` and `sm serve` offer to rebuild the cache, and read commands warn instead of failing with a confusing database error.

## 0.43.0

### Minor Changes

- `sm <namespace> --help` (and `sm help <namespace>`) now render a namespace overview, header, USAGE, an optional DESCRIPTION, and a COMMANDS list of the subcommands, for command prefixes that own subcommands but are not themselves runnable (`plugins`, `db`, `config`, `job`, `actions`, `sidecar`, `hooks`, `conformance`, plus nested ones like `plugins slots`). Previously these fell through to Clipanion's terse "Multiple commands match" listing. Leaf verbs and unknown names are unchanged.

  ## User-facing

  `sm plugins --help` (and `db`, `config`, `job`, and the other command groups) now print a tidy overview with a one-line description and a list of their subcommands, matching the look of `sm scan --help`, instead of a terse internal list.

- Removed seven project-config keys that had no runtime consumer: `i18n.locale`, `providers` (the enabled-list; `activeProvider` stays), `history.share`, the `autoMigrate` config key (the `sm db migrate` / `backup` adapter option is untouched), `plugins.<id>.config`, `plugins.<id>.extensions`, and `scan.followSymlinks` (the walker always hard-skips symlinks). Dropping `plugins.<id>.config` closed the last open subtree, so project-config is now fully `additionalProperties: false`.

  ## User-facing

  **Config cleanup.** Several settings.json keys that never did anything (`i18n`, `providers`, `history`, `autoMigrate`, `scan.followSymlinks`, per-plugin `config` / `extensions`) were removed. If still present they are now ignored and reported with a warning on load.

### Patch Changes

- Normalize plugin terminology: "bundle" is no longer used as a synonym for "plugin". The installable unit is now consistently called a "plugin" everywhere (types, identifiers, spec prose, CLI output, and Settings labels); the word "bundle" is reserved exclusively for the aggregate toggle that flips all of a plugin's extensions at once (the "bundle macro"). No behavior or wire-shape changes.

  ## User-facing

  `sm plugins list` / `show` and the Settings → Plugins UI now consistently say "plugin" instead of "bundle". The only place "bundle" remains is the name for toggling a whole plugin (all its extensions) at once.

## 0.42.0

### Minor Changes

- `sm tutorial` now materializes the walkthrough skill into the chosen agent's territory instead of always `.claude/skills/`. Providers declare an optional `scaffold` block (`skillDir` plus display-only `aka` names); the destination comes from `--for <provider>` or a prompt defaulting to Claude. It now also requires an empty cwd, seeding a self-contained scenario the tester can later delete wholesale, so a non-empty directory is refused (exit 2) unless `--force` is passed.

  ## User-facing

  `sm tutorial` can now target other agents: `--for agent-skills` (open-standard layout, used by Antigravity and OpenAI Codex) or `--for claude` (default). It now requires an empty directory: run it in a fresh folder, or pass `--force` to seed into the current one.

## 0.41.0

### Minor Changes

- Reserved-name detection gains a lens scope: when a Provider is the active lens, its `reservedNames` catalog also applies to the `agent-skills` skill nodes its runtime consumes, matched by kind. This activates Google Antigravity's catalog, refreshed from `agy /help` (v1.0.3) and now declared under `skill`, so a `.agents/skills/<name>` skill shadowing a built-in like `/goal` is flagged by `core/name-reserved` under the antigravity lens. Claude is unchanged.

  ## User-facing

  Under the Antigravity lens, `sm scan` now warns when a `.agents/skills` skill shadows a built-in `agy` slash command (e.g. a skill named `goal` collides with `/goal`), so you can rename it before the runtime silently ignores the file.

- Add opt-in, anonymous error reporting (Sentry) across the CLI, BFF, and UI, OFF by default. Consent lives in `~/.skill-map/settings.json` (`telemetry.errorsEnabled`), surfaced through `GET/PATCH /api/preferences` and a new Settings Privacy toggle; `SKILL_MAP_TELEMETRY=0` force-disables every surface. A pure, deny-by-default scrubber strips home paths and host identity from every event before it leaves the machine. The normative contract is `spec/telemetry.md`.

  ## User-facing

  skill-map can now report crashes anonymously to help fix bugs, and it is OFF by default. Turn it on or off in Settings, or set `SKILL_MAP_TELEMETRY=0` to force it off. File contents, paths, and your settings are never sent.

- Add opt-in, anonymous usage analytics (PostHog) for the CLI and UI, OFF by default. Three independent toggles in `~/.skill-map/settings.json` (`telemetry.usageCliEnabled`, `usageUiEnabled`, alongside `errorsEnabled`); one shared first-run prompt consents to all and mints an anonymous install id used as the PostHog `distinct_id`, exposed read-only via `GET/PATCH /api/preferences`. `SKILL_MAP_TELEMETRY=0` force-disables every surface. Contract: `spec/telemetry.md`.

  ## User-facing

  skill-map can now share anonymous usage (which commands and views you use) to guide development, OFF by default. Toggle CLI usage, UI usage, and error reports independently in Settings, or set `SKILL_MAP_TELEMETRY=0` to force all off. Files and paths are never sent.

### Patch Changes

- Sync the plugin author guide and architecture spec to the structure-as-truth manifest model (`annotation` singular, `ui` view map, on-disk Provider kinds, `precondition` filter, deterministic-only hooks); the guide now delegates instead of duplicating. Fix stale field names and the slot count (14) across architecture.md, db-schema.md and the conformance coverage, and fold the architecture diagram into architecture.md, dropping the generated CLI-reference mirror for `sm help --format md`.

## 0.40.0

### Minor Changes

- dc5c115: Migrate the canonical domain from `skill-map.dev` to `skill-map.ai` everywhere: schema `$id` / `$ref` and the `spec/index.json` canonical URL prefix, the bundled plugin schemas and validators, the public site (canonical URLs, Open Graph, Twitter, JSON-LD, the `/demo/` deploy), and the UI's Settings about-link and demo banner. No shape or behavior change; the spec scheme stays `v0`.

  ## User-facing

  The skill-map website and in-app links (Settings, About and the demo banner) now point to **skill-map.ai** (previously skill-map.dev). Spec schema URLs are now `https://skill-map.ai/spec/v0/...`.

- 43eb1e5: Frontmatter coverage pass for Claude and the Agent Skills open standard, plus a breaking revert of dual-source tags to single-source. Claude's `skill-base` gains the `disallowed-tools` denylist; the `agent-skills` Provider declares the open-standard `license` / `compatibility` / `metadata` / `allowed-tools` fields; and `tags` now live only in the `.sm` sidecar, dropping the universal `tags` field, the `scan_node_tags.source` column, and the `sm list --tag-source` flag.

  ## User-facing

  Claude skills and commands now show their `disallowed-tools` in the inspector. Tags come only from `.sm` sidecars now: the `sm list --tag-source` flag is removed and cards show a single tag style. Agent Skills `license` / `compatibility` / `metadata` fields are recognized.

- e953f9f: Pre-1.0 schema-drift rebuild: `sm scan`, `sm watch`, and the BFF watcher compare `scan_meta.scanned_by_version` against the running CLI and, on any `major.minor` difference, delete and recreate the project DB from `001_initial.sql` instead of failing on the stale schema. The DB is a derived cache (`.sm` sidecars hold the authored data) so no backup is taken; patch differences stay compatible and read verbs keep the version-skew advisory.

  ## User-facing

  After updating skill-map, the next `sm scan` rebuilds the local database when it was created by an older version (your `.sm` sidecar files are never touched). On a terminal it asks first; pass `--yes` to skip the prompt.

## 0.39.0

### Minor Changes

- f2b59c5: Makes the registered Provider set the single source of truth for the UI's provider surfaces (active-lens dropdown, topbar lens chip, per-node provider chip) and for active-lens auto-detection. Removes four divergent hardcoded provider lists that no longer matched the real built-in Providers (the lens dropdown offered phantom `gemini` / `cursor` entries and hid the real `antigravity` / `agent-skills`; the card chip did not know `openai` / `antigravity`; the detection table still listed `cursor`).

## 0.38.0

### Minor Changes

- d3c47b2: Adds a hard cap on the number of files `sm scan` and `sm watch` accept after `.skillmapignore` filtering, plus a persistent UI banner that fires when the graph crosses the recommended limit. Default cap is **256 nodes**. Override per invocation with `--max-nodes <N>` (bidirectional: raises OR lowers the cap).

## 0.37.0

### Minor Changes

- d852217: Eliminate the bundle-level toggle entirely. Every plugin extension is now independently toggle-able by its qualified `<bundle>/<ext>` id; the bundle itself is a presentational grouping only.

### Patch Changes

- f66dbfe: Decouple built-in extensions from per-extension semver. Built-ins ship inside the CLI bundle, so authors no longer declare a `version` literal in each `<plugin>/<kind>s/<name>/index.ts` manifest under `src/plugins/`. The codegen at `scripts/generate-built-ins.js` now reads the CLI version from `src/package.json` and stamps it onto every built-in (alongside the existing `pluginId` stamp) when emitting `src/plugins/built-ins.ts`. The resulting runtime objects still satisfy the full kind interface (`IAnalyzer`, `IExtractor`, ...) and every downstream consumer continues to see `ext.version: string`, so `state_executions.extension_version` keeps recording a meaningful value (= CLI version) for reproducibility.

- 457a60d: Reserve the `graph.node.alert` slot for special-case signals; disconnect every built-in core analyzer from it. Define the **chip-vs-issue policy** for plugin authors and align `reference-broken` to it. The corner badge on the NE tip of each graph card is no longer a generic "this node has a problem" surface. Routine findings (`reference-broken`, `annotation-field-unknown`, `schema-violation`) now ship only as `card.footer.right` chips, the slot's natural home for paired-icon-and-count signals.

- d66bc71: Three findings from a second `sm-tutorial` external-tester session (Adolfo, 2026-05-25).

## 0.36.0

### Minor Changes

- 8ab68ed: Rename `core/field-unknown` to `core/annotation-field-unknown` so it
  groups alphabetically with the other sidecar (`.sm`) annotation rules
  (`core/annotation-orphan`, `core/annotation-stale`). The rule's job has
  not changed: it still flags typos / unrecognised keys in sidecars and
  emits a warn issue plus the same `alert` + `chip` view contributions
  on `graph.node.alert` / `card.footer.right`.

- 880fe3e: Rename 14 built-in extension ids to a consistent `<domain>-<detail>` pattern. The naming was inconsistent: 10 ids already followed the "area first, attribute after" shape (e.g. `annotation-orphan`, `link-conflict`) while 14 were inverted, redundant, or vague. All built-ins now agree.

- 1b6e368: Honour per-extension toggles inside bundle-granularity plugins end-to-end. Closes the Phase 4b follow-up (commit `e45d2fd`) gap: BFF + Settings UI started accepting per-extension toggles for any granularity, but three call sites still treated bundle granularity as "one knob, every extension follows", so flipping an individual extension off (e.g. `claude/at-directive`) persisted to `config_plugins` and then did nothing on the next scan.

## 0.35.0

### Minor Changes

- de68f09: Soft-warn drift detection for the active provider lens. When `activeProvider` is set (whether by auto-detect on first scan, the interactive prompt for ambiguous markers, or `sm config set activeProvider <id>`), the runtime now persists the set of provider markers that existed on disk at the moment of the choice as `activeProviderMarkers` in `.skill-map/settings.json`. On every subsequent scan the bootstrap re-detects markers and diffs against this snapshot; when the diff is non-empty (new markers appeared, recorded markers disappeared), it emits ONE soft warn before the scan and continues with the cached lens.

- a58989f: Lens-gated classification for vendor providers. Vendor Providers (`claude`, `openai`, `antigravity`) now opt into being gated by the active lens via a new `gatedByActiveLens: true` field on their manifest. The walker (`src/kernel/orchestrator/walk.ts`) pre-filters `opts.providers` before the walk loop: a gated Provider runs only when `provider.id === opts.activeProvider`, so vendor providers no longer attempt to classify files outside their lens. Universal providers (`core/markdown`, future `agent-skills` open standard) leave the flag absent / `false` and run unconditionally.

- d207cfa: Observable link analysis. The link-matrix walkthrough surfaced a recurring complaint, "the inspector tells me there is an edge but not where, why, or whether it overlaps with another", and a small cluster of detection bugs that were hiding real problems and inventing fake ones. This changeset is the drain pass.

- 5a12e5c: Phase 2.D of the Signal IR migration: new `core/signal-collision` built-in analyzer surfaces resolver rejections as operator-visible `warn` issues. The analyzer reads `IAnalyzerContext.signals`, finds every Signal whose `resolution.outcome === 'rejected'`, and emits one issue per rejection naming the loser extractor + matched text + byte range, the winner extractor + range, and the tiebreak reason (`kind-priority` / `higher-confidence` / `longer-range` / `earlier-declaration`). Phase 4+ stubs (`extractorDisabled`, `belowFloor`) are handled with their own message templates so the surface stays forward-compatible.

- 3ca095b: Wire the Signal IR resolver end-to-end (Phase 2.A of the active-lens migration). The kernel's `resolveSignals` runs after extraction and before analysis: filters disabled extractors (Phase 4+ stub), ranks intra-Signal candidates via `IProvider.resolverRules.kindPriority` (when declared) + confidence + extractor declaration order, builds overlap clusters from body-scoped Signals sharing a source, picks a cluster winner per the four-step tiebreak chain (`kind-priority` -> `higher-confidence` -> `longer-range` -> `earlier-declaration`), materialises winners as Links indistinguishable from `emitLink`-emitted ones, and annotates each Signal's new `resolution` field with the outcome + reason. Rejected (losing) Signals remain accessible to analyzers via `IAnalyzerContext.signals` so a future `core/signal-collision` analyzer can surface them as `warn` issues naming WHO won and WHY.

### Patch Changes

- 1362de9: Phase 2.B of the Signal IR migration: `claude/at-directive` extractor now routes through `ctx.emitSignal` instead of `ctx.emitLink`. Each `@<token>` match emits a single-candidate Signal carrying the byte range, scope (`body`), and a candidate with the same kind / target / confidence / trigger / rationale shape the extractor used to embed directly into a Link. The resolver phase materialises the winning candidate as a Link indistinguishable from the prior direct-emit shape, including `occurrences[]` round-tripping; full `pnpm validate` stays green with 1734 tests passing and zero behaviour change.

## 0.34.0

### Minor Changes

- 2593664: Retire the `gemini` Provider and onboard the `antigravity` Provider. Google released the Antigravity CLI on 2026-05-19 as the replacement for the Gemini CLI (which sunsets 2026-06-18 for consumer tiers). Antigravity preserved the four pillars of Gemini CLI (Agent Skills, Hooks, Subagents, Extensions/plugins) but adopted the open-standard `.agents/` layout instead of carrying forward a vendor-specific `.gemini/` directory, so the old Provider classified obsolete paths.

- ee919da: Reserved-name catalog per Provider. Each Provider runtime owns a set of invocation names its built-ins consume (Claude reserves `/help`, `/clear`, `/init`, `/agents`, `/model`, … under `command`, and `general-purpose`, `output-style-setup`, `statusline-setup` under `agent`). User files declaring one of these names are silently shadowed at runtime, the kernel now surfaces the collision.

## 0.33.0

### Minor Changes

- da26519: Provider-aware confidence bump for resolved invocation links. Three changes ship together.

## 0.32.1

### Patch Changes

- 4af662b: Loosen the active-provider lens gate to lens-only: per-provider extractors run on every visited node when the active lens is in the extractor's declared `precondition.provider` allowlist, regardless of which provider classified the node.

## 0.32.0

### Minor Changes

- a5d6f12: `sm plugins enable` and `sm plugins disable` now accept multiple plugin ids in one invocation, e.g. `sm plugins disable gemini openai agent-skills`. The single-id form and `--all` keep working unchanged.

## 0.31.0

### Minor Changes

- 29fb253: Active-provider lens model, Signal IR scaffold, numeric `Confidence`, MCP virtual nodes, OpenAI Codex provider, and the Phase 4b extractor mudanza in one coherent migration.

## 0.30.0

### Minor Changes

- 5f4b181: Remove `@skill-map/testkit` and `examples/hello-world` from the monorepo.
  The packaged plugin-author helper layer is retired. Plugin authors test
  extensions by building fake `ctx` literals against the public types
  re-exported from `@skill-map/cli` (`IExtractor`, `IAnalyzer`,
  `IFormatter`, the matching `*Context` shapes, `Node`, `Link`, `Issue`).
  Reason: zero downstream consumers in the public ecosystem after Step
  9.3; the maintenance cost of an independently-versioned npm package +
  its own changesets, validate phases, and narrative outweighed the value
  of a thin packaged helper layer.

- d95e5b8: Remove the `scan.extraFolders` config key. Project-local persistent
  extension of the indexed scan no longer exists; to walk a directory
  outside the project root pass it as a positional argument to
  `sm scan [roots...]` (per-invocation, not persisted). The narrower
  `scan.referencePaths` key (validate links against on-disk files
  without indexing them) is unaffected.

## 0.29.0

### Minor Changes

- 4e0646c: Document the LLM-aligned semantics that landed in `core/at-directive`
  and `core/slash`. `spec/plugin-author-guide.md` § Extractors now
  describes the dispatch rules the built-ins follow: bare and
  namespaced `@<handle>` tokens emit `mentions`, file-flavoured
  `@<...>.ext` / `@./<...>` / `@/<...>` tokens emit `references`,
  `/<token>` is dropped when followed by another identifier or slash
  (path / URL territory), and both extractors strip fenced + inline
  code regions before matching. Plus a normative note in
  `spec/db-schema.md` § Rename detection: the `orphan` info issue is
  suppressed when the disappeared `deletedPath` is currently filtered
  by the active ignore-source (still on disk, just silenced).

## 0.28.0

### Minor Changes

- e21216e: Simplify plugin manifest fields beyond the file-layout refactor. The
  previous `structure-as-truth-plugins` changeset moved bundle / kind /
  id discovery onto the filesystem; this one extends the same principle
  into the manifest schemas themselves so the only fields that survive
  are the ones the kernel cannot derive from disk.

- 8b7abbf: Structure-as-truth refactor for plugin extensions. The filesystem
  layout (rather than declarative manifest fields) is now the single
  source of truth for bundle / kind / extension id.

## 0.27.0

### Minor Changes

- f1efd1b: Remove the `-g/--global` flag and every implicit `$HOME` read from
  skill-map. The CLI now operates exclusively on the project scope
  (`<cwd>/.skill-map/`); there is no global / user scope, no
  `SKILL_MAP_SCOPE` env var, no silent merge of user-level config or
  plugins.

## 0.26.0

### Minor Changes

- 48800d4: Drop `requires`, `related`, and `conflictsWith` from the curated annotation catalog.

## 0.25.0

### Minor Changes

- a53532b: Replace BYTES with TOKENS in the human-mode output of `sm list` and `sm show`. Tokens are the metric users actually care about for LLM budgeting; bytes were a leftover from the early file-size mental model.

- 2129b40: Add an optional positional `variant` argument to `sm tutorial`. Default (no argument) keeps the previous behaviour and materializes `<cwd>/sm-tutorial.md` (the basic walkthrough). Passing `master` materializes `<cwd>/sm-master.md` (the advanced walkthrough: plugin tour, plugin authoring, settings + view-slots) through the same channel. The value is validated against the closed set `{ tutorial, master }`; anything else exits with code 2 and an `invalidVariant` error pointing at the valid values. The build pipeline (`tsup.config.ts → onSuccess`) now copies both SKILL.md sources into `dist/cli/tutorial/`, and the runtime resolver caches each variant independently. CLI i18n strings under `tutorial.texts.ts` were parameterized with a `{{filename}}` placeholder so the success block points the tester at whichever file was materialised. Spec § `sm tutorial` was rewritten to document the new positional and exit-code rule.

## 0.24.3

### Patch Changes

- 2e1c0f4: Third pass of the release-pipeline shakedown. The second pass (`verify-pipeline-second-pass`) confirmed the Railway demo deploy is now green end-to-end, but the post-publish smoke step still failed: `npm i -g @skill-map/cli@0.24.4` returned `ETARGET` for the full 5-retry window even though the registry already had the version (`curl https://registry.npmjs.org/@skill-map/cli/0.24.4` returned 200 during the failure). Root cause is the npm CLI's local metadata cache, the first 404 gets cached and every retry replays it. This bump exists to verify the fix: the smoke step now passes `--prefer-online` (forces a fresh staleness check on every attempt), runs the install from a clean `mktemp -d` cwd (so the repo's pnpm-flavored `.npmrc` does not bleed into npm's config resolution), and retries up to 10 times with 30 second back-off. No code or contract change in any of the four packages.

## 0.24.2

### Patch Changes

- 5eb79ba: Second pass of the release-pipeline shakedown after the pnpm migration. The first pass (`verify-release-pipeline`) surfaced two issues that this bump exists to verify the fixes for: (a) the Railway demo deploy crashed in `web/scripts/build-demo-dataset.js` because `node --import tsx` could not resolve `tsx` from the demo fixture's cwd (pnpm's strict hoist keeps it in `src/node_modules/`), and (b) the post-publish smoke step hit `ETARGET` on `@skill-map/cli@latest` because the npm CDN had not yet propagated tarball metadata at every edge when the install ran. Both are now fixed: `build-demo-dataset.js` imports the tsx loader by absolute `file://` URL, and the smoke step now reads the explicit version from `changesets.outputs.publishedPackages` and retries up to 5 times with 30 second back-off. No code or contract change in any of the four packages.

## 0.24.1

### Patch Changes

- fb52d17: Migrate the monorepo's package manager from npm to pnpm 11.

- 56fef3b: Verify the release pipeline end-to-end after the pnpm 11 migration: `release.yml` boots through `pnpm install --frozen-lockfile`, `release:version` bumps versions and refreshes the lockfile in one shot, `release:publish` propagates the four versioned packages to npm, and `deploy-web.yml` rolls out the new public site on the post-migration `pnpm/action-setup` chain. No functional or contract change in any of the four packages, this exists purely so the next "chore: version packages" PR exercises every moving part of the new pipeline at least once.

## 0.24.0

### Minor Changes

- 2b09ce8: Restrict `node.kind` to `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` in `spec/schemas/node.schema.json`.

## 0.23.0

### Minor Changes

- c1ed77a: Add `IAnalyzer.recommendedActions` so an Analyzer can declare which per-node Actions resolve its findings.

### Patch Changes

- 608e6ae: BFF compliance audit follow-ups (`bff-ruler` on `src/server/`).

- c2152cc: Add `--json` output to four verbs that previously emitted only human-formatted text: `sm refresh` (and `sm refresh --stale`), `sm plugins doctor`, `sm conformance run`, plus `--format json` on `sm graph` (`sm graph` uses the formatter catalog rather than the global `--json` flag). Closes the spec drift where the global `--json` flag was advertised but ignored on these verbs, and unblocks CI / scripting consumers that parse the output.

- 5f4de1c: Security audit sweep (cli-hacker follow-up). Three highs, three mediums, three lows, plus the shared prototype-pollution helper and a plugin-author doc note.

- 639a95b: Strip em dashes (`—`) from spec prose and schema descriptions.

## 0.22.0

### Minor Changes

- 39a61e9: Remove the implicit "scan HOME" surface and consolidate every out-of-project scan path under a single, explicit `scan.extraFolders` setting. Privacy-by-default: the CLI / BFF / UI never read the user's home automatically anymore; every path outside the project root must be listed by the operator.

### Patch Changes

- 1e48d2e: Follow-up sweep on the cli-architect spec-drift audit. Three pieces.

## 0.21.0

### Minor Changes

- f72dbfc: Card body + topbar polish, plus catalog rename of the topbar scope slot.

- 5ed14cb: Disabling a plugin now wipes its `scan_contributions` rows immediately, instead of waiting for the next `sm scan` to sweep them. Without the eager purge, the catalog sweep documented in `db-schema.md` § scan_contributions only ran on the next scan, so the UI kept rendering the plugin's footer / card chips even though the toggle showed `enabled: false`.

- fe13254: Tighten the manifest `icon` grammar on `viewContributions[].icon` from "single emoji-or-PrimeIcons-bare-name" to a prefix-discriminated string with four explicit shapes. Greenfield migration: no compat shim, no `catalogCompat` bump, bare names now fail at manifest load.

- 4f89a84: Plugin toggles in the Settings modal now apply at the next scan instead of needing an `sm serve` restart. The "Restart required" banner is gone for the common case; only plugins that were disabled at server boot keep a per-row warning because their handlers were never loaded into memory.

- b840302: Rename the view slot `card.footer.left.counter` to `card.footer.left`.

- a96c257: Add a per-project consent gate for `.sm` sidecar writes, generalise the "privacy-sensitive, must not be committed" idea to a closed set of project-local-only keys, and cache config on the daemon so repeated reads in `sm serve` no longer re-walk six file layers.

## 0.20.0

### Minor Changes

- a1bfe15: Eliminate the view-contribution `contract` abstraction — plugin authors now pick `slot` directly.

- 5600a60: Hook trigger set grows from 8 to 10: add CLI-process-driven `boot` and `shutdown`. First built-in concrete consumer: `core/update-check` (the once-per-day update banner moves from an inline call site to a hook subscribing to `boot`).

- 802e64f: Rename the `rule` plugin extension kind to `analyzer`.

- 5600a60: Add `sm scan -g` (global scan) plus three privacy-sensitive project scan settings: `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Settings UI exposes them in a new "Project" section.

- 825dce4: View-contribution slot expansion + new `node-icon` contract + host-enforced plugin lock.

### Patch Changes

- 5600a60: Move `updateCheck.enabled` to user scope and add a reusable typed config helper. Settings UI's General section now exposes the toggle.

## 0.19.0

### Minor Changes

- 3376a75: spec 0.18.0 — universal markdown fallback as a built-in Provider. The format-named generic kind `markdown` moves out of the per-vendor Provider catalogs (claude / gemini) into a dedicated built-in `core/markdown` Provider. Markdown is provider-agnostic — no vendor owns the universal `.md` format — and bundling the fallback as a regular Provider under the `core` group preserves the spec invariant that no extension is privileged. The kernel orchestrator now dedups files across the multi-Provider walk so each path is offered to AT MOST one `classify`: vendor Providers retain priority on files inside their territory, and `core/markdown` (registered LAST) picks up exactly the orphan `.md` files no vendor claimed — files at the project root, under `.claude/hooks/`, `notes/`, `CLAUDE.md`, `GEMINI.md`, or anywhere else outside a known vendor path. The fallback can be disabled via `sm plugins disable core/markdown` (consistent with every other extension under `core`); orphan markdown then becomes silently invisible, matching pre-0.18.0 behaviour.

- f0ddae0: Move the cross-vendor Extractors out of the `claude` plugin bundle and into `core`, and rename `frontmatter` → `annotations` to reflect the post-Step 9.6 reality that the canonical home for those structured references is the sidecar `.sm` `annotations:` block (Decision #125), not the markdown frontmatter.

- b3ba3de: Drop the four denormalised fields (`title`, `description`, `stability`, `version`) from the public `Node` surface. The DB columns survive as indexing surface; the JSON wire shape and TypeScript `Node` interface no longer carry them.

- 22f4439: Reduce the Extractor extension kind to **deterministic-only**. The `mode` field is removed from `extractor.schema.json`; `IExtractor` no longer carries `mode`; `IExtractorContext` no longer exposes `ctx.runner`. `Extractor` joins `Provider` and `Formatter` as an extension that sits on the deterministic scan path; LLM-driven enrichment of a node is now strictly an **Action** concern, queued through the job subsystem.

- 40d0a81: Two small wire enrichments that the new Settings modal needs.

- 40d0a81: Add `POST /api/scan` so the SPA's topbar refresh button can trigger a manual scan + persist without dropping the user back to the CLI. The same `runScanWithRenames` + `persistScanResult` pipeline the watcher uses runs end-to-end inside the BFF, broadcasting `scan.started` then `scan.completed` over `/ws` so every connected client refreshes — `CollectionLoaderService`'s reactive subscription already handles the SPA side.

- 496fb72: Complete the `IAnalyzerContext.emitContribution` runtime channel and add `core/link-counts` built-in rule.

- 40d0a81: Add a global Settings modal in the SPA with a Plugins section — the first user-facing surface for toggling installed plugins from the UI. Backed by two new BFF mutation endpoints and an enriched `GET /api/plugins` shape.

- 68709b9: Sidecar schema cleanup: rename root block `for:` → `identity:` and drop the unused `hidden` field from the curated annotations catalog.

- 9f04fc2: Tags · Phase 1 (spec only): declare the dual-source tag system.

- 89c1c17: Add an "update available" notification surface (CLI banner + UI chip).

- 5624143: view contribution catalog reorg + `node-counter` narrowing + `priority` field. Pre-1.0 minor per `spec/versioning.md`; covers what would otherwise be a catalog-major bump.

- 0702381: spec 0.19.0 — view contribution system. Plugin extensions can now surface per-node typed data in the UI by picking a `contract` name from a closed kernel-published catalog (10 contracts: `per-node-counter`, `per-node-tag`, `per-node-breakdown`, `per-node-records`, `per-node-tree`, `per-node-key-values`, `per-node-link-list`, `per-node-summary`, `node-marker`, `scope-summary`) and emitting payloads at scan time via `ctx.emitContribution(id, payload)`. Plugin authors NEVER ship UI code, never write JSON Schema, and never pick UI slots — they declare intent via `viewContributions: Record<string, IViewContribution>` on each extension manifest, and the closed catalog of input-types (10 entries: `string-list`, `single-string`, `boolean-flag`, `integer`, `enum-pick`, `enum-multipick`, `path-glob`, `regex`, `secret`, `key-value-list`) drives the `settings:` declarations on the plugin manifest root. New CLI verbs `sm plugins create`, `sm plugins contracts list`, `sm plugins upgrade` make scaffolding the canonical entry point.

## 0.18.0

### Minor Changes

- 305e75a: Step 9.6.3 — built-in `bump` Action + sidecar write channel. Adds the deterministic `core/bump` Action and the new `ISidecarStore` port (with the `FilesystemSidecarStore` impl) that materialises Action-returned `{ kind: 'sidecar', path, changes }` payloads against on-disk `.sm` files. The Action stays pure — `invoke()` computes a deep-merge patch and returns it; the Store re-reads the on-disk sidecar, deep-merges (objects RECURSE; arrays REPLACE), revalidates the merged result against `sidecar.schema.json` + `annotations.schema.json`, and writes back inside a path-keyed critical section using the standard atomic `.tmp + rename` pattern.

- 79dfdea: Step 9.6 catalog curation. The annotation surface settled in Steps 9.6.1 → 9.6.7 went through a UX review on 2026-05-07; 16 fields with no clear value or that duplicated other surfaces were dropped from the curated catalog, and the per-bump rationale field `audit.bumpReason` was rolled back together with its CLI / BFF inputs.

- 79dfdea: Step 9.6 catalog-curation follow-up (2026-05-07): remove the vestigial `Node.author` denormalisation end-to-end. The 9.6.2 migration sourced `Node.author` from `annotations.author`; the 2026-05-07 catalog curation dropped `author` from `annotations.schema.json`, leaving the column without a canonical source. The earlier curation changeset said `Node.author` would stay untouched; this follow-up reverses that — keeping a denorm path for an opaque `additionalProperties: true` rider was inconsistent with the curated catalog and added persistence + display surface for a field the schema no longer documents.

- 670eaa4: Catalog refinement: drop `released` from the curated annotation catalog. The catalog now stands at **14 fields**.

- d12f7d2: Two new built-in Providers — `gemini` and the vendor-neutral `agent-skills` — plus a tighter `IProvider.classify()` contract so multiple Providers can scan the same roots without colliding.

- e17ff6a: Per-user favorites. The UI gains a subtle heart button on every node card (stacked under the chevron in the actions cluster) plus a "Favorites only" toggle in the filter-bar that hides while the user has zero favorites. State persists across `sm scan` and `sm db reset` because favorites live in a new `state_node_favorites` table (zone `state_`).

- 864e373: Phase 0 of the multi-provider rollout: rename the Claude Provider's fallback kind `note` → `markdown`.

- c47c131: Closes review-queue item R4 (Step 9.6) — introduce a shared deterministic report base so the deterministic / probabilistic split is explicit at the schema level, symmetric with the existing `report-base.schema.json` (LLM-only `confidence` + `safety`).

- 305e75a: Step 9.6.1 — sidecar + annotation schemas. Closes the deferred portion of Decision #124 (where skill-map's own annotation fields live) by introducing two new schemas that lock the shape of the co-located YAML sidecars (`<basename>.sm`) the kernel will start reading in Step 9.6.2.

- 305e75a: Step 9.6.6 (BFF half) — `GET /api/annotations/registered` over the Hono BFF. Read-only catalog of plugin-contributed annotation keys, surfaced so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime. The endpoint is a pure projection of `kernel.getRegisteredAnnotationKeys()` — populated once by `registerEnabledExtensions` after every plugin loads at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec.

- 305e75a: Step 9.6.5 (BFF half) — `POST /api/sidecar/bump` over the Hono BFF. The endpoint mirrors the `sm bump <node.path> [--force]` CLI verb 1:1: same built-in `core/bump` Action, same `FilesystemSidecarStore`, same fresh-vs-stale refusal semantics. The only differences from the CLI verb are the invoker label (`'ui'` vs `'cli'`) and the wire shape. Batch (`--pending`) stays CLI-only at 9.6.5 — surfacing it over REST needs a job-style progress channel and lands later.

- 305e75a: Step 9.6.4 — sidecar CLI verbs. Six new verbs split between `sm bump` (top-level, ROADMAP-named per Decision #125) and the `sm sidecar` sub-namespace (administrative helpers; the existing `sm refresh` from Step A.8 — enrichment-layer — stays untouched). Plus `sm hooks install pre-commit-bump` for the opt-in commit-time auto-bump.

- 305e75a: Step 9.6.6 — plugin annotation contributions + Tier-1 `unknown-field` rule. Closes the last sub-step of the Step 9.6 annotation system.

- 305e75a: Step 9.6.2 — kernel sidecar reader + drift detection. The walker now reads `<basename>.sm` next to every `<basename>.md` it finds, validates against `spec/schemas/sidecar.schema.json` + `spec/schemas/annotations.schema.json` via the kernel AJV stack, and computes drift versus the live body / canonical-frontmatter hashes. Stale state surfaces through a new built-in Rule `core/annotation-stale` (`warn` severity); orphan `.sm` files (no matching `.md`) surface through `core/annotation-orphan` (`warn`). Schema-invalid or YAML-malformed sidecars produce an `invalid-sidecar` warning and the scan continues — drift detection is soft-mode, never blocking.

- 687823d: R15 closure (Step 9.6 review queue): extend `Node.sidecar` overlay with the full parsed `.sm` root.

- 305e75a: Step 9.6.7 — wire-shape cleanup. Closes two §Step 9.6 review-queue items in one batch (R7 + R9) so the BFF's REST and WS surfaces match the canonical contracts every other route already follows.

- 1019d5f: Pluggable kernel walker + parser registry. Provider manifests gain a declarative `read: { extensions, parser }` field; the kernel owns the file walker and a closed registry of built-in parsers. The Claude Provider drops its hand-rolled `walk()` (~70 lines of fs walking + frontmatter parsing) and becomes pure metadata + classification.

## 0.17.0

### Minor Changes

- 77579b3: Add a `sm db browser` sub-command that opens the project's SQLite DB in DB Browser for SQLite (sqlitebrowser GUI). Read-only by default; pass `--rw` to enable writes. Replaces the previous `scripts/open-sqlite-browser.js` standalone script.

- 696008a: Add a `--no-ui` flag to `sm serve`. With it, the BFF stops serving the Angular bundle (stale or otherwise) and the root `/` renders an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Used by the root `bff:dev` shortcut so iterating on the BFF alongside the Angular dev server doesn't surface a stale UI by accident.

- bd5e360: Trim `frontmatter/base.schema.json` to the truly universal contract: `name` + `description` are the only required fields, every node on every Provider, and `additionalProperties: true` lets vendor-specific keys flow through silently.

## 0.16.0

### Minor Changes

- c981430: Rename the project ignore file from `.skill-mapignore` to `.skillmapignore` (no dash).

## 0.15.0

### Minor Changes

- d7e8dd9: Rename the tester onboarding verb and its companion Claude Code skill from `sm-guide` to `sm-tutorial` across spec, CLI, bundled materialised payload, runtime state file, and report file. Breaking change to the public CLI surface (`sm guide` is gone — no compat shim); pre-1.0 so it ships as a minor bump per the project's pre-1.0 policy (no major while a workspace stays in `0.Y.Z`).

## 0.14.1

### Patch Changes

- 34d57db: Doc-only fix to remove a misleading reading of "built-in kinds" in the Node schema and one test, plus a small batch of internal CLI refactors and tightened null checks. No external surface change.

## 0.14.0

### Minor Changes

- 8f2a66d: Bare `sm` defaults to `sm serve` instead of printing help

## 0.13.1

### Patch Changes

- 103fc1a: Doc revision pass — greenfield framing across READMEs, spec prose, ROADMAP, AGENTS, web, and workspace landing pages.

## [Unreleased]

### Minor

- **Provider-driven kind presentation + `kindRegistry` envelope.** The Provider extension surface gains a required `kinds[*].ui` block (`label`, `color`, optional `colorDark`, optional `emoji`, optional discriminated icon `{ kind: 'pi', id }` or `{ kind: 'svg', path }`). Every payload-bearing REST envelope variant embeds a required `kindRegistry` field; sentinel envelopes (`health`, `scan`, `graph`) stay exempt. New conformance case `plugin-missing-ui-rejected` locks the loader's behaviour against drop-in Providers that omit the `ui` block.

- **`/api/nodes/:pathB64?include=body` body opt-in.** The single-node detail endpoint accepts `?include=body` to add `item.body: string | null` (read from disk on demand; `null` when the source file is missing or unreadable). Single-node response shape is `{ schemaVersion, kind: 'node', item, links: { incoming, outgoing }, issues }`. The body reader refuses absolute paths and any relative path that resolves outside the scope root.

- **`/ws` WebSocket protocol + watcher contract.** `### Server` documents the wire envelope (delegated to `job-events.md` §Common envelope), the event catalog (`scan.started` / `scan.progress` / `scan.completed` plus `extractor.completed` / `rule.completed` / `extension.error` plus the BFF-internal advisories `watcher.started` / `watcher.error`), connection lifecycle, the backpressure rule (4 MiB `bufferedAmount` → close 1009 + unregister), and the loopback-only assumption. `sm serve --no-watcher` flag added.

## 0.12.0

### Minor

- **`sm serve` + Hono BFF skeleton.** New `### Server` subsection in `cli-contract.md`. Endpoints at this bump: `GET /api/health` (real), `ALL /api/*` (structured 404 stub), `GET /ws` (no-op upgrade — closes with code 1000 + reason `'no broadcaster yet'`), static handler + SPA fallback. Loopback-only through v0.6.0; boot resilient to a missing DB (`/api/health` reports `db: 'missing'`). `sm serve` flag set: `--port` (default 4242), `--host` (default 127.0.0.1), `--scope`, `--db`, `--no-built-ins`, `--no-plugins`, `--open` / `--no-open`, `--dev-cors`, `--ui-dist`.

## 0.11.0

### Minor

- **Job artifacts move into the database (content-addressed).** New `state_job_contents(content_hash PK, content, created_at)`; `state_jobs.file_path` removed (rendered content fetched via join). `state_executions.report_path` → `state_executions.report_json` (parsed-JSON-on-read). `Job.filePath` removed; `ExecutionRecord.reportPath` → `ExecutionRecord.report` (parsed JSON / null). `RunnerPort.run(jobContent, options)` returns `{ report, ... }` — path-based reporting is no longer part of the port contract. `sm job preview` reads from the DB; `sm job claim --json` returns `{ id, nonce, content }`; `sm record --report <path-or-dash>` accepts a file path or stdin; `sm job prune --orphan-files` removed (the verb auto-collects orphan content rows). `sm doctor` integrity checks updated. Event payload renames: `job.spawning.data.jobFilePath` → `contentHash`; `job.callback.received.data.reportPath` and `job.completed.data.reportPath` → `executionId`. The `job-file-missing` failure-reason enum is preserved with shifted semantics: it now flags a missing `state_job_contents` row (DB-corruption-only state).

## 0.10.0

### Minor

- **`Node.kind` opens to any Provider-declared string.** `node.schema.json#/properties/kind` becomes `{ type: 'string', minLength: 1 }`; the `CHECK in (...)` SQL constraints on `scan_nodes.kind` and `state_summaries.kind` drop; `extensions/action.schema.json#/.../filter/kind` widens to a string array. Providers declare their own kind catalog through the `kinds` map; the spec no longer enumerates a closed set.

## 0.7.0

### Minor

- **Execution modes lifted to a first-class architectural property.** `architecture.md` gains §Execution modes defining the per-kind capability matrix: Extractor / Rule / Action / Hook are dual-mode (declared in manifest); Provider and Formatter are deterministic-only (boundary-positioned). Extractor / Rule schemas gain optional `mode` (default `deterministic`); Action's `mode` enum becomes `deterministic` / `probabilistic`; Provider / Formatter forbid the field.

## 0.6.1

### Patch

- **Config folder rename** — `.skill-map.json` (single project-root file) → `.skill-map/settings.json` inside the canonical `.skill-map/` scope folder, with a sibling `.skill-map/settings.local.json` for per-machine overrides.

## 0.6.0

### Minor

- **Persisted scan-result metadata.** New `scan_meta` table backs `loadScanResult` so `scope` / `roots` / `scannedAt` / `scannedBy` / `adapters` / `stats.{filesWalked,filesSkipped,durationMs}` are real values instead of synthesised on read.

## 0.5.0

### Minor

- **`spec/index.json` integrity sweep.** Reconciles `index.json` with the manifest changes documented in v0.3.0 but never written to the file. No prose / schema changes.

## 0.4.0

### Minor

- **`--all` documented as targeted fan-out** in `cli-contract.md`. Valid only on verbs whose contract explicitly lists it.

## 0.3.0

### Minor

- **`--all` promoted to a normative universal flag** in `cli-contract.md §Global flags`. Any verb that accepts a target identifier (`-n <node.path>`, `<job.id>`, `<plugin.id>`) MUST accept `--all` as "apply to every eligible target matching the verb's preconditions". Mutually exclusive with a positional target on the same invocation. Verbs where fan-out is nonsensical (`sm record`, `sm init`, `sm version`, `sm help`, `sm config get/set/reset/show`, `sm db *`, `sm serve`) MUST reject `--all` with exit `2`.

## 0.2.0

### Minor

- **`@skill-map/spec` published on npm.** First public release of the spec package.

## 0.1.0

### Minor

- **Initial public spec bootstrap.** Ships the JSON Schemas (draft 2020-12) for `Node` / `Link` / `Issue` / `ScanResult` / `ExecutionRecord` / `ProjectConfig` / `PluginsRegistry` / `Job` / `ReportBase` / `ConformanceCase` / `HistoryStats` plus the per-kind extension schemas (Provider / Extractor / Rule / Action / Formatter / Hook). Prose normative contracts: `cli-contract.md`, `architecture.md`, `db-schema.md`, `job-lifecycle.md`, `job-events.md`, `prompt-preamble.md`, `plugin-kv-api.md`. Conformance case `kernel-empty-boot` exercises the boot invariant (kernel boots and returns an empty `ScanResult` with zero registered extensions); `preamble-bitwise-match` is deferred to Step 10.
