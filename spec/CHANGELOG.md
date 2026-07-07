# Spec changelog

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
