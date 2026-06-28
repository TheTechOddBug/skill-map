# Changelog

> Consolidated release history for skill-map, newest first. Each entry lists what shipped in the CLI (`@skill-map/cli`, the `sm` binary you install) and in the spec (`@skill-map/spec`). This file is generated at release time, do not hand-edit it.
>
> Per-package npm changelogs: [`src/CHANGELOG.md`](./src/CHANGELOG.md), [`spec/CHANGELOG.md`](./spec/CHANGELOG.md).
> Forward-looking plan: [`ROADMAP.md`](./ROADMAP.md).

<details open>
<summary><b>0.71.0</b> · 2026-06-28</summary>

### CLI Minor
- The `@<file>` and `/<command>` grammars are consolidated into one vendor-neutral pair of `core` extractors (`core/at-file`, `core/slash-command`), each gated by `precondition.provider` to the lenses whose runtime reads that syntax. Antigravity now draws `@filename` file references (a file-shaped `@path` becomes a path-resolved `references` edge, the file-picker grammar Codex already had); `claude/at-directive` narrows to bare-handle agent mentions.
- The kernel now flags an unclosed backtick in a node body during the scan walk: an opening fenced block (``` or ~~~) that is never closed, or an inline span whose backtick run has no equal-length closer. The verdict is derived from the same code-strip scanner the prose extractors rely on, so it pinpoints the body-syntax defect where a dangling fence swallows the rest of the file and prose extractors stop emitting edges. The warning is persisted and reused across incremental scans.

### CLI Patch
- The shared `@`-token grammar (`kernel/util/at-token.ts`) now recognises a multi-level relative prefix (`@../../x`), not just a single `./` / `../` level. So a file-shaped `@`-reference that climbs more than one directory (in a Claude, Codex, or Antigravity body) resolves to its target instead of being silently dropped.
- The Antigravity `workflow` kind now uses the same amber as Claude's `command` kind, since a workflow is Antigravity's command-equivalent, so node colors read as one cross-provider vocabulary. The `sm tutorial` open-standard destination is relabelled to lead with the standard (`Standard: Agent skills (Google's Antigravity, others)`), and the basic tutorial track is reframed as the Agent Skills open standard, with supporting vendors noted parenthetically rather than fronting the book.

### Spec Minor (0.65.0)
- The kernel now flags an unclosed backtick in a node body during the scan walk: an opening fenced block (``` or ~~~) that is never closed, or an inline span whose backtick run has no equal-length closer. The verdict is derived from the same code-strip scanner the prose extractors rely on, so it pinpoints the body-syntax defect where a dangling fence swallows the rest of the file and prose extractors stop emitting edges. The warning is persisted and reused across incremental scans.

</details>

<details>
<summary><b>0.70.0</b> · 2026-06-27</summary>

### CLI Minor
- Fix the OpenAI Codex connector model, which cloned Claude's grammar and was wrong per the official docs. Under the codex lens, skills are now invoked with `$name` (new `dollar-skill` extractor) not `/name`, `@` is a path-resolved file reference (new `at-file` extractor) not an agent mention, and codex plus the neutral `agent-skills` lens no longer flag skill names as reserved (a `$`-skill cannot shadow a `/` command). Claude and Antigravity are unchanged.
- Lens auto-detection now gives a vendor marker precedence over the open-standard `agent-skills` fallback. The `agent-skills` provider declares `detect.fallback`, so its `.agents/` marker resolves a lens only when no vendor marker is present. A project carrying `.codex/` (or `.agent/workflows/`) alongside the shared `.agents/skills/` home now resolves to that vendor outright instead of prompting `codex` vs `agent-skills`. Several vendor markers together still surface an ambiguous prompt.
- Add an optional `presentation.invocationSigil` to the Provider manifest: the single glyph a lens's runtime uses to invoke a skill (`/` for Claude and Antigravity, `$` for Codex). The BFF projects it into `providerRegistry`, and the link-kind palette now paints the `invokes` edge-kind glyph (and its tooltip example) for the active lens instead of a hardcoded `/`. Lenses with no `/`/`$` invocation channel (`agent-skills`, `markdown`) omit it.

### Spec Minor (0.64.0)
- Fix the OpenAI Codex connector model, which cloned Claude's grammar and was wrong per the official docs. Under the codex lens, skills are now invoked with `$name` (new `dollar-skill` extractor) not `/name`, `@` is a path-resolved file reference (new `at-file` extractor) not an agent mention, and codex plus the neutral `agent-skills` lens no longer flag skill names as reserved (a `$`-skill cannot shadow a `/` command). Claude and Antigravity are unchanged.
- Lens auto-detection now gives a vendor marker precedence over the open-standard `agent-skills` fallback. The `agent-skills` provider declares `detect.fallback`, so its `.agents/` marker resolves a lens only when no vendor marker is present. A project carrying `.codex/` (or `.agent/workflows/`) alongside the shared `.agents/skills/` home now resolves to that vendor outright instead of prompting `codex` vs `agent-skills`. Several vendor markers together still surface an ambiguous prompt.
- Add an optional `presentation.invocationSigil` to the Provider manifest: the single glyph a lens's runtime uses to invoke a skill (`/` for Claude and Antigravity, `$` for Codex). The BFF projects it into `providerRegistry`, and the link-kind palette now paints the `invokes` edge-kind glyph (and its tooltip example) for the active lens instead of a hardcoded `/`. Lenses with no `/`/`$` invocation channel (`agent-skills`, `markdown`) omit it.

</details>

<details>
<summary><b>0.69.0</b> · 2026-06-27</summary>

### CLI Minor
- Split plugin enable (operational) from import trust (security). Enable/disable now persist to the config layers, not the DB; `config_plugins` becomes a per-plugin local trust store. New `sm plugins trust / untrust` verbs, a trust PATCH route, a Settings UI Trust control, and a `pluginTrust.projectEnabled` opt-in grant or revoke consent to run a project-local plugin. It runs only when enabled AND trusted, so disabling one no longer re-reads as untrusted.

### Spec Minor (0.63.0)
- Split plugin enable (operational) from import trust (security). Enable/disable now persist to the config layers, not the DB; `config_plugins` becomes a per-plugin local trust store. New `sm plugins trust / untrust` verbs, a trust PATCH route, a Settings UI Trust control, and a `pluginTrust.projectEnabled` opt-in grant or revoke consent to run a project-local plugin. It runs only when enabled AND trusted, so disabling one no longer re-reads as untrusted.

</details>

<details>
<summary><b>0.68.1</b> · 2026-06-27</summary>

### CLI Patch
- Reworked the `sm tutorial` destination prompt to list providers by vendor name rather than their shared destination folder (several providers share `.agents/skills`), with the open standard shown aka-first. Reorganized the interactive tutorial book: the 'Connect the harness' part is merged into 'The project from zero' so building and wiring the harness is one continuous part, alongside a chapter-by-chapter copy pass across the Claude, Codex and open-standard tracks.

### Spec Patch (0.62.1)
- Reworked the `sm tutorial` destination prompt to list providers by vendor name rather than their shared destination folder (several providers share `.agents/skills`), with the open standard shown aka-first. Reorganized the interactive tutorial book: the 'Connect the harness' part is merged into 'The project from zero' so building and wiring the harness is one continuous part, alongside a chapter-by-chapter copy pass across the Claude, Codex and open-standard tracks.

</details>

<details>
<summary><b>0.68.0</b> · 2026-06-26</summary>

### CLI Minor
- Project-local plugins under `<cwd>/.skill-map/plugins/` are now discovered but their code is NOT imported or executed by the runtime verbs until the operator grants local trust with `sm plugins enable <id>`; the committed `settings.json` cannot grant it, so cloning and scanning a repo no longer auto-runs its plugins. Built-ins and `--plugin-dir` stay exempt. The BFF actions route also rejects a sidecar write whose path escapes the project root (400).
- The `sm tutorial` book now adapts to the active provider lens via two tracks: a rich track (Claude / Codex, with agents, commands, slash and mentions) and a basic track (the open-standard Agent Skills / Antigravity family, skills and markdown wired by markdown references). Scaffolding for the open standard now lays a complete references-based campaign instead of a Claude-shaped book with gaps, and the provider/lens narration was corrected to the current model.

### CLI Patch
- `sm db restore` now validates the source before previewing or swapping: it refuses a non-SQLite file, or a backup written by a newer minor or different major than the running CLI (same version rules `sm scan` applies on open). `--dry-run` and the live swap share one read-only check, so a dry run no longer green-lights a source the restore would reject. Separately, `--max-scan` / `--max-nodes` on `scan` / `serve` / `watch` now reject exponent notation like `1e3`, matching `--port`.
- `<sm-node-card>` and `<sm-kind-palette>` hardcoded per-kind colours in CSS for only the four core kinds, so any Provider-declared kind (e.g. Antigravity's `workflow`) fell back to neutral markdown grey, icon included. The colour now comes from the kind: the node card binds `--accent` / `--kind-bg` / `--kind-fg` from the runtime kind registry's `--sm-kind-<kind>` vars and the palette binds the accent per button, so every Provider-declared kind paints its declared colour with no per-kind CSS.
- Hardened the local server and opt-in telemetry. The BFF Content-Security-Policy now carries `object-src 'none'`, a zero-breakage backstop that blocks plugin-content (`<object>` / `<embed>`) script execution if the markdown sanitizer ever regresses. Separately, the opt-in UI error-telemetry SDK no longer auto-records console, fetch, xhr, or DOM breadcrumbs, which could otherwise carry project paths or request URLs into a report; navigation breadcrumbs stay and are still home-scrubbed.
- Updated every outdated `src/` dependency to its latest exact pin and migrated the code the four major bumps required. The only runtime-touching change is js-yaml 4 to 5: importers switch to named `load`/`dump` with `schema: CORE_SCHEMA`, which emits byte-identical YAML 1.2 so canonical frontmatter and sidecar hashes are unchanged. TypeScript 6, @types/node 26, @hono/node-server and kysely 0.29 needed only build-config and type-cast tweaks. The bumps clear the known CLI-tree advisories.
- Updated UI dependencies to close the advisories from the UI security audit. Angular moves to 21.2.17 (the XSS sanitizer-bypass fixes) and `dompurify` to 3.4.11; a pnpm-workspace override forces `posthog-js`'s bundled `dompurify` to the same 3.4.11 so the shipped bundle no longer carries a vulnerable copy. `@sentry/angular`, `markdown-it`, `posthog-js`, `primeng`, and `vitest` also move to current patches.

### Spec Minor (0.62.0)
- New normative import-trust boundary for project-local plugins: a drop-in plugin under `<cwd>/.skill-map/plugins/` is discovered but its extension code is NOT imported or executed by the runtime verbs until the operator grants local trust via `sm plugins enable <id>`. The committed `settings.json` baseline cannot grant it, so cloning and scanning a repo no longer auto-executes its plugins; built-ins and `--plugin-dir` stay ungated. Defined in architecture.md §Locality.

### Spec Patch (0.62.0)
- Reconciled the exit-codes table in `cli-contract.md`: code `2` no longer claims a missing DB (it covers a present-but-unreadable or corrupt DB), and code `5` now documents an absent project DB file, so a read verb with nothing to open exits `5` (run `sm scan` first). This matches the reference CLI, which ~20 read verbs already honour, and the existing server boot-resilience clause; no behaviour changed.
- The `sm tutorial` book now adapts to the active provider lens via two tracks: a rich track (Claude / Codex, with agents, commands, slash and mentions) and a basic track (the open-standard Agent Skills / Antigravity family, skills and markdown wired by markdown references). Scaffolding for the open standard now lays a complete references-based campaign instead of a Claude-shaped book with gaps, and the provider/lens narration was corrected to the current model.

</details>

<details>
<summary><b>0.67.0</b> · 2026-06-26</summary>

### CLI Minor
- Give the Antigravity provider its own `workflow` kind and promote it to `beta` (enabled by default). Under the antigravity lens, `.agent/workflows/<name>.md` (singular `.agent`) classifies as a `workflow` node (handle = filename) while skills keep the open-standard `.agents/skills/` classifier. The slash extractor now runs under antigravity, so `/name` resolves to both skills and workflows, reserved verbs are flagged on both, and `.agent/workflows/` auto-detects the lens.

### Spec Minor (0.61.0)
- Give the Antigravity provider its own `workflow` kind and promote it to `beta` (enabled by default). Under the antigravity lens, `.agent/workflows/<name>.md` (singular `.agent`) classifies as a `workflow` node (handle = filename) while skills keep the open-standard `.agents/skills/` classifier. The slash extractor now runs under antigravity, so `/name` resolves to both skills and workflows, reserved verbs are flagged on both, and `.agent/workflows/` auto-detects the lens.

</details>

<details>
<summary><b>0.66.0</b> · 2026-06-25</summary>

### CLI Minor
- The lens selector now offers a single open lens, `agent-skills` ("Agent Skills"), promoted to stable and locked and made the universal default for projects with no vendor marker (replacing the old `markdown` default). The non-gated `core/markdown` becomes the invisible base: it still classifies every orphan `.md` but is no longer a selectable lens. A new `isLens` flag drives the dropdown, and `PATCH /api/active-provider` rejects non-lens ids.
- The Codex lens now classifies open-standard Agent Skills (`.agents/skills/<name>/SKILL.md`, the layout OpenAI Codex actually reads) as `codex`/`skill`, by composing the `agent-skills` open-standard pieces over a new multi-rule `read`. A provider's `read` may now be an array of rules so one provider reads several file families with different parsers (Codex reads `.toml` agents and `.md` skills), and a `/skill-name` invocation in an agent prompt resolves to its skill.
- The provider / active-lens labels now follow one consistent naming pattern: vendor lenses use a possessive `<Vendor>'s <product>` form ("Anthropic's Claude", "OpenAI's Codex", "Google's Antigravity") and the vendor-neutral open standard uses a `Standard: <name>` prefix ("Standard: Agent skills"). The non-selectable `core/markdown` base keeps its internal "Markdown" label. The provider schema and kernel JSDoc document the pattern.
- The inspector's Body section gains a Raw / Rendered toggle: a button at the top of the expanded section flips between the rendered Markdown and a read-only source view, line-numbered and syntax-highlighted like a code editor (the markdown body, or a Codex agent's `developer_instructions`). The preference is sticky across nodes within the session. No extra fetch, the raw view reuses the content already loaded for rendering.
- The inspector now renders OpenAI Codex agents (`.codex/agents/*.toml`) like a Markdown node: the TOML `developer_instructions` field becomes the Body section (rendered as Markdown) and the other TOML keys the Definition/metadata card, instead of showing the raw TOML file. A new optional `bodyField` on each `providerRegistry` entry (projected from the provider's `read.bodyField`) drives the split, so it stays provider-driven with no hardcoded provider id.
- The OpenAI Codex provider is now beta (enabled by default): a `.codex/` directory auto-detects the codex lens and `.codex/agents/*.toml` files classify as agents. A Codex agent's prompt (the TOML `developer_instructions` field) flows through the link extractors via the new declarative `read.bodyField` knob, so `@mention` and `[link]` references inside it surface in the graph. `AGENTS.md` is no longer a detection marker (it is the vendor-neutral agents.md standard, common in non-Codex repos).
- Make `name`/`description` per-kind requirements instead of universal ones: the frontmatter base only defines the two fields, and `required` moves to the kinds whose vendor mandates them (Claude agent, Codex agent, Agent Skills skill), leaving the `markdown` fallback and Claude skill/command optional. Per-kind schemas are re-certified against current vendor docs, and the redundant base check in `core/schema-violation` is dropped so each per-kind schema is the single source of truth.
- The OpenAI Codex provider and plugin id was renamed from `openai` to `codex`, aligning the id with its `.codex/` marker and the product-name scheme of the other built-ins. The lens value (`activeProvider`), `node.provider`, the conformance scope (`provider:codex`), and qualified extension ids (`codex/codex`) change accordingly. Breaking but greenfield (no released consumers); the displayed lens label "OpenAI's Codex" is unchanged.

### CLI Patch
- Centralize the `backups` directory segment behind a single kernel primitive (`kernelBackupsDir(dbPath)` plus the `BACKUPS_DIRNAME` literal in `skill-map-paths.ts`, re-exported through `core/paths` and the CLI `db-path` helper). The migrations runner's pre-migrate snapshot path and `sm db backup` now both derive `<dbDir>/backups` from that one source instead of composing the literal by hand. Behaviour is unchanged.

### Spec Minor (0.60.0)
- The lens selector now offers a single open lens, `agent-skills` ("Agent Skills"), promoted to stable and locked and made the universal default for projects with no vendor marker (replacing the old `markdown` default). The non-gated `core/markdown` becomes the invisible base: it still classifies every orphan `.md` but is no longer a selectable lens. A new `isLens` flag drives the dropdown, and `PATCH /api/active-provider` rejects non-lens ids.
- The Codex lens now classifies open-standard Agent Skills (`.agents/skills/<name>/SKILL.md`, the layout OpenAI Codex actually reads) as `codex`/`skill`, by composing the `agent-skills` open-standard pieces over a new multi-rule `read`. A provider's `read` may now be an array of rules so one provider reads several file families with different parsers (Codex reads `.toml` agents and `.md` skills), and a `/skill-name` invocation in an agent prompt resolves to its skill.
- The provider / active-lens labels now follow one consistent naming pattern: vendor lenses use a possessive `<Vendor>'s <product>` form ("Anthropic's Claude", "OpenAI's Codex", "Google's Antigravity") and the vendor-neutral open standard uses a `Standard: <name>` prefix ("Standard: Agent skills"). The non-selectable `core/markdown` base keeps its internal "Markdown" label. The provider schema and kernel JSDoc document the pattern.
- The inspector now renders OpenAI Codex agents (`.codex/agents/*.toml`) like a Markdown node: the TOML `developer_instructions` field becomes the Body section (rendered as Markdown) and the other TOML keys the Definition/metadata card, instead of showing the raw TOML file. A new optional `bodyField` on each `providerRegistry` entry (projected from the provider's `read.bodyField`) drives the split, so it stays provider-driven with no hardcoded provider id.
- The OpenAI Codex provider is now beta (enabled by default): a `.codex/` directory auto-detects the codex lens and `.codex/agents/*.toml` files classify as agents. A Codex agent's prompt (the TOML `developer_instructions` field) flows through the link extractors via the new declarative `read.bodyField` knob, so `@mention` and `[link]` references inside it surface in the graph. `AGENTS.md` is no longer a detection marker (it is the vendor-neutral agents.md standard, common in non-Codex repos).
- Make `name`/`description` per-kind requirements instead of universal ones: the frontmatter base only defines the two fields, and `required` moves to the kinds whose vendor mandates them (Claude agent, Codex agent, Agent Skills skill), leaving the `markdown` fallback and Claude skill/command optional. Per-kind schemas are re-certified against current vendor docs, and the redundant base check in `core/schema-violation` is dropped so each per-kind schema is the single source of truth.
- The OpenAI Codex provider and plugin id was renamed from `openai` to `codex`, aligning the id with its `.codex/` marker and the product-name scheme of the other built-ins. The lens value (`activeProvider`), `node.provider`, the conformance scope (`provider:codex`), and qualified extension ids (`codex/codex`) change accordingly. Breaking but greenfield (no released consumers); the displayed lens label "OpenAI's Codex" is unchanged.

</details>

<details>
<summary><b>0.65.0</b> · 2026-06-25</summary>

### CLI Minor
- The vendor-neutral open-skills Provider (`agent-skills`, lens "Open Skills") gains an open-standard base reserved-name catalog under `skill`: a user skill shadowing a universal built-in like `help`/`config` is now flagged by `core/name-reserved`, and Antigravity inherits the base by manifest composition and appends its own verbs. Its `skill` frontmatter schema now enforces the open-standard `name` pattern/length and `description` length. Shared primitives renamed to a `COMMONS_*` vocabulary.

### Spec Minor (0.59.0)
- The vendor-neutral open-skills Provider (`agent-skills`, lens "Open Skills") gains an open-standard base reserved-name catalog under `skill`: a user skill shadowing a universal built-in like `help`/`config` is now flagged by `core/name-reserved`, and Antigravity inherits the base by manifest composition and appends its own verbs. Its `skill` frontmatter schema now enforces the open-standard `name` pattern/length and `description` length. Shared primitives renamed to a `COMMONS_*` vocabulary.

</details>

<details>
<summary><b>0.64.1</b> · 2026-06-25</summary>

### CLI Patch
- Patch release of `@skill-map/cli` with no functional change, used to exercise the changesets version-packages PR and the end-to-end release pipeline.

</details>

<details>
<summary><b>0.64.0</b> · 2026-06-25</summary>

### CLI Minor
- Bare `sm` in an empty folder now offers a getting-started menu: on an interactive terminal it asks whether to run the guided tutorial (`sm tutorial`) or drop a ready-to-explore example project (`sm example`), then dispatches the chosen verb. In a non-empty folder, or on a non-interactive stdin, it still prints a one-line hint and exits 2, now pointing at `sm tutorial` / `sm example` when the folder is empty and at `sm init` otherwise.
- New `sm example` verb: drops a ready-to-explore example project (the same wired harness the public demo renders) into an empty directory, so a new user can run `sm scan` then `sm serve` against a real connected graph without authoring files first. The payload is the single canonical `fixtures/demo-scope/` fixture, shared with the web demo, and ships unscanned (no `.skill-map/`). Refuses a non-empty cwd unless `--force`.

### Spec Minor (0.58.0)
- Bare `sm` in an empty folder now offers a getting-started menu: on an interactive terminal it asks whether to run the guided tutorial (`sm tutorial`) or drop a ready-to-explore example project (`sm example`), then dispatches the chosen verb. In a non-empty folder, or on a non-interactive stdin, it still prints a one-line hint and exits 2, now pointing at `sm tutorial` / `sm example` when the folder is empty and at `sm init` otherwise.
- New `sm example` verb: drops a ready-to-explore example project (the same wired harness the public demo renders) into an empty directory, so a new user can run `sm scan` then `sm serve` against a real connected graph without authoring files first. The payload is the single canonical `fixtures/demo-scope/` fixture, shared with the web demo, and ships unscanned (no `.skill-map/`). Refuses a non-empty cwd unless `--force`.

</details>

<details>
<summary><b>0.63.0</b> · 2026-06-24</summary>

### CLI Minor
- The active provider lens no longer has an unlensed (permissive) state. A project with no marker now resolves to the universal `markdown` lens (never null, never persisted, so a later vendor marker still auto-detects) instead of running every provider at once. The Settings dropdown drops the dead `(none)` entry and keeps Markdown as a selectable neutral lens, and `sm serve` now re-scans under the chosen lens after a switch instead of re-detecting it from disk.
- Removed the `comingSoon` provider flag: not-ready providers use `stability: 'experimental'`, shipping disabled by default (not classified, auto-detected, or selectable until enabled). `openai`, `antigravity`, `agent-skills` are experimental; `agent-skills` is gated to its own lens (only `core/markdown` stays universal). Antigravity reuses the agent-skills classifier, dropping the kernel's cross-provider reservedNames lens-scope. `sm tutorial --experimental` offers them as destinations.

### Spec Minor (0.57.0)
- The active provider lens no longer has an unlensed (permissive) state. A project with no marker now resolves to the universal `markdown` lens (never null, never persisted, so a later vendor marker still auto-detects) instead of running every provider at once. The Settings dropdown drops the dead `(none)` entry and keeps Markdown as a selectable neutral lens, and `sm serve` now re-scans under the chosen lens after a switch instead of re-detecting it from disk.
- Removed the `comingSoon` provider flag: not-ready providers use `stability: 'experimental'`, shipping disabled by default (not classified, auto-detected, or selectable until enabled). `openai`, `antigravity`, `agent-skills` are experimental; `agent-skills` is gated to its own lens (only `core/markdown` stays universal). Antigravity reuses the agent-skills classifier, dropping the kernel's cross-provider reservedNames lens-scope. `sm tutorial --experimental` offers them as destinations.

</details>

<details>
<summary><b>0.62.2</b> · 2026-06-23</summary>

### CLI Patch
- The `/api/branch` map projection now keeps an edge when its RESOLVED target is a rendered node, not only when the raw authored target is. Trigger-style `invokes` / `mentions` links store the trigger (`/cmd`, `@agent`) in `target` and the real node path in `resolvedTarget`; the old filter matched the raw target alone, so every resolved trigger edge was dropped from the graph and the map showed only path-style `references`. Genuinely-broken links (no resolved node) stay excluded.

### Spec Patch (0.56.1)
- The `/api/branch` map projection now keeps an edge when its RESOLVED target is a rendered node, not only when the raw authored target is. Trigger-style `invokes` / `mentions` links store the trigger (`/cmd`, `@agent`) in `target` and the real node path in `resolvedTarget`; the old filter matched the raw target alone, so every resolved trigger edge was dropped from the graph and the map showed only path-style `references`. Genuinely-broken links (no resolved node) stay excluded.

</details>

<details>
<summary><b>0.62.1</b> · 2026-06-23</summary>

### CLI Patch
- Audit pass over the bundled `sm tutorial` content: fixed a broken `sm plugins create extractor demo-highlight` command, corrected a contribution that was silently dropped by emit-time slot validation, refreshed the stale `sm plugins doctor` count and UI references, trimmed two redundant chapters from the Extend track, and aligned the chapter-count test with the trim.

</details>

<details>
<summary><b>0.62.0</b> · 2026-06-23</summary>

### CLI Minor
- Splits the scan cap into two knobs: `scan.maxScan` (corpus ceiling, default 50000) bounds what the walk parses and reference-validates, while `scan.maxNodes` (default 256) now caps only the graph render. References resolve across the whole corpus, so large repos no longer flag links to unrendered files as broken. Adds the `--max-scan` flag and the `/api/folders`, `/api/branch`, and `/api/scan?meta=1` endpoints that back the lazy folders tree and branch-scoped map.

### CLI Patch
- Restores the files rail's per-row stale-clock icon, dropped when the rail switched to building from the lightweight `GET /api/folders` payload (which carried the error / warn counts but not the sidecar drift status). The endpoint now emits a `sidecarStatus` field (the persisted `scan_nodes.sidecar_status`, `null` when there is no parseable sidecar), threaded from the kernel loader through the BFF into the rail so staleness flags corpus-wide in demo and `sm serve` mode.
- Incremental scans now skip unchanged files. The full-walk path (`sm scan --changed`, boot scan, fallback) reads and YAML-parses only files whose on-disk mtime differs from the prior snapshot, reusing the cached node otherwise. The watcher path (`sm serve` / `sm watch`) threads chokidar's exact changed-path set through the scan, enumerating the corpus from the prior snapshot and reading only the touched files instead of re-walking the tree. Results stay byte-identical to a full scan.
- Body extractors now strip raw HTML (comments and tag tokens) before matching, alongside the existing code-region strip. A markdown link commented out as `<!-- [x](old.md) -->` or hidden in an attribute value (`<img alt="[x](y.md)">`) no longer produces a phantom edge. The strip is bounded to comments and tag tokens, so markdown nested inside a `<div>` block still resolves; `core/backtick-path` is unaffected (HTML is not a code region).

### Spec Minor (0.56.0)
- Splits the scan cap into two knobs: `scan.maxScan` (corpus ceiling, default 50000) bounds what the walk parses and reference-validates, while `scan.maxNodes` (default 256) now caps only the graph render. References resolve across the whole corpus, so large repos no longer flag links to unrendered files as broken. Adds the `--max-scan` flag and the `/api/folders`, `/api/branch`, and `/api/scan?meta=1` endpoints that back the lazy folders tree and branch-scoped map.

### Spec Patch (0.56.0)
- Restores the files rail's per-row stale-clock icon, dropped when the rail switched to building from the lightweight `GET /api/folders` payload (which carried the error / warn counts but not the sidecar drift status). The endpoint now emits a `sidecarStatus` field (the persisted `scan_nodes.sidecar_status`, `null` when there is no parseable sidecar), threaded from the kernel loader through the BFF into the rail so staleness flags corpus-wide in demo and `sm serve` mode.
- Body extractors now strip raw HTML (comments and tag tokens) before matching, alongside the existing code-region strip. A markdown link commented out as `<!-- [x](old.md) -->` or hidden in an attribute value (`<img alt="[x](y.md)">`) no longer produces a phantom edge. The strip is bounded to comments and tag tokens, so markdown nested inside a `<div>` block still resolves; `core/backtick-path` is unaffected (HTML is not a code region).

</details>

<details>
<summary><b>0.61.5</b> · 2026-06-21</summary>

### CLI Patch
- Tutorial and inspector polish. The bundled `sm-tutorial` daily-loop part merges the styling and preview chapters into one, serves the site from a third terminal, clarifies the frontmatter rename, reframes the publish confirmation, invites the tester to keep building, and adds a confidence note; the `content-editor` agent uses a free image placeholder. The inspector's tag row gains a `TAGS:` title so a node with no tags no longer shows a lone pencil.

</details>

<details>
<summary><b>0.61.4</b> · 2026-06-21</summary>

### CLI Patch
- `sm tutorial` now lists coming-soon providers in its destination prompt instead of offering them as real targets. Claude is the only selectable destination; OpenAI Codex, Antigravity, and Open Skills appear greyed as "(coming soon)" and re-ask the tester if picked. The prompt still renders on a TTY even with a single selectable target (so the others stay visible), non-TTY stdin takes Claude silently, and `--for <coming-soon-id>` exits with an unknown-provider error.

</details>

<details>
<summary><b>0.61.3</b> · 2026-06-21</summary>

### CLI Patch
- Add a `comingSoon` flag to a Provider's `presentation` (spec + kernel). A coming-soon Provider ships in the registry (node chips still render) but is never selectable as the active lens: auto-detect skips its markers, the BFF drops it from `GET /api/active-provider`'s `selectable` set, and the UI greys it with a `(coming soon)` suffix. `openai`, `antigravity`, and `agent-skills` are marked coming-soon, so only `claude` is selectable today.

### Spec Patch (0.55.1)
- Add a `comingSoon` flag to a Provider's `presentation` (spec + kernel). A coming-soon Provider ships in the registry (node chips still render) but is never selectable as the active lens: auto-detect skips its markers, the BFF drops it from `GET /api/active-provider`'s `selectable` set, and the UI greys it with a `(coming soon)` suffix. `openai`, `antigravity`, and `agent-skills` are marked coming-soon, so only `claude` is selectable today.

</details>

<details>
<summary><b>0.61.2</b> · 2026-06-21</summary>

### CLI Patch
- The bundled `sm-tutorial` skill now demos the `claude` provider only; the other providers (`openai`/Codex, `agent-skills`/Antigravity) are presented as "coming soon". Provider detection always resolves to `claude`, the settings lens step drops the live switch to `openai` and shows only the auto-detected `claude` lens, and the project-kickoff markers prompt tells the tester the other lenses are coming soon. The `--provider` fixture plumbing stays wired so they drop in later.

</details>

<details>
<summary><b>0.61.1</b> · 2026-06-19</summary>

### CLI Patch
- Restructure the bundled `sm-tutorial` daily-loop part toward a UI-first walkthrough: split bringing the site up into a new `preview` chapter (with an express-missing recovery note), drop the orphan-draft / wire-and-improve arc, and rework `broken-ref`, `reserved`, and the renamed `stability` chapter to watch results on the live Map instead of running `sm scan` / `sm check`. Also hardens the publish frontmatter paste guidance and clarifies auto-advance still announces every chapter's number.
- Iterative polish of the bundled `sm-tutorial` skill, found while test-walking it: clearer prologue narration (floating "nodes" not "dots", broken reference reworded off the "bare mention" jargon, fixed edit attribution, stale inspector and Beat-marker notes dropped), a pre-flight HARD STOP so the two-terminals confirmation lands before the menu, a new `edit-link` beat where the tester adds `.md` to resolve the broken reference, an always-reseed fix, and less frontmatter noise on the fixture.

</details>

<details>
<summary><b>0.61.0</b> · 2026-06-18</summary>

### CLI Minor
- `sm version` no longer prints the `kernel` row, and `sm version --json` drops the `kernel` field: the matrix is now `{ sm, spec, dbSchema }`. The CLI and kernel ship in one package and always carried the identical number, so the second row was redundant noise rather than information; the row returns the day the kernel publishes as its own package. Pre-1.0 breaking change shipped as a minor per the versioning policy.

### CLI Patch
- Refactor the bundled `sm-tutorial` skill so fixture-file generation and progress tracking run as two zero-dependency Node scripts inside the skill (`scripts/state.js`, `scripts/fixtures.js`) reading a single `fixtures-data/` source of truth, instead of the agent reproducing fixture content verbatim and hand-editing a YAML state file each chapter. State moves to `tutorial-state.json` fed by a generated `references/_manifest.json` sidecar; tester-facing narration is unchanged.

### Spec Minor (0.55.0)
- `sm version` no longer prints the `kernel` row, and `sm version --json` drops the `kernel` field: the matrix is now `{ sm, spec, dbSchema }`. The CLI and kernel ship in one package and always carried the identical number, so the second row was redundant noise rather than information; the row returns the day the kernel publishes as its own package. Pre-1.0 breaking change shipped as a minor per the versioning policy.

</details>

<details>
<summary><b>0.60.4</b> · 2026-06-18</summary>

### CLI Patch
- Two sm-tutorial fixes from tester feedback: the first-agent chapter no longer repeats its framing (the redundant `Context` field is dropped, so the tester sees the agent-created message once instead of twice), and the scaffolded `.skillmapignore` guidance now guards against broadening the ignore to the whole `.claude/`, which would hide the harness agents and commands the tester builds.

</details>

<details>
<summary><b>0.60.3</b> · 2026-06-18</summary>

### CLI Patch
- The web demo now ships the view-contribution registry, so the node card footer slot icons (tools, links, external refs, issue counts) render in demo mode instead of a bare value with no glyph. The static data source primes it from the bundled meta like the live BFF path does, and the demo build derives it from the kernel. Also reverts the earlier folder/dark-theme icon swap back to Font Awesome (a misdiagnosis: the demo fonts load fine).
- The workspace search now narrows the map by default, not just the files rail: a query filters both surfaces so it focuses the whole workspace at once. The prior default (map keeps its full layout while only the rail narrows) moves behind the rail's search-to-map toggle and the persisted `sm.workspace.search-affects-map` preference (an absent key now reads as on). Tutorial references updated to match.

</details>

<details>
<summary><b>0.60.2</b> · 2026-06-17</summary>

### CLI Patch
- The map card's file-path folder icon and the dark-theme toggle icon switched from Font Awesome's regular weight (`fa-regular`) to the matching PrimeIcons glyphs (`pi-folder-open`, `pi-moon`). These were the only two first-party icons relying on the `fa-regular` webfont, which is not reliably served on the public demo deploy, so they rendered blank there; PrimeIcons is already the icon set the surrounding controls use, so the icons now render consistently. Icon meaning is unchanged.

</details>

<details>
<summary><b>0.60.1</b> · 2026-06-17</summary>

### CLI Patch
- The graph map's camera behaviour changes on two interactions. Clicking a tag chip on a card now curates the map in place without panning or zooming, so the operator stays on the card they clicked. The explicit re-arrange and fit-to-screen buttons now glide the camera to the new framing instead of snapping, matching the automatic auto-fit that already animated on scan add / remove. Which nodes get framed is unchanged.

</details>

<details>
<summary><b>0.60.0</b> · 2026-06-17</summary>

### CLI Minor
- New committed project setting `allowSidecarWriters` (default `true`) lets shared projects forbid every extension that writes `.sm` annotation sidecars. Actions declare the capability via `writes: ['sidecar']` on their manifest; when the policy is `false` the scan composer drops those actions (buttons never render) and the sidecar store refuses the write (BFF 403 `sidecar-writers-forbidden`), a hard gate that wins over the per-machine `allowEditSmFiles` consent.
- The inspector tag row (`<sm-node-tags>`) is now an inline editor: `core/node-set-tags` no longer self-projects an `inspector.action.button`; a pencil opens an add / remove editor (shown even with no tags) that offers the tags already present in the graph as click-to-add chips, derived live from the loaded scan; typing a brand-new tag still works. The author guide's self-projection example switched from Edit tags to Set stability.

### CLI Patch
- Fix the `--analyzers` (CLI) and `?analyzerId=` (BFF) filter so a qualified `<plugin>/<id>` form matches the persisted short analyzer id (issues store the short kebab id with no slash, per `issue.schema.json`). Before, only a short filter matched, so `sm check --analyzers core/node-stability` returned nothing while the bare `node-stability` worked. Both `matchesAnalyzerFilter` and the `/api/issues` SQL now reduce a qualified filter entry to its suffix; the short form is unchanged.
- Fix a stale doc comment in the `annotation-orphan` analyzer: the header claimed `nodeIds` is empty, but the analyzer sets it to the orphan's would-be `.md` path (the missing sibling, to satisfy the issue schema's `minItems: 1`). Comment-only; no behavior change.
- Sanitize the tags written by the `core/node-set-tags` action: it now keeps strings only, trims them, drops empty entries (the `annotations.tags` schema requires non-empty items), and dedups, instead of writing the free-form input verbatim. Prevents the Edit tags flow from producing a schema-violating or messy sidecar.
- The `node-stability` experimental / deprecated card-footer chips were being suppressed: `card.footer.right` is a counter slot that treats `value: 0` as empty, and the contributions set `emitWhenEmpty: false`, so the badges never rendered. They now emit-when-empty and show again as icon-only badges (the `fa-flask` / `pi-ban` icon carries the meaning, value is always 0).

### Spec Minor (0.54.0)
- New committed project setting `allowSidecarWriters` (default `true`) lets shared projects forbid every extension that writes `.sm` annotation sidecars. Actions declare the capability via `writes: ['sidecar']` on their manifest; when the policy is `false` the scan composer drops those actions (buttons never render) and the sidecar store refuses the write (BFF 403 `sidecar-writers-forbidden`), a hard gate that wins over the per-machine `allowEditSmFiles` consent.

### Spec Patch (0.54.0)
- The inspector tag row (`<sm-node-tags>`) is now an inline editor: `core/node-set-tags` no longer self-projects an `inspector.action.button`; a pencil opens an add / remove editor (shown even with no tags) that offers the tags already present in the graph as click-to-add chips, derived live from the loaded scan; typing a brand-new tag still works. The author guide's self-projection example switched from Edit tags to Set stability.
- Add a standalone plugin quickstart doc (a short scaffold then fill then run path with the plugin-lifecycle diagram and links into the full author guide), indexed in the spec README and published in the package. The now-redundant Quick start section was removed from the author guide and its unique co-located-files note (text.ts, the colocated test) folded into the Manifest section as a "Files by convention" paragraph.
- Editorial pass tightening the spec prose docs for concision (lossless, no normative change: no schema, field, enum, exit code, or MUST/SHOULD touched, and the verbatim prompt preamble still matches the conformance fixture), plus a new non-normative "Plugin lifecycle at a glance" overview atop the plugin author guide with an ASCII diagram of the deterministic flow (Provider, Extractor, Analyzer, Action, Formatter) and Hook off to the side, each with a one-line purpose and short example.

</details>

<details>
<summary><b>0.59.0</b> · 2026-06-16</summary>

### CLI Minor
- Ship the `core/node-bump` action and the `core/annotation-stale` analyzer as `experimental`, so the sidecar bump/drift surface is disabled by default (Decision #128). Gated as a unit: with the action disabled no Bump button projects, and with the drift analyzer disabled no stale finding fires. The `sidecar-end-to-end` conformance case drops its `annotation-stale` assertion accordingly (a default scan now surfaces only `annotation-orphan`; the node still carries the derived `sidecar.status`).

### CLI Patch
- Remove a dead per-node aggregation loop from the `annotation-field-unknown` analyzer: it counted offending keys per node for a card chip that was already retired, then discarded the result via `void`. No behavior change; the emitted findings are unchanged.

### Spec Minor (0.53.0)
- Ship the `core/node-bump` action and the `core/annotation-stale` analyzer as `experimental`, so the sidecar bump/drift surface is disabled by default (Decision #128). Gated as a unit: with the action disabled no Bump button projects, and with the drift analyzer disabled no stale finding fires. The `sidecar-end-to-end` conformance case drops its `annotation-stale` assertion accordingly (a default scan now surfaces only `annotation-orphan`; the node still carries the derived `sidecar.status`).

</details>

<details>
<summary><b>0.58.0</b> · 2026-06-16</summary>

### CLI Minor
- Move the inspector Set stability button to the `core/node-set-stability` action's scan-time `project()`. The button now tracks the action's enabled state (a disabled action projects no button) instead of the `core/node-stability` analyzer emitting it unconditionally. The analyzer also stops raising an `info` for `experimental` nodes (only `deprecated` still raises a finding, experimental stays a chip) and ships a clearer plugins-list description.
- Remove the `supersede` feature end to end. The `supersedes` link kind is dropped from the global link-kind enum, the `annotations.supersedes` and `supersededBy` sidecar fields are removed from the spec, and the three built-ins that powered it (the `core/annotations` extractor, the `core/node-supersede` action, the `core/node-superseded` analyzer) are deleted. Scans no longer produce supersede links, and the inspector drops the Supersede button and the superseded-by banner.
- The inspector sidecar action buttons (Set stability, Edit tags, Bump) now project on every real (non-virtual) node, not only nodes that already have a `.sm` sidecar. The write creates the sidecar when absent (gated by the write-consent flow), so a node can get its first annotation straight from the inspector. Bump is enabled on a node with no sidecar (it creates one) or a stale sidecar, and disabled only on a fresh one. Synthetic nodes stay excluded since there is no file to anchor a `.sm`.

### Spec Minor (0.52.0)
- Remove the `supersede` feature end to end. The `supersedes` link kind is dropped from the global link-kind enum, the `annotations.supersedes` and `supersededBy` sidecar fields are removed from the spec, and the three built-ins that powered it (the `core/annotations` extractor, the `core/node-supersede` action, the `core/node-superseded` analyzer) are deleted. Scans no longer produce supersede links, and the inspector drops the Supersede button and the superseded-by banner.

</details>

<details>
<summary><b>0.57.0</b> · 2026-06-15</summary>

### CLI Minor
- Normalize every built-in analyzer finding into one canonical message shape via the shared `formatFinding` helper: an optional backtick-quoted subject line, then `L<line>: <what>; <why>` (the `L<line>:` prefix only when the finding maps to body line(s)). Remediation advice moves out of `message` into `Issue.fix.summary`. `issue.schema.json` documents the grammar as normative; all 14 message-emitting analyzers were migrated, so `sm check` and the UI Inspector read consistently.
- Fix two built-in finding messages that drifted from the canonical `<what>; <why>` shape: `core/name-reserved` said "Name collision" (clashing with the separate `core/name-collision` rule) and now reads "Reserved name"; `core/job-file-orphan` now names the orphan file as the finding subject, matching `core/annotation-orphan`. A new format-consistency test pins every analyzer body to the grammar so messages stay uniform.
- Redesign the link-confidence scoring model: the kernel seeds a 1.0 baseline on every link (the per-extractor emit floor is dropped) and the score-phase detectors subtract a fixed penalty on top, so `core/name-reserved` lands a reserved link at 0.1 and `core/reference-broken` a broken one at 0.5, while disabling a detector leaves its link at 1.0. The built-in `core/score-resolution` analyzer is deleted (its 1.0 is now the baseline), so a clean resolved link records no `scan_link_scores` row.
- Add a `fix.summary` remediation hint to the `core/reference-broken` error finding: fix the path or name, remove the broken link, or add the file's folder under "Folders for link validation" (the `scan.referencePaths` escape hatch, which clears path-style breaks only). Detection and `error` severity are unchanged.
- Reword the `core/reference-redundant` finding to be kind-agnostic: it no longer says "Duplicate reference" (the redundancy can span different link kinds, e.g. `invokes` plus `references` to one node), and the remediation moves out of the message into `fix.summary`. The hint now reads as optional, the rule is `info` and keeping multiple forms can be deliberate.
- Remove the `core/job-file-orphan` analyzer, which flagged `*.md` files under `.skill-map/jobs/` that no job row referenced. The scan-time plumbing that fed it (`IAnalyzerContext.orphanJobFiles`, `RunScanOptions.orphanJobFiles`, scan-runner computation) is removed too, so no dead context survives. The `findOrphanJobFiles` helper and the `sm job prune --orphan-files` verb stay. The analyzer returns later under a probabilistic evaluation model.
- Rename the built-in analyzer `core/link-conflict` to `core/link-kind-conflict`. The rule flags two detectors emitting different `kind` values for the same `(source, target)` pair, so the id now names what it actually checks (a kind disagreement). Folder, id, texts, spec, and tests were renamed together, no compatibility alias. The rule also gains a `fix.summary` remediation hint (drop one conflicting source, or ignore the overlap deliberately).
- Rename `core/signal-collision` to `core/extractor-collision` (the rule surfaces two extractors colliding over the same span of text; "Signal" was internal IR jargon) and drop the dead `extractorDisabled` / `belowFloor` rejection stubs from the resolver schema, the `ISignalResolution` type, and the analyzer. The finding now carries the canonical `L<line>:` prefix and a `fix.summary` hint (rephrase one token, or accept the winner).
- Rename `core/trigger-collision` to `core/name-collision` and key it on the resolution identifier instead of the slashed trigger. It fires (`error`) when two or more name-resolvable nodes (kinds whose `identifiers` include `frontmatter.name`) declare the same normalised `name`. The subject is the bare name (the old `/` sigil was wrong for agents), and case / separator invocation variants no longer false-positive.
- `core/schema-violation` no longer re-warns a node whose frontmatter the kernel already flagged. Its universal base-field check (missing `name` / `description`) reads `accumulatedIssues` and stays silent when a `frontmatter-invalid`, `frontmatter-malformed`, or `frontmatter-parse-error` already covers the node, so a single bad frontmatter surfaces one warning instead of two. The check still fires when the kernel said nothing (dispatch never reached the per-kind validator).
- Make the link-confidence scoring mechanism spec-official. `analyzer.schema.json` gains a `phase` enum so external analyzers can declare `phase: 'score'` and adjust link confidence via `ctx.adjustConfidence(link, op)` (op kinds `set` / `delta` / `ceil` / `floor`), folded deterministically and clamped to [0,1] before the read-only phases. The spec now documents the phase, the fold, and the `scan_link_scores` attribution table, with a `score-phase-confidence` conformance case locking it.
- The `/ws` server now pings every client every 30s so idle connections survive intermediary proxies and half-open peers get terminated, and the SPA's WebSocket client resets its reconnect backoff only after a connection stays open long enough to be stable. Together these stop a flapping connection from looping at 1s and re-seeding `GET /api/scan` in a tight poll storm; an unrecoverable drop now escalates to the non-fatal 'connection lost' state.
- Stop the reconnect re-seed storm when the server flaps. The SPA re-seeds (`GET /api/scan` plus the cascading node / issue fetches) only after the WebSocket RE-STABILISES, not on every raw `open`. A flapping connection (a `--watch` BFF restarting, a rolling deploy) opens then drops within the stability window, so re-seeding on each open hammered the read endpoints with `ECONNREFUSED`; gating on a new `stableConnected` signal fires at most one re-seed per recovered connection.

### Spec Minor (0.51.0)
- Normalize every built-in analyzer finding into one canonical message shape via the shared `formatFinding` helper: an optional backtick-quoted subject line, then `L<line>: <what>; <why>` (the `L<line>:` prefix only when the finding maps to body line(s)). Remediation advice moves out of `message` into `Issue.fix.summary`. `issue.schema.json` documents the grammar as normative; all 14 message-emitting analyzers were migrated, so `sm check` and the UI Inspector read consistently.
- Redesign the link-confidence scoring model: the kernel seeds a 1.0 baseline on every link (the per-extractor emit floor is dropped) and the score-phase detectors subtract a fixed penalty on top, so `core/name-reserved` lands a reserved link at 0.1 and `core/reference-broken` a broken one at 0.5, while disabling a detector leaves its link at 1.0. The built-in `core/score-resolution` analyzer is deleted (its 1.0 is now the baseline), so a clean resolved link records no `scan_link_scores` row.
- Rename the built-in analyzer `core/link-conflict` to `core/link-kind-conflict`. The rule flags two detectors emitting different `kind` values for the same `(source, target)` pair, so the id now names what it actually checks (a kind disagreement). Folder, id, texts, spec, and tests were renamed together, no compatibility alias. The rule also gains a `fix.summary` remediation hint (drop one conflicting source, or ignore the overlap deliberately).
- Rename `core/signal-collision` to `core/extractor-collision` (the rule surfaces two extractors colliding over the same span of text; "Signal" was internal IR jargon) and drop the dead `extractorDisabled` / `belowFloor` rejection stubs from the resolver schema, the `ISignalResolution` type, and the analyzer. The finding now carries the canonical `L<line>:` prefix and a `fix.summary` hint (rephrase one token, or accept the winner).
- Rename `core/trigger-collision` to `core/name-collision` and key it on the resolution identifier instead of the slashed trigger. It fires (`error`) when two or more name-resolvable nodes (kinds whose `identifiers` include `frontmatter.name`) declare the same normalised `name`. The subject is the bare name (the old `/` sigil was wrong for agents), and case / separator invocation variants no longer false-positive.
- Make the link-confidence scoring mechanism spec-official. `analyzer.schema.json` gains a `phase` enum so external analyzers can declare `phase: 'score'` and adjust link confidence via `ctx.adjustConfidence(link, op)` (op kinds `set` / `delta` / `ceil` / `floor`), folded deterministically and clamped to [0,1] before the read-only phases. The spec now documents the phase, the fold, and the `scan_link_scores` attribution table, with a `score-phase-confidence` conformance case locking it.
- The `/ws` server now pings every client every 30s so idle connections survive intermediary proxies and half-open peers get terminated, and the SPA's WebSocket client resets its reconnect backoff only after a connection stays open long enough to be stable. Together these stop a flapping connection from looping at 1s and re-seeding `GET /api/scan` in a tight poll storm; an unrecoverable drop now escalates to the non-fatal 'connection lost' state.

</details>

<details>
<summary><b>0.56.0</b> · 2026-06-14</summary>

### CLI Minor
- Plugin extensions declare operator-configurable `settings` in their manifest, read at scan time via `ctx.settings` and resolved through the config layers under `plugins.<id>.extensions.<extId>.settings`. The `sm plugins config <plugin>/<ext>` verb, `GET`/`PATCH /api/plugins`, and per-plugin sections in Settings all read and write them; `secret` values route to the gitignored project-local file (no encryption). Adds a `number` (decimal) input-type to the catalog.

### CLI Patch
- Reserve the claude built-in slash names under `skill` as well as `command`. The two kinds share the `/` invocation namespace (`invokes: ['command','skill']`), so a built-in like `/help` shadows a user skill named `help` just as it shadows a command; the list is extracted to a shared `RESERVED_SLASH_NAMES` const. The `core/name-reserved` warnings are reworded around "Name collision: ..." so the operator reads what happened instead of internal shadowing terms.
- Consolidate link-target resolution onto the kernel's authoritative `link.resolvedTarget` (stamped by the post-walk lift). `core/link-counter` now tallies footer chips by that field and shares a single `isSelfLoop` helper with `core/link-self-loop`, and the graph view reads `resolvedTarget` instead of recomputing its own name index. The duplicate kernel and UI resolvers are gone, so footer chip counts, drawn graph edges, and the incoming panel can no longer disagree.
- Remove the dead `data.selfLoop: true` flag from `core/link-self-loop` issues. No consumer ever read it: the graph view recomputes the `source === resolvedTarget` predicate independently in its render-pipeline mirror, so the flag (and its "authoritative detector" doc claim) was vestigial. The doc comment now states the rule reports and the layout draws as deliberately independent paths, and the two obsolete `data.selfLoop` test assertions are dropped.
- Fix `core/link-conflict` embedding two literal NUL bytes (0x00) as the `(source, target)` group-key separator: git treated the file as binary so its diffs were hidden in review and grep skipped it. The separator is now a plain JS unicode escape (still NUL at runtime, identical behavior) and the hardcoded `pluginId: 'core'` reads the shared `CORE_PLUGIN_ID` const like the other core analyzers.
- Make `core/reference-broken` a pure projector of the kernel's broken-link verdict. The post-walk lift now computes the genuinely-broken set (the kind-agnostic "the name exists nowhere" notion of `spec/architecture.md` §Provider · resolution rules) and threads it via `IAnalyzerContext.brokenLinks`. The rule projects that set instead of re-deriving a frontmatter-name-only index that false-flagged links resolving via a filename / dirname identifier; `core/name-reserved` reads `link.resolvedTarget`.
- Consolidate `core/reference-redundant` onto the kernel's `link.resolvedTarget` (stamped by the post-walk lift) instead of rebuilding its own name index, deleting the duplicated `buildNameIndex` / `collectIdentifiers` / `resolveTargetPath` machinery. Grouping now tracks the resolved graph; a trigger that matches a name but fails the strict kind matrix is no longer grouped as redundant (that mismatch is `core/link-conflict`'s concern). The three documented redundancy cases are preserved.

### Spec Minor (0.50.0)
- Plugin extensions declare operator-configurable `settings` in their manifest, read at scan time via `ctx.settings` and resolved through the config layers under `plugins.<id>.extensions.<extId>.settings`. The `sm plugins config <plugin>/<ext>` verb, `GET`/`PATCH /api/plugins`, and per-plugin sections in Settings all read and write them; `secret` values route to the gitignored project-local file (no encryption). Adds a `number` (decimal) input-type to the catalog.

</details>

<details>
<summary><b>0.55.0</b> · 2026-06-13</summary>

### CLI Minor
- Inspector action buttons are now self-projected by the dispatching Action instead of a sibling projector Analyzer: an Action may declare a `ui` button plus an optional deterministic scan-time `project(ctx)` (read-only graph) that emits its own `inspector.action.button` per node. The pure projector analyzers `core/supersede` and `core/tags` were removed and `core/annotation-stale` trimmed to its badge + issue (the Bump button moved to `core/node-bump`).
- Extensions declaring `stability: 'deprecated'` now also ship DISABLED by default, joining `experimental` in the ships-disabled set: a deprecated extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override), the same opt-in `experimental` uses. `beta` / `stable` keep running. No built-in is deprecated today, so the default scan is unchanged until one is marked.
- Extensions declaring `stability: 'experimental'` now ship DISABLED by default: their installed default flips from enabled to disabled, so the extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override). `beta` / `deprecated` / `stable` keep running. Built-ins flipped to experimental: `core/mcp-tools` and the Supersede declarer (`core/supersede` button + `core/node-supersede` action).
- The scan now captures each file's modification time (`mtime`) from the walker's existing `lstat`, persisted on `scan_nodes.modified_at_ms` and surfaced on the node wire shape as `modifiedAtMs` (nullable for virtual / derived nodes). The files table gains a sortable "Modified" column at the end, rendered as an ISO short date with a full date+time tooltip; sorting orders by the raw timestamp and sinks fileless nodes to the bottom. The value never participates in `bodyHash` / `frontmatterHash`.
- The `core/node-superseded` analyzer (surfaces a node's `supersededBy` declaration as an `info` finding) is now `experimental`, joining the rest of the supersession family (`core/supersede`, `core/node-supersede`) which already shipped experimental. As an experimental extension it ships disabled by default, so the "node is superseded by X" finding no longer appears until the operator enables the family with `sm plugins enable core/node-superseded` (or the Settings toggle).
- `sm plugins show` is now extension-only: it takes a qualified `<plugin>/<ext>` id and renders one extension's detail. The whole-plugin view (manifest plus extension rows) moves to `sm plugins list <id>`, and the top-level `sm plugins list` index drops the per-extension name sub-lines. A bare `show <plugin>` id and a qualified `list <plugin>/<ext>` id are each rejected with a directed redirect to the other verb.
- The `sm tutorial` campaign's second half is now a single "daily loop" part (add, improve, publish) that operates the harness for real instead of by hand: the content-editor, check-links, and publish steps actually run, the maintenance analyzers (broken reference, orphan, reserved name, `.sm` sidecar) surface from real work, and the portfolio it builds ships with a styled, personalized site. MCP is parked out of the menu pending its own iteration.

### CLI Patch
- `core/backtick-path` now matches bare `.md` filenames inside code spans, not only slashed paths: a backticked `` `algo4.md` `` becomes a `points` edge the way the runtime follows it. The `/` separator is now optional, with the first path segment anchored to a word char so globs and placeholders (`{PROJECT}-x.md`, `*-S.md`) stay rejected. Slashless names like `SKILL.md` match too; a self-reference becomes a self-loop, other misses flag via `core/reference-broken`.
- Broken graph edges now render fainter than resolved ones. `core/markdown-link` emits the spec's `0.95` (unambiguous syntax) instead of a hardcoded `1.0`, and the post-walk confidence-lift transform adds a `BROKEN_TARGET_CONFIDENCE = 0.5` downgrade for links that resolve to nothing (no path and no name-index match, like `core/reference-broken`). A dangling `[x](missing.md)`, `@missing.md`, or `/no-such-command` now sits at `0.5`, below a resolved `1.0` and above a reserved `0.1`.
- Every built-in extractor description now ends with a concrete usage example. The `markdown-link`, `external-url-counter`, `annotations`, `mcp-tools`, `backtick-path`, `tools-counter`, and `slash-command` manifests keep their existing leading sentence and append a short `Example: ...` clause, so the text shown in `sm plugins list`, `sm plugins show`, and the Settings plugins panel illustrates what each extractor matches.
- The post-walk confidence-lift transform no longer bumps a link to `1.0` when its resolved target is a `virtual: true` node (today only `core/mcp-tools`' `mcp://<server>` nodes, reconstructed from frontmatter, never verified on disk). The edge still resolves (`resolvedTarget` set, navigable) but keeps its extractor emit confidence, so an MCP edge stays `0.85`: an unverified entity is not full certainty, like the reserved-target downgrade.

### Spec Minor (0.49.0)
- Inspector action buttons are now self-projected by the dispatching Action instead of a sibling projector Analyzer: an Action may declare a `ui` button plus an optional deterministic scan-time `project(ctx)` (read-only graph) that emits its own `inspector.action.button` per node. The pure projector analyzers `core/supersede` and `core/tags` were removed and `core/annotation-stale` trimmed to its badge + issue (the Bump button moved to `core/node-bump`).
- Extensions declaring `stability: 'deprecated'` now also ship DISABLED by default, joining `experimental` in the ships-disabled set: a deprecated extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override), the same opt-in `experimental` uses. `beta` / `stable` keep running. No built-in is deprecated today, so the default scan is unchanged until one is marked.
- Extensions declaring `stability: 'experimental'` now ship DISABLED by default: their installed default flips from enabled to disabled, so the extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override). `beta` / `deprecated` / `stable` keep running. Built-ins flipped to experimental: `core/mcp-tools` and the Supersede declarer (`core/supersede` button + `core/node-supersede` action).
- The scan now captures each file's modification time (`mtime`) from the walker's existing `lstat`, persisted on `scan_nodes.modified_at_ms` and surfaced on the node wire shape as `modifiedAtMs` (nullable for virtual / derived nodes). The files table gains a sortable "Modified" column at the end, rendered as an ISO short date with a full date+time tooltip; sorting orders by the raw timestamp and sinks fileless nodes to the bottom. The value never participates in `bodyHash` / `frontmatterHash`.
- `sm plugins show` is now extension-only: it takes a qualified `<plugin>/<ext>` id and renders one extension's detail. The whole-plugin view (manifest plus extension rows) moves to `sm plugins list <id>`, and the top-level `sm plugins list` index drops the per-extension name sub-lines. A bare `show <plugin>` id and a qualified `list <plugin>/<ext>` id are each rejected with a directed redirect to the other verb.

### Spec Patch (0.49.0)
- `core/backtick-path` now matches bare `.md` filenames inside code spans, not only slashed paths: a backticked `` `algo4.md` `` becomes a `points` edge the way the runtime follows it. The `/` separator is now optional, with the first path segment anchored to a word char so globs and placeholders (`{PROJECT}-x.md`, `*-S.md`) stay rejected. Slashless names like `SKILL.md` match too; a self-reference becomes a self-loop, other misses flag via `core/reference-broken`.
- Broken graph edges now render fainter than resolved ones. `core/markdown-link` emits the spec's `0.95` (unambiguous syntax) instead of a hardcoded `1.0`, and the post-walk confidence-lift transform adds a `BROKEN_TARGET_CONFIDENCE = 0.5` downgrade for links that resolve to nothing (no path and no name-index match, like `core/reference-broken`). A dangling `[x](missing.md)`, `@missing.md`, or `/no-such-command` now sits at `0.5`, below a resolved `1.0` and above a reserved `0.1`.
- The post-walk confidence-lift transform no longer bumps a link to `1.0` when its resolved target is a `virtual: true` node (today only `core/mcp-tools`' `mcp://<server>` nodes, reconstructed from frontmatter, never verified on disk). The edge still resolves (`resolvedTarget` set, navigable) but keeps its extractor emit confidence, so an MCP edge stays `0.85`: an unverified entity is not full certainty, like the reserved-target downgrade.

</details>

<details>
<summary><b>0.54.0</b> · 2026-06-12</summary>

### CLI Minor
- Adds the `core/backtick-path` extractor: relative `.md` paths written inside inline code spans and fenced blocks become edges, resolved like markdown links. The token grammar is pinned in `spec/architecture.md` (new section "Extractor: code-region file references"), unresolved targets surface via `core/reference-broken`, and the kernel exports `extractCodeRegions`, the exact inverse mask of `stripCodeBlocks`.
- Extensions can declare an optional `stability` lifecycle label (`experimental`, `beta`, `stable`, `deprecated`) in their manifest. Presentation-only: non-default values render as a badge in `sm plugins list` / `sm plugins show` and the Settings plugins panel; missing means `stable` and the kernel never gates behaviour on it. Declared in the spec's extension base schema and threaded through the loader, the BFF, and the SPA. `core/mcp-tools` is the first built-in flagged `experimental`.
- Adds the `points` link kind to the closed enum: `core/backtick-path` now emits `points` instead of `references`, so a backtick path and a markdown link to the same target persist as two coexisting edges instead of merging, and `core/link-conflict` treats `points` as compatible with every other kind (no false conflict warns). `core/reference-broken` labels the kind "pointer".
- The `tools-counter` extractor moved from the `core` plugin into the `claude` plugin: its qualified id is now `claude/tools-counter` (settings toggles keyed `core/tools-counter` no longer match), and disabling the `claude` plugin now drops the agent tools chip together with the provider it serves.

### CLI Patch
- Reworks every built-in analyzer message into a compact finding grammar: the involved artifact (target, trigger, sidecar) leads on its own line, followed by a short label, count, detail, and a `(line N)` location suffix wherever the link records one (broken references, self-loops, reserved-name downgrades); duplicate occurrences group by trigger, and messages about the node itself drop the redundant path. The inspector renders the line break and `sm check` flattens it to one row.
- Downgrades the `core/reference-redundant` analyzer severity from `warn` to `info`: a multi-form reference to the same target is a consolidation hint, not a defect, so it no longer shares the visual bucket of actionable warnings like `reference-broken`.
- Decouples the workspace text search from the map: `FilterStoreService.apply()` gains an `includeSearch` option and the graph view only applies the query when the new persisted `searchAffectsMap` preference (toggle next to the rail search input, default off) is enabled. The files rail keeps filtering on every query.

### Spec Minor (0.48.0)
- Adds the `core/backtick-path` extractor: relative `.md` paths written inside inline code spans and fenced blocks become edges, resolved like markdown links. The token grammar is pinned in `spec/architecture.md` (new section "Extractor: code-region file references"), unresolved targets surface via `core/reference-broken`, and the kernel exports `extractCodeRegions`, the exact inverse mask of `stripCodeBlocks`.
- Extensions can declare an optional `stability` lifecycle label (`experimental`, `beta`, `stable`, `deprecated`) in their manifest. Presentation-only: non-default values render as a badge in `sm plugins list` / `sm plugins show` and the Settings plugins panel; missing means `stable` and the kernel never gates behaviour on it. Declared in the spec's extension base schema and threaded through the loader, the BFF, and the SPA. `core/mcp-tools` is the first built-in flagged `experimental`.
- Adds the `points` link kind to the closed enum: `core/backtick-path` now emits `points` instead of `references`, so a backtick path and a markdown link to the same target persist as two coexisting edges instead of merging, and `core/link-conflict` treats `points` as compatible with every other kind (no false conflict warns). `core/reference-broken` labels the kind "pointer".

</details>

<details>
<summary><b>0.53.6</b> · 2026-06-09</summary>

### CLI Patch
- Tutorial-review pass on the bundled `sm-tutorial`: the example fixtures stop inventing frontmatter fields skill-map ignores (`args`/`shortcut` on commands, `inputs`/`outputs`/`metadata`/`version`/`tags` on skills and notes, which live in the `.sm` sidecar or nowhere); the `.sm` annotations lesson is de-duplicated across parts; the Maintain section is retitled "Maintain the harness"; and chapters now carry `section.chapter` numbers. `sm --help` also leads with a tutorial call-to-action.

</details>

<details>
<summary><b>0.53.5</b> · 2026-06-09</summary>

### CLI Patch
- Tutorial-review pass on the bundled `sm-tutorial` walkthrough: the connector-confidence lessons now match the resolver (a faint 0.50 mention versus a resolved 1.00 reference, with no phantom 0.85 step), the `@AGENTS.md` connector is labelled `references`, an optional `content-editor` chapter was added, the `sm bump` chapter was removed, and the MCP part now runs last.

</details>

<details>
<summary><b>0.53.4</b> · 2026-06-08</summary>

### CLI Patch
- Part 8 (`cli`) of the bundled `sm-tutorial` skill now self-seeds its own copy of the Part 0 demo fixture (`preflight: seed`, new `prologue-built` snapshot) instead of assuming it is still on disk. Before, running the campaign after the prologue deleted that fixture, yet Part 8 stayed in the menu and ran against the wrong project. Now it rebuilds the fixture on entry (resetting the portfolio if present) and, like the campaign parts, is always shown.
- The workspace files-panel collapse button now shows a left chevron instead of an `✕`, so it no longer reads as a clear-search control sitting next to the search box. The bundled `sm-tutorial` skill drops the slashed `# /publish` / `# /init` headers from its command fixtures (the slash token produced a spurious self-loop link the tester saw before it was explained) and adds a third-terminal heads-up to the maintenance part, where the live server and one-off `sm` commands run side by side.

</details>

<details>
<summary><b>0.53.3</b> · 2026-06-08</summary>

### CLI Patch
- Graph view gains three Neon themes (R/G/B) with a glow treatment, selectable from the theme picker. The toolbar tooltips were trimmed and the "edge style" control renamed to "connector style". The bundled `sm-tutorial` skill adds part 3 ("run the harness") and reworks the finale.

</details>

<details>
<summary><b>0.53.2</b> · 2026-06-08</summary>

### CLI Patch
- Graph view: "Fit to screen" (and the boot / auto fit) now caps zoom at natural size instead of magnifying, so opening a project with a single node no longer renders it gigantic; the wheel still zooms in to 2x. The "Re-arrange layout" toolbar tooltip also drops its redundant "(re-run auto layout)" tail.

</details>

<details>
<summary><b>0.53.1</b> · 2026-06-08</summary>

### CLI Patch
- The cache-rebuild prompt shown on a version skew (re-scanning a DB written by a different CLI version) is reworded to be shorter and calmer: it no longer recites the pre-1.0 derived-cache rationale or uses "delete" / "deleted" phrasing. The post-rebuild receipt is now suppressed after an interactive y/N confirm (the operator already answered) and only prints for automatic rebuilds (`--yes`, non-TTY, the BFF), where it is the only signal the cache was wiped.
- The default graph layout direction is now left-to-right instead of top-to-bottom. The "Balanced" (dagre network-simplex) algorithm was already the default, so only the direction changed: a fresh map with no saved layout preference now flows horizontally. Users who already picked a direction keep their choice.
- Tutorial polish for `sm tutorial` (the prologue and shared conventions): the session now opens on a numbered menu where you pick the part to run, each chapter asks for confirmation once instead of several times in a row, and the prologue's references to the live UI are refreshed to the current names (the "Connections" panel, "Re-arrange layout"). The watcher/browser are no longer translated in the Spanish flow, and the tutorial no longer creates harness tasks.

</details>

<details>
<summary><b>0.53.0</b> · 2026-06-07</summary>

### CLI Minor
- Inspector action-button adopters: `core/node-stability`, `core/supersede` and a new `core/tags` analyzer emit Set stability / Supersede / Edit tags buttons, each parametrized via an input-type prompt pre-loaded with the current value, backed by deterministic actions `core/node-set-stability`, `core/node-set-tags`, `core/node-supersede`.
- Plugins can now contribute action buttons to the inspector: a new `inspector.action.button` slot renders buttons that dispatch a kernel Action via `POST /api/actions/:id`, and the two header badge sub-slots collapse into one `inspector.header.badge` slot. The `.sm` write consent splits into `confirm` (one-shot) and `always` (persists `allowEditSmFiles`). `core/annotation-stale` now emits the Bump button and stale badge as contributions instead of hardcoded UI.
- Inspector body view contributions now render one collapsible section per plugin (titled by the trusted `pluginId`, collapsed by default) instead of a shared drawer; the `inspector.body.section` slot is retired. New optional inspector-only `order` fields on `plugin.json` (sorts sections) and the extension manifest (sorts bricks) drive layout, default 100. `inspector.action.button` is now uncapped.
- Runtime contribution rejections (an undeclared ref, or a payload that fails the slot's schema) are now persisted per scan to a `scan_contribution_errors` table. `sm plugins doctor` prints a per-plugin "Runtime contribution errors" section and exits non-zero when any exist; `GET /api/plugins` embeds a per-plugin `runtimeContributionErrors[]` field the Settings panel renders as a warning badge plus a collapsible list. The `extension.error` scan event still fires.
- View contributions are now emitted by object reference, not a string id: declare each as a const in the `ui` map and pass it to `ctx.emitContribution(ref, payload)`. The kernel recovers the id by object identity and rejects an undeclared ref with a loud `extension.error`. The payload is type-checked at author time via generated `SlotPayload<slot>` types (AJV still enforces it at runtime). The three list-payload fields were renamed: breakdown `bars`, key-values `pairs`, link-list `links`.
- The bundled `sm-tutorial` skill gains the portfolio campaign: Parts 1-5 of the book (start the project from zero, connect the harness, maintain the site, MCP, and the live-site finale) are now authored and active. They build one accumulating example project, a static portfolio served by a tiny Express server plus the `.claude/` harness that maintains it, around which the prologue and the advanced parts (extend skill-map, the CLI in depth) already sit.
- The portfolio-campaign parts of the bundled `sm-tutorial` skill become jumpable. Each now declares `preflight: seed`, so entering one out of order fast-forwards the project to that part's starting state (it lays the cumulative `.claude/` harness from a checklist, then inits and scans) instead of forcing the tester through the earlier parts first. Run in order it stays a no-op; the skipped predecessors are marked and stay in the menu for later.
- The `sm tutorial` verb drops its `master` positional variant and now materializes a single `sm-tutorial` skill, restructured into a "book" of ordered parts and chapters with a manifest-driven menu. The advanced walkthrough (plugins, settings, view-slots) and the CLI deep-dive are parts inside that one skill, reached from its menu after the live-UI prologue. `sm tutorial master` exits 2; `.claude/skills/sm-master/` is removed.

### CLI Patch
- Plugin load failures read better. A wrong view-slot value collapses AJV's `must be equal to constant` wall into one `<path> is not a valid value` linking to the slot catalog (`spec/view-slots.md`) on GitHub; other manifest errors link to the kind schema. The warning is one non-repetitive line, `plugin <id> (<status>), all extensions skipped: <reason>`. Plugin-load warnings also no longer print twice at `sm serve` boot.
- Harden test and conformance coverage for the emit-by-reference view-contribution refactor: orchestrator rejection-path and renderer unit tests, `sm plugins doctor` runtime-error coverage, two new conformance cases (renamed list payloads with off-shape rejections, and a manifest declaring all 14 slots) plus a fixture-drift fix. The conformance suite now runs in CI via `validate:test`, and the `plugins doctor` docs gain a runtime-error note. No CLI or normative spec change.

### Spec Minor (0.47.0)
- Inspector action-button adopters: `core/node-stability`, `core/supersede` and a new `core/tags` analyzer emit Set stability / Supersede / Edit tags buttons, each parametrized via an input-type prompt pre-loaded with the current value, backed by deterministic actions `core/node-set-stability`, `core/node-set-tags`, `core/node-supersede`.
- Plugins can now contribute action buttons to the inspector: a new `inspector.action.button` slot renders buttons that dispatch a kernel Action via `POST /api/actions/:id`, and the two header badge sub-slots collapse into one `inspector.header.badge` slot. The `.sm` write consent splits into `confirm` (one-shot) and `always` (persists `allowEditSmFiles`). `core/annotation-stale` now emits the Bump button and stale badge as contributions instead of hardcoded UI.
- Inspector body view contributions now render one collapsible section per plugin (titled by the trusted `pluginId`, collapsed by default) instead of a shared drawer; the `inspector.body.section` slot is retired. New optional inspector-only `order` fields on `plugin.json` (sorts sections) and the extension manifest (sorts bricks) drive layout, default 100. `inspector.action.button` is now uncapped.
- Runtime contribution rejections (an undeclared ref, or a payload that fails the slot's schema) are now persisted per scan to a `scan_contribution_errors` table. `sm plugins doctor` prints a per-plugin "Runtime contribution errors" section and exits non-zero when any exist; `GET /api/plugins` embeds a per-plugin `runtimeContributionErrors[]` field the Settings panel renders as a warning badge plus a collapsible list. The `extension.error` scan event still fires.
- View contributions are now emitted by object reference, not a string id: declare each as a const in the `ui` map and pass it to `ctx.emitContribution(ref, payload)`. The kernel recovers the id by object identity and rejects an undeclared ref with a loud `extension.error`. The payload is type-checked at author time via generated `SlotPayload<slot>` types (AJV still enforces it at runtime). The three list-payload fields were renamed: breakdown `bars`, key-values `pairs`, link-list `links`.
- The `sm tutorial` verb drops its `master` positional variant and now materializes a single `sm-tutorial` skill, restructured into a "book" of ordered parts and chapters with a manifest-driven menu. The advanced walkthrough (plugins, settings, view-slots) and the CLI deep-dive are parts inside that one skill, reached from its menu after the live-UI prologue. `sm tutorial master` exits 2; `.claude/skills/sm-master/` is removed.

### Spec Patch (0.47.0)
- Plugin load failures read better. A wrong view-slot value collapses AJV's `must be equal to constant` wall into one `<path> is not a valid value` linking to the slot catalog (`spec/view-slots.md`) on GitHub; other manifest errors link to the kind schema. The warning is one non-repetitive line, `plugin <id> (<status>), all extensions skipped: <reason>`. Plugin-load warnings also no longer print twice at `sm serve` boot.
- Harden test and conformance coverage for the emit-by-reference view-contribution refactor: orchestrator rejection-path and renderer unit tests, `sm plugins doctor` runtime-error coverage, two new conformance cases (renamed list payloads with off-shape rejections, and a manifest declaring all 14 slots) plus a fixture-drift fix. The conformance suite now runs in CI via `validate:test`, and the `plugins doctor` docs gain a runtime-error note. No CLI or normative spec change.

</details>

<details>
<summary><b>0.52.0</b> · 2026-06-05</summary>

### CLI Minor
- `sm bump` and the BFF bump route (`POST /api/sidecar/bump`) now stamp `audit.lastBumpedBy` / `audit.createdBy` with the project's Git author name (`git config user.name`) when the node lives in a Git repository, falling back to the channel literal (`'cli'` / `'ui'`) otherwise. This supersedes Decision A5, which kept the invoker a literal.
- The inspector body renders markdown with full prose styling plus highlight.js syntax highlighting and re-renders live on `scan.completed`. The connections panel drops its duplicate Findings sub-section and header and reuses the node-card icon vocabulary for Outgoing / Incoming / External; sidecar tags move to a clickable header row, the Annotations panel leads with Authors, and the map isolate gesture now focuses a node and its direct (one-hop) neighbors instead of its whole chain.
- A malformed or schema-invalid `.sm` sidecar now emits its `invalid-sidecar` diagnostic at `error` severity instead of `warn`. The scan still completes (the node is marked present with a null status), but `sm check` now exits non-zero when any sidecar fails to parse or validate, surfacing broken annotations in CI rather than letting them pass as a warning.

### CLI Patch
- The active-provider lens dropdown in Settings → Project now greys out (and refuses to select) any Provider the operator has disabled. `GET /api/active-provider` gained a `selectable` field listing the Provider ids that are enabled right now; the SPA renders Providers absent from it as disabled instead of offering a lens whose extractors would never run.
- The `core/annotation-stale` analyzer is now neutral instead of warning-tinted: drift is informational, not a warning. Its footer chip (`staleIcon`) carries no severity (the clock renders in the foreground colour instead of the warn tint), and the stale Findings issue is lowered from `warn` to `info`. As `info`, it no longer counts toward the card's warn chip (the issue-counter buckets error/warn only) and never affected `sm check`'s exit code (info and warn are both non-failing).

### Spec Minor (0.46.0)
- The active-provider lens dropdown in Settings → Project now greys out (and refuses to select) any Provider the operator has disabled. `GET /api/active-provider` gained a `selectable` field listing the Provider ids that are enabled right now; the SPA renders Providers absent from it as disabled instead of offering a lens whose extractors would never run.
- `sm bump` and the BFF bump route (`POST /api/sidecar/bump`) now stamp `audit.lastBumpedBy` / `audit.createdBy` with the project's Git author name (`git config user.name`) when the node lives in a Git repository, falling back to the channel literal (`'cli'` / `'ui'`) otherwise. This supersedes Decision A5, which kept the invoker a literal.

### Spec Patch (0.46.0)
- The `core/annotation-stale` analyzer is now neutral instead of warning-tinted: drift is informational, not a warning. Its footer chip (`staleIcon`) carries no severity (the clock renders in the foreground colour instead of the warn tint), and the stale Findings issue is lowered from `warn` to `info`. As `info`, it no longer counts toward the card's warn chip (the issue-counter buckets error/warn only) and never affected `sm check`'s exit code (info and warn are both non-failing).

</details>

<details>
<summary><b>0.51.0</b> · 2026-06-04</summary>

### CLI Minor
- Security hardening. `sm serve` now refuses any non-loopback `--host` (the BFF is loopback-only and unauthenticated pre-1.0, Decision #119; off-loopback previously leaned on the DNS-rebinding gate alone). The `/api/nodes/:pathB64` 404 sanitizes the decoded path for the terminal (log-injection parity with sibling routes), the `/ws` broadcaster caps concurrent clients (refuses past the cap with close 1013), and published tarballs now carry npm provenance.

### CLI Patch
- Internal quality pass from a review. The kernel no longer imports the `core/` runtime layer: pure leaves (`atomic-write`, `schema-fingerprint`, `update-check`, the `SKILL_MAP_DIR` literal, the provider detector) moved into `kernel/` and the sidecar consent gate is now injected, with a new lint rule enforcing the boundary. The BFF's two `409` responses dispatch via a typed `ConflictError` instead of a message-prefix match, and `sm scan`'s count nouns moved into the i18n catalog.

</details>

<details>
<summary><b>0.50.1</b> · 2026-06-04</summary>

### CLI Patch
- The reference-redundant finding message is shorter and more direct: "Duplicate reference to <target> (<n> occurrences): <list>." It drops the source-node name (the finding already hangs off that node) and the trailing "consider consolidating..." advice.
- Polish on the fused workspace: the floating kind / severity / favorites palette counts now reflect the files-rail curation (filtering from the tree reshapes the numbers); selecting a file whose node is hidden from the map no longer pans the camera to empty space; the layout reset only prompts when the user has actually positioned nodes and the warning is lower intensity; and the link-kind palette lists every link kind regardless of node curation.

</details>

<details>
<summary><b>0.50.0</b> · 2026-06-02</summary>

### CLI Minor
- Fuse the standalone files and map views into one workspace at `/`: a resizable files rail, the graph, and a floating inspector linked through the shared `?path` selection. The rail curates which nodes the map shows via per-file/per-folder visibility checkboxes, folder-depth presets, and an isolate-chain gesture (persisted to localStorage); the layout reset re-arranges only the visible nodes. Retires the `/files` and `/map` routes and the stability / has-issues / stale filters.

### Spec Patch (0.45.1)
- Fuse the standalone files and map views into one workspace at `/`: a resizable files rail, the graph, and a floating inspector linked through the shared `?path` selection. The rail curates which nodes the map shows via per-file/per-folder visibility checkboxes, folder-depth presets, and an isolate-chain gesture (persisted to localStorage); the layout reset re-arranges only the visible nodes. Retires the `/files` and `/map` routes and the stability / has-issues / stale filters.

</details>

<details>
<summary><b>0.49.0</b> · 2026-06-02</summary>

### CLI Minor
- Fuse the standalone files and map destinations into one workspace view, now the default landing: a drag-resizable files rail on the left, the graph in the center, and the inspector as a right-side slide-over, all linked through the shared `?path` selection. The file tree gains a tri-state control to curate which nodes appear on the map, with a `Show all` toolbar action to clear it. The `/files` and `/map` routes stay reachable.

</details>

<details>
<summary><b>0.48.0</b> · 2026-05-31</summary>

### CLI Minor
- `sm plugins create <kind> <plugin-id>` now takes the extension kind as a required first positional and scaffolds a loader-clean stub for each of the six kinds (provider, extractor, analyzer, action, formatter, hook). The slot / input-type catalog gains a single source of truth: the spec enums become `oneOf` const+description, and the kernel + CLI mirrors are generated from it by `scripts/generate-view-catalog.js`, guarded by `view-catalog:check` in `validate:compile`.

### CLI Patch
- Restore the left-to-right order of the `card.footer.right` chip cluster that the `core/issue-counter` aggregate had displaced: the stability badge leads (priority 10), then the stale-drift clock chip (priority 20), then the warning and error counters anchor the right edge. A reader notices it as the card-footer status icons returning to lifecycle, stale, warnings, errors order.
- The phrase `sm tutorial` surfaces to start each walkthrough now matches the website and READMEs: the basic tutorial trigger is `run the tutorial` / `ejecuta el tutorial` (was `start the tutorial` / `arranquemos el tutorial`) and the master tutorial trigger is `run the master tutorial` / `ejecuta el tutorial maestro`. The two SKILL.md trigger lists pick up the new phrases.

### Spec Minor (0.45.0)
- `sm plugins create <kind> <plugin-id>` now takes the extension kind as a required first positional and scaffolds a loader-clean stub for each of the six kinds (provider, extractor, analyzer, action, formatter, hook). The slot / input-type catalog gains a single source of truth: the spec enums become `oneOf` const+description, and the kernel + CLI mirrors are generated from it by `scripts/generate-view-catalog.js`, guarded by `view-catalog:check` in `validate:compile`.

</details>

<details>
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
