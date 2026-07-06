# skill-map

## 0.83.0

### Minor Changes

- New built-in analyzer `core/name-mismatch` flags nodes whose declared `frontmatter.name` diverges from their filename/dirname handle: warn for open-standard skills (the spec requires name == dirname), info where the vendor documents the override as legal. `core/name-collision` gains a warn tier for a declared name colliding with another node's file-derived handle; declared-vs-declared stays error and plain markdown stays out of the collision index.

  ## User-facing

  Scans now flag naming drift: a skill whose folder name differs from its name field gets a warning, and an agent or command whose name shadows another file's name is flagged too, so references stop pointing at the wrong file silently.

- Scans now validate an ABSENT frontmatter block against the kind's schema: a claude/codex agent or open-standard skill with no frontmatter at all (or with its fence pushed off the first byte by preceding prose) gets the same `frontmatter-invalid` warning a partial block already got, while all-optional kinds (plain markdown, claude command/skill) validate the empty block clean and stay silent. Malformed-fence heuristics keep precedence, one issue per defect.

  ## User-facing

  **Missing frontmatter is now flagged.** An agent or skill file with no frontmatter at all gets the same warning as one with incomplete frontmatter, including when stray text before the `---` fence made the metadata parse as body. Files that need no metadata stay quiet.

- Frontmatter diagnostics close three silent-loss gaps: a blank line before the opening `---` fence now warns via `frontmatter-malformed`, a declared-but-empty block now runs per-kind validation, and an unquoted `:` in a value gets an actionable quoting hint; a parse error no longer also reports present-but-unparseable fields as missing.

  ## User-facing

  Frontmatter mistakes now get clearer feedback: a blank line before the opening ---, an empty frontmatter block, or an unquoted colon in a value are flagged with hints that say how to fix them, instead of losing your metadata silently.

- Frontmatter diagnostics now detect a metadata block closed early by a stray `---` line inside it: a new `frontmatter-malformed` hint `early-close` names the leaked fields (gated on at least one being a schema-declared property) and suppresses the misleading missing-required report for fields sitting below the stray close; the combined BOM + blank-line accident before the fence now classifies as `byte-order-mark` instead of falling through every heuristic.

  ## User-facing

  A stray `---` line inside your frontmatter is now flagged with the fields that were silently falling out of the block, and a byte-order mark plus a blank line before the frontmatter is called out too, instead of the metadata quietly disappearing.

- Move the web UI's "Live updates" and "Real-time node activity" preferences from browser localStorage to the project-local config: new `ui.liveUpdates` / `ui.realtimeActivity` keys in `project-config.schema.json` (project-local only, stripped from the committed layer), read and written through `GET/PATCH /api/project-preferences` and persisted in `.skill-map/settings.local.json`. The SPA loads them before opening the live socket; the former localStorage keys are simply no longer read.

  ## User-facing

  The Live updates and Real-time node activity switches now live in Settings > Project and stick to the project instead of the browser: flip them once and every browser profile on this checkout sees the same choice.

- Hardened the scan pipeline per a cli-hacker audit: rewrote the HTML-tag stripper and capped the inline-code opener in `strip-code-blocks` to linear time (they could hang `sm scan`/`sm watch`), routed disk-sourced `sm config get`/`list` output through `sanitizeForTerminal` (now also dropping a bare CR), validated the activity `serve.json` port, and made the walker skip symlinks whose target escapes the scan roots by default, with a new `scan.followExternalSymlinks` opt-in gated by `--yes`.

  ## User-facing

  **Scans stay inside your project.** Symlinks pointing outside it are no longer followed (security fix); re-enable via the Follow external symlinks setting (Settings → Project) or `sm config set scan.followExternalSymlinks true --yes`. Config values are sanitized before printing.

### Patch Changes

- Added regression specs pinning two audit fixes: fatal-path errors keep landing on stderr under `--json` / `-q` (stdout stays clean for the JSON contract), and the `-v` verbose logger writes to the Clipanion context stderr instead of `process.stderr`. Test-only, no runtime change.

- Fatal command failures now emit their error text via `printer.error()` (stderr) instead of `printer.info()`, so `--json` / `--quiet` runs no longer exit non-zero with no explanation (44 sites across 9 commands); the `core/update-check` hook receives the update probe injected through the `boot` event payload instead of importing it from `cli/`, and two new lint guards block regressions on both fronts.

  ## User-facing

  **Failed commands now always say why.** When an `sm` command fails, the error message is printed even with `--json` or `--quiet`; previously some failure paths exited with a non-zero code and no explanation.

- The minimal-claude conformance fixture moves its skill from the flat `.claude/skills/hello.md` (which classified as `markdown`) to the directory layout `.claude/skills/hello/SKILL.md`, so the basic-scan case exercises one node per kind as intended; alongside, raw control bytes embedded in the frontmatter-yaml and toml parsers and in safe-text were replaced with escape text, with identical compiled patterns and no behavior change.

- Internal cleanup from a cli-ruler compliance pass: built-in plugin string catalogs renamed from `text.ts` to `<extension-id>.texts.ts` so the em-dash lint gate covers them, the frontmatter-yaml and toml parsers share one parse-error sanitiser (the TOML side now also strips DEL bytes), dead legacy metadata projectors dropped from node-build, the activity templates interpolate the shared `.skill-map` path constants, and the BOM heuristic's key-line probe is bounded to 4 KB.

- Closes the remaining cli-ruler audit findings: the REST contract table in cli-contract.md now documents the implemented preferences, project-preferences, project-ignore, favorites, and update-status endpoints, and architecture.md enumerates all eight PROJECT_LOCAL_ONLY_KEYS members. On the src side, published package metadata and the Claude provider schema descriptions drop their em dashes, and a stale $HOME docstring now points at the closed caller list.

- Resolved the app-ruler UI audit findings: migrated the files-tree row animation from the deprecated @angular/animations DSL to the native animate.enter/animate.leave CSS API (dropping the @angular/animations dependency), hardened UI service signals to read-only exposure, and consolidated the duplicated frame-scheduling and panel-resize helpers into shared modules.

## 0.82.0

### Minor Changes

- Live-activity abstraction hardening for future providers: the in-process plugin template keeps only the shared envelope and splices provider-owned hook registrations (new `pluginHooksSource` runtime field, opencode's generated plugin stays byte-identical), uninstall removes the shared bridge dir only when no other json-hooks provider remains wired, duplicated adapter idioms moved to a shared kernel kit, and the install descriptor became a per-kind discriminated union with a schema gate.

  ## User-facing

  Turning live activity off for one agent no longer breaks it for other agents wired in the same project: the shared bridge now stays in place until the last agent unwires.

## 0.81.1

### Patch Changes

- Real Time polish: the topbar toggle and the node-card execution counter swap the bolt for a wave-pulse icon (the bolt collided with the skill glyph) and the blocked toggle now reads clearly disabled. The conversation dialog no longer prints "Invalid Date" on timestamp-less records and names an empty retained thread. The realtime tutorial installs the hook from Settings > Project (no CLI verbs), explains the ephemeral session capsule, and reopens conversations from the inspector.

  ## User-facing

  The Real Time toggle now uses a heartbeat icon and looks clearly off when blocked. The tutorial installs the hook from Settings, shows why the dashed session capsule exists, and reopens agent conversations from the node inspector. No more "Invalid Date" in empty conversations.

## 0.81.0

### Minor Changes

- Codex live-activity parity: the codex adapter wires the spawn_agent Pre/PostToolUse pair (matcher-scoped, the only tool events) and emits spawn relations with the prompt on start and the child agent_id parsed from the JSON-string response on handoff, plus the stop's last_assistant_message as the conversation response via the generic report path. No custody (codex parents never pause), no execution totals (the payloads carry none); spec table updated from the 2026-07-05 probe.

  ## User-facing

  Codex sessions now get the same live map extras as Claude: spawn arrows between agents, per-edge conversation counters, and opt-in agent-to-agent conversation viewing. Execution totals stay empty on Codex, its runtime does not report them.

- OpenCode live-activity spawn parity: the in-process plugin forwards tool.execute.after wiring-filtered to the task tool, and the adapter emits spawn relations from the task pair (callID as spawnId, prompt on start, the child sessionID plus its final report unwrapped from the task_result envelope on completion, relation-only since the task event never names the parent agent). session.idle confirmed nap-free; spec table updated from the 2026-07-05 probe.

  ## User-facing

  OpenCode sessions now draw spawn arrows with per-edge conversation counters and opt-in conversation viewing, with the child's full reply captured natively; the demo fixture mirrors the Claude one (3-turn conversation, unlinked scout, report skill).

- sm-tutorial: new "Real time: watch your agent run" part after the daily loop (wire the hook with its consent prompt, restart and watch nodes light up, opt-in conversation capture, and a closing known-gaps note per provider), shared across claude/codex/antigravity/opencode with per-provider trigger deltas; on the agent-skills lens the part explains it needs a runtime with an activity adapter. Internal part order renumbered (cli 4, extend 5).

  ## User-facing

  The interactive tutorial has a new part: install the live-activity hook, restart your agent, and watch your tutorial project's nodes glow on the map as it runs. On Claude and Codex it ends with a spawn arrow you can click to read the agent-to-agent conversation.

### Patch Changes

- Antigravity live-activity fix: the conversation Stop only releases the owner's claims when the conversation is FULLY idle (fullyIdle is not false). The runtime fires Stop on every mid-run nap while subagents work (live-verified 2026-07-05), and releasing there darkened the whole chain prematurely; nap stops now disclaim, a missing fullyIdle keeps the old behavior for older runtimes. The per-provider spec table also pins why spawn relations are unmappable on this runtime.

  ## User-facing

  On Antigravity, the map no longer goes dark while the main conversation waits for its subagents; everything stays lit until the whole conversation actually finishes.

## 0.80.0

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

## 0.79.0

### Minor Changes

- New read-only verb `sm activity status [provider]` (normative row in cli-contract.md §Activity): one line per activity-capable provider reporting installed, not installed, or partial (config wired but the shared bridge artifact missing; the inverse reads as not installed because the bridge is shared across hook-file providers), and the `activity install`/`uninstall` help texts now describe both install shapes with opencode examples.

  ## User-facing

  **Check where live activity stands with `sm activity status`.** One line per provider tells you if its hook is installed, missing, or half-broken, plus the exact re-install command that repairs it.

- Antigravity joins live activity: the contract gains three additive install-descriptor fields (`install.group`, `install.commandCwd`, `events[].entryShape`) and a node-less owner-release signal form, the bridge derives its scope root from its own installed location instead of the spawn cwd, and the new adapter lights everything the agent reads via `view_file` and releases the whole chain on conversation `Stop` (demo fixture: `fixtures/realtime-antigravity/`).

  ## User-facing

  **The live map now works with Antigravity.** Run `sm activity install antigravity` and watch skills, workflows and notes light up as the agent reads them, going dark the moment it finishes. Skills invoked with a slash stay dark (Antigravity reports no event for them).

- The codex provider ships the second live-activity adapter: `sm activity install codex` wires `.codex/hooks.json` (same json-hooks convention as claude) and maps `$skill` prompt tokens (same dollar grammar as the `dollar-skill` extractor) plus named SubagentStart/Stop boundaries. The codex row of the spec's informative per-provider table is rewritten to the shipped facts, README gains a live-activity section with a support matrix, and a demo fixture lands at `fixtures/realtime-codex/`.

  ## User-facing

  **Live activity now works with Codex.** Install its hook from Settings or with `sm activity install codex`, then watch your `$skills` and named agents light up on the map as they run (file reads stay dark for now, Codex does not yet expose them).

- The opencode adapter closes the four-provider live-activity set and implements the spec's `plugin-file` install kind: `sm activity install opencode` writes one self-contained in-process plugin at `.opencode/plugin/skill-map-activity.js` (wiring and bridge in a single marker-stamped file, a foreign file at that path is never touched) forwarding named skill / command / agent signals, markdown reads by path, and the native `session.idle` owner release (demo fixture: `fixtures/realtime-opencode/`).

  ## User-facing

  **Live activity now covers OpenCode, completing the set.** Run `sm activity install opencode`: skills, commands and agents light up by name (even asked in prose), markdown reads glow by path, and each session goes dark the instant it idles.

## 0.78.0

### Minor Changes

- The live-activity hook is now manageable over HTTP: `spec/provider-activity.md` gains a normative install-management contract (status probe plus install/uninstall that MUST answer 412 and touch nothing without `confirm: true`), the BFF serves the three routes on a shared `core/activity` engine (CLI verbs byte-identical), and Settings → Project offers install/uninstall for the active lens, with the real-time toggle hinting when the hook is missing.

  ## User-facing

  **Wire the activity hook from Settings.** Install or remove the live-activity hook for your assistant right from Settings → Project, with a clear confirmation before anything touches your files. The real-time toggle now tells you when the hook is missing.

- Live node activity now ends natively instead of by TTL decay: activity signals and the `node.activity` wire gain optional `ownerScope` (a terminal subagent stop releases every claim that owner holds) and `sticky` (lifecycle claims get a long safety-net window), the Claude adapter keeps a spawning parent lit via spawn custody handed to the child only while it still runs (`async_launched`), and `spec/provider-activity.md` is now published and hashed in the spec index.

  ## User-facing

  **Map lights now follow your agents natively.** A node switches off the moment its agent actually finishes instead of fading on a timer, and an agent that delegates work stays lit until its whole delegation chain completes.

- Settings → General gains two live-channel switches persisted in a new localStorage seam (`LivePreferencesService`): one gates the whole `/ws` socket via a new `'disabled'` connection state (distinct from `'lost'`, so the banner never nags about a chosen disconnect), the other gates real-time node activity (off drops buffered frames and clears every lit claim immediately). Both persist and apply atomically through the feature owners' `setEnabled`.

  ## User-facing

  **Live updates on your terms.** Settings → General gains two switches: turn live updates on or off entirely, and toggle real-time node activity (the glow that follows your assistant) separately. Both take effect instantly, no reload.

## 0.77.0

### Minor Changes

- Live activity now lights markdown nodes: activity signals gain a path-based form (`{ path, phase, owner? }`, resolved by exact `node.path` match across providers), and the claude adapter maps `Read` tool events to path signals with a filter-first early disclaim (non-`.md` reads and paths outside the scope root never reach the node set). `sm activity install` switches to refresh semantics so re-running updates skill-map's own hook entries in place.

  ## User-facing

  **Markdown files light up too.** When Claude Code reads any scanned `.md` (your notes, docs, a skill's file), its node now glows on the live map like skills and agents do. Re-run `sm activity install claude` once to pick up the new wiring.

- Backticked `@handle` mentions and `/command` / `$skill` invocations now become graph links: the new `claude/backtick-mention`, `core/backtick-slash`, and `codex/backtick-dollar` extractors match inside code spans and fences, gated post-walk so only tokens resolving to a real entity survive (npm scopes, decorators, shell tokens never link nor flag broken). Claude mentions also resolve to skills and markdown docs via priority-ordered matrices, and usage-example self-loops no longer warn.

  ## User-facing

  Names in backticks or code fences now link on the map when they exist: `@my-agent`, `@my-skill`, `@some-doc`, `/my-command`, and `$my-skill` all connect. Unrelated code tokens (npm packages, shell paths) stay ignored, and a doc showing its own command no longer warns.

## 0.76.0

### Minor Changes

- Live node activity v1 (contract in `spec/provider-activity.md`): Providers gain an optional `activity` capability, `sm serve` publishes `.skill-map/serve.json` (bind address plus per-session token) and serves a token-gated `POST /api/activity` that resolves provider hook events to scanned nodes and broadcasts `node.activity` over `/ws`, `sm activity install|uninstall` wires a zero-dependency bridge into the provider's hook config, and the map lights executing nodes. Ships the `claude` adapter.

  ## User-facing

  **Watch your map light up as your assistant works.** With `sm serve` running, run `sm activity install claude`: every skill, agent, or command Claude Code invokes now glows on the map in real time, and the path between an agent and the skill it runs lights up as one chain.

- Add `server.port` / `server.host` project-config keys, resolved through the normal config layering (defaults, project, project-local) with the `--port` / `--host` flags as the per-invocation override, mirroring the `scan.watch.backend` precedent; `sm serve` records the resolved values in `serve.json` and the loopback-only rule applies regardless of which layer supplied the host.

  ## User-facing

  **Pin your port in config.** Set `server.port` (and optionally `server.host`) in `.skill-map/settings.json` and `sm serve` always boots there, no flags needed; `--port` still wins for a one-off run.

## 0.75.0

### Minor Changes

- Remove the `scan.followSymlinks` setting: the scan walker now always follows symbolic links, to targets inside or outside the project, guarded only by cycle detection (the realpath-containment gate is gone). Change `scan.watch.backend` to `chokidar` (default) or `parcel` and drop the `auto` value, and add a `--watch-backend <chokidar|parcel>` flag on `sm serve` / `sm watch` / `sm scan --watch` that overrides the setting per invocation.

  ## User-facing

  Symlinked folders are now always indexed, even when the link points outside your project. The file watcher defaults to `chokidar`; pass `--watch-backend parcel` on `sm serve` / `sm watch` for very large trees (scales better, but no live updates behind symlinks).

- Surface provider-marker drift in the web UI instead of the server log. `sm serve` / `POST /api/scan` no longer log the `Provider markers changed` warning; `GET /api/active-provider` now returns a `markerDrift` field and the SPA shows a dismissable notice to switch lens or dismiss. Dismissing (`POST /api/active-provider/accept-markers`) reconciles the `activeProviderMarkers` snapshot so the drift clears in both UI and CLI. `sm scan` / `sm watch` keep the warning.

  ## User-facing

  **Marker-change notice moved into the map.** If a new provider folder (like `.claude/`) appears, the map shows a dismissable banner to switch lens or keep your current one, instead of repeating a warning in the server console. Dismissing it remembers your choice.

### Patch Changes

- Set `PRAGMA busy_timeout` on every SQLite connection so a contended writer waits for a held write lock instead of failing immediately with `SQLITE_BUSY` ("database is locked"). Legitimate concurrent access (a second `sm serve`, a `sm scan` while the watcher is live, an editor-triggered rescan) now succeeds once the brief in-flight transaction commits, instead of surfacing a "watcher batch failed" warning.

  ## User-facing

  **No more spurious "database is locked" errors.** Running `sm scan` while `sm serve` is watching (or two servers on one project) no longer fails with a database-locked error; the operations queue and complete.

## 0.74.2

### Patch Changes

- Anchor the watcher runtime's scan roots to `runtimeContext.cwd` instead of `process.cwd()` (the walker's fallback for a bare `.`). A no-op for real `sm serve` / `sm watch` runs, where the two coincide; it keeps the scan, the watcher subscription, and the config layer all anchored to the same directory when a caller supplies a `cwd` that differs from the process cwd.

## 0.74.1

### Patch Changes

- Make the primary scan watcher backend selectable via `scan.watch.backend` (`auto` default, `parcel`, `chokidar`). `auto` uses `@parcel/watcher` (a single native inotify instance that scales to huge trees without chokidar's `EMFILE` failure) and switches to `chokidar` when `scan.followSymlinks` is on so symlinked dirs keep updating live. The meta-watcher stays on chokidar. Defaults preserve existing behaviour.

  ## User-facing

  **Watcher scales to large repos.** The file watcher now uses a native single-instance backend, so `sm serve` / `sm watch` no longer crash with `EMFILE: too many open files` on projects with very many folders. Set `scan.watch.backend` (auto / parcel / chokidar) to force a backend.

- Add an opt-in `scan.followSymlinks` setting (default `false`). When enabled, the scan walker follows symlinked directories and files instead of skipping them, so a softlinked `.claude/skills` is indexed. Following is gated by cycle detection and realpath containment (a link is followed only when its target stays inside the scan roots), and the incremental watcher re-scan applies the same policy as a full scan.

  ## User-facing

  **Scan symlinked folders.** Turn on `scan.followSymlinks` in settings to index skills behind a symbolic link (for example a `.claude/skills` that points elsewhere). Off by default; links pointing outside your project are never followed.

## 0.74.0

### Minor Changes

- Fold the project `.gitignore` into the scan and watcher ignore filter (precedence: bundled defaults, `.gitignore`, `config.ignore`, `.skillmapignore`, where later layers may `!`-re-include) and scope the live watcher to only the file types a scan opens: the registered providers' `read.extensions` (`.md` everywhere, `.toml` under codex) plus `.sm` sidecars. A provider that ships a custom walker disables the extension gate.

  ## User-facing

  **Quieter live map, cleaner scans.** The scan and live map now also respect your project's `.gitignore`, and the live watcher only reacts to `.md`, `.toml`, `.sm`, and `.skillmapignore` changes, so edits elsewhere (including `node_modules`) no longer cause a rescan.

## 0.73.0

### Minor Changes

- Add a dismissable topbar reminder pointing first-time users at `sm tutorial`. Its dismissal persists via a new project-local `tutorialReminderDismissed` config key (`.skill-map/settings.local.json`), read and written through the project-preferences BFF route.

  ## User-facing

  **Tutorial reminder.** The map's header now shows a one-time reminder to run `sm tutorial`, with a dismiss button that remembers your choice for this project.

### Patch Changes

- `sm tutorial` now offers OpenCode alongside Antigravity on the open-standard basic track: OpenCode shows up in the destination prompt and an OpenCode project (detected by `.opencode/`) resolves to the basic walkthrough built on the shared `.agents/skills/` standard.

  ## User-facing

  **OpenCode tutorial.** `sm tutorial` now lists OpenCode as a destination, and running it in an OpenCode project gives you the basic open-standard walkthrough.

- Trim the antigravity and opencode `plugin.json` descriptions to drop text that duplicated their provider extension descriptions (plus a "contributes the runtime identity and reserved built-in names" boilerplate clause the other built-in plugins do not carry); the per-extension provider descriptions still hold the full path-by-path classification detail.

## 0.72.0

### Minor Changes

- Add an `opencode` built-in provider lens for the OpenCode CLI. Under the opencode lens, skill-map classifies OpenCode agents (`.opencode/agent/*.md`) and commands (`.opencode/commands/*.md`), and discovers skills from the three homes OpenCode reads (`.opencode/skills/`, `.claude/skills/`, `.agents/skills/`). Claude compatibility is asymmetric: OpenCode reads Claude skills but not Claude agents or commands, so those fall through to markdown. A `.opencode/` folder auto-detects the lens (beta).

  ## User-facing

  skill-map now recognizes OpenCode projects. Open a repo with a `.opencode/` folder and the map shows your OpenCode agents, commands, and skills (including the Claude-compatible skills OpenCode reads). Pick the OpenCode lens from the lens dropdown.

## 0.71.0

### Minor Changes

- The `@<file>` and `/<command>` grammars are consolidated into one vendor-neutral pair of `core` extractors (`core/at-file`, `core/slash-command`), each gated by `precondition.provider` to the lenses whose runtime reads that syntax. Antigravity now draws `@filename` file references (a file-shaped `@path` becomes a path-resolved `references` edge, the file-picker grammar Codex already had); `claude/at-directive` narrows to bare-handle agent mentions.

  ## User-facing

  Antigravity projects now draw `@filename` file references on the map: an `@path` token in a workflow or skill body becomes an arrow to that file, the same file-picker behavior Codex already had.

- The kernel now flags an unclosed backtick in a node body during the scan walk: an opening fenced block (``` or ~~~) that is never closed, or an inline span whose backtick run has no equal-length closer. The verdict is derived from the same code-strip scanner the prose extractors rely on, so it pinpoints the body-syntax defect where a dangling fence swallows the rest of the file and prose extractors stop emitting edges. The warning is persisted and reused across incremental scans.

  ## User-facing

  Scans now warn when a Markdown file has an unclosed backtick (a code fence ```never closed, or an inline`code` span missing its closer). The warning carries the offending line so you can fix it before it breaks how the file's links are read.

### Patch Changes

- The shared `@`-token grammar (`kernel/util/at-token.ts`) now recognises a multi-level relative prefix (`@../../x`), not just a single `./` / `../` level. So a file-shaped `@`-reference that climbs more than one directory (in a Claude, Codex, or Antigravity body) resolves to its target instead of being silently dropped.

  ## User-facing

  `@`-file references that climb more than one folder (e.g. `@../../docs/guide.md`) now draw an arrow to the target file; before, only single-level `@../x` references were recognised.

- The Antigravity `workflow` kind now uses the same amber as Claude's `command` kind, since a workflow is Antigravity's command-equivalent, so node colors read as one cross-provider vocabulary. The `sm tutorial` open-standard destination is relabelled to lead with the standard (`Standard: Agent skills (Google's Antigravity, others)`), and the basic tutorial track is reframed as the Agent Skills open standard, with supporting vendors noted parenthetically rather than fronting the book.

  ## User-facing

  Antigravity workflows now show in the same amber as Claude commands on the map (a workflow plays the same role as a command). And `sm tutorial` lists the open standard as `Standard: Agent skills (Google's Antigravity, others)` instead of fronting one vendor.

## 0.70.0

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

## 0.69.0

### Minor Changes

- Split plugin enable (operational) from import trust (security). Enable/disable now persist to the config layers, not the DB; `config_plugins` becomes a per-plugin local trust store. New `sm plugins trust / untrust` verbs, a trust PATCH route, a Settings UI Trust control, and a `pluginTrust.projectEnabled` opt-in grant or revoke consent to run a project-local plugin. It runs only when enabled AND trusted, so disabling one no longer re-reads as untrusted.

  ## User-facing

  Plugins now have two separate switches: enable (is it part of the project, shared) and trust (may its code run on your machine). New `sm plugins trust` / `untrust` plus a Trust button in Settings. A plugin you disabled stays disabled instead of nagging that it is untrusted.

## 0.68.1

### Patch Changes

- Reworked the `sm tutorial` destination prompt to list providers by vendor name rather than their shared destination folder (several providers share `.agents/skills`), with the open standard shown aka-first. Reorganized the interactive tutorial book: the 'Connect the harness' part is merged into 'The project from zero' so building and wiring the harness is one continuous part, alongside a chapter-by-chapter copy pass across the Claude, Codex and open-standard tracks.

  ## User-facing

  The `sm tutorial` picker now lists each agent by name (Claude, OpenAI Codex, Google's Antigravity) instead of its install folder. The guided tutorial is tighter: building and connecting your project's harness is now one continuous part, with clearer copy throughout.

## 0.68.0

### Minor Changes

- Project-local plugins under `<cwd>/.skill-map/plugins/` are now discovered but their code is NOT imported or executed by the runtime verbs until the operator grants local trust with `sm plugins enable <id>`; the committed `settings.json` cannot grant it, so cloning and scanning a repo no longer auto-runs its plugins. Built-ins and `--plugin-dir` stay exempt. The BFF actions route also rejects a sidecar write whose path escapes the project root (400).

  ## User-facing

  **Project plugins no longer run until you trust them.** Plugins committed in a repo's `.skill-map/plugins/` are now listed but not executed by `sm scan` / `sm serve` until you run `sm plugins enable <id>`, so cloning and scanning a repo no longer auto-runs its plugins.

- The `sm tutorial` book now adapts to the active provider lens via two tracks: a rich track (Claude / Codex, with agents, commands, slash and mentions) and a basic track (the open-standard Agent Skills / Antigravity family, skills and markdown wired by markdown references). Scaffolding for the open standard now lays a complete references-based campaign instead of a Claude-shaped book with gaps, and the provider/lens narration was corrected to the current model.

  ## User-facing

  `sm tutorial` now runs end to end beyond Claude: a basic skills-and-references book on the open Agent Skills standard (agent-skills / Antigravity) and a rich book for OpenAI Codex, each matching how scans resolve your project.

### Patch Changes

- `sm db restore` now validates the source before previewing or swapping: it refuses a non-SQLite file, or a backup written by a newer minor or different major than the running CLI (same version rules `sm scan` applies on open). `--dry-run` and the live swap share one read-only check, so a dry run no longer green-lights a source the restore would reject. Separately, `--max-scan` / `--max-nodes` on `scan` / `serve` / `watch` now reject exponent notation like `1e3`, matching `--port`.

  ## User-facing

  **Safer restores, stricter limits.** `sm db restore` now refuses a backup that isn't a real database, or one written by a newer `sm`, before touching your data. And `--max-scan` / `--max-nodes` reject values like `1e3` instead of silently treating them as 1000.

- `<sm-node-card>` and `<sm-kind-palette>` hardcoded per-kind colours in CSS for only the four core kinds, so any Provider-declared kind (e.g. Antigravity's `workflow`) fell back to neutral markdown grey, icon included. The colour now comes from the kind: the node card binds `--accent` / `--kind-bg` / `--kind-fg` from the runtime kind registry's `--sm-kind-<kind>` vars and the palette binds the accent per button, so every Provider-declared kind paints its declared colour with no per-kind CSS.

  ## User-facing

  **Provider kinds get their own colour.** Node kinds added by providers (for example Antigravity workflows) now show their declared colour in the graph and the kind filter, icon included, instead of falling back to grey.

- Hardened the local server and opt-in telemetry. The BFF Content-Security-Policy now carries `object-src 'none'`, a zero-breakage backstop that blocks plugin-content (`<object>` / `<embed>`) script execution if the markdown sanitizer ever regresses. Separately, the opt-in UI error-telemetry SDK no longer auto-records console, fetch, xhr, or DOM breadcrumbs, which could otherwise carry project paths or request URLs into a report; navigation breadcrumbs stay and are still home-scrubbed.

- Updated every outdated `src/` dependency to its latest exact pin and migrated the code the four major bumps required. The only runtime-touching change is js-yaml 4 to 5: importers switch to named `load`/`dump` with `schema: CORE_SCHEMA`, which emits byte-identical YAML 1.2 so canonical frontmatter and sidecar hashes are unchanged. TypeScript 6, @types/node 26, @hono/node-server and kysely 0.29 needed only build-config and type-cast tweaks. The bumps clear the known CLI-tree advisories.

- Updated UI dependencies to close the advisories from the UI security audit. Angular moves to 21.2.17 (the XSS sanitizer-bypass fixes) and `dompurify` to 3.4.11; a pnpm-workspace override forces `posthog-js`'s bundled `dompurify` to the same 3.4.11 so the shipped bundle no longer carries a vulnerable copy. `@sentry/angular`, `markdown-it`, `posthog-js`, `primeng`, and `vitest` also move to current patches.

## 0.67.0

### Minor Changes

- Give the Antigravity provider its own `workflow` kind and promote it to `beta` (enabled by default). Under the antigravity lens, `.agent/workflows/<name>.md` (singular `.agent`) classifies as a `workflow` node (handle = filename) while skills keep the open-standard `.agents/skills/` classifier. The slash extractor now runs under antigravity, so `/name` resolves to both skills and workflows, reserved verbs are flagged on both, and `.agent/workflows/` auto-detects the lens.

  ## User-facing

  **Antigravity is on by default now.** A project with a `.agent/workflows/` folder auto-detects the Antigravity lens; those files show up as workflows (not plain Markdown), and a `/name` reference links to the matching workflow or skill.

## 0.66.0

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

- The inspector's Body section gains a Raw / Rendered toggle: a button at the top of the expanded section flips between the rendered Markdown and a read-only source view, line-numbered and syntax-highlighted like a code editor (the markdown body, or a Codex agent's `developer_instructions`). The preference is sticky across nodes within the session. No extra fetch, the raw view reuses the content already loaded for rendering.

  ## User-facing

  The inspector's Body section now has a Raw / Rendered toggle: flip between the formatted Markdown and a read-only, syntax-highlighted source view (with line numbers) of a node's body, without leaving the panel.

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

### Patch Changes

- Centralize the `backups` directory segment behind a single kernel primitive (`kernelBackupsDir(dbPath)` plus the `BACKUPS_DIRNAME` literal in `skill-map-paths.ts`, re-exported through `core/paths` and the CLI `db-path` helper). The migrations runner's pre-migrate snapshot path and `sm db backup` now both derive `<dbDir>/backups` from that one source instead of composing the literal by hand. Behaviour is unchanged.

## 0.65.0

### Minor Changes

- The vendor-neutral open-skills Provider (`agent-skills`, lens "Open Skills") gains an open-standard base reserved-name catalog under `skill`: a user skill shadowing a universal built-in like `help`/`config` is now flagged by `core/name-reserved`, and Antigravity inherits the base by manifest composition and appends its own verbs. Its `skill` frontmatter schema now enforces the open-standard `name` pattern/length and `description` length. Shared primitives renamed to a `COMMONS_*` vocabulary.

  ## User-facing

  With the Open Skills lens active, a skill you authored that shares a name with a built-in command (like `help` or `config`) now gets a warning, and skill names or descriptions that break the open-standard format (bad characters, too long) are flagged too.

## 0.64.1

### Patch Changes

- Patch release of `@skill-map/cli` with no functional change, used to exercise the changesets version-packages PR and the end-to-end release pipeline.

## 0.64.0

### Minor Changes

- Bare `sm` in an empty folder now offers a getting-started menu: on an interactive terminal it asks whether to run the guided tutorial (`sm tutorial`) or drop a ready-to-explore example project (`sm example`), then dispatches the chosen verb. In a non-empty folder, or on a non-interactive stdin, it still prints a one-line hint and exits 2, now pointing at `sm tutorial` / `sm example` when the folder is empty and at `sm init` otherwise.

  ## User-facing

  Run `sm` in an empty folder and it now asks how you want to start: a guided tutorial, or a ready-made example project to explore. Pick one and it sets it up for you.

- New `sm example` verb: drops a ready-to-explore example project (the same wired harness the public demo renders) into an empty directory, so a new user can run `sm scan` then `sm serve` against a real connected graph without authoring files first. The payload is the single canonical `fixtures/demo-scope/` fixture, shared with the web demo, and ships unscanned (no `.skill-map/`). Refuses a non-empty cwd unless `--force`.

  ## User-facing

  New `sm example` command: run it in an empty folder to drop a small ready-made project, then `sm scan` and `sm serve` to explore it as a live graph. The fastest way to try skill-map without setting up your own files first.

## 0.63.0

### Minor Changes

- The active provider lens no longer has an unlensed (permissive) state. A project with no marker now resolves to the universal `markdown` lens (never null, never persisted, so a later vendor marker still auto-detects) instead of running every provider at once. The Settings dropdown drops the dead `(none)` entry and keeps Markdown as a selectable neutral lens, and `sm serve` now re-scans under the chosen lens after a switch instead of re-detecting it from disk.

  ## User-facing

  A repo with no `.claude/`, `.codex/`, or `.agents/` now opens in the Markdown view instead of mixing every platform together, with no warning. Pick Markdown anytime from Settings to see your files as plain markdown. The empty `(none)` option is gone.

- Removed the `comingSoon` provider flag: not-ready providers use `stability: 'experimental'`, shipping disabled by default (not classified, auto-detected, or selectable until enabled). `openai`, `antigravity`, `agent-skills` are experimental; `agent-skills` is gated to its own lens (only `core/markdown` stays universal). Antigravity reuses the agent-skills classifier, dropping the kernel's cross-provider reservedNames lens-scope. `sm tutorial --experimental` offers them as destinations.

  ## User-facing

  The lens dropdown no longer shows "(coming soon)" rows. Not-ready providers (OpenAI Codex, Antigravity, Open Skills) are hidden until you enable them with `sm plugins enable <id>`; `sm tutorial --experimental` offers them as tutorial destinations.

## 0.62.2

### Patch Changes

- The `/api/branch` map projection now keeps an edge when its RESOLVED target is a rendered node, not only when the raw authored target is. Trigger-style `invokes` / `mentions` links store the trigger (`/cmd`, `@agent`) in `target` and the real node path in `resolvedTarget`; the old filter matched the raw target alone, so every resolved trigger edge was dropped from the graph and the map showed only path-style `references`. Genuinely-broken links (no resolved node) stay excluded.

  ## User-facing

  The graph map again draws `invokes` and `mentions` arrows (a command running a skill, an agent referenced by name), not just plain file references. A recent change had hidden every resolved trigger edge from the map.

## 0.62.1

### Patch Changes

- Audit pass over the bundled `sm tutorial` content: fixed a broken `sm plugins create extractor demo-highlight` command, corrected a contribution that was silently dropped by emit-time slot validation, refreshed the stale `sm plugins doctor` count and UI references, trimmed two redundant chapters from the Extend track, and aligned the chapter-count test with the trim.

  ## User-facing

  **`sm tutorial` cleanup.** The Extend track now runs the right commands end to end (the plugin-authoring walkthrough no longer dead-ends on a broken command or a dropped chip), drops two redundant chapters, and matches what `sm` actually prints today.

## 0.62.0

### Minor Changes

- Splits the scan cap into two knobs: `scan.maxScan` (corpus ceiling, default 50000) bounds what the walk parses and reference-validates, while `scan.maxNodes` (default 256) now caps only the graph render. References resolve across the whole corpus, so large repos no longer flag links to unrendered files as broken. Adds the `--max-scan` flag and the `/api/folders`, `/api/branch`, and `/api/scan?meta=1` endpoints that back the lazy folders tree and branch-scoped map.

  ## User-facing

  Large repos now scan and validate references across the whole tree; check folders (with per-folder issue counts) to choose what the map shows. Map palettes count what is shown; a Reset filters button clears it all; the refresh button spins while any scan runs.

### Patch Changes

- Restores the files rail's per-row stale-clock icon, dropped when the rail switched to building from the lightweight `GET /api/folders` payload (which carried the error / warn counts but not the sidecar drift status). The endpoint now emits a `sidecarStatus` field (the persisted `scan_nodes.sidecar_status`, `null` when there is no parseable sidecar), threaded from the kernel loader through the BFF into the rail so staleness flags corpus-wide in demo and `sm serve` mode.

  ## User-facing

  The files rail again flags out-of-date nodes with the clock icon, so you can see at a glance which files have drifted since their last review.

- Incremental scans now skip unchanged files. The full-walk path (`sm scan --changed`, boot scan, fallback) reads and YAML-parses only files whose on-disk mtime differs from the prior snapshot, reusing the cached node otherwise. The watcher path (`sm serve` / `sm watch`) threads chokidar's exact changed-path set through the scan, enumerating the corpus from the prior snapshot and reading only the touched files instead of re-walking the tree. Results stay byte-identical to a full scan.

  ## User-facing

  **Faster live updates.** Saving a file while `sm serve` or `sm watch` is running now refreshes the map almost instantly, because only the file you changed is re-read instead of the whole project being re-scanned on every save.

- Body extractors now strip raw HTML (comments and tag tokens) before matching, alongside the existing code-region strip. A markdown link commented out as `<!-- [x](old.md) -->` or hidden in an attribute value (`<img alt="[x](y.md)">`) no longer produces a phantom edge. The strip is bounded to comments and tag tokens, so markdown nested inside a `<div>` block still resolves; `core/backtick-path` is unaffected (HTML is not a code region).

  ## User-facing

  Scanning `.md` files that contain HTML no longer creates phantom links or false broken-reference warnings from links that were commented out or tucked inside HTML attributes.

## 0.61.5

### Patch Changes

- Tutorial and inspector polish. The bundled `sm-tutorial` daily-loop part merges the styling and preview chapters into one, serves the site from a third terminal, clarifies the frontmatter rename, reframes the publish confirmation, invites the tester to keep building, and adds a confidence note; the `content-editor` agent uses a free image placeholder. The inspector's tag row gains a `TAGS:` title so a node with no tags no longer shows a lone pencil.

  ## User-facing

  The inspector now shows a "TAGS:" label on the tag row, so nodes with no tags read clearly instead of showing a lone edit pencil. The interactive tutorial's daily-loop part also got several narration and flow improvements.

## 0.61.4

### Patch Changes

- `sm tutorial` now lists coming-soon providers in its destination prompt instead of offering them as real targets. Claude is the only selectable destination; OpenAI Codex, Antigravity, and Open Skills appear greyed as "(coming soon)" and re-ask the tester if picked. The prompt still renders on a TTY even with a single selectable target (so the others stay visible), non-TTY stdin takes Claude silently, and `--for <coming-soon-id>` exits with an unknown-provider error.

  ## User-facing

  Running `sm tutorial` now sets up the tutorial for Claude. Other assistants (Codex, Antigravity, Open Skills) show as "coming soon" in the prompt and cannot be selected yet.

## 0.61.3

### Patch Changes

- Add a `comingSoon` flag to a Provider's `presentation` (spec + kernel). A coming-soon Provider ships in the registry (node chips still render) but is never selectable as the active lens: auto-detect skips its markers, the BFF drops it from `GET /api/active-provider`'s `selectable` set, and the UI greys it with a `(coming soon)` suffix. `openai`, `antigravity`, and `agent-skills` are marked coming-soon, so only `claude` is selectable today.

  ## User-facing

  Only the Claude provider is selectable for now. Codex, Antigravity and Open Skills appear greyed out as "coming soon" in the provider lens, and projects auto-detect Claude without a lens prompt.

## 0.61.2

### Patch Changes

- The bundled `sm-tutorial` skill now demos the `claude` provider only; the other providers (`openai`/Codex, `agent-skills`/Antigravity) are presented as "coming soon". Provider detection always resolves to `claude`, the settings lens step drops the live switch to `openai` and shows only the auto-detected `claude` lens, and the project-kickoff markers prompt tells the tester the other lenses are coming soon. The `--provider` fixture plumbing stays wired so they drop in later.

  ## User-facing

  The interactive tutorial now focuses on Claude only. Other assistants (Codex, Antigravity, agent-skills) show as "coming soon" instead of being offered as setup options.

## 0.61.1

### Patch Changes

- Restructure the bundled `sm-tutorial` daily-loop part toward a UI-first walkthrough: split bringing the site up into a new `preview` chapter (with an express-missing recovery note), drop the orphan-draft / wire-and-improve arc, and rework `broken-ref`, `reserved`, and the renamed `stability` chapter to watch results on the live Map instead of running `sm scan` / `sm check`. Also hardens the publish frontmatter paste guidance and clarifies auto-advance still announces every chapter's number.

- Iterative polish of the bundled `sm-tutorial` skill, found while test-walking it: clearer prologue narration (floating "nodes" not "dots", broken reference reworded off the "bare mention" jargon, fixed edit attribution, stale inspector and Beat-marker notes dropped), a pre-flight HARD STOP so the two-terminals confirmation lands before the menu, a new `edit-link` beat where the tester adds `.md` to resolve the broken reference, an always-reseed fix, and less frontmatter noise on the fixture.

## 0.61.0

### Minor Changes

- `sm version` no longer prints the `kernel` row, and `sm version --json` drops the `kernel` field: the matrix is now `{ sm, spec, dbSchema }`. The CLI and kernel ship in one package and always carried the identical number, so the second row was redundant noise rather than information; the row returns the day the kernel publishes as its own package. Pre-1.0 breaking change shipped as a minor per the versioning policy.

  ## User-facing

  `sm version` no longer shows a separate `kernel` line, it always matched `sm` exactly. The matrix now lists sm, spec, runtime, and db-schema.

### Patch Changes

- Refactor the bundled `sm-tutorial` skill so fixture-file generation and progress tracking run as two zero-dependency Node scripts inside the skill (`scripts/state.js`, `scripts/fixtures.js`) reading a single `fixtures-data/` source of truth, instead of the agent reproducing fixture content verbatim and hand-editing a YAML state file each chapter. State moves to `tutorial-state.json` fed by a generated `references/_manifest.json` sidecar; tester-facing narration is unchanged.

## 0.60.4

### Patch Changes

- Two sm-tutorial fixes from tester feedback: the first-agent chapter no longer repeats its framing (the redundant `Context` field is dropped, so the tester sees the agent-created message once instead of twice), and the scaffolded `.skillmapignore` guidance now guards against broadening the ignore to the whole `.claude/`, which would hide the harness agents and commands the tester builds.

## 0.60.3

### Patch Changes

- The web demo now ships the view-contribution registry, so the node card footer slot icons (tools, links, external refs, issue counts) render in demo mode instead of a bare value with no glyph. The static data source primes it from the bundled meta like the live BFF path does, and the demo build derives it from the kernel. Also reverts the earlier folder/dark-theme icon swap back to Font Awesome (a misdiagnosis: the demo fonts load fine).

- The workspace search now narrows the map by default, not just the files rail: a query filters both surfaces so it focuses the whole workspace at once. The prior default (map keeps its full layout while only the rail narrows) moves behind the rail's search-to-map toggle and the persisted `sm.workspace.search-affects-map` preference (an absent key now reads as on). Tutorial references updated to match.

  ## User-facing

  Typing in the workspace search now filters the map too, not just the files list, so a query focuses the whole workspace. Want the map to keep its full layout? Turn off the search-to-map toggle next to the search box.

## 0.60.2

### Patch Changes

- The map card's file-path folder icon and the dark-theme toggle icon switched from Font Awesome's regular weight (`fa-regular`) to the matching PrimeIcons glyphs (`pi-folder-open`, `pi-moon`). These were the only two first-party icons relying on the `fa-regular` webfont, which is not reliably served on the public demo deploy, so they rendered blank there; PrimeIcons is already the icon set the surrounding controls use, so the icons now render consistently. Icon meaning is unchanged.

## 0.60.1

### Patch Changes

- The graph map's camera behaviour changes on two interactions. Clicking a tag chip on a card now curates the map in place without panning or zooming, so the operator stays on the card they clicked. The explicit re-arrange and fit-to-screen buttons now glide the camera to the new framing instead of snapping, matching the automatic auto-fit that already animated on scan add / remove. Which nodes get framed is unchanged.

  ## User-facing

  Clicking a tag on a card now filters the map without jumping the view around, it stays where you are. And the Re-arrange and Fit buttons glide the map into place instead of snapping, so it is easier to follow where things moved.

## 0.60.0

### Minor Changes

- New committed project setting `allowSidecarWriters` (default `true`) lets shared projects forbid every extension that writes `.sm` annotation sidecars. Actions declare the capability via `writes: ['sidecar']` on their manifest; when the policy is `false` the scan composer drops those actions (buttons never render) and the sidecar store refuses the write (BFF 403 `sidecar-writers-forbidden`), a hard gate that wins over the per-machine `allowEditSmFiles` consent.

  ## User-facing

  Shared projects can now turn off sidecar writers: a new Project setting stops actions from creating or editing the `.sm` files next to your notes. It is saved in the committed settings.json so it applies to the whole team and cannot be overridden locally.

- The inspector tag row (`<sm-node-tags>`) is now an inline editor: `core/node-set-tags` no longer self-projects an `inspector.action.button`; a pencil opens an add / remove editor (shown even with no tags) that offers the tags already present in the graph as click-to-add chips, derived live from the loaded scan; typing a brand-new tag still works. The author guide's self-projection example switched from Edit tags to Set stability.

  ## User-facing

  Edit a node's tags right where they are shown: click the pencil in the inspector's tag row to add or remove them inline, with one-click chips for tags already used in your graph (you can still type new ones). The separate Edit tags button is gone.

### Patch Changes

- Fix the `--analyzers` (CLI) and `?analyzerId=` (BFF) filter so a qualified `<plugin>/<id>` form matches the persisted short analyzer id (issues store the short kebab id with no slash, per `issue.schema.json`). Before, only a short filter matched, so `sm check --analyzers core/node-stability` returned nothing while the bare `node-stability` worked. Both `matchesAnalyzerFilter` and the `/api/issues` SQL now reduce a qualified filter entry to its suffix; the short form is unchanged.

  ## User-facing

  `sm check --analyzers core/<id>` now matches issues, not only the bare `<id>` form.

- Fix a stale doc comment in the `annotation-orphan` analyzer: the header claimed `nodeIds` is empty, but the analyzer sets it to the orphan's would-be `.md` path (the missing sibling, to satisfy the issue schema's `minItems: 1`). Comment-only; no behavior change.

- Sanitize the tags written by the `core/node-set-tags` action: it now keeps strings only, trims them, drops empty entries (the `annotations.tags` schema requires non-empty items), and dedups, instead of writing the free-form input verbatim. Prevents the Edit tags flow from producing a schema-violating or messy sidecar.

  ## User-facing

  Editing a node's tags now drops blank and duplicate entries and trims whitespace, instead of saving them as-is.

- The `node-stability` experimental / deprecated card-footer chips were being suppressed: `card.footer.right` is a counter slot that treats `value: 0` as empty, and the contributions set `emitWhenEmpty: false`, so the badges never rendered. They now emit-when-empty and show again as icon-only badges (the `fa-flask` / `pi-ban` icon carries the meaning, value is always 0).

  ## User-facing

  The experimental / deprecated badge on a node's card now shows again.

## 0.59.0

### Minor Changes

- Ship the `core/node-bump` action and the `core/annotation-stale` analyzer as `experimental`, so the sidecar bump/drift surface is disabled by default (Decision #128). Gated as a unit: with the action disabled no Bump button projects, and with the drift analyzer disabled no stale finding fires. The `sidecar-end-to-end` conformance case drops its `annotation-stale` assertion accordingly (a default scan now surfaces only `annotation-orphan`; the node still carries the derived `sidecar.status`).

  ## User-facing

  The Bump button and the sidecar drift ("stale") finding are off by default now. Staleness still shows on the node's status; re-enable with `sm plugins enable core/node-bump core/annotation-stale` or the Settings toggles.

### Patch Changes

- Remove a dead per-node aggregation loop from the `annotation-field-unknown` analyzer: it counted offending keys per node for a card chip that was already retired, then discarded the result via `void`. No behavior change; the emitted findings are unchanged.

## 0.58.0

### Minor Changes

- Move the inspector Set stability button to the `core/node-set-stability` action's scan-time `project()`. The button now tracks the action's enabled state (a disabled action projects no button) instead of the `core/node-stability` analyzer emitting it unconditionally. The analyzer also stops raising an `info` for `experimental` nodes (only `deprecated` still raises a finding, experimental stays a chip) and ships a clearer plugins-list description.

  ## User-facing

  The Set stability button no longer shows when its action is turned off (it used to leave a dead button), and experimental files no longer add an info row to Findings; the experimental badge still shows on the card.

- Remove the `supersede` feature end to end. The `supersedes` link kind is dropped from the global link-kind enum, the `annotations.supersedes` and `supersededBy` sidecar fields are removed from the spec, and the three built-ins that powered it (the `core/annotations` extractor, the `core/node-supersede` action, the `core/node-superseded` analyzer) are deleted. Scans no longer produce supersede links, and the inspector drops the Supersede button and the superseded-by banner.

  ## User-facing

  The Supersede inspector button, the "superseded by" banner, and supersede links on the map are gone. The `supersedes` and `supersededBy` keys in `.sm` sidecars are no longer recognized, remove them from any sidecar that still declares them.

- The inspector sidecar action buttons (Set stability, Edit tags, Bump) now project on every real (non-virtual) node, not only nodes that already have a `.sm` sidecar. The write creates the sidecar when absent (gated by the write-consent flow), so a node can get its first annotation straight from the inspector. Bump is enabled on a node with no sidecar (it creates one) or a stale sidecar, and disabled only on a fresh one. Synthetic nodes stay excluded since there is no file to anchor a `.sm`.

  ## User-facing

  You can now set stability, edit tags, or bump any node straight from the inspector, even ones without a `.sm` yet. The action creates the sidecar for you, with the usual write consent.

## 0.57.0

### Minor Changes

- Normalize every built-in analyzer finding into one canonical message shape via the shared `formatFinding` helper: an optional backtick-quoted subject line, then `L<line>: <what>; <why>` (the `L<line>:` prefix only when the finding maps to body line(s)). Remediation advice moves out of `message` into `Issue.fix.summary`. `issue.schema.json` documents the grammar as normative; all 14 message-emitting analyzers were migrated, so `sm check` and the UI Inspector read consistently.

  ## User-facing

  **Finding messages now read the same way everywhere.** Each one shows the offending subject on its own line, then `L<line>: what; why`, with the fix hint shown separately instead of appended. Output in `sm check` and the Inspector is more consistent and easier to scan.

- Fix two built-in finding messages that drifted from the canonical `<what>; <why>` shape: `core/name-reserved` said "Name collision" (clashing with the separate `core/name-collision` rule) and now reads "Reserved name"; `core/job-file-orphan` now names the orphan file as the finding subject, matching `core/annotation-orphan`. A new format-consistency test pins every analyzer body to the grammar so messages stay uniform.

  ## User-facing

  **Finding messages read more consistently.** Reserved-name findings no longer say "Name collision" (now "Reserved name"), and orphan-job-file findings name the file they point at, like the other findings.

- Redesign the link-confidence scoring model: the kernel seeds a 1.0 baseline on every link (the per-extractor emit floor is dropped) and the score-phase detectors subtract a fixed penalty on top, so `core/name-reserved` lands a reserved link at 0.1 and `core/reference-broken` a broken one at 0.5, while disabling a detector leaves its link at 1.0. The built-in `core/score-resolution` analyzer is deleted (its 1.0 is now the baseline), so a clean resolved link records no `scan_link_scores` row.

  ## User-facing

  **Link confidence now starts at 1.0 and each rule subtracts a fixed amount.** A clean link reads 1.0, a reserved one 0.1, a broken one 0.5. Turning a rule off leaves its links at full confidence. The internal score-resolution scorer was retired.

- Add a `fix.summary` remediation hint to the `core/reference-broken` error finding: fix the path or name, remove the broken link, or add the file's folder under "Folders for link validation" (the `scan.referencePaths` escape hatch, which clears path-style breaks only). Detection and `error` severity are unchanged.

  ## User-facing

  **Broken-reference findings now suggest how to fix them.** Each one points at correcting the path or name, removing the link, or adding the file's folder under Folders for link validation in Settings, so links to files outside the project still validate.

- Reword the `core/reference-redundant` finding to be kind-agnostic: it no longer says "Duplicate reference" (the redundancy can span different link kinds, e.g. `invokes` plus `references` to one node), and the remediation moves out of the message into `fix.summary`. The hint now reads as optional, the rule is `info` and keeping multiple forms can be deliberate.

  ## User-facing

  **Redundant-link findings read clearer.** The message no longer assumes the links are "references" (they may be a mix of kinds), and the fix hint now reads as optional: consolidate the links, or keep the overlap on purpose.

- Remove the `core/job-file-orphan` analyzer, which flagged `*.md` files under `.skill-map/jobs/` that no job row referenced. The scan-time plumbing that fed it (`IAnalyzerContext.orphanJobFiles`, `RunScanOptions.orphanJobFiles`, scan-runner computation) is removed too, so no dead context survives. The `findOrphanJobFiles` helper and the `sm job prune --orphan-files` verb stay. The analyzer returns later under a probabilistic evaluation model.

  ## User-facing

  The orphan-job-file check is gone from scans for now; it will come back with a smarter, probabilistic model. You can still remove leftover job files with `sm job prune --orphan-files`.

- Rename the built-in analyzer `core/link-conflict` to `core/link-kind-conflict`. The rule flags two detectors emitting different `kind` values for the same `(source, target)` pair, so the id now names what it actually checks (a kind disagreement). Folder, id, texts, spec, and tests were renamed together, no compatibility alias. The rule also gains a `fix.summary` remediation hint (drop one conflicting source, or ignore the overlap deliberately).

  ## User-facing

  **The `link-conflict` rule is now `link-kind-conflict`.** If you enabled or disabled it via `sm plugins`, re-apply the toggle under the new id; the old id is no longer recognized. The warning it raises is unchanged.

- Rename `core/signal-collision` to `core/extractor-collision` (the rule surfaces two extractors colliding over the same span of text; "Signal" was internal IR jargon) and drop the dead `extractorDisabled` / `belowFloor` rejection stubs from the resolver schema, the `ISignalResolution` type, and the analyzer. The finding now carries the canonical `L<line>:` prefix and a `fix.summary` hint (rephrase one token, or accept the winner).

  ## User-facing

  **`signal-collision` is now `extractor-collision`** and reads clearer: it points at the body line, names the two extractors that overlapped, and suggests how to resolve it (rephrase one token, accept the winner, or flip the tiebreak).

- Rename `core/trigger-collision` to `core/name-collision` and key it on the resolution identifier instead of the slashed trigger. It fires (`error`) when two or more name-resolvable nodes (kinds whose `identifiers` include `frontmatter.name`) declare the same normalised `name`. The subject is the bare name (the old `/` sigil was wrong for agents), and case / separator invocation variants no longer false-positive.

  ## User-facing

  **`trigger-collision` is now `name-collision`** and fires only when two files declare the same resolvable name (a command and an agent both named `deploy`, say), across any name-resolvable kind. Plain notes, addressed by path, never collide.

- `core/schema-violation` no longer re-warns a node whose frontmatter the kernel already flagged. Its universal base-field check (missing `name` / `description`) reads `accumulatedIssues` and stays silent when a `frontmatter-invalid`, `frontmatter-malformed`, or `frontmatter-parse-error` already covers the node, so a single bad frontmatter surfaces one warning instead of two. The check still fires when the kernel said nothing (dispatch never reached the per-kind validator).

  ## User-facing

  A file with invalid frontmatter now shows one warning instead of two. The schema check stops repeating what the per-kind validator already reported, so the issue list and the per-node warning count read cleaner.

- Make the link-confidence scoring mechanism spec-official. `analyzer.schema.json` gains a `phase` enum so external analyzers can declare `phase: 'score'` and adjust link confidence via `ctx.adjustConfidence(link, op)` (op kinds `set` / `delta` / `ceil` / `floor`), folded deterministically and clamped to [0,1] before the read-only phases. The spec now documents the phase, the fold, and the `scan_link_scores` attribution table, with a `score-phase-confidence` conformance case locking it.

  ## User-facing

  **Plugin authors can ship a `score`-phase analyzer that adds or subtracts link confidence.** Declare `phase: 'score'` and call `ctx.adjustConfidence(link, op)` to compose on top of the kernel's own scoring; every adjustment is recorded in `scan_link_scores` for auditing.

- The `/ws` server now pings every client every 30s so idle connections survive intermediary proxies and half-open peers get terminated, and the SPA's WebSocket client resets its reconnect backoff only after a connection stays open long enough to be stable. Together these stop a flapping connection from looping at 1s and re-seeding `GET /api/scan` in a tight poll storm; an unrecoverable drop now escalates to the non-fatal 'connection lost' state.

  ## User-facing

  **The live view stops hammering the server on a dropped connection.** Idle tabs stay connected instead of silently dropping, and a connection that cannot recover now shows a clear 'connection lost' notice instead of retrying scans forever in the background.

- Stop the reconnect re-seed storm when the server flaps. The SPA re-seeds (`GET /api/scan` plus the cascading node / issue fetches) only after the WebSocket RE-STABILISES, not on every raw `open`. A flapping connection (a `--watch` BFF restarting, a rolling deploy) opens then drops within the stability window, so re-seeding on each open hammered the read endpoints with `ECONNREFUSED`; gating on a new `stableConnected` signal fires at most one re-seed per recovered connection.

  ## User-facing

  **No more request storm when the dev server restarts.** The UI waits for the connection to stabilise before re-fetching, instead of hammering the API every time a restarting server flaps the socket.

## 0.56.0

### Minor Changes

- Plugin extensions declare operator-configurable `settings` in their manifest, read at scan time via `ctx.settings` and resolved through the config layers under `plugins.<id>.extensions.<extId>.settings`. The `sm plugins config <plugin>/<ext>` verb, `GET`/`PATCH /api/plugins`, and per-plugin sections in Settings all read and write them; `secret` values route to the gitignored project-local file (no encryption). Adds a `number` (decimal) input-type to the catalog.

  ## User-facing

  Plugin extensions can expose options: edit them per plugin in Settings (one global Apply) or via `sm plugins config <plugin>/<ext>` (saved in `.skill-map/settings.json`; secrets stay local, never committed). Run `sm scan` to apply. New decimal `number` option type.

### Patch Changes

- Reserve the claude built-in slash names under `skill` as well as `command`. The two kinds share the `/` invocation namespace (`invokes: ['command','skill']`), so a built-in like `/help` shadows a user skill named `help` just as it shadows a command; the list is extracted to a shared `RESERVED_SLASH_NAMES` const. The `core/name-reserved` warnings are reworded around "Name collision: ..." so the operator reads what happened instead of internal shadowing terms.

  ## User-facing

  **Skills that shadow a built-in slash command are now flagged.** A skill named like a built-in (e.g. `/help`) is reported as a name collision, the same as a command was, and the collision warnings are reworded to read more plainly.

- Consolidate link-target resolution onto the kernel's authoritative `link.resolvedTarget` (stamped by the post-walk lift). `core/link-counter` now tallies footer chips by that field and shares a single `isSelfLoop` helper with `core/link-self-loop`, and the graph view reads `resolvedTarget` instead of recomputing its own name index. The duplicate kernel and UI resolvers are gone, so footer chip counts, drawn graph edges, and the incoming panel can no longer disagree.

- Remove the dead `data.selfLoop: true` flag from `core/link-self-loop` issues. No consumer ever read it: the graph view recomputes the `source === resolvedTarget` predicate independently in its render-pipeline mirror, so the flag (and its "authoritative detector" doc claim) was vestigial. The doc comment now states the rule reports and the layout draws as deliberately independent paths, and the two obsolete `data.selfLoop` test assertions are dropped.

- Fix `core/link-conflict` embedding two literal NUL bytes (0x00) as the `(source, target)` group-key separator: git treated the file as binary so its diffs were hidden in review and grep skipped it. The separator is now a plain JS unicode escape (still NUL at runtime, identical behavior) and the hardcoded `pluginId: 'core'` reads the shared `CORE_PLUGIN_ID` const like the other core analyzers.

- Make `core/reference-broken` a pure projector of the kernel's broken-link verdict. The post-walk lift now computes the genuinely-broken set (the kind-agnostic "the name exists nowhere" notion of `spec/architecture.md` §Provider · resolution rules) and threads it via `IAnalyzerContext.brokenLinks`. The rule projects that set instead of re-deriving a frontmatter-name-only index that false-flagged links resolving via a filename / dirname identifier; `core/name-reserved` reads `link.resolvedTarget`.

  ## User-facing

  **Fewer false broken-reference errors.** A `@name` or `/name` that points at a same-named file no longer reports as broken, even when that file has no `name:` in its frontmatter; the reference resolves like the runtime follows it.

- Consolidate `core/reference-redundant` onto the kernel's `link.resolvedTarget` (stamped by the post-walk lift) instead of rebuilding its own name index, deleting the duplicated `buildNameIndex` / `collectIdentifiers` / `resolveTargetPath` machinery. Grouping now tracks the resolved graph; a trigger that matches a name but fails the strict kind matrix is no longer grouped as redundant (that mismatch is `core/link-conflict`'s concern). The three documented redundancy cases are preserved.

## 0.55.0

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

- The `core/node-superseded` analyzer (surfaces a node's `supersededBy` declaration as an `info` finding) is now `experimental`, joining the rest of the supersession family (`core/supersede`, `core/node-supersede`) which already shipped experimental. As an experimental extension it ships disabled by default, so the "node is superseded by X" finding no longer appears until the operator enables the family with `sm plugins enable core/node-superseded` (or the Settings toggle).

  ## User-facing

  The supersession info finding ("this node is superseded by X") no longer shows by default: `core/node-superseded` is now experimental, so the whole supersession family (declare button + this finding) is off until you enable it in Settings or with `sm plugins enable`.

- `sm plugins show` is now extension-only: it takes a qualified `<plugin>/<ext>` id and renders one extension's detail. The whole-plugin view (manifest plus extension rows) moves to `sm plugins list <id>`, and the top-level `sm plugins list` index drops the per-extension name sub-lines. A bare `show <plugin>` id and a qualified `list <plugin>/<ext>` id are each rejected with a directed redirect to the other verb.

  ## User-facing

  **Plugin commands split by altitude.** `sm plugins list <id>` now shows a whole plugin's extensions (kinds, versions, status); `sm plugins show` is for a single `<plugin>/<ext>` extension. The plain `sm plugins list` stays a clean index, one row per plugin.

- The `sm tutorial` campaign's second half is now a single "daily loop" part (add, improve, publish) that operates the harness for real instead of by hand: the content-editor, check-links, and publish steps actually run, the maintenance analyzers (broken reference, orphan, reserved name, `.sm` sidecar) surface from real work, and the portfolio it builds ships with a styled, personalized site. MCP is parked out of the menu pending its own iteration.

  ## User-facing

  The interactive tutorial's second half is now a single "daily loop": you add a page with your agent, improve it, and publish, running the harness for real. The portfolio it builds ships with a clean, personalized site you can serve and deploy.

### Patch Changes

- `core/backtick-path` now matches bare `.md` filenames inside code spans, not only slashed paths: a backticked `` `algo4.md` `` becomes a `points` edge the way the runtime follows it. The `/` separator is now optional, with the first path segment anchored to a word char so globs and placeholders (`{PROJECT}-x.md`, `*-S.md`) stay rejected. Slashless names like `SKILL.md` match too; a self-reference becomes a self-loop, other misses flag via `core/reference-broken`.

  ## User-facing

  Backticked filenames now become links even without a folder: writing `` `algo4.md` `` inside code formatting (not just `` `docs/algo4.md` ``) draws an arrow to that file in the graph, matching how an agent actually follows the reference.

- Broken graph edges now render fainter than resolved ones. `core/markdown-link` emits the spec's `0.95` (unambiguous syntax) instead of a hardcoded `1.0`, and the post-walk confidence-lift transform adds a `BROKEN_TARGET_CONFIDENCE = 0.5` downgrade for links that resolve to nothing (no path and no name-index match, like `core/reference-broken`). A dangling `[x](missing.md)`, `@missing.md`, or `/no-such-command` now sits at `0.5`, below a resolved `1.0` and above a reserved `0.1`.

  ## User-facing

  Broken links in the graph now appear fainter than working ones: a markdown link, `@file`, or `/command` pointing at something that does not exist renders at low opacity, so dangling references stand out at a glance instead of looking like solid edges.

- Every built-in extractor description now ends with a concrete usage example. The `markdown-link`, `external-url-counter`, `annotations`, `mcp-tools`, `backtick-path`, `tools-counter`, and `slash-command` manifests keep their existing leading sentence and append a short `Example: ...` clause, so the text shown in `sm plugins list`, `sm plugins show`, and the Settings plugins panel illustrates what each extractor matches.

  ## User-facing

  Extractor descriptions in `sm plugins list` and Settings now include a usage example.

- The post-walk confidence-lift transform no longer bumps a link to `1.0` when its resolved target is a `virtual: true` node (today only `core/mcp-tools`' `mcp://<server>` nodes, reconstructed from frontmatter, never verified on disk). The edge still resolves (`resolvedTarget` set, navigable) but keeps its extractor emit confidence, so an MCP edge stays `0.85`: an unverified entity is not full certainty, like the reserved-target downgrade.

## 0.54.0

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

- The `tools-counter` extractor moved from the `core` plugin into the `claude` plugin: its qualified id is now `claude/tools-counter` (settings toggles keyed `core/tools-counter` no longer match), and disabling the `claude` plugin now drops the agent tools chip together with the provider it serves.

### Patch Changes

- Reworks every built-in analyzer message into a compact finding grammar: the involved artifact (target, trigger, sidecar) leads on its own line, followed by a short label, count, detail, and a `(line N)` location suffix wherever the link records one (broken references, self-loops, reserved-name downgrades); duplicate occurrences group by trigger, and messages about the node itself drop the redundant path. The inspector renders the line break and `sm check` flattens it to one row.

  ## User-facing

  Findings are shorter and clearer: the file or trigger involved leads on its own line, duplicates collapse to `Duplicate reference (2): \`refs/x.md\` (124, 145)`, broken references name the line they sit on, and messages no longer repeat the node's own path.

- Downgrades the `core/reference-redundant` analyzer severity from `warn` to `info`: a multi-form reference to the same target is a consolidation hint, not a defect, so it no longer shares the visual bucket of actionable warnings like `reference-broken`.

  ## User-facing

  Referencing the same file twice in different forms (a markdown link plus a backtick path, for example) now shows as an info note instead of a warning, so the warning chips on cards only count things worth fixing.

- Decouples the workspace text search from the map: `FilterStoreService.apply()` gains an `includeSearch` option and the graph view only applies the query when the new persisted `searchAffectsMap` preference (toggle next to the rail search input, default off) is enabled. The files rail keeps filtering on every query.

  ## User-facing

  Searching no longer rips nodes out of the map: by default the query narrows only the files list while the map keeps its layout. A new toggle next to the search box brings back the old filter-everything behavior, and your choice is remembered.

## 0.53.6

### Patch Changes

- Tutorial-review pass on the bundled `sm-tutorial`: the example fixtures stop inventing frontmatter fields skill-map ignores (`args`/`shortcut` on commands, `inputs`/`outputs`/`metadata`/`version`/`tags` on skills and notes, which live in the `.sm` sidecar or nowhere); the `.sm` annotations lesson is de-duplicated across parts; the Maintain section is retitled "Maintain the harness"; and chapters now carry `section.chapter` numbers. `sm --help` also leads with a tutorial call-to-action.

  ## User-facing

  `sm --help` now opens with a pointer to `sm tutorial`, the guided hands-on walkthrough. The tutorial reads cleaner too: the maintain part is renamed, chapters are numbered (5.1, 5.2…), and the annotations lesson no longer repeats across parts.

## 0.53.5

### Patch Changes

- Tutorial-review pass on the bundled `sm-tutorial` walkthrough: the connector-confidence lessons now match the resolver (a faint 0.50 mention versus a resolved 1.00 reference, with no phantom 0.85 step), the `@AGENTS.md` connector is labelled `references`, an optional `content-editor` chapter was added, the `sm bump` chapter was removed, and the MCP part now runs last.

## 0.53.4

### Patch Changes

- Part 8 (`cli`) of the bundled `sm-tutorial` skill now self-seeds its own copy of the Part 0 demo fixture (`preflight: seed`, new `prologue-built` snapshot) instead of assuming it is still on disk. Before, running the campaign after the prologue deleted that fixture, yet Part 8 stayed in the menu and ran against the wrong project. Now it rebuilds the fixture on entry (resetting the portfolio if present) and, like the campaign parts, is always shown.

  ## User-facing

  The built-in tutorial's CLI deep-dive now rebuilds its own demo fixture when you enter it, so it works correctly even after you have run the project campaign, and it always appears in the menu instead of staying hidden until the prologue is done.

- The workspace files-panel collapse button now shows a left chevron instead of an `✕`, so it no longer reads as a clear-search control sitting next to the search box. The bundled `sm-tutorial` skill drops the slashed `# /publish` / `# /init` headers from its command fixtures (the slash token produced a spurious self-loop link the tester saw before it was explained) and adds a third-terminal heads-up to the maintenance part, where the live server and one-off `sm` commands run side by side.

  ## User-facing

  The files panel's collapse button is now a chevron instead of an `✕`, so it clearly hides the panel rather than clearing the search. The built-in tutorial fixes a stray self-link in its command examples and reminds you to open a third terminal during the maintenance part.

## 0.53.3

### Patch Changes

- Graph view gains three Neon themes (R/G/B) with a glow treatment, selectable from the theme picker. The toolbar tooltips were trimmed and the "edge style" control renamed to "connector style". The bundled `sm-tutorial` skill adds part 3 ("run the harness") and reworks the finale.

  ## User-facing

  Three new Neon graph themes (red/green/blue) with a glow effect in the map's theme picker. Toolbar tooltips are shorter and "edge style" is now "connector style". The built-in tutorial adds a third part and a reworked ending.

## 0.53.2

### Patch Changes

- Graph view: "Fit to screen" (and the boot / auto fit) now caps zoom at natural size instead of magnifying, so opening a project with a single node no longer renders it gigantic; the wheel still zooms in to 2x. The "Re-arrange layout" toolbar tooltip also drops its redundant "(re-run auto layout)" tail.

  ## User-facing

  Opening a project with one node no longer zooms in too far: the map fits content at natural size (you can still wheel-zoom in). The "Re-arrange layout" tooltip is shorter.

## 0.53.1

### Patch Changes

- The cache-rebuild prompt shown on a version skew (re-scanning a DB written by a different CLI version) is reworded to be shorter and calmer: it no longer recites the pre-1.0 derived-cache rationale or uses "delete" / "deleted" phrasing. The post-rebuild receipt is now suppressed after an interactive y/N confirm (the operator already answered) and only prints for automatic rebuilds (`--yes`, non-TTY, the BFF), where it is the only signal the cache was wiped.

  ## User-facing

  When you upgrade and re-scan, the cache-rebuild prompt is short and reassuring, and once you confirm it no longer prints a redundant "rebuilt" notice. Automatic rebuilds (for example with `--yes`) still show a one-line confirmation.

- The default graph layout direction is now left-to-right instead of top-to-bottom. The "Balanced" (dagre network-simplex) algorithm was already the default, so only the direction changed: a fresh map with no saved layout preference now flows horizontally. Users who already picked a direction keep their choice.

  ## User-facing

  New maps now lay out left-to-right by default (with the Balanced algorithm), so the skill dependency chain reads along the natural left-to-right axis. You can switch back to top-to-bottom from the graph toolbar or Settings.

- Tutorial polish for `sm tutorial` (the prologue and shared conventions): the session now opens on a numbered menu where you pick the part to run, each chapter asks for confirmation once instead of several times in a row, and the prologue's references to the live UI are refreshed to the current names (the "Connections" panel, "Re-arrange layout"). The watcher/browser are no longer translated in the Spanish flow, and the tutorial no longer creates harness tasks.

  ## User-facing

  The interactive tutorial now opens on a numbered menu to pick where to start, and walks each step with a single confirmation instead of several. Its references to the live UI match what is on screen.

## 0.53.0

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

- The bundled `sm-tutorial` skill gains the portfolio campaign: Parts 1-5 of the book (start the project from zero, connect the harness, maintain the site, MCP, and the live-site finale) are now authored and active. They build one accumulating example project, a static portfolio served by a tiny Express server plus the `.claude/` harness that maintains it, around which the prologue and the advanced parts (extend skill-map, the CLI in depth) already sit.

  ## User-facing

  The interactive tutorial (`sm tutorial`) now walks a full campaign: you build a real static portfolio site and the `.claude/` harness that maintains it, from `sm init` to the live site, picking parts from the in-skill menu.

- The portfolio-campaign parts of the bundled `sm-tutorial` skill become jumpable. Each now declares `preflight: seed`, so entering one out of order fast-forwards the project to that part's starting state (it lays the cumulative `.claude/` harness from a checklist, then inits and scans) instead of forcing the tester through the earlier parts first. Run in order it stays a no-op; the skipped predecessors are marked and stay in the menu for later.

  ## User-facing

  In the interactive tutorial you can now jump straight into any part of the portfolio campaign from the menu (say the maintenance or MCP part). If you skipped the earlier parts, the tutorial sets the project up for you so you can start right there.

- The `sm tutorial` verb drops its `master` positional variant and now materializes a single `sm-tutorial` skill, restructured into a "book" of ordered parts and chapters with a manifest-driven menu. The advanced walkthrough (plugins, settings, view-slots) and the CLI deep-dive are parts inside that one skill, reached from its menu after the live-UI prologue. `sm tutorial master` exits 2; `.claude/skills/sm-master/` is removed.

  ## User-facing

  `sm tutorial master` is gone. Run `sm tutorial`: the advanced parts (plugins, settings, view-slots) and the CLI in depth are now chapters you pick from a menu inside the tutorial, after the live-UI prologue.

### Patch Changes

- Plugin load failures read better. A wrong view-slot value collapses AJV's `must be equal to constant` wall into one `<path> is not a valid value` linking to the slot catalog (`spec/view-slots.md`) on GitHub; other manifest errors link to the kind schema. The warning is one non-repetitive line, `plugin <id> (<status>), all extensions skipped: <reason>`. Plugin-load warnings also no longer print twice at `sm serve` boot.

  ## User-facing

  Clearer plugin errors: a wrong view-slot name now gives a short message linking to the slot catalog, and the warning spells out that the plugin and all its extensions were skipped. It also no longer appears twice when the server starts.

- Harden test and conformance coverage for the emit-by-reference view-contribution refactor: orchestrator rejection-path and renderer unit tests, `sm plugins doctor` runtime-error coverage, two new conformance cases (renamed list payloads with off-shape rejections, and a manifest declaring all 14 slots) plus a fixture-drift fix. The conformance suite now runs in CI via `validate:test`, and the `plugins doctor` docs gain a runtime-error note. No CLI or normative spec change.

## 0.52.0

### Minor Changes

- `sm bump` and the BFF bump route (`POST /api/sidecar/bump`) now stamp `audit.lastBumpedBy` / `audit.createdBy` with the project's Git author name (`git config user.name`) when the node lives in a Git repository, falling back to the channel literal (`'cli'` / `'ui'`) otherwise. This supersedes Decision A5, which kept the invoker a literal.

  ## User-facing

  Bumping a node now records **who** bumped it: the audit `by` fields show your Git author name (`git config user.name`) instead of `cli` / `ui`, when the project is a Git repo. It falls back to `cli` / `ui` outside a Git repo or when no `user.name` is configured.

- The inspector body renders markdown with full prose styling plus highlight.js syntax highlighting and re-renders live on `scan.completed`. The connections panel drops its duplicate Findings sub-section and header and reuses the node-card icon vocabulary for Outgoing / Incoming / External; sidecar tags move to a clickable header row, the Annotations panel leads with Authors, and the map isolate gesture now focuses a node and its direct (one-hop) neighbors instead of its whole chain.

  ## User-facing

  **Inspector polish.** The body now renders rich markdown with code syntax highlighting and updates live after a re-scan. Node tags moved to a clickable row in the header, and "isolate" on the map now shows a node plus its direct neighbors.

- A malformed or schema-invalid `.sm` sidecar now emits its `invalid-sidecar` diagnostic at `error` severity instead of `warn`. The scan still completes (the node is marked present with a null status), but `sm check` now exits non-zero when any sidecar fails to parse or validate, surfacing broken annotations in CI rather than letting them pass as a warning.

  ## User-facing

  `sm check` now **fails** (non-zero exit) when a `.sm` sidecar is malformed or breaks schema validation. These were previously reported as warnings and did not affect the exit code. Fix or remove the offending sidecar to make the check pass.

### Patch Changes

- The active-provider lens dropdown in Settings → Project now greys out (and refuses to select) any Provider the operator has disabled. `GET /api/active-provider` gained a `selectable` field listing the Provider ids that are enabled right now; the SPA renders Providers absent from it as disabled instead of offering a lens whose extractors would never run.

  ## User-facing

  Disabling a provider plugin now removes it as a choice in **Settings → Project → Active provider**. The provider stays listed but greyed out and labelled `(disabled)`, so you can no longer switch the lens to a provider whose extractors would not run.

- The `core/annotation-stale` analyzer is now neutral instead of warning-tinted: drift is informational, not a warning. Its footer chip (`staleIcon`) carries no severity (the clock renders in the foreground colour instead of the warn tint), and the stale Findings issue is lowered from `warn` to `info`. As `info`, it no longer counts toward the card's warn chip (the issue-counter buckets error/warn only) and never affected `sm check`'s exit code (info and warn are both non-failing).

## 0.51.0

### Minor Changes

- Security hardening. `sm serve` now refuses any non-loopback `--host` (the BFF is loopback-only and unauthenticated pre-1.0, Decision #119; off-loopback previously leaned on the DNS-rebinding gate alone). The `/api/nodes/:pathB64` 404 sanitizes the decoded path for the terminal (log-injection parity with sibling routes), the `/ws` broadcaster caps concurrent clients (refuses past the cap with close 1013), and published tarballs now carry npm provenance.

  ## User-facing

  `sm serve` now refuses a non-loopback `--host` (for example `0.0.0.0`): the local server has no auth and is loopback-only, so bind it to `127.0.0.1` or `::1`. Multi-host serve reopens after v0.6.0.

### Patch Changes

- Internal quality pass from a review. The kernel no longer imports the `core/` runtime layer: pure leaves (`atomic-write`, `schema-fingerprint`, `update-check`, the `SKILL_MAP_DIR` literal, the provider detector) moved into `kernel/` and the sidecar consent gate is now injected, with a new lint rule enforcing the boundary. The BFF's two `409` responses dispatch via a typed `ConflictError` instead of a message-prefix match, and `sm scan`'s count nouns moved into the i18n catalog.

## 0.50.1

### Patch Changes

- The reference-redundant finding message is shorter and more direct: "Duplicate reference to <target> (<n> occurrences): <list>." It drops the source-node name (the finding already hangs off that node) and the trailing "consider consolidating..." advice.

  ## User-facing

  The redundant-reference finding now reads with shorter, more direct wording so the duplicated target and where it appears are easier to scan at a glance.

- Polish on the fused workspace: the floating kind / severity / favorites palette counts now reflect the files-rail curation (filtering from the tree reshapes the numbers); selecting a file whose node is hidden from the map no longer pans the camera to empty space; the layout reset only prompts when the user has actually positioned nodes and the warning is lower intensity; and the link-kind palette lists every link kind regardless of node curation.

  ## User-facing

  The map palettes now count only the nodes you've curated visible. Selecting a hidden file no longer jumps the camera to empty space, and "Re-arrange layout" only asks to confirm when you have moved nodes yourself.

## 0.50.0

### Minor Changes

- Fuse the standalone files and map views into one workspace at `/`: a resizable files rail, the graph, and a floating inspector linked through the shared `?path` selection. The rail curates which nodes the map shows via per-file/per-folder visibility checkboxes, folder-depth presets, and an isolate-chain gesture (persisted to localStorage); the layout reset re-arranges only the visible nodes. Retires the `/files` and `/map` routes and the stability / has-issues / stale filters.

  ## User-facing

  The Files and Map tabs are gone: skill-map opens on one screen, file tree left, graph right. Tick files or folders (or the 0/1/2 depth buttons) to pick what the map shows; the tree's map icon isolates a node's whole chain. "Re-arrange layout" tidies just what's visible.

## 0.49.0

### Minor Changes

- Fuse the standalone files and map destinations into one workspace view, now the default landing: a drag-resizable files rail on the left, the graph in the center, and the inspector as a right-side slide-over, all linked through the shared `?path` selection. The file tree gains a tri-state control to curate which nodes appear on the map, with a `Show all` toolbar action to clear it. The `/files` and `/map` routes stay reachable.

  ## User-facing

  **New workspace view**: the file list, graph, and inspector now share one screen. Drag the divider to resize the file rail, click a file to focus its node on the map, and use the tree checkboxes to choose which nodes the map shows (`Show all` clears the selection).

## 0.48.0

### Minor Changes

- `sm plugins create <kind> <plugin-id>` now takes the extension kind as a required first positional and scaffolds a loader-clean stub for each of the six kinds (provider, extractor, analyzer, action, formatter, hook). The slot / input-type catalog gains a single source of truth: the spec enums become `oneOf` const+description, and the kernel + CLI mirrors are generated from it by `scripts/generate-view-catalog.js`, guarded by `view-catalog:check` in `validate:compile`.

  ## User-facing

  `sm plugins create` now takes the extension kind as a required first argument: `sm plugins create <kind> <plugin-id>` (kinds: provider, extractor, analyzer, action, formatter, hook). Previously it only scaffolded extractors.

### Patch Changes

- Restore the left-to-right order of the `card.footer.right` chip cluster that the `core/issue-counter` aggregate had displaced: the stability badge leads (priority 10), then the stale-drift clock chip (priority 20), then the warning and error counters anchor the right edge. A reader notices it as the card-footer status icons returning to lifecycle, stale, warnings, errors order.

  ## User-facing

  **Card footer icon order restored.** The status icons in the bottom-right of each card are back to their previous order: lifecycle/stability first, then the stale indicator, then warnings and errors on the far right.

- The phrase `sm tutorial` surfaces to start each walkthrough now matches the website and READMEs: the basic tutorial trigger is `run the tutorial` / `ejecuta el tutorial` (was `start the tutorial` / `arranquemos el tutorial`) and the master tutorial trigger is `run the master tutorial` / `ejecuta el tutorial maestro`. The two SKILL.md trigger lists pick up the new phrases.

  ## User-facing

  After `sm tutorial`, start the tutorial by typing `run the tutorial` (or `ejecuta el tutorial`), matching the website. The master tutorial uses `run the master tutorial` / `ejecuta el tutorial maestro`.

## 0.47.1

### Patch Changes

- The marketing site gains a Quickstart section just below the hero, with the tutorial first steps as a copy-paste terminal card (install, scaffold, open Claude Code, plus the in-Claude prompt). The documented way to start the tutorial moves from the stale `@sm-tutorial.md` file mention to the natural `run the tutorial` / `run the master tutorial` trigger phrase across the root and CLI READMEs, matching the skill directory that `sm tutorial` now installs.

## 0.47.0

### Minor Changes

- Wired the `tokenizer` project-config key to actually select the scan encoder. It is now a closed enum (`cl100k_base` default, `o200k_base`); the resolved name is recorded in `scan_meta.tokenizer` / `ScanResult.tokenizer` and an out-of-set value is dropped with a warning and falls back to the default. The orchestrator lazily loads only the chosen `js-tiktoken` rank table, and an incremental scan recomputes per-node token counts when the persisted encoder differs from the resolved one.

  ## User-facing

  **Pick your tokenizer.** `tokenizer` in settings.json now selects the encoder for token counts: `cl100k_base` (default, GPT-4) or `o200k_base` (GPT-4o). Any other value is ignored with a warning. Changing it recomputes counts on the next scan.

### Patch Changes

- Detect database schema drift by fingerprint. A sha256 of the migration DDL is stored in `scan_meta.schema_fingerprint` per scan and checked at open, so a DB whose columns fell behind an inline schema edit is caught instead of failing later as a cryptic `no such column` error. Write paths (`sm scan`, `sm serve`) prompt to rebuild (or `--yes`); read verbs warn and point at `sm scan` / `sm db reset`.

  ## User-facing

  skill-map now notices when your local DB schema is out of date (not just an older version): `sm scan` and `sm serve` offer to rebuild the cache, and read commands warn instead of failing with a confusing database error.

- Settings → Plugins gains a single filter bar: a shared **All** reset, a source axis (Built-in / Project), and the existing kind axis on one line. The two axes compose independently (picking a source does not clear a kind), so an operator can isolate the project's own drop-in plugins and extensions from the built-ins. A dedicated empty state points at `sm plugins create` when there are none yet; choices persist per browser.

  ## User-facing

  Settings → Plugins now has a unified filter bar (All, then Built-in / Project, then the kinds), so you can quickly isolate your project's own plugins and extensions from the built-ins.

- The UI WebSocket client no longer raises a stream error when it gives up reconnecting after the dev server stops. It now exposes a `connectionState` signal instead: a new `<sm-connection-banner>` shows a non-fatal "connection lost" notice with a Reconnect button, the data stream stays alive, and the collection re-seeds via `/api/scan` once the socket re-opens. This stops a routine `sm serve` shutdown from surfacing in Sentry as an uncaught error.

  ## User-facing

  When the dev server stops, the UI now shows a "connection lost" banner with a Reconnect button instead of failing silently, and it refreshes automatically once the connection is back.

## 0.46.0

### Minor Changes

- The plugin loader now rejects a disk-loaded extension manifest that re-declares a structure-as-truth field (`id`, `kind`, provider `kinds`, formatter `formatId`) as `invalid-manifest` instead of silently stripping it. These are derived from the folder layout, so declaring one was a second source of truth that could drift. `pluginId` is unchanged. `sm plugins create` no longer emits `kind` in the stub. Breaking for external plugins that inlined any of these fields.

- `sm <namespace> --help` (and `sm help <namespace>`) now render a namespace overview, header, USAGE, an optional DESCRIPTION, and a COMMANDS list of the subcommands, for command prefixes that own subcommands but are not themselves runnable (`plugins`, `db`, `config`, `job`, `actions`, `sidecar`, `hooks`, `conformance`, plus nested ones like `plugins slots`). Previously these fell through to Clipanion's terse "Multiple commands match" listing. Leaf verbs and unknown names are unchanged.

  ## User-facing

  `sm plugins --help` (and `db`, `config`, `job`, and the other command groups) now print a tidy overview with a one-line description and a list of their subcommands, matching the look of `sm scan --help`, instead of a terse internal list.

- Removed seven project-config keys that had no runtime consumer: `i18n.locale`, `providers` (the enabled-list; `activeProvider` stays), `history.share`, the `autoMigrate` config key (the `sm db migrate` / `backup` adapter option is untouched), `plugins.<id>.config`, `plugins.<id>.extensions`, and `scan.followSymlinks` (the walker always hard-skips symlinks). Dropping `plugins.<id>.config` closed the last open subtree, so project-config is now fully `additionalProperties: false`.

  ## User-facing

  **Config cleanup.** Several settings.json keys that never did anything (`i18n`, `providers`, `history`, `autoMigrate`, `scan.followSymlinks`, per-plugin `config` / `extensions`) were removed. If still present they are now ignored and reported with a warning on load.

### Patch Changes

- `sm plugins create` now scaffolds a plugin that loads. The generated `plugin.json` drops the `id` and root `settings` keys (both rejected by the structure-as-truth `PluginManifest` schema), and the extractor stub declares `ui` instead of the dead `viewContributions` field, with its `settings` co-located per-extension. A freshly scaffolded plugin now passes `sm plugins doctor` and emits its contribution on `sm scan` instead of failing with `invalid-manifest`.

- The active-provider auto-detect line (`Auto-detected activeProvider = ... persisted to settings.json`) no longer interleaves with the scan summary. The bootstrap printed it to stderr while `sm scan` writes its summary to stdout, so on a tty the two streams glued together with no newline between them. The bootstrap now stays silent and the CLI announces the auto-detect on the summary's own stream (stdout for `sm scan`, stderr for `sm init`), in order, on its own line.

  ## User-facing

  `sm scan` no longer glues the `Auto-detected activeProvider` notice onto the results line. The auto-detect message now prints on its own line, right above the scan summary.

- Normalize plugin terminology: "bundle" is no longer used as a synonym for "plugin". The installable unit is now consistently called a "plugin" everywhere (types, identifiers, spec prose, CLI output, and Settings labels); the word "bundle" is reserved exclusively for the aggregate toggle that flips all of a plugin's extensions at once (the "bundle macro"). No behavior or wire-shape changes.

  ## User-facing

  `sm plugins list` / `show` and the Settings → Plugins UI now consistently say "plugin" instead of "bundle". The only place "bundle" remains is the name for toggling a whole plugin (all its extensions) at once.

- The release pipeline now uploads CLI source maps to the Sentry Node project (`skill-map-cli`) using debug IDs injected before publish, and the published tarball no longer ships `.map` files when telemetry is configured at build time. A hidden `/intentional-fail` UI route was added as a browser-side Sentry self-test, mirroring the existing `sm intentional-fail` command.

## 0.45.1

### Patch Changes

- Use a slash-free Sentry release identifier (`skill-map-cli@<version>` instead of `@skill-map/cli@<version>`). Sentry rejects forward slashes in release names, so the CI sourcemap upload failed the moment it ran; the UI SDK was also tagging events with a bare version that never matched the upload. The CLI SDK release tag, the UI SDK release tag, and the CI upload now use the same slash-free value so events resolve against their sourcemaps.

## 0.45.0

### Minor Changes

- `sm tutorial` now materializes the walkthrough skill into the chosen agent's territory instead of always `.claude/skills/`. Providers declare an optional `scaffold` block (`skillDir` plus display-only `aka` names); the destination comes from `--for <provider>` or a prompt defaulting to Claude. It now also requires an empty cwd, seeding a self-contained scenario the tester can later delete wholesale, so a non-empty directory is refused (exit 2) unless `--force` is passed.

  ## User-facing

  `sm tutorial` can now target other agents: `--for agent-skills` (open-standard layout, used by Antigravity and OpenAI Codex) or `--for claude` (default). It now requires an empty directory: run it in a fresh folder, or pass `--force` to seed into the current one.

### Patch Changes

- Tidy two run-together lines in `sm init` output: insert a blank line before `Running first scan...` so the scaffolding summary and the first scan are visually separated, and terminate the `Auto-detected activeProvider = ...` line with a newline so it no longer abuts the `First scan: ...` summary.

## 0.44.0

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

## 0.43.0

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

### Patch Changes

- Updated dependencies [dc5c115]
- Updated dependencies [43eb1e5]
- Updated dependencies [e953f9f]
  - @skill-map/spec@0.40.0

## 0.42.0

### Minor Changes

- f2b59c5: Makes the registered Provider set the single source of truth for the UI's provider surfaces (active-lens dropdown, topbar lens chip, per-node provider chip) and for active-lens auto-detection. Removes four divergent hardcoded provider lists that no longer matched the real built-in Providers (the lens dropdown offered phantom `gemini` / `cursor` entries and hid the real `antigravity` / `agent-skills`; the card chip did not know `openai` / `antigravity`; the detection table still listed `cursor`).

### Patch Changes

- Updated dependencies [f2b59c5]
  - @skill-map/spec@0.39.0

## 0.41.0

### Minor Changes

- d3c47b2: Adds a hard cap on the number of files `sm scan` and `sm watch` accept after `.skillmapignore` filtering, plus a persistent UI banner that fires when the graph crosses the recommended limit. Default cap is **256 nodes**. Override per invocation with `--max-nodes <N>` (bidirectional: raises OR lowers the cap).

### Patch Changes

- ac87936: Fix `sm -version` / `sm -help` (and any single-dash long-form typo) printing the no-project hint when run from a directory without `.skill-map/`. The bare-invocation router now bypasses serve-routing for single-dash long forms so Clipanion's parser always surfaces the proper unknown-option diagnostic with the `Did you mean '--foo'?` suggestion, regardless of project state. Double-dash flags (`--max-nodes`, etc.) still route through serve as before, and the no-project hint still fires for `sm --max-nodes 5` outside a project. The CI test job was the trigger: `src/cli/__tests__/cli-parse-errors.spec.ts` ran from a fresh checkout (no DB) and the two single-dash typo cases hit the no-project hint path instead of the parse-error path.

- 018dd8b: Internal test coverage for the `--max-nodes` flag surface introduced in the previous release and for the `<sm-kind-palette>` inline search added during the same UI pass.

- Updated dependencies [d3c47b2]
  - @skill-map/spec@0.38.0

## 0.40.1

### Patch Changes

- 6381646: UI polish across Settings, topbar, list / graph empty states, the Matrix theme, and the list-view column order. Pure `ui/` change, no spec / kernel / CLI verbs touched; the patch bump on `@skill-map/cli` is the carrier because `ui/` ships bundled in the CLI.

## 0.40.0

### Minor Changes

- f66dbfe: Decouple built-in extensions from per-extension semver. Built-ins ship inside the CLI bundle, so authors no longer declare a `version` literal in each `<plugin>/<kind>s/<name>/index.ts` manifest under `src/plugins/`. The codegen at `scripts/generate-built-ins.js` now reads the CLI version from `src/package.json` and stamps it onto every built-in (alongside the existing `pluginId` stamp) when emitting `src/plugins/built-ins.ts`. The resulting runtime objects still satisfy the full kind interface (`IAnalyzer`, `IExtractor`, ...) and every downstream consumer continues to see `ext.version: string`, so `state_executions.extension_version` keeps recording a meaningful value (= CLI version) for reproducibility.

- d852217: Eliminate the bundle-level toggle entirely. Every plugin extension is now independently toggle-able by its qualified `<bundle>/<ext>` id; the bundle itself is a presentational grouping only.

- aab9500: Aggregate severity counter for cards, drive-by cleanups in the footer-right slot.

- 212fdcf: List view as a first-class surface, harmonised severity icons across graph and list.

### Patch Changes

- 9d37094: Settings → Changelog tab: cap the rendered list and add a permanent escape hatch to the full history.

- c067765: Suppress the per-extension version chip for built-in plugins in both the UI Settings → Plugins panel and the CLI `sm plugins show` human output. Built-ins ship inside the CLI bundle and inherit the CLI version, so a per-extension semver chip on every row is noise; per-extension semver only carries meaning for external (user-authored) plugins, which keep showing it.

- 457a60d: Reserve the `graph.node.alert` slot for special-case signals; disconnect every built-in core analyzer from it. Define the **chip-vs-issue policy** for plugin authors and align `reference-broken` to it. The corner badge on the NE tip of each graph card is no longer a generic "this node has a problem" surface. Routine findings (`reference-broken`, `annotation-field-unknown`, `schema-violation`) now ship only as `card.footer.right` chips, the slot's natural home for paired-icon-and-count signals.

- d66bc71: Three findings from a second `sm-tutorial` external-tester session (Adolfo, 2026-05-25).

- Updated dependencies [f66dbfe]

- Updated dependencies [d852217]

- Updated dependencies [457a60d]

- Updated dependencies [d66bc71]
  - @skill-map/spec@0.37.0

## 0.39.0

### Minor Changes

- 8ab68ed: Rename `core/field-unknown` to `core/annotation-field-unknown` so it
  groups alphabetically with the other sidecar (`.sm`) annotation rules
  (`core/annotation-orphan`, `core/annotation-stale`). The rule's job has
  not changed: it still flags typos / unrecognised keys in sidecars and
  emits a warn issue plus the same `alert` + `chip` view contributions
  on `graph.node.alert` / `card.footer.right`.

- 880fe3e: Rename 14 built-in extension ids to a consistent `<domain>-<detail>` pattern. The naming was inconsistent: 10 ids already followed the "area first, attribute after" shape (e.g. `annotation-orphan`, `link-conflict`) while 14 were inverted, redundant, or vague. All built-ins now agree.

- 1b6e368: Honour per-extension toggles inside bundle-granularity plugins end-to-end. Closes the Phase 4b follow-up (commit `e45d2fd`) gap: BFF + Settings UI started accepting per-extension toggles for any granularity, but three call sites still treated bundle granularity as "one knob, every extension follows", so flipping an individual extension off (e.g. `claude/at-directive`) persisted to `config_plugins` and then did nothing on the next scan.

### Patch Changes

- 8a05b2b: Dev builds now SUPPRESS the version chip in two decorative surfaces and surface a lone `[dev]` marker instead.

- 5d3d757: Restore the animated viewport fit when a WS-scan refresh adds or removes nodes, fix two correctness gaps that surfaced once the tween was back. The graph view's auto-fit-on-topology-change effect had been snapping the camera in place since the zoom-clamp commit `d60e4a4`, losing the "camera glides to frame the new layout" beat the boot-time tween used to deliver. Putting the tween back exposed a long-latent reconcile bug where `nodePositions` (the user-pin map that drives rendering) kept the pre-relayout coordinates of every existing node when dagre rearranged the graph, so a new node would land on top of an existing one and the fit bbox was computed from coordinates that did not match what was rendered.

- 7f15817: The CLI logger's `defaultFormat` now paints each line with the project's standard glyph + color per level, matching the rest of the output surface (see `context/cli-output-style.md` §Glyph catalog). Previously every level emitted as a plain `HH:MM:SS | LEVEL | message` row, so warnings the user is supposed to read scanned the same as low-noise debug lines.

- 49b70fb: Three quality-of-life fixes to the `sm serve` SPA + a small CLI / BFF listing tweak that keeps the user-visible plugin order coherent across surfaces.

- be116dd: Two bugs surfaced by the `sm-tutorial` external-tester walkthrough.

- Updated dependencies [8ab68ed]

- Updated dependencies [880fe3e]

- Updated dependencies [1b6e368]
  - @skill-map/spec@0.36.0

## 0.38.0

### Minor Changes

- b5f6a57: Internal: rename the registry's base extension shape from `Extension` to `IExtension` so the kernel's type naming convention is uniformly applied. `Extension` was an unprefixed Category 4 internal interface (the registry's storage view, distinct from the Category 3 `IExtensionBase` author contract), the only one of its kind outside the closed grandfathered list (`RunScanOptions`, `RenameOp`, `Kernel`, `ProgressEvent`, `LogRecord`, `NodeStat`) documented in `context/kernel.md` §Type naming. Renaming to `IExtension` brings it in line with `IPluginRuntimeBundle`, `IPruneResult`, `IDbLocationOptions`, and the rest of the bucket.

### Patch Changes

- f69d519: cli-architect review pass on `src/`: mechanical hygiene fixes, no behavioural change.

- 556f526: End-to-end `nodes[]` filter on the issues query, threaded from SQLite storage through the BFF route into the UI data-source contract. Motivated by the linked-nodes panel's N+1 fan-out: the panel needs issues for a focused node PLUS its neighbours, and the prior single-path `node=<path>` filter forced one request per neighbour.

- 1c916d5: Security hardening pass on `src/` (audit findings H1, H2, M1, M2, L1).

## 0.37.0

### Minor Changes

- de68f09: Soft-warn drift detection for the active provider lens. When `activeProvider` is set (whether by auto-detect on first scan, the interactive prompt for ambiguous markers, or `sm config set activeProvider <id>`), the runtime now persists the set of provider markers that existed on disk at the moment of the choice as `activeProviderMarkers` in `.skill-map/settings.json`. On every subsequent scan the bootstrap re-detects markers and diffs against this snapshot; when the diff is non-empty (new markers appeared, recorded markers disappeared), it emits ONE soft warn before the scan and continues with the cached lens.

- c318b58: CLI output-style audit pass 2. Pass 1 (landed in `21920e8`) covered `init`, `scan`, `config`, `help`, `history`, `export`, and the bare-`sm` no-project entry. Pass 2 migrates the remaining error / warning surfaces across twelve catalogs to `context/cli-output-style.md` §3.1b, the two-line block: glyph + headline followed by a dim hint sourced from a sibling `<key>Hint` catalogue entry. Colour resolution stays at the CLI seam (`ansiFor`-resolved glyph + `ansi.dim`-wrapped hint threaded through the texts pipeline at the call site).

- 821a9ed: DB version-skew detection. When the local `.skill-map/` SQLite DB was written by a different `@skill-map/cli` version than the one currently running, the operator used to get either silent corruption (older CLI reading a newer DB) or a cryptic "Invalid LinkKind value ..." from the enum parsers downstream. This changeset adds an opt-in classification seam at the SQLite open path so the skew surfaces at open time with a recovery hint, before the kernel touches the rows.

- 75a91eb: Fix two kernel bugs surfaced in a manual link-matrix test session, both affecting how invocation/mention edges land in a real scan.

- a58989f: Lens-gated classification for vendor providers. Vendor Providers (`claude`, `openai`, `antigravity`) now opt into being gated by the active lens via a new `gatedByActiveLens: true` field on their manifest. The walker (`src/kernel/orchestrator/walk.ts`) pre-filters `opts.providers` before the walk loop: a gated Provider runs only when `provider.id === opts.activeProvider`, so vendor providers no longer attempt to classify files outside their lens. Universal providers (`core/markdown`, future `agent-skills` open standard) leave the flag absent / `false` and run unconditionally.

- a4ce684: `core/link-counts` analyzer no longer counts self-loop links toward the per-node footer chips (`linksIn` / `linksOut`). The chips disagreed with the `LinkedNodesPanel` sidecar which already filtered self-loops out of its outgoing / incoming lists.

- 21920e8: Drain pass after the link-matrix walkthrough surfaced rough edges across the CLI surface and the inspector. No new normative spec, only impl polish and tightened error semantics.

- d207cfa: Observable link analysis. The link-matrix walkthrough surfaced a recurring complaint, "the inspector tells me there is an edge but not where, why, or whether it overlaps with another", and a small cluster of detection bugs that were hiding real problems and inventing fake ones. This changeset is the drain pass.

- 5a12e5c: Phase 2.D of the Signal IR migration: new `core/signal-collision` built-in analyzer surfaces resolver rejections as operator-visible `warn` issues. The analyzer reads `IAnalyzerContext.signals`, finds every Signal whose `resolution.outcome === 'rejected'`, and emits one issue per rejection naming the loser extractor + matched text + byte range, the winner extractor + range, and the tiebreak reason (`kind-priority` / `higher-confidence` / `longer-range` / `earlier-declaration`). Phase 4+ stubs (`extractorDisabled`, `belowFloor`) are handled with their own message templates so the surface stays forward-compatible.

- 3ca095b: Wire the Signal IR resolver end-to-end (Phase 2.A of the active-lens migration). The kernel's `resolveSignals` runs after extraction and before analysis: filters disabled extractors (Phase 4+ stub), ranks intra-Signal candidates via `IProvider.resolverRules.kindPriority` (when declared) + confidence + extractor declaration order, builds overlap clusters from body-scoped Signals sharing a source, picks a cluster winner per the four-step tiebreak chain (`kind-priority` -> `higher-confidence` -> `longer-range` -> `earlier-declaration`), materialises winners as Links indistinguishable from `emitLink`-emitted ones, and annotates each Signal's new `resolution` field with the outcome + reason. Rejected (losing) Signals remain accessible to analyzers via `IAnalyzerContext.signals` so a future `core/signal-collision` analyzer can surface them as `warn` issues naming WHO won and WHY.

### Patch Changes

- e91681f: Internal: expand the `antigravity` Provider's `reservedNames.command` seed catalog from 6 entries to the full 38-verb Gemini CLI slash-command surface plus its 4 documented aliases (42 total). Google's transition blog (2026-05-19) states that the Antigravity CLI fully replaces Gemini CLI, preserves the four feature pillars (Agent Skills, Hooks, Subagents, Extensions), and shares the same agent harness as the Antigravity 2.0 desktop app, so the operator's built-in slash-command vocabulary almost certainly carries over 1:1. The catalog stays inactive (the analyzer keys on `node.provider` and the `antigravity` Provider still classifies nothing), no behavioural change today; the seed is in place for the day Antigravity grows its own kind. Provisional label inline; reconcile when antigravity.google/docs publishes the authoritative reference.

- 1362de9: Phase 2.B of the Signal IR migration: `claude/at-directive` extractor now routes through `ctx.emitSignal` instead of `ctx.emitLink`. Each `@<token>` match emits a single-candidate Signal carrying the byte range, scope (`body`), and a candidate with the same kind / target / confidence / trigger / rationale shape the extractor used to embed directly into a Link. The resolver phase materialises the winning candidate as a Link indistinguishable from the prior direct-emit shape, including `occurrences[]` round-tripping; full `pnpm validate` stays green with 1734 tests passing and zero behaviour change.

- 8d9e820: `sm init --force` now wipes the existing `.skill-map/skill-map.db` (and its WAL / SHM sidecars) before provisioning the fresh one, matching the greenfield posture per AGENTS.md: --force means "reset every project artefact", not just the config files. Re-opening a stale DB whose schema predates the current `001_initial.sql` produced `JSON.parse(undefined)` crashes inside `loadScanResult` (columns added post-DB-creation come back as `undefined` from Kysely, and the defensive wrap surfaced them as "Failed to read scan rows" errors on the very next auto-scan); the wipe sidesteps the problem at the right layer instead of bolting in-place ALTER TABLE migrations against the greenfield rule.

- b8c7c0d: Internal cleanup that rides with the post-active-lens documentation sweep.

- 0df19f0: Phase 2.C of the Signal IR migration: the remaining five link-emitter extractors (`claude/slash`, `core/markdown-link`, `core/annotations`, `core/mcp-tools`, `core/external-url-counter`) now route through `ctx.emitSignal` instead of `ctx.emitLink`. Each one emits single-candidate Signals with the same kind / target / confidence / trigger shape the prior emission produced; the resolver materialises them as Links indistinguishable from direct-emit shape so 1734 tests and full `pnpm validate` stay green with zero behavioural change.

- 526cebd: Internal: regression tests for the BFF `/api/links?to=` resolved-target lookup and the `core/reserved-name` source-side issue through `runScan`.

- ba07e2f: Internal: bump `tsx` from 4.21.0 to 4.22.3. The 4.21.1 release added official support for Node 26.1.0 (switched the loader from the now-deprecated `module.register()` to `module.registerHooks()`), so dev-mode invocations under Node 26 no longer print the `DEP0205` deprecation banner at startup. Node 24 floor (`engines.node >= 24.0`) is unaffected: tsx 4.22.3 retains the legacy path on older Node versions. Touches `src/package.json` and the workspace lockfile only; no runtime behavioural change for the built CLI distribution.

- Updated dependencies [de68f09]

- Updated dependencies [1362de9]

- Updated dependencies [a58989f]

- Updated dependencies [d207cfa]

- Updated dependencies [5a12e5c]

- Updated dependencies [3ca095b]
  - @skill-map/spec@0.35.0

## 0.36.0

### Minor Changes

- 2593664: Retire the `gemini` Provider and onboard the `antigravity` Provider. Google released the Antigravity CLI on 2026-05-19 as the replacement for the Gemini CLI (which sunsets 2026-06-18 for consumer tiers). Antigravity preserved the four pillars of Gemini CLI (Agent Skills, Hooks, Subagents, Extensions/plugins) but adopted the open-standard `.agents/` layout instead of carrying forward a vendor-specific `.gemini/` directory, so the old Provider classified obsolete paths.

- ee919da: Reserved-name catalog per Provider. Each Provider runtime owns a set of invocation names its built-ins consume (Claude reserves `/help`, `/clear`, `/init`, `/agents`, `/model`, … under `command`, and `general-purpose`, `output-style-setup`, `statusline-setup` under `agent`). User files declaring one of these names are silently shadowed at runtime, the kernel now surfaces the collision.

### Patch Changes

- Updated dependencies [2593664]

- Updated dependencies [ee919da]
  - @skill-map/spec@0.34.0

## 0.35.0

### Minor Changes

- da26519: Provider-aware confidence bump for resolved invocation links. Three changes ship together.

### Patch Changes

- Updated dependencies [da26519]
  - @skill-map/spec@0.33.0

## 0.34.1

### Patch Changes

- 4af662b: Loosen the active-provider lens gate to lens-only: per-provider extractors run on every visited node when the active lens is in the extractor's declared `precondition.provider` allowlist, regardless of which provider classified the node.

- Updated dependencies [4af662b]
  - @skill-map/spec@0.32.1

## 0.34.0

### Minor Changes

- a5d6f12: `sm plugins enable` and `sm plugins disable` now accept multiple plugin ids in one invocation, e.g. `sm plugins disable gemini openai agent-skills`. The single-id form and `--all` keep working unchanged.

### Patch Changes

- 270fc6f: Implement the spec'd active-provider auto-detect at scan entry (`spec/cli-contract.md` §Auto-detect on first scan), closing the gap where `activeProvider` only flowed when the operator typed `sm config set activeProvider <id>` manually.

- a1e5fdc: Two P3 polish bugs from the providers-test-plan re-pass.

- 3ee3d19: Unify path normalisation between `claude/at-directive` and `core/markdown-link`, and upgrade `dedupeLinks` to merge cross-extractor duplicates with the maximum confidence.

- 0fa452d: Three fixes to provider classification and Claude extractor heuristics, surfaced by the new provider end-to-end test plan.

- 8bec353: Wire the active-provider lens gate through the orchestrator so per-provider extractors run only when both the node's provider AND the active lens are in the extractor's declared `precondition.provider` allowlist.

- 0da1ab2: Post-resolution confidence bump for `mentions` links (closes `bd-owi`).

- dba02a2: Unify the orchestrator's post-walk link transforms under a single internal seam, and pay down two complexity-rule hot-spots flagged by lint.

- Updated dependencies [a5d6f12]
  - @skill-map/spec@0.32.0

## 0.33.0

### Minor Changes

- 29fb253: Active-provider lens model, Signal IR scaffold, numeric `Confidence`, MCP virtual nodes, OpenAI Codex provider, and the Phase 4b extractor mudanza in one coherent migration.

### Patch Changes

- Updated dependencies [29fb253]
  - @skill-map/spec@0.31.0

## 0.32.0

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

- 6964be3: Add a UI surface for editing the project's `.skillmapignore` file from
  Settings → Project. The new section sits below "Folders for link
  validation" and uses the same add / remove list pattern, so the
  operator can manage gitignore-style scan filters without opening the
  file by hand.

- dcd6b78: Tighten the Settings → Project surface (paths) end-to-end: client + BFF
  validation, audit logging on the server console, banner visibility for
  the configured roots, watcher hot-reload when `scan.extraFolders`
  changes, and a scoped red signal for error banners inside the Settings
  modal.

- d95e5b8: Remove the `scan.extraFolders` config key. Project-local persistent
  extension of the indexed scan no longer exists; to walk a directory
  outside the project root pass it as a positional argument to
  `sm scan [roots...]` (per-invocation, not persisted). The narrower
  `scan.referencePaths` key (validate links against on-disk files
  without indexing them) is unaffected.

### Patch Changes

- Updated dependencies [5f4b181]

- Updated dependencies [d95e5b8]
  - @skill-map/spec@0.30.0

## 0.31.0

### Minor Changes

- 5783372: `sm tutorial` now materializes a full Claude Code skill folder under
  `<cwd>/.claude/skills/<slug>/` instead of a single `.md` file at the
  cwd top level. This unblocks `sm tutorial master`: the canonical
  `sm-master` skill ships a `references/` sub-folder (tour bodies +
  fixture templates) that the SKILL.md reads at runtime, and the
  previous single-file payload left those references missing when a
  tester ran the verb.

## 0.30.0

### Minor Changes

- 9a27192: Broken-ref findings now carry a hint when a same-named file exists on
  disk but does not advertise `name:` in its frontmatter. Common case:
  the author writes `@c` (or `/c`) expecting it to resolve to
  `.claude/agents/c.md`, but the agent's frontmatter is missing the
  `name: c` line, so trigger resolution falls through.

- 993df04: Align `core/slash` and `core/at-directive` with how LLM hosts (Claude
  Code, Gemini CLI, Cursor) read author-intent tokens in prose. An
  external tester surfaced false-positive broken-ref issues on inputs
  like `re-invoke @sm-tutorial.md from /Volumes/foo/...`; cross-runtime
  research confirmed a consistent pattern across providers and reference
  runtimes (Codex, Cursor, Aider).

### Patch Changes

- Updated dependencies [4e0646c]
  - @skill-map/spec@0.29.0

## 0.29.0

### Minor Changes

- 834fede: Replace the graph view's hand-tuned d3-force layout with an
  algorithm dispatcher and surface the knobs through three new
  popovers in the bottom toolbar (next to the zoom controls). Two
  engines feed the dispatcher: Foblex's `@foblex/flow-dagre-layout`
  plugin (versions pinned to 18.5.0, matches the installed
  `@foblex/flow`) for the layered `Balanced` and `Stretched` modes,
  and the existing d3-force simulation kept around as the `Organic`
  mode for users who want a physics-based arrangement without a
  fixed flow direction.

- e21216e: Simplify plugin manifest fields beyond the file-layout refactor. The
  previous `structure-as-truth-plugins` changeset moved bundle / kind /
  id discovery onto the filesystem; this one extends the same principle
  into the manifest schemas themselves so the only fields that survive
  are the ones the kernel cannot derive from disk.

- 8b7abbf: Structure-as-truth refactor for plugin extensions. The filesystem
  layout (rather than declarative manifest fields) is now the single
  source of truth for bundle / kind / extension id.

- 8e457dd: Adopt the convention that every test file lives in a `__tests__/`
  folder next to its SUT and uses the `.spec.ts` suffix. The legacy
  central `src/test/` and `testkit/test/` directories are gone:
  the 145 specs under `src/` were moved to colocated `__tests__/`
  folders, end-to-end cross-module flows landed under
  `src/__tests__/integration/`, and the 5 testkit specs moved to
  `testkit/src/__tests__/`. Same convention `makius-base/api` and
  the `cli-ruler` agent enforce, now wired into this repo.

### Patch Changes

- fcc2341: Ship `.skillmapignore` at POSIX mode `0o644` so anyone with checkout
  access can read it on multi-user hosts and shared-mount workflows
  without a chmod dance. The file is meant to be committed alongside
  `.gitignore`, the project-private default of `0o600` (kept for
  `settings.json` and sidecars that may carry private paths) was
  misapplied here. Implementation: `writeFileAtomicExclusive` gains a
  third `mode: number` parameter with the previous `0o600` as default;
  the init command passes `0o644` for `.skillmapignore` only. On
  Windows the parameter is a no-op (Node maps POSIX modes to the
  readonly attribute only).

- Updated dependencies [e21216e]

- Updated dependencies [8b7abbf]
  - @skill-map/spec@0.28.0

## 0.28.0

### Minor Changes

- 88b2491: Add a Matrix theme as an opt-in extra theme alongside the existing
  dark / light / auto tri-state. `ThemeService` grows an orthogonal
  `extraTheme: 'matrix' | null` signal that overrides the dark/light
  mode when set, persists at `localStorage:skill-map.ui.extra-theme`,
  and is selectable from Settings → General → Theme. Clicking the
  topbar dark/light toggle clears the extra theme AND advances the
  mode one step in the same gesture, so users always have a one-click
  exit path.

### Patch Changes

- 76304be: Group and sort the extension list rendered by `sm plugins show <bundle>`
  by the canonical pipeline order (provider, extractor, analyzer, action,
  formatter, hook), then alphabetically by short id within each kind.
  Previously the list followed the declaration order of `built-ins.ts`,
  which mixed analyzers after formatters and gave readers no quick way to
  scan a bundle by kind. Mirrors the kind order published on the marketing
  site so the CLI and the web tell the same story. Affects human output of
  the bare-bundle form (`sm plugins show core`, `sm plugins show <user-plugin>`);
  `--json` keeps emitting the source manifest order so existing JSON
  consumers see no shape change, and the single-extension detail form
  (`sm plugins show core/superseded`) is untouched.

- e8be298: Swap the leading glyph in the `Update available` banner header from
  `⬆` (HEAVY UPWARDS BLACK ARROW, U+2B06) to `⬇` (HEAVY DOWNWARDS BLACK
  ARROW, U+2B07). The down arrow reads as "a newer version is coming
  DOWN to your machine" (incoming download), which is the same semantics
  the banner is already conveying with the `<current> → <latest>` line
  just below; the previous up arrow's "upgrade outward" reading was
  inconsistent with that downward flow. Single-character edit in
  `src/cli/util/update-check-banner.ts:189`; both characters are East
  Asian fullwidth and occupy the same number of terminal cells, so
  `BANNER_WIDTH` math and the border `─` fill remain correct without
  adjustment.

## 0.27.0

### Minor Changes

- f1efd1b: Remove the `-g/--global` flag and every implicit `$HOME` read from
  skill-map. The CLI now operates exclusively on the project scope
  (`<cwd>/.skill-map/`); there is no global / user scope, no
  `SKILL_MAP_SCOPE` env var, no silent merge of user-level config or
  plugins.

### Patch Changes

- fd909bd: Fix `sm plugins show <bundle>/<ext>` rendering the full parent
  bundle's detail instead of the requested extension. The CLI now
  branches on whether the resolver returned a qualified id and emits
  a focused single-extension block (header + Kind / Version /
  Stability / Description / Preconditions / Entry) in human mode,
  with `--json` returning just the extension object instead of the
  whole bundle envelope. Bare bundle ids (`sm plugins show core`)
  keep the original bundle-listing output. Two new renderers
  (`renderBuiltInExtensionDetail`, `renderUserExtensionDetail`) plus
  a shared `renderExtensionFields` block live in
  `src/cli/commands/plugins/show.ts`; the user-plugin path reads
  optional metadata off `ILoadedExtension.instance` via a new
  `readInstanceMeta` helper. `IBuiltInBundleRow.extensions[]` in
  `src/cli/commands/plugins/shared.ts` now carries optional
  `description` / `stability` / `preconditions` / `entry`, populated
  through a new `extensionRowFromBuiltIn` builder that respects
  `exactOptionalPropertyTypes`. Six new tests in
  `src/test/plugins-cli.test.ts` replace the previous "renders
  parent bundle" assertion (which was locking in the bug) and cover
  single-ext built-in + user paths, JSON shape, disabled-glyph
  reflection, optional-field surfacing, and a bare-id regression.
  Bundled together: `src/test/git-helpers.test.ts` now `t.skip()`s
  the two "no `.git/` parent" cases with a directed message when
  the host's tmpdir lineage contains a stray `.git/` ancestor (e.g.
  `/tmp/.git/`); the branch was unreachable on polluted
  environments and the skip keeps the suite green without masking
  real coverage (the rest of the file still exercises
  `isInsideGitRepo` end-to-end via the project root's real
  `.git/`). No spec change: `cli-contract.md` already says "Full
  manifest + compat detail" for `sm plugins show <id>`, and the new
  behaviour is strictly closer to that wording than the old
  dump-the-whole-parent-bundle behaviour.

- Updated dependencies [f1efd1b]
  - @skill-map/spec@0.27.0

## 0.26.1

### Patch Changes

- 4d2a540: Rework the `sm tutorial` demo fixture (`sm-tutorial` skill) so the
  Live UI block teaches the three link kinds (`mentions`, `invokes`,
  `references`) from the syntax the tester writes. Step 3 now creates
  four files instead of three, the extra node is a second
  `markdown` (`notes/demo-guideline.md`) that gives the hub a real
  `references` target. Step 5 collapses three separate file edits
  into a single edit on `notes/todo.md`, which becomes the only
  source of connectors in the demo: four bullets, one per target,
  covering `@demo-agent` (`mentions`), `/demo-command` (`invokes`),
  `/demo-skill` (`invokes`), and `[demo-guideline](./demo-guideline.md)`
  (`references`). The downstream count references, the
  `.skillmapignore` tree shown in Step 6, the deep-dive edit target
  in Step 8, the `sm list` expected output in Step 9, the Provider
  detection global substitution rule, and the start-over wipe list
  all updated to match.

## 0.26.0

### Minor Changes

- 48800d4: Drop `requires`, `related`, and `conflictsWith` from the curated annotation catalog.

### Patch Changes

- 7e3acb9: Extract the `.sm` sidecar consent gate strings shared by `sm bump`,
  `sm sidecar refresh`, and `sm sidecar annotate` into a single
  `src/cli/i18n/consent.texts.ts` module (`CONSENT_TEXTS`). The directed
  error prefixes are now driven by a `{{verb}}` placeholder filled by
  each caller (`'sm bump'` or `'sm sidecar'`), so the user-visible output
  is unchanged and the catalogs (`bump.texts.ts`, `sidecar.texts.ts`)
  stop carrying duplicated copies of the same paragraph. Internal DRY
  cleanup, no behaviour or surface change.

- 21875e5: Fix double-counted incoming/outgoing link totals when a relation is
  declared from BOTH sides of a `.sm` annotation pair (e.g. `supersedes: [B]`
  on `A.sm` AND `supersededBy: A` on `B.sm`). The `core/annotations`
  extractor walks each node in isolation, so each side independently emits
  the same `(A → B, supersedes)` edge; without a global dedup the orchestrator
  returns two copies, `recomputeLinkCounts` and the `core/link-counts`
  chip then surface inflated `linksInCount` / `linksOutCount` values, and
  the watcher's per-rescan `delta.ts#diffLinks` `Set`s occasionally
  collapse the duplicate by accident on save, which is what made the bug
  appear as "wrong number on cold start, correct after editing anything".

- 49243b9: Three related fixes around graph link semantics and node health surfacing.

- Updated dependencies [48800d4]
  - @skill-map/spec@0.26.0

## 0.25.0

### Minor Changes

- a53532b: Replace BYTES with TOKENS in the human-mode output of `sm list` and `sm show`. Tokens are the metric users actually care about for LLM budgeting; bytes were a leftover from the early file-size mental model.

- 2129b40: Add an optional positional `variant` argument to `sm tutorial`. Default (no argument) keeps the previous behaviour and materializes `<cwd>/sm-tutorial.md` (the basic walkthrough). Passing `master` materializes `<cwd>/sm-master.md` (the advanced walkthrough: plugin tour, plugin authoring, settings + view-slots) through the same channel. The value is validated against the closed set `{ tutorial, master }`; anything else exits with code 2 and an `invalidVariant` error pointing at the valid values. The build pipeline (`tsup.config.ts → onSuccess`) now copies both SKILL.md sources into `dist/cli/tutorial/`, and the runtime resolver caches each variant independently. CLI i18n strings under `tutorial.texts.ts` were parameterized with a `{{filename}}` placeholder so the success block points the tester at whichever file was materialised. Spec § `sm tutorial` was rewritten to document the new positional and exit-code rule.

### Patch Changes

- Updated dependencies [a53532b]

- Updated dependencies [2129b40]
  - @skill-map/spec@0.25.0

## 0.24.5

### Patch Changes

- 2e1c0f4: Third pass of the release-pipeline shakedown. The second pass (`verify-pipeline-second-pass`) confirmed the Railway demo deploy is now green end-to-end, but the post-publish smoke step still failed: `npm i -g @skill-map/cli@0.24.4` returned `ETARGET` for the full 5-retry window even though the registry already had the version (`curl https://registry.npmjs.org/@skill-map/cli/0.24.4` returned 200 during the failure). Root cause is the npm CLI's local metadata cache, the first 404 gets cached and every retry replays it. This bump exists to verify the fix: the smoke step now passes `--prefer-online` (forces a fresh staleness check on every attempt), runs the install from a clean `mktemp -d` cwd (so the repo's pnpm-flavored `.npmrc` does not bleed into npm's config resolution), and retries up to 10 times with 30 second back-off. No code or contract change in any of the four packages.

- Updated dependencies [2e1c0f4]
  - @skill-map/spec@0.24.3

## 0.24.4

### Patch Changes

- 5eb79ba: Second pass of the release-pipeline shakedown after the pnpm migration. The first pass (`verify-release-pipeline`) surfaced two issues that this bump exists to verify the fixes for: (a) the Railway demo deploy crashed in `web/scripts/build-demo-dataset.js` because `node --import tsx` could not resolve `tsx` from the demo fixture's cwd (pnpm's strict hoist keeps it in `src/node_modules/`), and (b) the post-publish smoke step hit `ETARGET` on `@skill-map/cli@latest` because the npm CDN had not yet propagated tarball metadata at every edge when the install ran. Both are now fixed: `build-demo-dataset.js` imports the tsx loader by absolute `file://` URL, and the smoke step now reads the explicit version from `changesets.outputs.publishedPackages` and retries up to 5 times with 30 second back-off. No code or contract change in any of the four packages.

- Updated dependencies [5eb79ba]
  - @skill-map/spec@0.24.2

## 0.24.3

### Patch Changes

- fb52d17: Migrate the monorepo's package manager from npm to pnpm 11.

- 56fef3b: Verify the release pipeline end-to-end after the pnpm 11 migration: `release.yml` boots through `pnpm install --frozen-lockfile`, `release:version` bumps versions and refreshes the lockfile in one shot, `release:publish` propagates the four versioned packages to npm, and `deploy-web.yml` rolls out the new public site on the post-migration `pnpm/action-setup` chain. No functional or contract change in any of the four packages, this exists purely so the next "chore: version packages" PR exercises every moving part of the new pipeline at least once.

- Updated dependencies [fb52d17]

- Updated dependencies [56fef3b]
  - @skill-map/spec@0.24.1

## 0.24.2

### Patch Changes

- dc92b12: Add a per-browser graph edge style preference to Settings → General. The new selector picks between the four Foblex connection shapes (orthogonal / straight / bezier / adaptive curve) and persists in `localStorage`, so it does not sync across machines.

- 88cb607: Polish the graph view's default edge look to match Foblex's `schema-designer` example.

- 4e57f22: Enable user-driven edge selection in the graph view. Removed `[fSelectionDisabled]="true"` from `<f-connection>` so Foblex's built-in click-to-select kicks in. When an edge is selected, the line grows from its per-kind base (1-1.5px) to 2.5px and the kind's muted base colour is promoted to its full-saturation `*-active` counterpart (e.g. `invokes` goes from desaturated `#b8843a` to vivid `#f59e0b`), marker dot and arrowhead follow the path so the picked edge pops without changing hue family.

- 38a24a0: Swap the card-footer `linksIn` / `linksOut` icons from `pi-arrow-up` / `pi-arrow-down` to `pi-download` / `pi-upload`. The tray-with-vertical-arrow glyphs read as "things landing on / leaving this node" while keeping the pure arrow shape exclusive to the graph's own edges.

## 0.24.1

### Patch Changes

- dc92b12: Add a per-browser graph edge style preference to Settings → General. The new selector picks between the four Foblex connection shapes (orthogonal / straight / bezier / adaptive curve) and persists in `localStorage`, so it does not sync across machines.

## 0.24.0

### Minor Changes

- dd25272: Apply 13 of 15 findings from the `cli-architect` review of `src/` (audit run 2026-05-13). Behaviour and architecture only; lint and security audits were out of scope.

### Patch Changes

- 2b09ce8: Apply findings from the `app-hacker` security audit of `ui/` (audit run 2026-05-13). Defence-in-depth and hardening only; no user-observable behaviour changes.

- 8e06f8a: Apply 3 findings from the `cli-hacker` security audit of `src/` (audit run 2026-05-13). Defence-in-depth and hardening only; no user-observable behaviour changes.

- Updated dependencies [2b09ce8]
  - @skill-map/spec@0.24.0

## 0.23.1

### Patch Changes

- 45e275c: M1 PrimeNG `::ng-deep` audit (verified against `primeng@21.1.6`). Two phases of work plus documentation, all internal to `ui/` (the workspace ships bundled inside `@skill-map/cli`).

## 0.23.0

### Minor Changes

- c1ed77a: Add `IAnalyzer.recommendedActions` so an Analyzer can declare which per-node Actions resolve its findings.

### Patch Changes

- a34858a: Audit fix L6 on the BFF: `/api/issues` now paginates (`offset`, `limit`, default 100, max 1000, mirroring `/api/nodes`) and pushes its three filters (`severity`, `analyzerId`, `node`) into the storage layer instead of loading every persisted issue into memory and filtering in JS.

- 608e6ae: BFF compliance audit follow-ups (`bff-ruler` on `src/server/`).

- 639a95b: Finish the em-dash sweep across `src/` and lock it down with an ESLint rule.

- 639644d: Strip em dashes (`—`) from CLI / kernel / built-in user-facing strings. Stylistic sweep matching the project rule against em dashes in written text; each replacement is a comma, colon, semicolon, or parenthetical pair chosen to read naturally in context.

- 8c3bc0d: Follow-up sweep on the cli-ruler audit. Four pieces.

- c2152cc: Add `--json` output to four verbs that previously emitted only human-formatted text: `sm refresh` (and `sm refresh --stale`), `sm plugins doctor`, `sm conformance run`, plus `--format json` on `sm graph` (`sm graph` uses the formatter catalog rather than the global `--json` flag). Closes the spec drift where the global `--json` flag was advertised but ignored on these verbs, and unblocks CI / scripting consumers that parse the output.

- 665a21a: Security hardening, two BFF fixes from a follow-up audit. No user-visible behavior changes; defence-in-depth on the loopback HTTP surface.

- 15bf673: Security hardening, three follow-up audit fixes. No user-visible behavior changes; defence-in-depth on internals.

- 36b1865: Security hardening, three fixes from a follow-up audit. No user-visible behavior changes; defence-in-depth on internals.

- ff3121f: Security hardening, safer Windows browser launcher in `sm serve`. No user-visible behavior changes; defence-in-depth on internals.

- 5f4de1c: Security audit sweep (cli-hacker follow-up). Three highs, three mediums, three lows, plus the shared prototype-pollution helper and a plugin-author doc note.

- b17bf41: Tutorial F3 — close consent-gate leak across user-level config layers. `allowEditSmFiles`, `scan.extraFolders`, and `scan.referencePaths` are spec'd as project-local-only, but the loader's strip used to fire only on the committed `project` layer; values in `user` / `user-local` / `override` survived and silently granted consent (or applied paths) in every project. Now stripped from every non-project-local layer, with a directed warning naming the offending layer + key.

- Updated dependencies [c1ed77a]

- Updated dependencies [608e6ae]

- Updated dependencies [c2152cc]

- Updated dependencies [5f4de1c]

- Updated dependencies [639a95b]
  - @skill-map/spec@0.23.0

## 0.22.0

### Minor Changes

- 39a61e9: Remove the implicit "scan HOME" surface and consolidate every out-of-project scan path under a single, explicit `scan.extraFolders` setting. Privacy-by-default: the CLI / BFF / UI never read the user's home automatically anymore; every path outside the project root must be listed by the operator.

### Patch Changes

- 1e48d2e: Follow-up sweep on the cli-architect spec-drift audit. Three pieces.

- b6aa85e: Apply four P1 findings from the cli-architect audit on `src/` — three are pure internal refactors (no observable behaviour change), one tightens BFF input validation.

- a91b1dd: Architect-audit follow-up: split `cli/commands/bump.ts` into a pure plan-computation half and a side-effect adapter half.

- 129483e: Split `cli/commands/db.ts` (943 LOC, 7 subverbs in one file) into one file per subverb under `cli/commands/db/`, plus a `shared.ts` for cross-subverb helpers. Same shape as the earlier `cli/commands/plugins/` split.

- c5959d2: Architect-audit follow-up: split `kernel/orchestrator.ts` (2972 LOC, 5 `eslint-disable complexity`) into one file per pipeline stage under `kernel/orchestrator/`. Two-phase change in a single commit.

- 5f19e71: Split two coupled kernel-side files into per-concern directories. Same shape as the earlier `kernel/orchestrator/` split.

- 4d8d527: Architect-audit follow-up: split `cli/commands/plugins.ts` (1700 LOC, 7 `eslint-disable complexity`, 7 subcommands) into per-verb modules under `cli/commands/plugins/`.

- 598135c: Architect-audit follow-up: full complexity-disable sweep across `src/kernel/adapters/sqlite/`. **18 `eslint-disable complexity` → 0** across 7 files. Pure structural refactor — every function preserves its prior signature and behaviour; tests pass unchanged.

- 093e2e9: Refactor `npm run validate` orchestration: every compilation-stage check across every workspace runs FIRST, then every test suite runs LAST. Fast-fail on typecheck / lint / build / spec-check / reference-check without paying the test-suite wait.

- Updated dependencies [1e48d2e]

- Updated dependencies [39a61e9]
  - @skill-map/spec@0.22.0

## 0.21.0

### Minor Changes

- 08c33b8: Fold `core/sidecar-drift` into `core/annotation-stale` and fix a per-tuple sweep bug that left stale view-contribution rows orphaned for nodes whose path contained slashes.

- c43e499: Surface `core/broken-ref` and `core/unknown-field` issues on the graph card, reshape `core/annotation-stale` to a single icon-only chip, and clean up the renderer chrome across `node-icon` / `node-counter` / `node-alert`.

- f72dbfc: Card body + topbar polish, plus catalog rename of the topbar scope slot.

- 04f858d: Consolidate the card-footer link counters into a single `core/link-counts` pair and run a top-to-bottom icon-review pass across the topbar, the graph card, and the alert / chip surfaces of `broken-ref` + `unknown-field` + `stability`. Greenfield: no `catalogCompat` bump, no migration shim — the manifest catalog of built-in view contributions changes shape (three extractor chips drop, two analyzer chips appear, two analyzer payloads change) and no released external plugin keys off these IDs.

- 2c9aaad: Lock `core/annotations` so it can no longer be disabled.

- fe13254: Tighten the manifest `icon` grammar on `viewContributions[].icon` from "single emoji-or-PrimeIcons-bare-name" to a prefix-discriminated string with four explicit shapes. Greenfield migration: no compat shim, no `catalogCompat` bump, bare names now fail at manifest load.

- 4f89a84: Plugin toggles in the Settings modal now apply at the next scan instead of needing an `sm serve` restart. The "Restart required" banner is gone for the common case; only plugins that were disabled at server boot keep a per-row warning because their handlers were never loaded into memory.

- b840302: Rename the view slot `card.footer.left.counter` to `card.footer.left`.

- 62ab63d: Promote sidecar-awareness into the kernel's per-(node, extractor) cache key so `.sm` edits propagate to the UI on every code path (watch, scan, CLI, BFF cold start) without busting unrelated cached extractors.

- 13f8484: Fix two bugs around sidecar-driven UI updates and adopt Font Awesome Free in the bundled UI as a webfont addition (no spec changes, no plugin-author surface yet).

- a96c257: Add a per-project consent gate for `.sm` sidecar writes, generalise the "privacy-sensitive, must not be committed" idea to a closed set of project-local-only keys, and cache config on the daemon so repeated reads in `sm serve` no longer re-walk six file layers.

- b676fdb: Migrate the experimental / deprecated stability indicators on graph cards from hardcoded template markup into a new built-in extractor `core/stability` that emits chips to the `card.footer.right` slot. Remove the dead-code injection icon that shared the same wrapper.

### Patch Changes

- 5ed14cb: Disabling a plugin now wipes its `scan_contributions` rows immediately, instead of waiting for the next `sm scan` to sweep them. Without the eager purge, the catalog sweep documented in `db-schema.md` § scan_contributions only ran on the next scan, so the UI kept rendering the plugin's footer / card chips even though the toggle showed `enabled: false`.

- b840302: Unify footer-chip icons across the three outgoing-reference extractors and remove three legacy hardcoded chips from the card now that the per-extension view contributions cover them.

- 1212f18: Rewrite the `description` field on every built-in plugin (extractors, analyzers, actions, formatters, hooks) in user-facing language. Removes internal jargon — slot ids, frontmatter key names, kernel-side concepts — in favour of explanations that match what the operator actually sees in Settings → Plugins and on the cards / graph.

- 3b17043: Fix two `sm plugins` inconsistencies and align the tester tutorial with the verbs that actually exist at v0.20.0.

- 0f621e9: `update available` banner now fires on the first invocation after a fresh install or a `npm i -g` upgrade. Previously the banner required two runs to surface: the first run loaded the empty / not-yet-populated cache row, skipped the banner, fetched the latest from npm, and persisted the cache; only the second run actually printed the message. Operators who installed and ran `sm` once a day effectively never saw the notification because the cache freshness window (24h) and the run cadence collided.

- Updated dependencies [f72dbfc]

- Updated dependencies [5ed14cb]

- Updated dependencies [fe13254]

- Updated dependencies [4f89a84]

- Updated dependencies [b840302]

- Updated dependencies [a96c257]
  - @skill-map/spec@0.21.0

## 0.20.1

### Patch Changes

- fd6926f: Surface the project path under the brand mark in the topbar.

## 0.20.0

### Minor Changes

- 5600a60: Move `updateCheck.enabled` to user scope and add a reusable typed config helper. Settings UI's General section now exposes the toggle.

- a1bfe15: Eliminate the view-contribution `contract` abstraction — plugin authors now pick `slot` directly.

- 5600a60: Hook trigger set grows from 8 to 10: add CLI-process-driven `boot` and `shutdown`. First built-in concrete consumer: `core/update-check` (the once-per-day update banner moves from an inline call site to a hook subscribing to `boot`).

- 802e64f: Rename the `rule` plugin extension kind to `analyzer`.

- 5600a60: Add `sm scan -g` (global scan) plus three privacy-sensitive project scan settings: `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Settings UI exposes them in a new "Project" section.

- 825dce4: View-contribution slot expansion + new `node-icon` contract + host-enforced plugin lock.

### Patch Changes

- 5600a60: Add the `core/job-orphan-file` built-in rule. Surfaces orphan MD files under `.skill-map/jobs/` (no matching `state_jobs.filePath` row) as `warn` issues during `sm scan`. Mirrors the `core/annotation-orphan` model: detection runs OUTSIDE the rule and the rule only projects.

- 5600a60: Move file parsers under `src/built-in-plugins/parsers/` for layout consistency with the other built-ins.

- Updated dependencies [5600a60]

- Updated dependencies [a1bfe15]

- Updated dependencies [5600a60]

- Updated dependencies [802e64f]

- Updated dependencies [5600a60]

- Updated dependencies [825dce4]
  - @skill-map/spec@0.20.0

## 0.19.0

### Minor Changes

- 3376a75: spec 0.18.0 — universal markdown fallback as a built-in Provider. The format-named generic kind `markdown` moves out of the per-vendor Provider catalogs (claude / gemini) into a dedicated built-in `core/markdown` Provider. Markdown is provider-agnostic — no vendor owns the universal `.md` format — and bundling the fallback as a regular Provider under the `core` group preserves the spec invariant that no extension is privileged. The kernel orchestrator now dedups files across the multi-Provider walk so each path is offered to AT MOST one `classify`: vendor Providers retain priority on files inside their territory, and `core/markdown` (registered LAST) picks up exactly the orphan `.md` files no vendor claimed — files at the project root, under `.claude/hooks/`, `notes/`, `CLAUDE.md`, `GEMINI.md`, or anywhere else outside a known vendor path. The fallback can be disabled via `sm plugins disable core/markdown` (consistent with every other extension under `core`); orphan markdown then becomes silently invisible, matching pre-0.18.0 behaviour.

- f0ddae0: Move the cross-vendor Extractors out of the `claude` plugin bundle and into `core`, and rename `frontmatter` → `annotations` to reflect the post-Step 9.6 reality that the canonical home for those structured references is the sidecar `.sm` `annotations:` block (Decision #125), not the markdown frontmatter.

- d7ddd08: Drop the `parsed` view contribution from `core/annotations`.

- 454311c: Drop the transitional legacy `metadata:` frontmatter fallback from `core/annotations`. The extractor now reads structured references (`supersedes`, `supersededBy`, `requires`, `related`, `conflictsWith`) **only** from the sidecar `.sm` `annotations:` block (Decision #125 / Step 9.6 canonical surface). The `core/superseded` rule follows the same path and now reads from the sidecar.

- b3ba3de: Drop the four denormalised fields (`title`, `description`, `stability`, `version`) from the public `Node` surface. The DB columns survive as indexing surface; the JSON wire shape and TypeScript `Node` interface no longer carry them.

- 22f4439: Reduce the Extractor extension kind to **deterministic-only**. The `mode` field is removed from `extractor.schema.json`; `IExtractor` no longer carries `mode`; `IExtractorContext` no longer exposes `ctx.runner`. `Extractor` joins `Provider` and `Formatter` as an extension that sits on the deterministic scan path; LLM-driven enrichment of a node is now strictly an **Action** concern, queued through the job subsystem.

- e636074: Fold every post-001 SQLite kernel migration into `001_initial.sql`: the original four (`002_sidecar_columns.sql`, `003_drop_node_author.sql`, `004_sidecar_root_json.sql`, `005_node_favorites.sql`) plus the later `002_view_contributions.sql` introduced after the first fold by the view contribution system. Pre-1.0 greenfield consolidation — no released consumer depends on the historical migration steps, so collapsing the schema evolution into a single up-only migration removes the per-step bookkeeping cost and gives new databases the final shape on first init. The runner now sees `user_version: 1` as the latest. Schema content unchanged from the pre-fold endpoint (sidecar denormalisation via `sidecar_present` / `sidecar_status` / `annotations_json`, `author` column dropped from `scan_nodes`, `sidecar_root_json` column, `state_node_favorites` table, `version INTEGER` per Decision #125, plus `scan_contributions` table from the view contribution system).

- 40d0a81: Two small wire enrichments that the new Settings modal needs.

- 40d0a81: Add `POST /api/scan` so the SPA's topbar refresh button can trigger a manual scan + persist without dropping the user back to the CLI. The same `runScanWithRenames` + `persistScanResult` pipeline the watcher uses runs end-to-end inside the BFF, broadcasting `scan.started` then `scan.completed` over `/ws` so every connected client refreshes — `CollectionLoaderService`'s reactive subscription already handles the SPA side.

- 496fb72: Complete the `IAnalyzerContext.emitContribution` runtime channel and add `core/link-counts` built-in rule.

- 2b44d6c: Settings → Changelog tab + user-facing changelog pipeline.

- 40d0a81: Add a global Settings modal in the SPA with a Plugins section — the first user-facing surface for toggling installed plugins from the UI. Backed by two new BFF mutation endpoints and an enriched `GET /api/plugins` shape.

- 68709b9: Sidecar schema cleanup: rename root block `for:` → `identity:` and drop the unused `hidden` field from the curated annotations catalog.

- 8577563: Tags · click-to-multi-select via Foblex Flow's native selection.

- 762aad3: Tags · Phases 2-7 (full implementation): persistence, BFF wire shape, CLI, UI.

- f3e6347: Tags · zoom-to-matching on click + active chip indicator + side-panel-aware fit.

- 89c1c17: Add an "update available" notification surface (CLI banner + UI chip).

- 5624143: view contribution catalog reorg — kernel side + bundled UI debug toolkit. Pre-1.0 minor per `spec/versioning.md`; pairs with the matching `@skill-map/spec` minor that drives the rename.

- 0702381: spec 0.19.0 — view contribution system. Plugin extensions can now surface per-node typed data in the UI by picking a `contract` name from a closed kernel-published catalog (10 contracts: `per-node-counter`, `per-node-tag`, `per-node-breakdown`, `per-node-records`, `per-node-tree`, `per-node-key-values`, `per-node-link-list`, `per-node-summary`, `node-marker`, `scope-summary`) and emitting payloads at scan time via `ctx.emitContribution(id, payload)`. Plugin authors NEVER ship UI code, never write JSON Schema, and never pick UI slots — they declare intent via `viewContributions: Record<string, IViewContribution>` on each extension manifest, and the closed catalog of input-types (10 entries: `string-list`, `single-string`, `boolean-flag`, `integer`, `enum-pick`, `enum-multipick`, `path-glob`, `regex`, `secret`, `key-value-list`) drives the `settings:` declarations on the plugin manifest root. New CLI verbs `sm plugins create`, `sm plugins contracts list`, `sm plugins upgrade` make scaffolding the canonical entry point.

### Patch Changes

- d8630e8: Redesign the `sm check` human renderer. Issues are now grouped by file with a sectioned layout: a header line summarises severity counts (only non-zero ones, joined with `·` and individually colored), each touched file gets its own heading, and rows render as `    <glyph>  <analyzerId>   <message>` with the rule-id column padded to align messages within the rendered set. Severity glyphs replace the old `[severity]` prefix — `✕` red for errors, `⚠` yellow for warns, `ℹ` cyan for infos — and the same color precedence as `sm plugins list` / `sm serve` applies (stdout TTY plus `--no-color`). Multi-node issues attach to their primary `nodeIds[0]`; when the rule message embeds `" from <primary>"` and the primary path is already in the section header, the renderer trims the redundancy so prose like "Broken X reference from <path> → <target>" reads as "Broken X reference → <target>". Plugin-authored fields are sanitised once into a flat row shape before rendering. The previous flat one-line-per-issue format is gone; tests that asserted on `[warn]` / `[error]` prefixes now match on the new glyphs.

- 9534efe: Redesign the `sm config list` human renderer. Effective dot-paths are now grouped into a closed catalogue of sections — General, Scan, Jobs, Roots & plugins, History, plus an `Other` catch-all for future keys — printed in that order. Each section gets a header followed by indented `  <key>   <value>` rows, with the key column padded to the longest key in the section and entries sorted alphabetically by their displayed form (the section prefix is stripped in display, so `scan.tokenize` shows as `tokenize` under Scan, `jobs.maxConcurrency` as `maxConcurrency` under Jobs, etc.). Empty sentinels (`null`, `[]`, `{}`) collapse to a dim em-dash so the eye skips defaults and lands on populated overrides. The flag surface is unchanged and `--json` output is byte-identical to before; only the human path is touched. Tests that asserted on the old flat `key = value` shape now match the new padded `<key>   <value>` rows.

- ccad7da: Polish `sm config get / set / show / reset` human output to share the visual rhythm of the rest of the CLI. Each success line now opens with the green ✓ glyph; the trailing `(wrote <path>)` and `(from <layer>)` suffixes are dim; settings paths render relative to cwd when they sit under it (so the user sees `.skill-map/settings.json` instead of an absolute path). No flag surface change; `--json` paths unchanged.

- b3500b0: Polish `sm db backup` / `sm db restore` / `sm db reset` / `sm db migrate` human output: prefix every success line with the green ✓ glyph, render DB / backup / target paths relative to cwd when they sit under it (so the user sees `.skill-map/skill-map.db` instead of the absolute `~/projects/.../skill-map.db`), and add the same glyph to the `kernel · …` and `plugin <id> · …` migration status lines so a glance is enough to confirm "everything ok". Failure paths still emit on stderr without a glyph (existing UX). No flag surface change.

- c9d0e15: Universal blank line before the `done in <…>` elapsed-time footer. The line was rendering tight against each verb's body output (`<final body line>\ndone in 5ms`) which read as visually crowded. Now every verb gets a blank-line separator. Tutorial's verb-specific trailing `\n` (added a few commits ago for the same purpose) reverts since the universal one covers it.

- c6436a6: Polish `sm graph` error path: the `No formatter registered for format=…` message now opens with a red ✕ glyph, matching the rest of the CLI's error-line style. The successful render path is untouched — its output comes from the registered formatter (markdown-flavored ASCII), which is intentionally preserved as-is for diff-tool / pipe compatibility.

- 19e8da3: `sm history` and `sm history stats`: redesign the human renderers to match
  the visual rhythm of the recent `sm scan` / `sm refresh` / `sm list` /
  `sm config list` / `sm show` polish.

- a224379: Polish `sm init`, `sm bump`, and `sm hooks install pre-commit-bump` human output to share the green ✓ glyph rhythm of the rest of the CLI. Each success line — gitignore update, .skill-map/ provisioning, first-scan summary, single-node bump (with or without sidecar creation), pre-commit hook install / chain / already-installed — now opens with `✓`. Pluralised nouns in the first-scan summary (`1 node` / `N nodes`) replace the old `(s)`-suffix style. No flag surface change; `--json` paths unchanged.

- 2d66cb6: Redesign the `sm list` human renderer. The fixed 50-column path / 8-column kind table is replaced with a dynamic layout: column widths are computed from the actual data (PATH soft-capped at 60, every other column unbounded so single- and double-digit counts don't waste a 4-char slot), rows carry a 2-space indent matching the rhythm of `sm plugins list`, `sm check`, and `sm config list`, and the old single-dash separator is gone. Header columns and the KIND column render dim (chrome / metadata), the ISSUES column turns yellow when non-zero so triage targets pop and stays dim at zero, and the data values (OUT / IN / EXT / BYTES) stay plain. A footer block follows: a blank line, `<count> node(s)` (singular / plural via the new `tableFooterNoun*` keys), then a dim tip pointing at `sm show <path>` and `sm check`. Color resolution goes through `ansiFor({ isTTY, noColorFlag })` so `--no-color` and non-TTY pipes stay byte-clean. The flag surface is unchanged and `--json` output is byte-identical to before; only the human path is touched. Tests that asserted on the old `header + sep + N data` line counts now count data rows by `.md` matches (robust to header / footer churn) and additionally assert the new footer's `<count> nodes` line.

- 4a2d36a: Refresh the public-facing tagline across README (EN/ES), CLI compact help header, and the UI top bar. The new line — "The missing map for your generative-AI ecosystem — discover what your Markdown is trying to tell you." / "El mapa que le faltaba a tu ecosistema de IA generativa — descubre lo que tus Markdown intentan decirte." — replaces the previous "graph explorer" wording everywhere it surfaces to users. The CLI `sm --help` compact header mirrors the README "In a sentence" line per the doc-comment contract on `HELP_TEXTS.compactHeader`; `context/cli-reference.md` already covers the new wording and needs no regeneration.

- 1485204: Redesign `sm orphans` / `sm orphans reconcile` / `sm orphans undo-rename` human output to match the visual rhythm of the rest of the CLI.

- addd5cf: Terminal-UX polish across `sm plugins doctor` and `sm tutorial`. Doctor warning bodies no longer repeat the qualified id (`Provider '<id>' declares ...`) — the id already lands in the entry header glyph row, so the body now reads `Declares explorationDir '<path>', but ...`. `sm tutorial` opens with the same violet "Skill Map" figlet block that `sm serve` does (printed to stderr so it stays out of any pipe consuming stdout), and a trailing blank line in the success template puts breathing room between the body and the `done in <…>` footer.

- c26aab4: `sm refresh`: redesign the human renderer to a single result line in the
  rhythm of the recent `sm scan` / `sm list` / `sm config list` polish.

- 7e1a756: Polish `sm scan compare-with` and `sm sidecar annotate / refresh / prune` human output.

- d1e2f17: Redesign the `sm scan` outcome renderer and fix a real bug in the orchestrator's contribution-rejection error path. The outcome layout switches from a single dense summary line to the same sectioned shape as `sm check` and `sm plugins list/show/doctor`: a header `<glyph>  N nodes · M links · K issues   in <Xms>  (P roots)` with `✓` green when no error-severity issues land and `✕` red otherwise, the issues count colored by worst severity (yellow when warn-only, red when errors present, dim when zero), and an indented body line with the relative DB path (or "would persist to <path> (dry-run)" under `--dry-run`). Color resolution mirrors `sm check` / `sm serve`: stdout TTY plus `--no-color`, forwarded explicitly through `IScanRunOpts.colorEnabled` into `createStderrProgressEmitter`, which now wraps its `⚠` glyph in xterm-214 yellow when enabled. The progress emitter's `extension.error:` literal prefix is gone — the line now reads `<glyph>  <message>`, where the glyph carries the severity and the message stays the message. Bug fix on the way: the two `emitContribution` rejection paths in the orchestrator (`unknown-contribution-id` and `payload-invalid`) previously emitted extension-error events without a `message` field, so the stderr emitter fell through to the cryptic "extension reported an error (no detail)." line on every scan that hit a contribution validation failure (e.g. a frontmatter value over `per-node-key-values`'s 512-char ceiling). Both call sites now build a real human message from new `orchestrator.texts.ts` templates so the user sees what was rejected and why.

- 9abeb32: `sm show`: redesign the human renderer to match the visual rhythm of
  the recent `sm scan` / `sm check` / `sm refresh` / `sm list` /
  `sm config list` polish.

- b94ce7f: Document `.sm` sidecar files in user-facing READMEs and the interactive
  tutorial. Adds a "Sidecar `.sm` files (don't be alarmed when they appear)"
  section to `README.md` and `README.es.md` (between Quick start and the
  Interactive tutorial), a terser one-paragraph summary in `src/README.md`
  (which ships in the `@skill-map/cli` npm tarball), and replaces the
  buried sidecar paragraph in `sm-tutorial` Step 3 with a short
  heads-up blockquote. The content explains what `.sm` files are, why they
  sit beside the `.md` instead of inside its frontmatter, that `sm scan` /
  `sm watch` / the live UI never create them (only `sm bump` and
  `sm sidecar annotate` do), and that they belong in git. No behavioural
  change — purely documentation surfacing of an existing architectural
  decision (Step 9.6, Decision #125).

- bb74f42: Apply the in-CLI visual style to `sm version`, `sm tutorial`, and the four `sm plugins enable / disable` rejection error messages.

- b2f56ff: Polish `sm watch` per-batch summary line and stub verbs to match the visual rhythm of the rest of the CLI.

- Updated dependencies [3376a75]

- Updated dependencies [f0ddae0]

- Updated dependencies [b3ba3de]

- Updated dependencies [22f4439]

- Updated dependencies [40d0a81]

- Updated dependencies [40d0a81]

- Updated dependencies [496fb72]

- Updated dependencies [40d0a81]

- Updated dependencies [68709b9]

- Updated dependencies [9f04fc2]

- Updated dependencies [89c1c17]

- Updated dependencies [5624143]

- Updated dependencies [0702381]
  - @skill-map/spec@0.19.0

## 0.18.0

### Minor Changes

- 305e75a: Step 9.6.3 — built-in `bump` Action + sidecar write channel. Adds the deterministic `core/bump` Action and the new `ISidecarStore` port (with the `FilesystemSidecarStore` impl) that materialises Action-returned `{ kind: 'sidecar', path, changes }` payloads against on-disk `.sm` files. The Action stays pure — `invoke()` computes a deep-merge patch and returns it; the Store re-reads the on-disk sidecar, deep-merges (objects RECURSE; arrays REPLACE), revalidates the merged result against `sidecar.schema.json` + `annotations.schema.json`, and writes back inside a path-keyed critical section using the standard atomic `.tmp + rename` pattern.

- 79dfdea: Step 9.6 catalog-curation follow-up (2026-05-07): remove the vestigial `Node.author` denormalisation end-to-end. The 9.6.2 migration sourced `Node.author` from `annotations.author`; the 2026-05-07 catalog curation dropped `author` from `annotations.schema.json`, leaving the column without a canonical source. The earlier curation changeset said `Node.author` would stay untouched; this follow-up reverses that — keeping a denorm path for an opaque `additionalProperties: true` rider was inconsistent with the curated catalog and added persistence + display surface for a field the schema no longer documents.

- 670eaa4: Catalog refinement: drop `released` from the curated annotation catalog. The catalog now stands at **14 fields**.

- d12f7d2: Two new built-in Providers — `gemini` and the vendor-neutral `agent-skills` — plus a tighter `IProvider.classify()` contract so multiple Providers can scan the same roots without colliding.

- 5e0ebcd: Rename five public type aliases on the kernel surface to match the project's `T*` prefix convention for type aliases (categories 1-4 already documented in `context/kernel.md` + `src/kernel/types.ts`; category 5 was implicit and is now formalized).

- e17ff6a: Per-user favorites. The UI gains a subtle heart button on every node card (stacked under the chevron in the actions cluster) plus a "Favorites only" toggle in the filter-bar that hides while the user has zero favorites. State persists across `sm scan` and `sm db reset` because favorites live in a new `state_node_favorites` table (zone `state_`).

- 864e373: Phase 0 of the multi-provider rollout: rename the Claude Provider's fallback kind `note` → `markdown`.

- 305e75a: Step 9.6 review queue R14 — `loadPluginRuntime` now honours an explicit `runtimeContext` override. The BFF composition root (`server/index.ts:assembleBootBundle`) threads its already-resolved `runtimeContext` through to plugin discovery so a `createServer({ runtimeContext: { cwd: <tempdir>, ... } })` boot actually walks `<tempdir>/.skill-map/plugins/` instead of the real `process.cwd()`. Pre-R14 the option was silently ignored — `loadPluginRuntime` fabricated a fresh `defaultRuntimeContext()` per helper.

- 305e75a: Step 9.6.6 (BFF half) — `GET /api/annotations/registered` over the Hono BFF. Read-only catalog of plugin-contributed annotation keys, surfaced so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime. The endpoint is a pure projection of `kernel.getRegisteredAnnotationKeys()` — populated once by `registerEnabledExtensions` after every plugin loads at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec.

- 305e75a: Step 9.6.5 (BFF half) — `POST /api/sidecar/bump` over the Hono BFF. The endpoint mirrors the `sm bump <node.path> [--force]` CLI verb 1:1: same built-in `core/bump` Action, same `FilesystemSidecarStore`, same fresh-vs-stale refusal semantics. The only differences from the CLI verb are the invoker label (`'ui'` vs `'cli'`) and the wire shape. Batch (`--pending`) stays CLI-only at 9.6.5 — surfacing it over REST needs a job-style progress channel and lands later.

- 305e75a: Step 9.6.4 — sidecar CLI verbs. Six new verbs split between `sm bump` (top-level, ROADMAP-named per Decision #125) and the `sm sidecar` sub-namespace (administrative helpers; the existing `sm refresh` from Step A.8 — enrichment-layer — stays untouched). Plus `sm hooks install pre-commit-bump` for the opt-in commit-time auto-bump.

- 305e75a: Step 9.6.6 — plugin annotation contributions + Tier-1 `unknown-field` rule. Closes the last sub-step of the Step 9.6 annotation system.

- 305e75a: Step 9.6.2 — kernel sidecar reader + drift detection. The walker now reads `<basename>.sm` next to every `<basename>.md` it finds, validates against `spec/schemas/sidecar.schema.json` + `spec/schemas/annotations.schema.json` via the kernel AJV stack, and computes drift versus the live body / canonical-frontmatter hashes. Stale state surfaces through a new built-in Rule `core/annotation-stale` (`warn` severity); orphan `.sm` files (no matching `.md`) surface through `core/annotation-orphan` (`warn`). Schema-invalid or YAML-malformed sidecars produce an `invalid-sidecar` warning and the scan continues — drift detection is soft-mode, never blocking.

- 687823d: R15 closure (Step 9.6 review queue): extend `Node.sidecar` overlay with the full parsed `.sm` root.

- 305e75a: Step 9.6.5 (UI half) — sidecar surface in the SPA. Closes 9.6.5 alongside the BFF half that landed earlier on the same date. The `ui/` workspace stays private (per project policy); user-visible UI changes ship bundled inside `@skill-map/cli`.

- 305e75a: Step 9.6.7 — wire-shape cleanup. Closes two §Step 9.6 review-queue items in one batch (R7 + R9) so the BFF's REST and WS surfaces match the canonical contracts every other route already follows.

- 1019d5f: Pluggable kernel walker + parser registry. Provider manifests gain a declarative `read: { extensions, parser }` field; the kernel owns the file walker and a closed registry of built-in parsers. The Claude Provider drops its hand-rolled `walk()` (~70 lines of fs walking + frontmatter parsing) and becomes pure metadata + classification.

### Patch Changes

- 79dfdea: Step 9.6 catalog curation. The annotation surface settled in Steps 9.6.1 → 9.6.7 went through a UX review on 2026-05-07; 16 fields with no clear value or that duplicated other surfaces were dropped from the curated catalog, and the per-bump rationale field `audit.bumpReason` was rolled back together with its CLI / BFF inputs.

- 71aab31: Internal cleanup across `src/`. No public API or CLI surface change. Absorbs the M2, M3, M5, M7, M8 findings from the latest `cli-architect` review on `src/` (C1, C2, M1 already shipped in the previous commit).

- 9d64507: Internal cleanup across `src/`. No public API or CLI surface change. Closes the M4 + M6 themes plus the residual minors (m2–m9), the n1 nit, and the H1 hypothesis from the latest `cli-architect` review on `src/`.

- 9c4680f: Internal cleanup across `src/cli/`, `src/kernel/`, `src/server/`, `src/conformance/`. No public API changes. Folds 22 hand-rolled `(err as Error).message` / `err instanceof Error ? err.message : String(err)` sites onto a kernel-level `formatErrorMessage` helper (`src/kernel/util/format-error.ts`). Kills inline `'.skill-map'` literals outside the path-helper modules — kernel callers now route through `src/kernel/util/skill-map-paths.ts`, CLI callers through the existing `defaultSettingsPath` / `defaultIgnoreFilePath` helpers. Wires the `IPrinter` channel surface into `SmCommand`: status banners (`Initialised`, `Running first scan…`, `Updated .gitignore`, dry-run plan, `sm job prune` retention rows) now route through `printer.info` to stderr (consistent with the M1 review), with the public-facing payload still reserved for stdout. New `pluginRuntime.emitWarnings(printer)` consolidates six identical for-loops; new `registerEnabledExtensions(kernel, pluginRuntime)` consolidates the five-site built-ins-+-plugins manifest registration dance. Adds `WATCH_TEXTS.maxConsecutiveFailuresInvalid`, `DB_TEXTS.dumpFailure`, `SERVE_TEXTS.uiDistInvalid` for previously-inline English; `requireDbOrExit(path, stderr)` collapses the 14-site `if (!assertDbExists(...)) return ExitCode.NotFound` boilerplate; `THealthDbState` narrows to `'present' | 'missing'` (the `'error'` state was reserved but never produced — widening the union later is non-breaking). New BFF query helper `src/server/util/parse-query.ts` (`parseCsv`, `parsePagination`, `parseBooleanFlag`) replaces hand-rolled equivalents in `routes/nodes.ts`, `routes/issues.ts`, `routes/links.ts`, `routes/scan.ts`. New kernel-level `matchesAnalyzerFilter` (`src/kernel/util/analyzer-filter.ts`) replaces the inline copy in `cli/commands/check.ts` and `server/routes/issues.ts`. Per-route plugin-warnings forwarding (`routes/plugins.ts`, `routes/graph.ts`, `routes/config.ts`) now flows through `log.warn(sanitizeForTerminal(warn))` instead of `process.stderr.write` directly. Behaviour-visible change: `sm init` and `sm init --dry-run` print their status banners to stderr now (so a future `--json` mode can keep stdout clean); test suite updated accordingly.

- 1132e69: Internal architectural cleanup across `src/`. No public API or CLI surface change. Absorbs the C1, C2, M1 findings from the `cli-architect` review on `src/`. C1 — eliminates the residual `core/ → cli/` boundary leak the v0.6 audit could not surface structurally: `IPrinter` + `createPrinter` move to `core/runtime/printer.ts` (was `cli/util/printer.ts`); `truncateHead` / `truncateTail` move to `kernel/util/text.ts` (was `cli/util/text.ts`); `createCliProgressEmitter` is renamed `createStderrProgressEmitter` (the helper is stream-based, never was CLI-specific) and lifted to `core/runtime/progress-emitter.ts` with its catalogue at `core/runtime/i18n/progress-emitter.texts.ts`; the two strings the runtime itself emitted (`changedNoPriorWarning`, `priorSchemaValidationFailed`) move from `cli/i18n/scan.texts.ts` to a new `core/runtime/i18n/scan-runner.texts.ts`. Historic `cli/util/{printer,text,cli-progress-emitter}.ts` and `cli/i18n/cli-progress-emitter.texts.ts` stay as thin re-export shims so every CLI / test import keeps working unchanged. C2 — adds a third `core/**` block to `src/eslint.config.js`, peer of the existing `kernel/**` block: `no-restricted-imports` blocks `../cli/*` at every depth (8 patterns); `no-restricted-syntax` blocks `process.cwd()` and `process.env` reads with messages that point to the correct fix (inject through `IRuntimeContext` or resolve in the CLI / BFF adapter). One narrow exception: `core/runtime/runtime-context.ts:32` carries `eslint-disable-next-line no-restricted-syntax` over the single `process.cwd()` read — this is the factory that lifts the live process context into the typed `IRuntimeContext` bag every other `core/` module consumes. M1 — `composeScanExtensions` no longer reads `process.env`. New exported type `IConformanceKillSwitches` (in `core/runtime/plugin-runtime.ts`) and new helper `cli/util/conformance-env.ts: readConformanceKillSwitches(env?)` reads the three kill-switch env vars (`SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}`) at the CLI boundary, treating only the literal `'1'` as truthy so a stray developer-shell export cannot silently disable production scans. Five CLI verbs wire the bag through options (`scan.ts`, `check.ts`, `refresh.ts`, `scan-compare.ts`, `watch.ts`); `core/watcher/runtime.ts` accepts `killSwitches` per call and threads it to the composer per-batch; `core/runtime/scan-runner.ts` adds `killSwitches?` to `IScanRunOpts`. The BFF intentionally does not honour the env vars (production caller). Tests: `plugin-runtime-branches.test.ts` is reorganised — composer behaviour is tested with `killSwitches` injected directly (4 cases), and the env-var contract is tested at the helper (3 cases including the `'1'`-literal enforcement). The existing `conformance-disable-flags.test.ts` integration suite still passes intact (sub-process injects env, the verb reads at the boundary). Drive-by: drops a stale `eslint-disable-next-line complexity` in `cli/commands/check.ts` whose function no longer triggers the rule. Net: 16 modified, 6 new, +246/-279.

- d529e47: Internal architectural cleanup across `src/`. No public API or CLI surface change. Extracts a new `src/core/` boundary (`runtime/`, `sqlite/`, `paths/`, `watcher/`) so the BFF (`src/server/`) no longer reaches into `src/cli/util/` for shared machinery — the two grep gates (`from '../../cli/util'` and `from '../cli/util'` under `src/server/`) now both return zero. Physically moves `runScanForCommand` / `composeScanExtensions` / `loadPluginRuntime` / `emptyPluginRuntime` / `defaultRuntimeContext` (plus their i18n texts), `tryWithSqlite` / `withSqlite`, and `defaultProjectPluginsDir` plus sibling pure path helpers into `core/`; the old `cli/util/{runtime-context,with-sqlite,plugin-runtime,scan-runner,db-path}.ts` modules become thin re-export shims so historic CLI/test imports keep working. CLI-only helpers (`assertDbExists`, `requireDbOrExit`, ExitCode-aware paths) stayed in `cli/util/db-path.ts`. The BFF now imports `formatErrorMessage` directly from `kernel/util/format-error.ts` instead of going through the `cli/util/error-reporter.ts` shim. Watcher consolidation: new `src/core/watcher/runtime.ts` exports `createWatcherRuntime(opts): IWatcherRuntimeHandle` with pure machinery (config + ignore filter, plugin-runtime load, primary + meta-file chokidar wiring, debounced batch dispatch, prior-snapshot strict validation, persist branch, circuit breaker, `maxBatches` test hook) and an events bag (`onBatch`, `onWatcherError`, `onPluginWarning`, `onReady`, `onBreakerTripped`); `subscribeBeforeInitial` knob preserves both adapters' historic ordering. `cli/commands/watch.ts` shrank 465→322 lines, `server/watcher.ts` shrank 468→178 lines — each is now just the Clipanion / Hono adapter. `cli/commands/init.ts` drops its inline pipeline composition and reuses `runScanForCommand` with `noPlugins: true` / `allowEmpty: true`, mapping the discriminated outcome to `INIT_TEXTS.*` framing. `server/health.ts` memoises `resolveSpecVersion()` via a module-level cached promise (`??=`), so the dynamic import only runs once per process. Net: 21 files modified, 7 new files under `src/core/`, 1 file deleted, ~−1555 lines.

- 529c106: Internal refactor of the frontmatter extractor in `src/built-in-plugins/extractors/frontmatter/index.ts`. No behavior change — same emission rules, same dedup, same comment about the inverse-direction `supersededBy` edge. The duplicated body that processed each annotations-shaped block (sidecar `annotations:` and legacy `metadata:` frontmatter) is extracted into a new `processBlock(block, sourcePath, emit)` helper at module scope, plus a small `EmitFn` type alias. `extract` now does only: build the `seen` dedup set + `emit` closure, then call `processBlock` once per source. Drops cyclomatic complexity from 15 to under the project's max of 8 so the file no longer needs a per-function ESLint disable. Lint, typecheck, and the extractor test suite (30/30) are green.

- faaa813: Fix Step 9.6 migration gap in the `frontmatter` extractor. The extractor was emitting structured links (`supersedes`, `supersededBy`, `requires`, `related`, `conflictsWith`) by reading the legacy `metadata:` block in markdown frontmatter; Step 9.6.2 hard-cut the column denormalisation (`stability` / `version` / `author`) but never migrated this link-emission path. Result: any node whose annotations migrated to the new `.sm` sidecar lost its structured links from the graph (visible as a sudden link gap in the UI after the fixture migration).

- ead5cab: Internal refactor: move BFF error message literals (catch-all 404 envelopes, sidecar bump refusals, body-parse failures, missing-invoke envelope) into `src/server/i18n/server.texts.ts` so every operator-facing string lives in one catalog. The route bodies now reference `SERVER_TEXTS.*` keys (interpolated through `tx()` for the path-bearing 404s) instead of inlining the literals.

- Updated dependencies [305e75a]

- Updated dependencies [79dfdea]

- Updated dependencies [79dfdea]

- Updated dependencies [670eaa4]

- Updated dependencies [d12f7d2]

- Updated dependencies [e17ff6a]

- Updated dependencies [864e373]

- Updated dependencies [c47c131]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [305e75a]

- Updated dependencies [687823d]

- Updated dependencies [305e75a]

- Updated dependencies [1019d5f]
  - @skill-map/spec@0.18.0

## 0.17.0

### Minor Changes

- bd5e360: Absorb Anthropic Claude's documented frontmatter verbatim into the Claude Provider's per-kind schemas, drop the obsolete `hook` node kind.

- 77579b3: Add a `sm db browser` sub-command that opens the project's SQLite DB in DB Browser for SQLite (sqlitebrowser GUI). Read-only by default; pass `--rw` to enable writes. Replaces the previous `scripts/open-sqlite-browser.js` standalone script.

- 84c3f07: `npm run start` now opens Windows Terminal with two side-by-side panes that run `bff:dev` (the BFF watcher with the Hono API + the Angular dev-mode placeholder) and `ui:dev` (the Angular dev server with HMR). Replaces the previous `start` which was a thin alias to `ng serve` that booted the SPA without a backing BFF.

### Patch Changes

- f706e57: Improve the `sm db browser` error message when `sqlitebrowser` is not installed: multi-line block, aligned columns, three OS variants (Debian/Ubuntu, macOS, Windows), softer framing ("if you want a GUI…" rather than imperative). The Windows hint links to the official downloads page. The shortcut at root `npm run sqlite` is moved up to sit next to `start` so the daily-use entry points are grouped at the top of the scripts block.

- 696008a: Add a `--no-ui` flag to `sm serve`. With it, the BFF stops serving the Angular bundle (stale or otherwise) and the root `/` renders an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Used by the root `bff:dev` shortcut so iterating on the BFF alongside the Angular dev server doesn't surface a stale UI by accident.

- Updated dependencies [77579b3]

- Updated dependencies [696008a]

- Updated dependencies [bd5e360]
  - @skill-map/spec@0.17.0

## 0.16.6

### Patch Changes

- 508c96a: Two coordinated landings on the landing footer plus a whitespace cleanup.

## 0.16.5

### Patch Changes

- b1a59e8: Graph view: place newly-detected nodes around the existing layout instead of on top of it.

## 0.16.4

### Patch Changes

- 383ce0b: Graph view: persist every node's position, not just the manually-dragged ones.

- 07cd144: `sm tutorial` success message now surfaces the bilingual trigger phrase as the most visible part of the output, and reminds the tester that the first message they write to Claude sets the tutorial language for the rest of the session.

- 37bde96: `sm-tutorial` SKILL: heads-up before scaffolding the scenario.

## 0.16.3

### Patch Changes

- bf7c434: Tutorial audit pass.

## 0.16.2

### Patch Changes

- 8b55382: Watcher fix + tutorial polish.

## 0.16.1

### Patch Changes

- f5db61e: Tutorial polish + UI fix.

## 0.16.0

### Minor Changes

- c981430: Rename the project ignore file from `.skill-mapignore` to `.skillmapignore` (no dash).

- 15f2b4e: `sm serve` and `sm watch` now react in-flight to edits of `.skillmapignore` and `.skill-map/settings.json`. Previously, both verbs loaded the ignore filter once at startup and required a restart for new patterns to take effect — invisible to the user except via stale results. After this change, a secondary chokidar watcher monitors both meta-files; on change, the watcher rebuilds the filter from disk, re-reads `config.ignore` / `scan.tokenize` / `scan.strict` from settings, and dispatches a fresh scan so the DB and `/ws scan.completed` reflect the new state.

### Patch Changes

- Updated dependencies [c981430]
  - @skill-map/spec@0.16.0

## 0.15.0

### Minor Changes

- d7e8dd9: Rename the tester onboarding verb and its companion Claude Code skill from `sm-guide` to `sm-tutorial` across spec, CLI, bundled materialised payload, runtime state file, and report file. Breaking change to the public CLI surface (`sm guide` is gone — no compat shim); pre-1.0 so it ships as a minor bump per the project's pre-1.0 policy (no major while a workspace stays in `0.Y.Z`).

### Patch Changes

- 89a3e59: `sm-guide` tester-feedback iteration plus a handful of CLI/UI polish fixes that ride along.

- Updated dependencies [d7e8dd9]
  - @skill-map/spec@0.15.0

## 0.14.1

### Patch Changes

- b1f6018: `sm serve` shows a figlet-style ASCII-art startup banner; non-TTY output is unchanged.

- e02eab9: `sm guide` UX polish: clearer trigger phrase + richer bundled walkthrough.

## 0.14.0

### Minor Changes

- 17a908c: Add a new built-in `markdown-link` extractor that catches `[text](path)` markdown links and emits one `references` link per resolved file path. Closes the gap surfaced by the slash-regex fix: even after that bug stopped generating false positives, sm had no extractor that mapped relative markdown links to real edges in the graph — the dominant cross-reference shape in real knowledge bases was invisible. The new extractor.

- c486f74: Add a new `sm guide` verb that materializes the interactive tester guide as `sm-guide.md` in the current working directory. Companion to the `sm-guide` Claude Code skill: a tester drops into an empty directory, runs `sm guide` to seed the canonical SKILL.md content, then opens Claude Code there and triggers the skill ("guíame") to start the interactive walkthrough. The verb.

### Patch Changes

- b4fceb7: Two UX improvements to the CLI error surface, addressing tester friction.

- c99b972: Two small CLI improvements driven by tour findings.

- 0ecf2af: `sm db dump` no longer requires the external `sqlite3` binary. Reimplemented on top of `node:sqlite` (already a dep via the storage adapter), so the verb works on any host that can run sm without an extra install step. The output format mirrors sqlite3's `.dump` closely enough to round-trip into a fresh DB via either `node:sqlite` or the system `sqlite3` if present (`PRAGMA foreign_keys=OFF;` + `BEGIN TRANSACTION;` + schema objects in `rootpage` order + per-table `INSERT INTO …` + `COMMIT;`).

- 34d57db: Doc-only fix to remove a misleading reading of "built-in kinds" in the Node schema and one test, plus a small batch of internal CLI refactors and tightened null checks. No external surface change.

- 17a908c: Fix the slash extractor's regex so markdown relative links `[label](./foo.md)` no longer trigger false-positive `broken-ref` issues. URLs (`https://...`), Windows drive letters (`c:/...`), and dotted paths (`domain.com/api`) were also affected — same root cause in the previous-char guard. Switched from a character-class guard to a negative lookbehind that explicitly excludes `.`, `:`, `?`, `#` in addition to the original word / `/` exclusions.

- 53d39d8: Pin `@skill-map/spec` to an exact version instead of the wildcard `"*"`. The wildcard let `npm install -g @skill-map/cli@X.Y` resolve the spec dep to whatever was newest in the registry at install time — not necessarily the version the CLI was tested against. End users could end up running an `X.Y` CLI binary against a spec it had never seen, producing the "code is one version, spec is OTA" symptom (renamed config keys rejected, documented flags missing, conformance suite drifting).

- Updated dependencies [34d57db]
  - @skill-map/spec@0.14.1

## 0.13.0

### Minor Changes

- 34768b2: Replace Clipanion's full-catalog error dump with a concise diagnostic on argv parse errors.

- e42cb62: Ship the Angular UI bundle inside `@skill-map/cli` and resolve the correct Angular `application`-builder output path so `sm serve` actually serves the SPA in installed mode.

## 0.12.0

### Minor Changes

- 8f2a66d: Bare `sm` defaults to `sm serve` instead of printing help

### Patch Changes

- Updated dependencies [8f2a66d]
  - @skill-map/spec@0.14.0

## 0.11.1

### Patch Changes

- 103fc1a: Doc revision pass — greenfield framing across READMEs, spec prose, ROADMAP, AGENTS, web, and workspace landing pages.

- Updated dependencies [103fc1a]
  - @skill-map/spec@0.13.1

## 0.11.0

### Minor Changes

- e0fb57e: Step 14.2 — REST read-side endpoints + DataSource contract

- d5488bf: Step 14.4.a — BFF WS broadcaster + chokidar wiring + scan event emission

- 4ff3f38: Step 14.5.d — Provider-driven kind presentation + envelope kindRegistry

- de20bc2: Step 14.5 (a + b) — Inspector polish: markdown body opt-in + linked-nodes panel + dead-link verify hybrid

### Patch Changes

- Updated dependencies [e0fb57e]

- Updated dependencies [d5488bf]

- Updated dependencies [4ff3f38]

- Updated dependencies [de20bc2]
  - @skill-map/spec@0.13.0

## 0.10.0

### Minor Changes

- 9b55981: cli-architect review follow-up — `SmCommand` base class wires every spec § Global flag (`-q/--quiet`, `-v/--verbose`, `--no-color`, env vars), every read-side verb now emits `done in <…>` per spec § Elapsed time, watch grows a circuit breaker, scan extracts the runner, and two invariant tests gate future regressions.

- 68c5e28: Step 14.1 — `sm serve` + Hono BFF skeleton

### Patch Changes

- Updated dependencies [68c5e28]
  - @skill-map/spec@0.12.0

## 0.9.0

### Minor Changes

- 67fb4ae: refactor: cli-architect audit sweep — boundary hygiene, i18n discipline, enum hardening, IAction stub

- 2ef6b15: refactor: cli-architect follow-up — finish kernel i18n migration, dedupe DB-path helpers, normalize conformance type names, switch `sm db` / `sm init` to async fs

- 723c022: cli-architect audit follow-up — output sanitization hardening, `StoragePort.migrations.writeBackup` signature change, atomic config write, and shared helper extraction.

- 147adb8: feat(cli): compact `sm --help` and per-verb help

- 256fb70: security: harden CLI/kernel against prototype pollution, ANSI injection, and path-escape attacks (audit findings H1–H3, M1–M6, L1)

### Patch Changes

- 3c07b8f: refactor: cli-architect audit follow-up — i18n discipline in built-in plugins, scan-compare delta, plugin-runtime warnings, and `IDbLocationOptions` runtime-context unification

- 62d3124: refactor: cli-architect audit follow-up — i18n discipline, runtime-context sweep, ExitCode literal cleanup

- 7d14da9: refactor: cli-architect re-audit follow-up — dedupe `dbPathForScope`, share `SKILL_MAP_DIR` const, fold trigger-collision joiner into the i18n template

- 4080efd: refactor: i18n discipline sweep across CLI renderers + storage-port-promotion follow-up

- 33383c9: Security audit fixes (cli-hacker sweep).

- Updated dependencies [f8fca25]
  - @skill-map/spec@0.11.0

## 0.8.0

### Minor Changes

- bb7ff01: Audit cleanup pass — close four mechanical items from the
  `cli-architect` audit in a single sweep. **Pre-1.0 minor bump** per
  `spec/versioning.md` § Pre-1.0; the API changes below are technically
  breaking but ship as a minor while the package stays `0.Y.Z`.

- d058bf8: Close H1 / M1 / M3 from the cli-architect review.

- b5a1a1e: Correct misclassified exit codes in `sm export` and `sm graph`.

- 698dd5d: Introduce `LoggerPort` on the kernel and a concrete CLI `Logger`
  adapter, replacing the last direct `console.error` write inside the
  kernel.

- 124ccda: Open `Node.kind` and `IProvider.classify` to `string` end-to-end on the TS side (Phases B + C).

- 558cf43: Replace the placeholder `PluginLoaderPort` shape with the real
  contract the concrete loader has been exposing since Step 0b, and
  pin the adapter to the port via `implements PluginLoaderPort`.

- 91fea6a: Split the orchestrator's `walkAndExtract` into three named helpers and
  close audit item V4 by reusing the kernel's extractor loop from
  `sm refresh`. **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0;
  the API addition below would warrant a minor on its own, and the
  internal split is non-breaking (no public signature changes).

- e8cbd19: Storage-port promotion — Phase A (`scans` / `issues` / `enrichments` / `transaction` namespaces).

- 19fbc08: Storage-port promotion — Phase B (`history` namespace).

- 19fbc08: Storage-port promotion — Phase C (`jobs` namespace).

- 19fbc08: Storage-port promotion — Phase D (`pluginConfig` namespace).

- 19fbc08: Storage-port promotion — Phase E (`migrations` / `pluginMigrations` namespaces) + Phase F (cleanup).

### Patch Changes

- bf30b67: Update `AGENTS.md` to reflect the post-sweep lint state: every quality rule is now `'error'` (no more `'warn'` tier), and codify the six categories where `eslint-disable-next-line` is the right answer (CLI orchestrators, parsers, multi-accumulator folds, migration runners, pure column mappers, discriminated-union dispatchers). Anything outside those categories should be split, not disabled — pointers to the canonical split commits included.

- 3cc603b: Close audit items D3 (i18n discipline) and D4 (rename `extensions/`) in
  a single sweep. **Patch bump**: pure refactor + docs; zero public API
  changes, no spec change, no behaviour change. The directory rename and
  the i18n migration are both internal to the workspace.

- 9c5db60: Close L1 / L2 / L3 from the cli-architect review.

- 369213c: Continue the complexity sweep — 5 more functions reduced or disabled with rationale.

- e9e04c7: Continue the complexity sweep.

- aa550a6: Code-quality follow-up to commit `518180d` — final wave of the
  ongoing complexity sweep ("hasta menos de 8") plus a tightening pass
  on the ESLint config so the workspace lint is now fully strict.
  **Patch bump**: zero public API changes (every refactored function
  keeps its exported signature; no new exports); pure internal
  restructuring + dev-tooling.

- 66ea293: Extract `buildFreshNodeAndValidateFrontmatter` from `walkAndExtract` (orchestrator). Internal-only refactor — moves the `else` branch (no cache hit: build a fresh `Node` and run frontmatter validation) into a focused helper. `walkAndExtract` complexity drops from 35 to 33. No public API change; behaviour preserved.

- a785a16: Three follow-up tests for the open-node-kinds refactor — close gaps the Phase E smoke test left implicit.

- b3debbe: Phase E of the open-node-kinds refactor — end-to-end smoke verification baked into the test suite.

- 518180d: Code-quality follow-up to commit `369213c` — eighth batch of the
  ongoing complexity sweep ("hasta menos de 8"). Eight functions
  addressed: two splits into focused private helpers, six justified
  inline disables on CLI orchestrators / safe-apply loops where the
  cyclomatic count is intrinsic to the contract. **Patch bump**: zero
  public API changes (every refactored function keeps its exported
  signature; no new exports); pure internal restructuring.

- 5ca7c36: Continue the complexity-reduction sweep — six more high-complexity
  functions split into focused helpers in a single batch. **Patch bump**:
  zero public API changes (no exported signatures touched, no new
  exports), pure internal restructuring; 602 / 602 tests still green
  after each split individually and after the batch.

- efa8972: Code-quality follow-up to commit `91fea6a` — split the next three
  high-complexity offenders into focused private helpers. **Patch bump**:
  zero public API changes (every refactored function keeps its exported
  signature; no new exports); pure internal restructuring.

- 33cfea4: Close audit item SD4 — clean ROADMAP "Step N / Phase N" references from kernel docstrings. 78 refs eliminated or reworded; 22 algorithm-internal "Step N" / "Phase N" comments preserved (they describe numbered steps inside an algorithm, not roadmap milestones — `trigger-normalize.ts`, `scan-persistence.ts:upsertEnrichmentLayer`, `plugin-loader.ts:loadOne`, `orchestrator.ts:detectRenamesAndOrphans` and friends). Updated one assertion in `hook-extension.test.ts` so the test no longer pins the literal string "Step 10" in the deferral message.

- 4fbb23c: Split `evaluateJsonPath` (complexity 25) and `runConformanceCase` (complexity 20) in `src/conformance/index.ts`. Internal-only refactor — no public API change. Extracted helpers: `traverseJsonPath` (pure walker over a parsed segment list), `applyJsonPathComparator` (justified inline disable for the 4-comparator chain), `runPriorScansSetup` (the priorScans replay loop). Both monsters drop below or just above the threshold; no test regressions.

- 11c4382: Split `renderMarkdown` (complexity 19) in `src/cli/commands/export.ts`. Extracted `countIssuesPerNode` (issue index helper) and `renderNodesByKindSection` (the per-kind nodes block with grouping + sorting + rendering). `renderMarkdown` itself drops below the threshold; the extracted section helper sits at 11 (parallel branches over `KIND_ORDER`, manageable). Pure refactor, no public API change.

- 6d031d8: Code-quality follow-up to commit `66ea293` — split the audit's other
  big offender, `loadOne` in `src/kernel/adapters/plugin-loader.ts`
  (310 lines, complexity 31), into focused private helpers. **Patch
  bump**: zero public API changes (the `PluginLoader` class still
  exposes the same `loadOne(pluginPath): Promise<IDiscoveredPlugin>`
  signature; new helpers are `#`-prefixed truly-private methods plus
  one private free function); pure internal restructuring.

- Updated dependencies [f8a7125]
  - @skill-map/spec@0.10.0

## 0.7.0

### Minor Changes

- 88afe24: Cleanup pass post-v0.8.0 — finishing the renames and wiring the
  conformance kill-switches.

### Patch Changes

- Updated dependencies [88afe24]
  - @skill-map/spec@0.9.0

## 0.6.0

### Minor Changes

- 6dad772: v0.8.0 — Pre-1.0 stabilization pass.

### Patch Changes

- Updated dependencies [6dad772]
  - @skill-map/spec@0.8.0

## 0.5.0

### Minor Changes

- 0463a0f: Step 9.1 — plugin runtime wiring. Drop-in plugins discovered under
  `<scope>/.skill-map/plugins/<id>/` now participate in the read-side
  pipeline: their detectors / rules emit links + issues during `sm scan`,
  and their renderers are selectable via `sm graph --format <name>`.

- 0463a0f: Step 9.2 — plugin migrations + triple protection. Plugins declaring
  `storage.mode === 'dedicated'` can now ship their own SQL migrations
  under `<plugin-dir>/migrations/NNN_<name>.sql`, and `sm db migrate`
  applies them after the kernel pass. Two new flags from
  `spec/cli-contract.md:304` light up.

### Patch Changes

- 0463a0f: Step 9.3 — `@skill-map/testkit` lands as a separate workspace + npm
  package (per the Arquitecto's pick of independent versioning over a
  subpath export). Plugin authors install it alongside `@skill-map/cli`
  and use it to unit-test detectors, rules, renderers, and audits
  without spinning up the full skill-map runtime.

- 0463a0f: Step 9.4 — plugin author guide + reference plugin + diagnostics polish.
  **Step 9 fully closed** with this changeset.

- Updated dependencies [0463a0f]
  - @skill-map/spec@0.7.1

## 0.4.0

### Minor Changes

- a73f3f4: Step 7.1 — File watcher (`sm watch` / `sm scan --watch`)

- a73f3f4: Step 7.2 — Detector conflict resolution

- a73f3f4: Step 7.3 — `sm job prune` retention GC

- d3ad73c: Step 8.1 — `sm graph [--format <name>]` real implementation

- d3ad73c: Step 8.2 — `sm scan --compare-with <path>` delta report

- 13727a3: Step 8.3 — `sm export <query> --format <json|md|mermaid>` real implementation

### Patch Changes

- b067f35: Runtime catch-up — thread `mode: 'deterministic'` explicitly through the built-in detectors and rules

- Updated dependencies [d730094]

- Updated dependencies [a73f3f4]

- Updated dependencies [a73f3f4]
  - @skill-map/spec@1.0.0

## 0.3.3

### Patch Changes

- 16e782a: Fix `tsc --noEmit` regressions surfaced by CI after the Step 6
  follow-up commits (`7d4b143`, `4669267`). The commits validated
  through `tsup` (which does not enforce `noUncheckedIndexedAccess` /
  `exactOptionalPropertyTypes`) but tripped CI's stricter `npm run
typecheck` step. Eight TS errors across six files; runtime behaviour
  unchanged.

- f41dbad: Step 6.2 — Layered config loader for `.skill-map/settings.json`. Walks the
  six canonical layers (defaults → user → user-local → project → project-local
  → overrides), deep-merges per key, validates each layer against the
  `project-config` JSON schema, and is resilient per-key: malformed JSON,
  schema violations, and type mismatches emit warnings and skip the offending
  input without invalidating the rest of the layer. Strict mode (`--strict`,
  wired in 6.3+) re-routes every warning to a thrown `Error`.

- f41dbad: Step 6.3 — `sm config list / get / set / reset / show` go from
  stub-printing-"not implemented" to real implementations. The five verbs
  share the layered loader from 6.2 and gain a `--strict` flag on
  the read side that escalates merge warnings to fatal errors.

- f41dbad: Step 6.4 — `.skill-mapignore` parser + scan walker integration.
  Layered ignore filter composes bundled defaults + `config.ignore`
  (from `.skill-map/settings.json`) + `.skill-mapignore` file content;
  the walker honours it so reorganising `node_modules`, `dist`, drafts,
  or any user-defined private dir keeps them out of the scan in one
  predictable place.

- 8a4667f: Step 6.5 — `sm init` scaffolding. Replaces the
  "not-implemented" stub with a real bootstrap verb that provisions
  everything Step 6 has built so far in one command.

- 8a4667f: Step 6.6 — `sm plugins enable / disable` + the `config_plugins`
  override layer they read from. The two stub verbs become real, and
  the `PluginLoader` finally honours user intent: a disabled plugin
  surfaces in `sm plugins list` with status `disabled`, but its
  extensions are NOT imported and the kernel will not run them.

- 8a4667f: Step 6.7 — Frontmatter strict mode. The orchestrator now validates each
  node's parsed frontmatter against `frontmatter/<kind>.schema.json`
  during `sm scan` and emits a `frontmatter-invalid` issue when the shape
  doesn't conform. Severity is `warn` by default (scan still exits 0);
  `--strict` (CLI) or `scan.strict: true` (config) promote every such
  finding to `error` so the scan exits 1.

- 7d4b143: Step 6 follow-up — unify the `--strict-config` flag (introduced in 6.2
  for the layered loader) with the existing `--strict` flag (introduced
  in 6.7 for frontmatter validation). One name, same intent across every
  verb that touches user input: "fail loudly on any validation
  warning".

- 4669267: Step 6 follow-up — two UX polish fixes surfaced during the post-Step-6
  manual walkthrough.

- Updated dependencies [f41dbad]

- Updated dependencies [8a4667f]
  - @skill-map/spec@0.6.1

## 0.3.2

### Patch Changes

- dacd4d9: Move the auto-generated CLI reference from `docs/cli-reference.md` to
  `context/cli-reference.md`. Spec change is editorial: `cli-contract.md`
  references the file path in three spots (`--format md` description, the
  NORMATIVE introspection section, and the "Related" link list); all three
  updated to the new location. No schema or behavioural change.

- 551f6ec: Persist scan results to SQLite (scan_nodes/links/issues).

- 4c34af1: Step 4.10 — scenario coverage. Pure regression-test growth, no behavior
  changes, no new dependencies, no migrations, no spec edits. Backfills
  the scenarios surfaced by the manual end-to-end validation in
  `.tmp/sandbox/` that the existing test suite did not codify.

- 4c34af1: Step 4.11 — three layers of defense against accidental DB wipes when
  `sm scan` receives invalid or empty inputs.

- 551f6ec: Compute per-node token counts via `js-tiktoken`.

- 551f6ec: Add `external-url-counter` detector and orchestrator-level segregation for
  external pseudo-links.

- 551f6ec: Add `sm scan -n` / `--dry-run` (in-memory, no DB writes) and `sm scan
--changed` (incremental scan against the persisted prior snapshot).

- 551f6ec: Promote `sm list`, `sm show`, `sm check` from stubs to real
  implementations backed by the persisted `scan_*` snapshot.

- 551f6ec: Add Step 4.6 acceptance coverage: a self-scan test and a 500-MD
  performance benchmark.

- 551f6ec: Reconcile the runtime `ScanResult` shape with `spec/schemas/scan-result.schema.json`.

- 551f6ec: Three fixes surfaced by the Step 4 end-to-end validation.

- 4c34af1: Two more fixes from the Step 4 end-to-end validation pass.

- 9a89124: Step 5.1 — Persist scan-result metadata in a new `scan_meta` table so
  `loadScanResult` returns real values for `scope` / `roots` / `scannedAt` /
  `scannedBy` / `adapters` / `stats.filesWalked` / `stats.filesSkipped` /
  `stats.durationMs` instead of the synthetic envelope shipped at Step 4.7.

- 9a89124: Step 5.10 — Two polish fixes for the `sm history` CLI surfaces, both
  surfaced during end-to-end walkthrough.

- 9a89124: Step 5.11 — `sm history` human renderer now shows `failure_reason`
  inline when present, so the human path stops hiding info that's
  already in `--json`.

- 9a89124: Step 5.12 — `loadSchemaValidators()` now caches the compiled validator
  set at module level. Before: every call paid ~100 ms cold to read +
  AJV-compile 17 schemas (plus 8 supporting `$ref` targets). After: the
  first call costs the same; every subsequent call in the same process
  returns the same instance for free.

- 9a89124: Step 5.13 — `frontmatter_hash` is now computed over a CANONICAL YAML
  form of the parsed frontmatter, not over the raw text bytes.

- 9a89124: Step 5.2 — Storage helpers for the history readers (`sm history`,
  `sm history stats`) and for the rename heuristic / `sm orphans` verbs
  landing in 5.3 — 5.6.

- 9a89124: Step 5.3 — `sm history` CLI lands. The stub is removed from
  `stubs.ts`; the real implementation lives at `src/cli/commands/history.ts`
  and is registered in `cli/entry.ts`.

- 9a89124: Step 5.4 — `sm history stats` CLI lands alongside `sm history` in
  `src/cli/commands/history.ts`. The stub is removed from `stubs.ts`
  and the real class registered in `cli/entry.ts`.

- 9a89124: Step 5.5 — Auto-rename heuristic lands at scan time per
  `spec/db-schema.md` §Rename detection.

- 9a89124: Step 5.6 — `sm orphans` verbs land. The three stubs are removed from
  `stubs.ts`; the real implementations live at
  `src/cli/commands/orphans.ts` and are registered as `ORPHANS_COMMANDS`
  in `cli/entry.ts`.

- 9a89124: Step 5.7 — Conformance coverage for the rename heuristic.

- 9a89124: Step 5.8 — fire the rename heuristic on every `sm scan`, not just
  `sm scan --changed`. Closes the follow-up flagged at the close of
  Step 5.

- 9a89124: Step 5.9 — Orphan issues now persist across scans as long as `state_*`
  has stranded references. Closes a gap surfaced during end-to-end
  walkthrough.

- Updated dependencies [dacd4d9]

- Updated dependencies [9a89124]

- Updated dependencies [9a89124]
  - @skill-map/spec@0.6.0

## 0.3.1

### Patch Changes

- 18d758a: Editorial pass across spec/ and src/ docs: convert relative-path text references (e.g. `plugin-kv-api.md`, `schemas/node.schema.json`) to proper markdown links, so they resolve on GitHub and in renderers. No normative or behavioural changes — prose, schemas, and CLI contract are unchanged.

- b6c46f8: Pin all dependencies to exact versions in `src/package.json` (no `^` / `~` ranges). Matches the new repo-wide rule in `AGENTS.md`. No runtime behaviour change — all versions match what the lockfile already resolves to. Re-evaluate when `src/` flips to public (published libs usually prefer caret ranges so consumers can dedupe).

- 48c386b: First npm publish of `@skill-map/cli` — name registration. The package was previously private; flipping `private: false` plus adding `publishConfig.access: public` lets the next "Version Packages" merge publish to the npm registry under the `@skill-map` org alongside `@skill-map/spec`. Status remains preview / pre-1.0 (Steps 0a-3 done; full scan lands at Step 4). Subsequent releases follow the standard changeset flow.

- Updated dependencies [18d758a]
  - @skill-map/spec@0.5.1

## 0.3.0

### Minor Changes

- 128a678: Step 1a — Storage + migrations.

- a0e6578: Step 1b — Registry + plugin loader.

- 8bda522: Step 1c — Orchestrator + CLI dispatcher + introspection.

- eedaf90: Step 2 — First extension instances.

### Patch Changes

- Updated dependencies [69572fd]

- Updated dependencies [2699276]
  - @skill-map/spec@0.5.0

## 0.2.0

### Minor Changes

- 3e89d8f: Bump minimum Node version to **24+** (active LTS since October 2025).

### Patch Changes

- 5935948: Align kernel domain types with `spec/schemas/`. The Step 0b stub types for `Node`, `Link`, `Issue`, `Extension`, and `PluginManifest` were invented names that diverged from the normative schemas; they compiled only because the `runScan` stub never materialized any instance. This patch closes the drift before Step 4 starts consuming the types in earnest.

- 1455cb1: Fix `sm version`: the `spec` line now reports the `@skill-map/spec` npm package version (e.g. `0.2.0`) instead of the `index.json` payload-shape version (which was `0.0.1` in every release).

- Updated dependencies [334c51a]

- Updated dependencies [3e89d8f]

- Updated dependencies [334c51a]

- Updated dependencies [d41b9ae]

- Updated dependencies [93ffe34]

- Updated dependencies [d41b9ae]

- Updated dependencies [5935948]

- Updated dependencies [1455cb1]

- Updated dependencies [1455cb1]

- Updated dependencies [93ffe34]

- Updated dependencies [1455cb1]

- Updated dependencies [334c51a]

- Updated dependencies [93ffe34]

- Updated dependencies [93ffe34]

- Updated dependencies [d41b9ae]

- Updated dependencies [93ffe34]

- Updated dependencies [93ffe34]
  - @skill-map/spec@0.3.0

## 0.1.0

### Minor Changes

- 5b3829a: Step 0b — Implementation bootstrap.

### Patch Changes

- Updated dependencies [5b3829a]

- Updated dependencies [4e0aec4]
  - @skill-map/spec@0.1.0
