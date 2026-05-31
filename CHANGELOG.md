# Changelog

> Consolidated release history for skill-map, newest first. Each entry lists what shipped in the CLI (`@skill-map/cli`, the `sm` binary you install) and in the spec (`@skill-map/spec`). This file is generated at release time, do not hand-edit it.
>
> Per-package npm changelogs: [`src/CHANGELOG.md`](./src/CHANGELOG.md), [`spec/CHANGELOG.md`](./spec/CHANGELOG.md).
> Forward-looking plan: [`ROADMAP.md`](./ROADMAP.md).

<details open>
<summary><b>0.47.1</b> · 2026-05-31</summary>

### CLI Patch
- The marketing site gains a Quickstart section just below the hero, with the tutorial first steps as a copy-paste terminal card (install, scaffold, open Claude Code, plus the in-Claude prompt). The documented way to start the tutorial moves from the stale `@sm-tutorial.md` file mention to the natural `run the tutorial` / `run the master tutorial` trigger phrase across the root and CLI READMEs, matching the skill directory that `sm tutorial` now installs.

</details>

<details>
<summary><b>0.47.0</b> · 2026-05-31</summary>

### CLI Minor
- Wired the `tokenizer` project-config key to actually select the scan encoder. It is now a closed enum (`cl100k_base` default, `o200k_base`); the resolved name is recorded in `scan_meta.tokenizer` / `ScanResult.tokenizer` and an out-of-set value is dropped with a warning and falls back to the default. The orchestrator lazily loads only the chosen `js-tiktoken` rank table, and an incremental scan recomputes per-node token counts when the persisted encoder differs from the resolved one.

### CLI Patch
- Detect database schema drift by fingerprint. A sha256 of the migration DDL is stored in `scan_meta.schema_fingerprint` per scan and checked at open, so a DB whose columns fell behind an inline schema edit is caught instead of failing later as a cryptic `no such column` error. Write paths (`sm scan`, `sm serve`) prompt to rebuild (or `--yes`); read verbs warn and point at `sm scan` / `sm db reset`.
- Settings → Plugins gains a single filter bar: a shared **All** reset, a source axis (Built-in / Project), and the existing kind axis on one line. The two axes compose independently (picking a source does not clear a kind), so an operator can isolate the project's own drop-in plugins and extensions from the built-ins. A dedicated empty state points at `sm plugins create` when there are none yet; choices persist per browser.
- The UI WebSocket client no longer raises a stream error when it gives up reconnecting after the dev server stops. It now exposes a `connectionState` signal instead: a new `<sm-connection-banner>` shows a non-fatal "connection lost" notice with a Reconnect button, the data stream stays alive, and the collection re-seeds via `/api/scan` once the socket re-opens. This stops a routine `sm serve` shutdown from surfacing in Sentry as an uncaught error.

### Spec Minor (0.44.0)
- Wired the `tokenizer` project-config key to actually select the scan encoder. It is now a closed enum (`cl100k_base` default, `o200k_base`); the resolved name is recorded in `scan_meta.tokenizer` / `ScanResult.tokenizer` and an out-of-set value is dropped with a warning and falls back to the default. The orchestrator lazily loads only the chosen `js-tiktoken` rank table, and an incremental scan recomputes per-node token counts when the persisted encoder differs from the resolved one.

### Spec Patch (0.44.0)
- Detect database schema drift by fingerprint. A sha256 of the migration DDL is stored in `scan_meta.schema_fingerprint` per scan and checked at open, so a DB whose columns fell behind an inline schema edit is caught instead of failing later as a cryptic `no such column` error. Write paths (`sm scan`, `sm serve`) prompt to rebuild (or `--yes`); read verbs warn and point at `sm scan` / `sm db reset`.

</details>

<details>
<summary><b>0.46.0</b> · 2026-05-31</summary>

### CLI Minor
- The plugin loader now rejects a disk-loaded extension manifest that re-declares a structure-as-truth field (`id`, `kind`, provider `kinds`, formatter `formatId`) as `invalid-manifest` instead of silently stripping it. These are derived from the folder layout, so declaring one was a second source of truth that could drift. `pluginId` is unchanged. `sm plugins create` no longer emits `kind` in the stub. Breaking for external plugins that inlined any of these fields.
- `sm <namespace> --help` (and `sm help <namespace>`) now render a namespace overview, header, USAGE, an optional DESCRIPTION, and a COMMANDS list of the subcommands, for command prefixes that own subcommands but are not themselves runnable (`plugins`, `db`, `config`, `job`, `actions`, `sidecar`, `hooks`, `conformance`, plus nested ones like `plugins slots`). Previously these fell through to Clipanion's terse "Multiple commands match" listing. Leaf verbs and unknown names are unchanged.
- Removed seven project-config keys that had no runtime consumer: `i18n.locale`, `providers` (the enabled-list; `activeProvider` stays), `history.share`, the `autoMigrate` config key (the `sm db migrate` / `backup` adapter option is untouched), `plugins.<id>.config`, `plugins.<id>.extensions`, and `scan.followSymlinks` (the walker always hard-skips symlinks). Dropping `plugins.<id>.config` closed the last open subtree, so project-config is now fully `additionalProperties: false`.

### CLI Patch
- `sm plugins create` now scaffolds a plugin that loads. The generated `plugin.json` drops the `id` and root `settings` keys (both rejected by the structure-as-truth `PluginManifest` schema), and the extractor stub declares `ui` instead of the dead `viewContributions` field, with its `settings` co-located per-extension. A freshly scaffolded plugin now passes `sm plugins doctor` and emits its contribution on `sm scan` instead of failing with `invalid-manifest`.
- The active-provider auto-detect line (`Auto-detected activeProvider = ... persisted to settings.json`) no longer interleaves with the scan summary. The bootstrap printed it to stderr while `sm scan` writes its summary to stdout, so on a tty the two streams glued together with no newline between them. The bootstrap now stays silent and the CLI announces the auto-detect on the summary's own stream (stdout for `sm scan`, stderr for `sm init`), in order, on its own line.
- Normalize plugin terminology: "bundle" is no longer used as a synonym for "plugin". The installable unit is now consistently called a "plugin" everywhere (types, identifiers, spec prose, CLI output, and Settings labels); the word "bundle" is reserved exclusively for the aggregate toggle that flips all of a plugin's extensions at once (the "bundle macro"). No behavior or wire-shape changes.
- The release pipeline now uploads CLI source maps to the Sentry Node project (`skill-map-cli`) using debug IDs injected before publish, and the published tarball no longer ships `.map` files when telemetry is configured at build time. A hidden `/intentional-fail` UI route was added as a browser-side Sentry self-test, mirroring the existing `sm intentional-fail` command.

### Spec Minor (0.43.0)
- `sm <namespace> --help` (and `sm help <namespace>`) now render a namespace overview, header, USAGE, an optional DESCRIPTION, and a COMMANDS list of the subcommands, for command prefixes that own subcommands but are not themselves runnable (`plugins`, `db`, `config`, `job`, `actions`, `sidecar`, `hooks`, `conformance`, plus nested ones like `plugins slots`). Previously these fell through to Clipanion's terse "Multiple commands match" listing. Leaf verbs and unknown names are unchanged.
- Removed seven project-config keys that had no runtime consumer: `i18n.locale`, `providers` (the enabled-list; `activeProvider` stays), `history.share`, the `autoMigrate` config key (the `sm db migrate` / `backup` adapter option is untouched), `plugins.<id>.config`, `plugins.<id>.extensions`, and `scan.followSymlinks` (the walker always hard-skips symlinks). Dropping `plugins.<id>.config` closed the last open subtree, so project-config is now fully `additionalProperties: false`.

### Spec Patch (0.43.0)
- Normalize plugin terminology: "bundle" is no longer used as a synonym for "plugin". The installable unit is now consistently called a "plugin" everywhere (types, identifiers, spec prose, CLI output, and Settings labels); the word "bundle" is reserved exclusively for the aggregate toggle that flips all of a plugin's extensions at once (the "bundle macro"). No behavior or wire-shape changes.

</details>

<details>
<summary><b>0.45.1</b> · 2026-05-30</summary>

### CLI Patch
- Use a slash-free Sentry release identifier (`skill-map-cli@<version>` instead of `@skill-map/cli@<version>`). Sentry rejects forward slashes in release names, so the CI sourcemap upload failed the moment it ran; the UI SDK was also tagging events with a bare version that never matched the upload. The CLI SDK release tag, the UI SDK release tag, and the CI upload now use the same slash-free value so events resolve against their sourcemaps.

</details>

<details>
<summary><b>0.45.0</b> · 2026-05-30</summary>

### CLI Minor
- `sm tutorial` now materializes the walkthrough skill into the chosen agent's territory instead of always `.claude/skills/`. Providers declare an optional `scaffold` block (`skillDir` plus display-only `aka` names); the destination comes from `--for <provider>` or a prompt defaulting to Claude. It now also requires an empty cwd, seeding a self-contained scenario the tester can later delete wholesale, so a non-empty directory is refused (exit 2) unless `--force` is passed.

### CLI Patch
- Tidy two run-together lines in `sm init` output: insert a blank line before `Running first scan...` so the scaffolding summary and the first scan are visually separated, and terminate the `Auto-detected activeProvider = ...` line with a newline so it no longer abuts the `First scan: ...` summary.

### Spec Minor (0.42.0)
- `sm tutorial` now materializes the walkthrough skill into the chosen agent's territory instead of always `.claude/skills/`. Providers declare an optional `scaffold` block (`skillDir` plus display-only `aka` names); the destination comes from `--for <provider>` or a prompt defaulting to Claude. It now also requires an empty cwd, seeding a self-contained scenario the tester can later delete wholesale, so a non-empty directory is refused (exit 2) unless `--force` is passed.

</details>

<details>
<summary><b>0.44.0</b> · 2026-05-30</summary>

### CLI Minor
- Reserved-name detection gains a lens scope: when a Provider is the active lens, its `reservedNames` catalog also applies to the `agent-skills` skill nodes its runtime consumes, matched by kind. This activates Google Antigravity's catalog, refreshed from `agy /help` (v1.0.3) and now declared under `skill`, so a `.agents/skills/<name>` skill shadowing a built-in like `/goal` is flagged by `core/name-reserved` under the antigravity lens. Claude is unchanged.
- Add opt-in, anonymous error reporting (Sentry) across the CLI, BFF, and UI, OFF by default. Consent lives in `~/.skill-map/settings.json` (`telemetry.errorsEnabled`), surfaced through `GET/PATCH /api/preferences` and a new Settings Privacy toggle; `SKILL_MAP_TELEMETRY=0` force-disables every surface. A pure, deny-by-default scrubber strips home paths and host identity from every event before it leaves the machine. The normative contract is `spec/telemetry.md`.
- Add opt-in, anonymous usage analytics (PostHog) for the CLI and UI, OFF by default. Three independent toggles in `~/.skill-map/settings.json` (`telemetry.usageCliEnabled`, `usageUiEnabled`, alongside `errorsEnabled`); one shared first-run prompt consents to all and mints an anonymous install id used as the PostHog `distinct_id`, exposed read-only via `GET/PATCH /api/preferences`. `SKILL_MAP_TELEMETRY=0` force-disables every surface. Contract: `spec/telemetry.md`.

### Spec Minor (0.41.0)
- Reserved-name detection gains a lens scope: when a Provider is the active lens, its `reservedNames` catalog also applies to the `agent-skills` skill nodes its runtime consumes, matched by kind. This activates Google Antigravity's catalog, refreshed from `agy /help` (v1.0.3) and now declared under `skill`, so a `.agents/skills/<name>` skill shadowing a built-in like `/goal` is flagged by `core/name-reserved` under the antigravity lens. Claude is unchanged.
- Add opt-in, anonymous error reporting (Sentry) across the CLI, BFF, and UI, OFF by default. Consent lives in `~/.skill-map/settings.json` (`telemetry.errorsEnabled`), surfaced through `GET/PATCH /api/preferences` and a new Settings Privacy toggle; `SKILL_MAP_TELEMETRY=0` force-disables every surface. A pure, deny-by-default scrubber strips home paths and host identity from every event before it leaves the machine. The normative contract is `spec/telemetry.md`.
- Add opt-in, anonymous usage analytics (PostHog) for the CLI and UI, OFF by default. Three independent toggles in `~/.skill-map/settings.json` (`telemetry.usageCliEnabled`, `usageUiEnabled`, alongside `errorsEnabled`); one shared first-run prompt consents to all and mints an anonymous install id used as the PostHog `distinct_id`, exposed read-only via `GET/PATCH /api/preferences`. `SKILL_MAP_TELEMETRY=0` force-disables every surface. Contract: `spec/telemetry.md`.

### Spec Patch (0.41.0)
- Sync the plugin author guide and architecture spec to the structure-as-truth manifest model (`annotation` singular, `ui` view map, on-disk Provider kinds, `precondition` filter, deterministic-only hooks); the guide now delegates instead of duplicating. Fix stale field names and the slot count (14) across architecture.md, db-schema.md and the conformance coverage, and fold the architecture diagram into architecture.md, dropping the generated CLI-reference mirror for `sm help --format md`.

</details>

<details>
<summary><b>0.42.0</b> · 2026-05-28</summary>

### CLI Minor
- Registered Provider set is now the single source of truth for the UI provider surfaces (lens dropdown, topbar chip, per-node chip) and auto-detection; four divergent hardcoded provider lists removed.

### Spec Minor (0.39.0)
- Registered Provider set is now the single source of truth for the UI provider surfaces and active-lens auto-detection; the stale hardcoded provider lists are gone.

</details>

<details>
<summary><b>0.41.0</b> · 2026-05-27</summary>

### CLI Minor
- Hard cap on the number of files `sm scan` / `sm watch` accept after `.skillmapignore` filtering (default 256, override with `--max-nodes <N>`), plus a persistent UI banner past the limit.

### CLI Patch
- Fix `sm -version` / `sm -help` (and single-dash long-form typos) printing the no-project hint outside a project; the parser now surfaces the proper unknown-option diagnostic.
- Internal test coverage for the `--max-nodes` flag and the kind-palette inline search.

### Spec Minor (0.38.0)
- Hard cap on the number of files `sm scan` / `sm watch` accept after ignore filtering (default 256, `--max-nodes <N>` override), with a persistent over-limit UI banner.

</details>

<details>
<summary><b>0.40.1</b> · 2026-05-26</summary>

### CLI Patch
- UI polish across Settings, topbar, list / graph empty states, the Matrix theme, and the list-view column order (pure UI change, carried by the CLI bundle).

</details>

<details>
<summary><b>0.40.0</b> · 2026-05-26</summary>

### CLI Minor
- Decouple built-in extensions from per-extension semver; built-ins inherit the CLI version, stamped by the codegen instead of declared per manifest.
- Eliminate the bundle-level toggle; every plugin extension is now independently toggle-able by its qualified `<bundle>/<ext>` id.
- Aggregate severity counter for cards plus footer-right slot cleanups.
- List view as a first-class surface, with severity icons harmonised across graph and list.

### CLI Patch
- Settings → Changelog tab: cap the rendered list and add a permanent escape hatch to the full history.
- Suppress the per-extension version chip for built-in plugins in Settings → Plugins and `sm plugins show`; external plugins keep showing semver.
- Reserve the `graph.node.alert` slot for special-case signals and define the chip-vs-issue policy; routine findings ship as `card.footer.right` chips only.
- Three findings from a second `sm-tutorial` external-tester session.

### Spec Minor (0.37.0)
- Eliminate the bundle-level toggle; every plugin extension toggles independently by its qualified `<bundle>/<ext>` id.
- Built-in extensions decoupled from per-extension semver (inherit the CLI version, stamped by the codegen).
- Reserve the `graph.node.alert` slot for special-case signals and document the chip-vs-issue policy; routine findings ship as footer chips.
- Three findings from a second `sm-tutorial` external-tester session.

</details>

<details>
<summary><b>0.39.0</b> · 2026-05-25</summary>

### CLI Minor
- Rename `core/field-unknown` to `core/annotation-field-unknown` so it groups with the other sidecar annotation rules; behaviour unchanged.
- Rename 14 built-in extension ids to a consistent `<domain>-<detail>` pattern.
- Honour per-extension toggles inside bundle-granularity plugins end-to-end (flipping an individual extension off now persists and takes effect).

### CLI Patch
- Dev builds suppress the version chip in two decorative surfaces and show a lone `[dev]` marker instead.
- Restore the animated viewport fit on WS-scan topology changes and fix two reconcile correctness gaps it exposed.
- The CLI logger paints each line with the standard glyph + color per level, so warnings stand out from debug lines.
- Three quality-of-life fixes to the `sm serve` SPA plus a plugin-listing order tweak.
- Two bugs surfaced by the `sm-tutorial` external-tester walkthrough.

### Spec Minor (0.36.0)
- Rename `core/field-unknown` to `core/annotation-field-unknown` so it groups with the other sidecar annotation rules; behaviour unchanged.
- Rename 14 built-in extension ids to a consistent `<domain>-<detail>` pattern.
- Honour per-extension toggles inside bundle-granularity plugins end-to-end.

</details>

<details>
<summary><b>0.38.0</b> · 2026-05-24</summary>

### CLI Minor
- Internal: rename the registry's base extension shape from `Extension` to `IExtension` for uniform kernel type naming.

### CLI Patch
- cli-architect review pass on `src/`: mechanical hygiene fixes, no behavioural change.
- End-to-end `nodes[]` filter on the issues query, threaded from SQLite through the BFF route into the UI data-source contract.
- Security hardening pass on `src/` (audit findings H1, H2, M1, M2, L1).

</details>
