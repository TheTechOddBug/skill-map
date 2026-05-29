# skill-map

> Design document and execution plan for `skill-map`. Architecture, decisions, phases, deferred items, and open questions. Target: distributable product (not personal tool). Versioning policy, plugin security, i18n, onboarding docs, and compatibility matrix all apply.

**Last updated**: 2026-05-29 (Claude + Agent Skills frontmatter coverage pass: Claude `skill-base` gains `disallowed-tools` (now 14 fields); the neutral `agent-skills` Provider schema gains the open-standard optionals `license` / `compatibility` / `metadata` / `allowed-tools`; `base.schema.json` is trimmed back to `name` + `description`, its only universal fields; `tags` reverts from dual-source to a single skill-map sidecar concept, removing the `frontmatter.tags` author source, the `scan_node_tags.source` column, the `node.tags` object wire shape (now a flat `string[]`), the `sm list --tag-source` flag, and the UI author-tag chip; Claude agent schema/doc links corrected from `agents.md` to `sub-agents.md`). Prior (2026-05-28): provider registry as single source of truth: Providers now declare a required `presentation` block (label / color / `hideChip`) plus optional `detect.markers`; the BFF embeds a `providerRegistry` sibling of `kindRegistry` on every payload-bearing envelope; the SPA's `ProviderRegistryService` feeds the active-lens dropdown, the topbar lens chip, and the per-node provider chip from the real registered-Provider set instead of four divergent hardcoded lists (phantom `gemini` / `cursor` options removed, real `antigravity` / `agent-skills` surfaced); active-lens auto-detect markers are now provider-owned and the central `DETECTION_RULES` table is gone. Prior (2026-05-27): node cap on `sm scan` / `sm watch` / `sm serve` and the bare `sm` shortcut: new `scan.maxNodes` setting (default 256) plus `--max-nodes <N>` flag with bidirectional override; `scan_meta` and the `ScanResult` envelope carry `recommendedNodeLimit` + `overrideMaxNodes`; new `<sm-oversized-banner>` in the SPA with three modes (capped / overLimit / atLimit) and a CTA into Settings → Project for trimming `.skillmapignore`. Post-Phase-6 polish: observable link analysis / `core/link-counts` chips, reserved-name analyzer + confidence downgrade, lens-drift warning on stale `activeProvider` markers, db-version skew detection at sqlite open, Antigravity Provider onboarding, Gemini Provider retired, vendor provider classification gated by active lens, active-provider auto-detect at first scan). Editorial / structural change history for this file lives in `context/roadmap-history.md` and `CHANGELOG.md` §Document changelog.


## Project overview

The project description, problem statement, target audience, and philosophy live in the README. Both language variants carry the same content:

- **English (default)**: [README.md](./README.md).
- **Español**: [README.es.md](./README.es.md).

Each README also ships a short essentials-only glossary with a pointer back to the full [§Glossary](#glossary) below. This document (`ROADMAP.md`) is the design narrative, architecture decisions, execution plan, decision log, and deferred work, and sits beneath the READMEs; it is maintained in English only.

**Status**: `v0.6.0` shipped (deterministic kernel + CLI + Web UI), then iterated through the active-lens migration (Phases 1–6, 2026-05-19 onwards): active-provider lens, Signal IR scaffold, numeric `Confidence`, MCP virtual nodes, OpenAI Codex provider, Antigravity onboarded, Gemini retired, lens-only extractor gating, provider-aware confidence bump, reserved-name catalog, observable link analysis (`core/link-counts` chips), lens-drift + db-skew safety nets. The deterministic surface is feature-complete; the only post-Phase-6 deliverable that gates v1.0 is the Codex body extractor (TOML `instructions` field, §Step 13). **Next**: `v0.8.0`, wave 2 (Steps 10–11, 16). Per-Step landing prose for closed work lives in `CHANGELOG.md`.

---

## Table of contents

1. [Project overview](#project-overview), status, language variants, document scope.
2. [Glossary](#glossary), canonical vocabulary (domain, extensions, modes, architecture, jobs, states, plugins, refresh, safety, enrichment, scope, CLI/UI).
3. [Visual roadmap](#visual-roadmap), ASCII timeline of every Step.
4. [Spec as a standard](#spec-as-a-standard), repo layout, properties, distribution.
5. [Architecture: Hexagonal (Ports & Adapters)](#architecture-hexagonal-ports--adapters), layering, ports, adapters, package layout.
6. [Persistence](#persistence), scopes, zones (`scan_*` / `state_*` / `config_*`), naming, data-access, migrations, DB management.
7. [Job system](#job-system), model, lifecycle, TTL, duplicate prevention, runners, nonce, preamble, atomicity, concurrency, events, `sm job` surface.
8. [Plugin system](#plugin-system), six kinds, drop-in install, loading, qualified ids, Provider catalog, Extractor channels, scan cache, Hook trigger set, storage modes, triple protection, default pack.
9. [Summarizer pattern](#summarizer-pattern), schemas, storage, probabilistic refresh, report base.
10. [Frontmatter standard](#frontmatter-standard), base (universal), per-kind (Provider-owned), validation tiers, DB denormalization.
11. [Enrichment](#enrichment), two enrichment models, hash verification, stale tracking, refresh commands.
12. [Reference counts](#reference-counts), link-count denormalization.
13. [Trigger normalization](#trigger-normalization), six-step pipeline, examples.
14. [Configuration](#configuration), file hierarchy, key reference.
15. [CLI surface](#cli-surface), every verb, the `sm` binary contract, exit codes.
16. [Skills catalog](#skills-catalog), built-in and bundled skills.
17. [UI (Step 14 full)](#ui-step-14-full), Flavor B + the Hono BFF.
18. [Testing strategy](#testing-strategy), pyramid, coverage targets.
19. [Stack conventions](#stack-conventions), runtime, language, deps, formatting.
20. [Execution plan](#execution-plan), Step-by-step status with the completeness marker.
21. [Decision log](#decision-log), pointer to the canonical numbered table in `context/roadmap-history.md`.
22. [Deferred beyond v1.0](#deferred-beyond-v10), Steps and features intentionally pushed past the first stable release.
23. [Discarded (explicitly rejected)](#discarded-explicitly-rejected), pointer to the rationale of dropped proposals in `context/roadmap-history.md`.

> **Step vs Phase glossary**: a **Step** (e.g. `Step 9`, `Step 14.4.b`) is an atomic feature milestone, one PR or a tightly-related sequence. A **Phase** (e.g. `Phase A`, `Phase B`, `Phase C`) is a multi-Step release target. Phase A = `v0.5.0` (deterministic kernel + CLI), Phase B = `v0.8.0` (job subsystem + LLM verbs), Phase C = `v1.0.0` (surface + distribution). Execution prose mixes both: `Step 14 ships v0.6.0 inside Phase C` is correct shorthand.

---

## Glossary

> Canonical vocabulary of the project. The rest of the roadmap uses these terms without ambiguity.

### Domain and graph

| Concept | Description |
|---|---|
| **Node** | Markdown file representing a unit (skill, agent, command, markdown, for the Claude built-in catalog; other Providers may declare their own kinds). Identified by path relative to the scope root. |
| **Link** | Directed relation between two nodes (replaces the term "edge"). Carries `kind` (invokes / references / mentions / supersedes), confidence (high / medium / low), and sources (which Extractors produced it). |
| **Issue** | Problem emitted by a deterministic analyzer when evaluating the graph. Has severity (warn / error). |
| **Finding** | Result emitted by probabilistic analysis (summarizer, LLM verb), persisted in the DB. Covers injection detection, low confidence, stale summaries. |
| **Node kind** | Category of a node, declared by the classifying Provider. Open by design, built-in Claude Provider catalog: `skill` / `agent` / `command` / `markdown`; built-in OpenAI Codex Provider: `agent` (TOML envelopes); neutral `agent-skills` Provider: `skill`; built-in Antigravity Provider: none (metadata-only). The retired Gemini Provider declared `agent` / `skill` / `markdown` and was removed when Google sunset Gemini CLI 2026-05; the historical entries above survive in `context/roadmap-history.md`. External Providers MAY declare their own. Field `node.kind` in the spec. Distinct from **link kind** (value of `link.kind`) and **extension kind** (plugin category, see next table). All three are polysemic specializations of the generic term "kind"; the prefix is used when context is not obvious. |

### Extensions (6 extension kinds)

"Extension kind" is the category of a plugin piece, distinct from **node kind** in the previous table. The ecosystem exposes six, and they form the stable kernel contract. Three kinds are dual-mode (deterministic / probabilistic, see §Execution modes below); three kinds are deterministic-only because they sit on the deterministic scan path.

| Concept | Description |
|---|---|
| **Provider** | Extension kind. Recognizes a platform (today's built-in catalog: `claude`, `openai` for Codex, `antigravity` (metadata-only since Google adopted the open standard), `agent-skills` for the vendor-neutral `.agents/skills/<n>/SKILL.md` layout, plus the `core` fallback that owns `markdown`), classifies each file into its node kind, and declares its `kinds` catalog (per-kind frontmatter `schema` + `defaultRefreshAction` + `ui` presentation block) plus its `explorationDir`. **Deterministic-only**. The retired `gemini` Provider was removed when Google sunset Gemini CLI on 2026-06-18 and replaced it with Antigravity (which reuses the open-standard `.agents/skills/` layout, so its Provider is metadata-only). |
| **Extractor** | Extension kind. Reads a node's body and emits work through three callbacks: `ctx.emitLink(link)`, `ctx.enrichNode(partial)`, `ctx.store.write(...)`. **Deterministic-only**: runs synchronously inside `sm scan`. LLM-driven enrichment of a node is an Action concern, not an Extractor concern. |
| **Analyzer** | Extension kind. Evaluates the graph and emits issues. **Dual-mode**: deterministic Analyzers run in `sm check`; probabilistic Analyzers run only as queued jobs (opt-in via `sm check --include-prob`). |
| **Action** | Extension kind. Operation executable over one or more nodes. **Dual-mode**: `deterministic` (plugin code, in-process) or `probabilistic` (rendered prompt the runner executes against an LLM). |
| **Formatter** | Extension kind. Serializes the graph into ascii / mermaid / dot / json. **Deterministic-only** (snapshot diffability). |
| **Hook** | Extension kind. Reacts declaratively to one of ten curated lifecycle events, eight pipeline-driven (`scan.started`, `scan.completed`, `extractor.completed`, `analyzer.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`) plus two CLI-process-driven (`boot` before verb routing, `shutdown` after the verb's exit code resolves). **Dual-mode**. Reaction-only: a Hook cannot mutate, block, or steer the pipeline. |

### Execution modes

The dual-mode capability is the meta-property that lets the same extension model scale from `pre-commit` (deterministic only) to nightly enrichment (deterministic + probabilistic). Mode is a property of the extension as a whole, not of an individual call.

| Concept | Description |
|---|---|
| **Deterministic mode** | Pure code. Same input → same output, every run. Runs synchronously inside `sm scan` / `sm check`. Fast, free, CI-safe. |
| **Probabilistic mode** | Calls an LLM through the kernel's `RunnerPort` (`ClaudeCliRunner`, `MockRunner`, third-party runners). Output may vary across runs. NEVER participates in `sm scan`; dispatches as a queued job (`sm job submit <kind>:<id>`). The kernel rejects probabilistic extensions that try to register scan-time hooks at load time. |
| **Per-kind capability** | Three kinds are dual-mode (declared in manifest's `mode` field): **Analyzer**, **Action**, **Hook** (Action requires the field; the others default to `deterministic`). Three kinds are deterministic-only because they sit on the deterministic scan path: **Provider** (filesystem-to-graph), **Extractor** (parsed-node-to-callbacks), **Formatter** (graph-to-string). The `mode` field MUST NOT appear on Provider, Extractor, or Formatter manifests. |

The full normative contract lives in [`spec/architecture.md`](./spec/architecture.md) §Execution modes.

### Architecture

| Concept | Description |
|---|---|
| **Kernel** | Domain core. Pure logic; performs no direct IO. Exposes use cases. |
| **Port** | Interface declared by the kernel. Enables adapter injection. |
| **Driving adapter** | Primary adapter, consumes the kernel from the outside. CLI, Server, Skill agent. |
| **Driven adapter** | Secondary adapter, implements a kernel port. SQLite storage, FS, Plugin loader, LLM runner. |
| **Hexagonal** | Ports & adapters pattern. Canonical name of this project's architecture. |

### Job runtime

| Concept | Description |
|---|---|
| **Action (type)** | Defined by a plugin. What the user can invoke. |
| **Job** | Runtime instance of an Action over one or more nodes (replaces the term "dispatch"). Lives in `state_jobs`. |
| **Job file** | MD generated by `sm` at `.skill-map/jobs/<id>.md`. Contains rendered prompt + callback instruction. Ephemeral. |
| **CLI runner loop** | Driving adapter, the `sm job run` command itself. Claims queued jobs, spawns a `RunnerPort` impl, and records callbacks. Does NOT implement `RunnerPort`. |
| **`ClaudeCliRunner`** | Default `RunnerPort` impl (driven adapter). Spawns a `claude -p` subprocess per item; `MockRunner` is the test fake. Lands in Step 10 with the job subsystem. |
| **Skill agent** | Driving adapter that runs inside an LLM session and consumes `sm job claim` + `sm record` like any other client. Does NOT implement `RunnerPort`; peer of CLI / Server. |
| **Report** | JSON produced by a job, validated against the schema declared by the action. |
| **Callback** | Call to `sm record` that closes a job: status, tokens, duration. |
| **Nonce** | Unique token in the job file frontmatter. Required by `sm record` to prevent callback forgery. |
| **Content hash** | Hash identifying a job for deduplication: `sha256(actionId + actionVersion + bodyHash + frontmatterHash + promptTemplateHash)`. |
| **Atomic claim** | `UPDATE ... RETURNING id` operation letting a runner take a queued job without a race. |
| **Reap** | Automatic process at the start of every `sm job run` that detects `running` jobs with expired TTL and marks them `failed` (reason `abandoned`). |

### States

| Concept | Description |
|---|---|
| **queued** | Job created, awaiting a runner. |
| **running** | A runner claimed it; execution in flight. |
| **completed** | The runner finished successfully and the report validated. |
| **failed** | The runner reported an error, or the job was abandoned by TTL. |
| **abandoned** | Sub-state of failed: runner died without a callback. |
| **stale** | Data computed over an older `body_hash`; the file has changed since. |
| **orphan** | Node with DB history but no file on disk. |

### Plugins and storage

| Concept | Description |
|---|---|
| **Plugin** | Distributable unit registering one or more extensions. Drop-in at `<scope>/.skill-map/plugins/<id>/`. |
| **Extension** | One of the 6 categories (provider, extractor, analyzer, action, formatter, hook) a plugin contributes. |
| **Drop-in** | Installation mode: place files in the right folder and they appear. No `sm plugins add`. |
| **Spec-compat** | Semver range in the plugin manifest against the spec version. Checked at load. |
| **Storage mode KV** | Mode A. Plugin uses `ctx.store.{get,set,list,delete}`, persisted in the kernel table `state_plugin_kvs`. |
| **Storage mode Dedicated** | Mode B. Plugin declares its own tables; the kernel provisions them with prefix `plugin_<id>_`. Triple protection against kernel contamination. |

### Refresh and analysis

| Concept | Description |
|---|---|
| **Deterministic refresh** | Re-scan of a node: recomputes bytes, tokens, hashes, links. Synchronous, no LLM. `sm scan -n <id>`. |
| **Probabilistic refresh** | Enqueues an LLM-backed action (summarizer, what, cluster). Async. `sm job submit <action> -n <id>`. |
| **Summarizer** | Per-kind Action that produces a structured semantic summary. One summarizer per Provider-declared kind (e.g. `claude/summarize-skill`, `claude/summarize-agent`, `claude/summarize-markdown`, `openai/summarize-agent`, `agent-skills/summarize-skill`, ...). |
| **Meta-skill** | Conversational skill (`/skill-map:explore`) that consumes `sm … --json` verbs and maintains follow-ups with the user. |

### Safety and content

| Concept | Description |
|---|---|
| **User-content delimiter** | XML tags `<user-content id="...">...</user-content>` that wrap user content inside job files. The kernel escapes any literal `</user-content>` inside the content. |
| **Prompt preamble** | Canonical block auto-prepended by the kernel to every job MD. Instructs the model to treat user-content as data, not instructions. |
| **Safety object** | Block in probabilistic reports (sibling of `confidence`): `injectionDetected`, `injectionType`, `contentQuality`, `injectionDetails`. |
| **Injection detection** | Detection (by the model) of prompt-injection attempts inside node content. Categorized as direct-override / role-swap / hidden-instruction / other. |

### Enrichment and provenance

| Concept | Description |
|---|---|
| **Enrichment** | Fetching external data (GitHub stars, last activity) to augment node info. Action with a refresh TTL. |
| **Provenance** | Frontmatter section: `metadata.source` (canonical URL) + `metadata.sourceVersion` (tag or SHA). |
| **Hash verification** | Comparison of local `body_hash` against the hash computed over raw GitHub content to set `verified: true/false`. |

### Scope and persistence

| Concept | Description |
|---|---|
| **Scope** | Skill-map operates exclusively on the project scope. DB at `<cwd>/.skill-map/skill-map.db`; config at `<cwd>/.skill-map/settings.json` + `settings.local.json`. There is no opt-in global scope (see `spec/cli-contract.md` §Scope is always project-local). To extend the scan beyond the project root the user passes positional roots to `sm scan [roots...]` (per-invocation, not persisted). |
| **Zone scan_** | Prefix for **regenerable** tables: `sm scan` truncates and repopulates them. E.g. `scan_nodes`, `scan_links`. |
| **Zone state_** | Prefix for **persistent** tables: jobs, executions, summaries, plugin_kv. Back up. |
| **Zone config_** | Prefix for user-owned tables: plugins enabled/disabled, preferences, schema versions. |
| **Migration** | Versioned `.sql` file (`NNN_snake_case.sql`) that evolves the schema. Up-only. |
| **user_version** | Built-in SQLite PRAGMA. Fast tracking of the kernel schema. |
| **Auto-backup** | Automatic copy of the DB to `.skill-map/backups/…db` before applying migrations. |

### CLI and UI

| Concept | Description |
|---|---|
| **Introspection** | Property of the CLI to emit its own structure (`sm help --format json`), consumed by docs, completion, UI, agents. |
| **Graph view** | Main UI view: nodes + links, interactive. |
| **List view** | Tabular view of nodes with filters and sort. |
| **Inspector panel** | UI section showing detail of the selected node: metadata, weight, summary, links, issues, findings. |
| **Issues panel** | UI section fed by `sm check` (deterministic). |
| **Findings panel** | UI section fed by `sm findings` (probabilistic). |
| **WebSocket** | Bidirectional protocol between server and UI. Push of events (job lifecycle, scan updates) + user commands (rescan, submit, cancel). |

---

## Visual roadmap

Mirrors the interactive timeline on `skill-map.dev` (driven by `web/app.js` `PHASES`). Five phases (0 / A / B / C / D); 0 ships highlights, A/B/C ship numbered steps, D ships sketches.

```text
═══════════════════════════════════════════════════════════════════════════
  PHASE 0 · DEFINITION (project shape and the standard)
═══════════════════════════════════════════════════════════════════════════
● Hexagonal architecture · kernel + ports + adapters + 6 plugin kinds
● Persistence model · 1 project scope × 3 zones
● Job subsystem · atomic claim, nonce, kernel-enforced preamble
● Plugin model · 2 storage modes, triple protection
● Frontmatter standard · universal base · provider-owned kind schemas
● Trigger normalization · 6-step pipeline
● Config hierarchy · defaults → project → project-local → override
● Versioning policy · changesets, independent semver per package
● Spec as a standard · separable from reference impl
● 29 schemas + 9 prose contracts + conformance suite
● 117 architectural decisions, logged
● @skill-map/spec published on npm
  ────────────────────────────────────────────────────────────────────────
   ▶ @skill-map/spec released

═══════════════════════════════════════════════════════════════════════════
  PHASE A · DETERMINISTIC CORE (scan, model, query, no LLM)
═══════════════════════════════════════════════════════════════════════════
●  0b   Implementation bootstrap     workspace, kernel shell, CLI binary, conformance harness, CI green
●  0c   UI prototype (Flavor A)      Angular + Foblex Flow + PrimeNG, mock collection, list / graph / inspector
●  1a   Storage + migrations         SQLite via node:sqlite, kernel migrations, auto-backup, sm db * verbs
●  1b   Registry + plugin loader     six kinds enforced, drop-in discovery, sm plugins list/show/doctor
●  1c   Orchestrator + dispatcher    scan skeleton, full Clipanion verb registration, sm help, autogen reference
●  2    First extensions             claude provider · 3 extractors · 3 analyzers · ASCII formatter · validate-all
●  9.7  Multi-provider rollout       declarative kernel walker (parser registry) · gemini + agent-skills providers · `classify(): string \| null` · per-Provider painting · `note` → `markdown` rename (Gemini was later retired 2026-05-19 when Antigravity replaced Gemini CLI under the open `.agents/skills/` standard)
●  3    UI design refinement         node cards, connection styling, inspector layout, dark mode parity
●  4    Scan end-to-end              sm scan persists · per-node tokens · external-url-counter · --changed · sm list/show/check
●  5    History + orphans            scan_meta · sm history + stats · auto-rename heuristic · sm orphans · canonical-YAML hash
●  6    Config + onboarding          settings(.local).json · 6-layer loader · sm config * · .skillmapignore · sm init · scan strict
●  7    Robustness                   sm watch + chokidar · link-conflict analyzer · sm job prune · trigger normalization
●  8    Diff + export                sm graph · sm scan compare-with · sm export with mini query language
●  9    Plugin author UX             plugin runtime · plugin migrations · author guide
●  ALm  Active-lens migration        Phases 1–6 (2026-05-19→05-23): active-provider lens · Signal IR scaffold · numeric `Confidence` · MCP virtual nodes + `core/mcp-tools` extractor · OpenAI Codex provider (`.codex/agents/*.toml`) · Antigravity onboarded + Gemini retired · lens-only extractor gating · provider-aware confidence bump on resolved links · reserved-name catalog + analyzer + confidence downgrade · observable link analysis (`core/link-counts` chips, in/out per-kind tooltip) · lens-drift warning · db-version skew detection · auto-detect on first scan
  ────────────────────────────────────────────────────────────────────────
   ▶ YOU ARE HERE, Steps 0–9 + 14.1–14.7 + active-lens migration Phases 1–6 complete · v0.6.0 shipped (CI/publish wiring deferred to Step 15). Phase B opens with Step 10 (job subsystem) next; the only remaining pre-v1.0 deterministic deliverable is the Codex body extractor (Step 13).
  ────────────────────────────────────────────────────────────────────────
   ▶ skill-map@0.5

═══════════════════════════════════════════════════════════════════════════
  PHASE B · LLM AS AN OPTIONAL LAYER (summaries, semantic verbs)
═══════════════════════════════════════════════════════════════════════════
●  9.6  Foundation refactors         Open node kinds · storage port promotion (5 namespaces) · universal enrichment · incremental scan cache
○  10a  Queue infrastructure         state_jobs + content-addressed state_job_contents · atomic claim · sm job submit/list/show/preview/claim/cancel/status · sm record + nonce
○  10b  LLM runner                   ClaudeCliRunner + MockRunner · ctx.runner injection · sm job run full loop · sm doctor runner probe · /skill-map:run-queue Skill agent
○  10c  First probabilistic ext      skill-summarizer (Action) · extension-mode-derivation + preamble-bitwise-match · github-enrichment plugin
○  11a  Per-kind summarizers         agent · command · skill · markdown · (per-Provider qualified ids)
○  11b  Semantic LLM verbs           sm what · sm dedupe · sm cluster-triggers · sm impact-of · sm recommend-optimization · sm findings
○  11c  /skill-map:explore meta      cross-extension orchestration over the queue + summaries
○  16   UI: LLM surfaces v1          Inspector summary/enrichment/findings cards (read-only) · /findings page · per-card refresh · cost surfacing · BFF endpoints
  ────────────────────────────────────────────────────────────────────────
   ▶ target: v0.8.0, LLM optional layer + initial UI hand-off

═══════════════════════════════════════════════════════════════════════════
  PHASE C · SURFACE & DISTRIBUTION (formatters, full web UI, single-binary release)
═══════════════════════════════════════════════════════════════════════════
○  12   Additional formatters        Mermaid · DOT/Graphviz · subgraph export with filters
○  13   Multi-host adapters          Codex body extractor · Copilot · per-host sm-<host>-* skill namespace · adapter conformance · (Codex + agent-skills + Antigravity onboarded during the post-v0.6.0 active-lens migration; legacy Gemini Provider shipped at 9.7 and retired 2026-05 when Antigravity replaced Gemini CLI)
○  14a  Web UI: BFF + transport      Hono BFF · WebSocket /ws · single-port mandate · Angular SPA + REST + WS under one listener · sm serve --port N
○  14b  Web UI: Flavor B slice       Inspector with enrichment + summaries + findings · command submit from UI · chokidar live updates · MD body renderer pick
○  14c  Web UI: polish & budgets     URL-synced filter state · responsive scope · bundle budget · dark mode tri-state · Foblex types reassessment
○  17   UI: LLM surfaces v2          Verbs as flows (what · dedupe · cluster-triggers · impact-of · recommend-optimization) · queue inspector · findings management · cost dashboard · settings + plugins page · WCAG AA pass
○  15a  Single package distrib       @skill-map/cli with UI bundled · sm + skill-map binary aliases · sm ui sub-command · settings loader + runtime-settings schema
○  15b  Documentation site           Astro Starlight · plugin API reference (JSDoc → Starlight) · llms.txt + llms-full.txt · skill-map.dev launch · context7
○  15c  Release infrastructure       GH Actions release + changelog · telemetry opt-in · compatibility matrix · breaking-changes policy · sm doctor diagnostics · Claude Code wrapper
  ────────────────────────────────────────────────────────────────────────
   ▶ target: v1.0.0, full distributable

═══════════════════════════════════════════════════════════════════════════
  PHASE D · REAL-TIME (pending, watch execution as it happens)
═══════════════════════════════════════════════════════════════════════════
○       Event stream                 live WebSocket from the kernel to the UI
○       Execution snapshot           immutable audit of every run
○       Real-time exploration        watch agents and skills as they run
○       Marketplace ?                plugin discovery and distribution, to evaluate
═══════════════════════════════════════════════════════════════════════════

  Analyzer: the LLM is never required. Product is complete offline through Phase A.
```

---

## Spec as a standard

`skill-map` is a reusable standard, not only a tool. The **spec** is separated from the **reference implementation** from day zero. Anyone can build a UI, a CLI, a VSCode extension, or an entirely new implementation (any language) using only `spec/`, without reading the reference source.

### Repo layout

```
skill-map/
├── spec/                          ← source of truth for the STANDARD (25 schemas + 7 prose contracts + plugin author guide)
│   ├── README.md                  ← human-readable spec
│   ├── CHANGELOG.md               ← spec history (independent from tool)
│   ├── versioning.md              ← evolution policy
│   ├── architecture.md            ← hexagonal ports & adapters
│   ├── cli-contract.md            ← verbs, flags, exit codes, JSON introspection
│   ├── job-events.md              ← canonical event stream schema
│   ├── prompt-preamble.md         ← canonical injection-mitigation preamble
│   ├── db-schema.md               ← table catalog (kernel-owned)
│   ├── plugin-kv-api.md           ← ctx.store contract for storage mode A
│   ├── job-lifecycle.md           ← queued → running → completed | failed
│   ├── index.json                 ← machine-readable manifest + per-file sha256
│   ├── package.json               ← published as @skill-map/spec
│   ├── plugin-author-guide.md     ← drop-in plugin authoring contract (manifest, six kinds, storage modes)
│   ├── schemas/                   ← 25 JSON Schemas, draft 2020-12, camelCase keys
│   │   ├── node.schema.json                 ┐
│   │   ├── link.schema.json                 │
│   │   ├── issue.schema.json                │
│   │   ├── scan-result.schema.json          │
│   │   ├── execution-record.schema.json     │ 11 top-level
│   │   ├── project-config.schema.json       │
│   │   ├── plugins-registry.schema.json     │
│   │   ├── job.schema.json                  │
│   │   ├── report-base.schema.json          │
│   │   ├── conformance-case.schema.json     │
│   │   ├── history-stats.schema.json        ┘
│   │   ├── api/                             ← BFF wire envelopes (Step 14.2)
│   │   │   └── rest-envelope.schema.json    ← 1 envelope schema
│   │   ├── extensions/                      ← one per extension kind (loaded at plugin load)
│   │   │   ├── base.schema.json             ┐
│   │   │   ├── provider.schema.json         │
│   │   │   ├── extractor.schema.json        │ 7 extension schemas
│   │   │   ├── analyzer.schema.json             │ (base + 6 kinds)
│   │   │   ├── action.schema.json           │
│   │   │   ├── formatter.schema.json        │
│   │   │   └── hook.schema.json             ┘
│   │   ├── frontmatter/                     ← universal-only; per-kind schemas live in the Provider that declares them
│   │   │   └── base.schema.json             ← 1 universal frontmatter schema
│   │   └── summaries/                       ← kernel-controlled; additionalProperties: false
│   │       ├── skill.schema.json            ┐
│   │       ├── agent.schema.json            │ 5 summaries (extend
│   │       ├── command.schema.json          │ report-base via allOf)
│   │       ├── hook.schema.json             │
│   │       └── markdown.schema.json         ┘
│   ├── interfaces/
│   │   └── security-scanner.md              ← convention over the Action kind (NOT a 7th kind)
│   └── conformance/
│       ├── README.md                        ← human-readable guide to the suite
│       ├── coverage.md                      ← release-gate matrix (schemas + artifacts ↔ cases)
│       ├── fixtures/                        ← controlled MD corpora + preamble-v1.txt
│       └── cases/                           ← basic-scan, kernel-empty-boot (preamble-bitwise-match deferred to Step 10)
└── src/                           ← reference implementation (published as skill-map)
```

### Properties

- **Machine-readable**: all schemas are JSON Schema; validate from any language.
- **Human-readable**: prose documents with examples.
- **Independently versioned**: spec `v1.0.0` implementable by CLI `v0.3.2`.
- **Platform-neutral**: no Claude Code required in any schema; it's one example adapter.
- **Conformance-tested**: any implementation passes or fails, binary.

### Distribution

- Publish schemas to JSON Schema Store (deferred until the `v0 → v1` stable release; current `v0` URLs are live but pre-stable).
- Canonical URLs: `https://skill-map.dev/spec/v0/<path>.schema.json` (live today via Railway-deployed Caddy; DNS at Vercel). Scheme bumps to `v1` at the first stable release.
- npm package `@skill-map/spec`, schemas + conformance tests.
- Spec semver separate from CLI semver; the current reference roadmap stabilizes both tracks at `v1.0.0`, but future versions can diverge.

---

## Architecture: Hexagonal (Ports & Adapters)

```
                    Driving adapters (primary)
                         │
   ┌─────────┐       ┌─────────┐       ┌──────┐
   │   CLI   │       │ Server  │       │Skill │
   └────┬────┘       └────┬────┘       └───┬──┘
        │                 │                │
        └─────────────────┼────────────────┘
                          ▼
                   ┌──────────────┐
                   │    Kernel    │  ← domain core (pure use cases)
                   └──────┬───────┘
                          │
      ┌────────┬──────────┴──────────┬────────┐
      ▼        ▼                     ▼        ▼
  ┌────────┐ ┌────┐              ┌─────────┐ ┌────────┐
  │ SQLite │ │ FS │              │ Plugins │ │ Runner │
  └────────┘ └────┘              └─────────┘ └────────┘
                Driven adapters (secondary)
```

(ProgressEmitterPort exists alongside the four shown; its adapters are terminal sinks, `pretty` / `stream-output` / `--json`, and do not participate in the kernel-owning diagram.)

- Kernel accepts **ports** (interfaces) for `StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`.
- Kernel never imports SQLite, fs, or subprocess directly.
- Each adapter swappable: `InMemoryStorageAdapter` for tests, real `SqliteStorageAdapter` in production; `MockRunner` for tests, real `ClaudeCliRunner` in production.
- Test pyramid collapses cleanly: unit tests inject mocks into kernel; integration tests wire real adapters.
- CLI-first principle reinterpreted: CLI and UI are **peers** consuming the same kernel API, neither depends on the other.

### Package layout

pnpm workspaces. Two today (`spec/`, `src/`); `ui/` joins at Step 0c. Changesets manage each package's semver independently (see Decision #5 and the note at the end of this section).

The marker `[Step N]` in the tree below means the folder is part of the target layout and lands at that step, it is NOT yet on disk as of Step 0b. The remaining folders already exist.

```
skill-map/                        ← private root workspace (not published)
├── package.json                  ← { "name": "skill-map-monorepo", "private": true,
│                                     "workspaces": ["spec", "src"],  // "ui" added at Step 0c
│                                     "engines": { "node": ">=24.0" } }
├── .changeset/                   ← changesets config + pending release notes
├── scripts/                      ← build-site.js · build-spec-index.js · check-changeset.js · check-coverage.js
├── web/                          ← editable landing source (HTML/CSS/JS); copied into site/ at build
├── site/                         ← generated public site (Caddy on Railway)
│
├── spec/                         ← workspace #1, published as @skill-map/spec
│   └── (see previous §Repo layout tree)
│
├── src/                          ← workspace #2, published as @skill-map/cli
│   ├── package.json              ← { "name": "@skill-map/cli",
│   │                                  "bin": { "sm": "bin/sm.js", "skill-map": "bin/sm.js" },
│   │                                  "exports": { ".", "./kernel", "./conformance" } }
│   ├── kernel/                   Registry, Orchestrator, domain types, ports, use cases
│   ├── cli/                      Clipanion commands, thin wrappers over kernel
│   ├── conformance/              Contract runner (loads a spec case, asserts against binary)
│   ├── extensions/               Built-in extensions (empty until Step 2; user plugins drop in at `<scope>/.skill-map/plugins/`)
│   ├── test/                     node:test + tsx loader (*.test.ts)
│   ├── bin/sm.js                CLI entry, imports from ../dist/cli
│   ├── index.ts                  Package entry (re-exports)
│   ├── server/         [Step 14] Hono + WebSocket, thin wrapper over kernel
│   ├── migrations/     [Step 1a] Kernel .sql migrations, up-only
│   └── adapters/       [Step 1a+] port implementations
│       ├── sqlite/               node:sqlite + Kysely + CamelCasePlugin
│       ├── filesystem/           real fs
│       ├── plugin-loader/        drop-in discovery
│       └── runner/               claude -p subprocess (ClaudeCliRunner) + MockRunner
│
└── ui/                 [Step 0c] workspace #3, Angular SPA (standalone) + Foblex Flow + PrimeNG
    └── (scaffolded when Step 0c starts; isolation analyzer: no import from ../src/)
```

Two independently published packages (`@skill-map/spec`, `@skill-map/cli`). Two un-scoped placeholder packages (`skill-map`, `skill-mapper`) were published once to lock the names against squatters and have since been retired locally, they remain on npm with a `npm deprecate` notice pointing at `@skill-map/cli` and the workspaces are gone (see decision #5 history). `ui/` stays private at least through v1.0.0. Plugin authors reach the kernel via `import { registerDetector } from '@skill-map/cli/kernel'` (subpath export). Splitting into more `@skill-map/*` packages is deferred until a concrete external consumer justifies it; the org scope is already protected by ownership of `@skill-map/spec`.

The kernel never imports Angular; `ui/` never imports `src/` internals. The sole cross-workspace contract is `spec/` (JSON Schemas + typed DTOs). At Step 14 the Hono BFF inside `src/server/` exposes kernel operations over HTTP/WS, and `sm serve` serves the built Angular SPA from the same listener (single-port mandate).

---

## Persistence

### Two scopes, symmetric

| Scope | Scans | DB location |
|---|---|---|
| **project** (the only scope) | current repo (skills, agents, CLAUDE.md under cwd); positional roots on `sm scan [roots...]` extend the scan per-invocation | `<cwd>/.skill-map/skill-map.db` |

There is no global / user scope, see `spec/cli-contract.md` §Scope is always project-local. The CLI never reads `$HOME` by default; the only way to extend the scan beyond `<cwd>` is passing positional roots to `sm scan` (per-invocation, never persisted). The narrow documented exception is `~/.skill-map/settings.json` (validated by `user-settings.schema.json`), a single file that holds genuinely per-machine preferences (today: the update-check toggle + its throttle bookkeeping; future: locale, theme). It is read directly by the module that owns the feature and never merged into the project config layers.

Project DB is **gitignored by default**. A team that wants to share audit history across contributors opts in explicitly via the `history.share` config flag (`spec/schemas/project-config.schema.json`, marked `Stability: experimental`); when set to `true`, the project is expected to remove `./.skill-map/skill-map.db` from its `.gitignore`. The default stays conservative because the DB carries per-developer state (job runs, summaries, plugin KV) that most teams do not want to diff in PRs.

### Three zones

| Zone | Nature | Regenerable | Examples |
|---|---|---|---|
| `scan_*` | last scan result | yes, `sm scan` truncates and repopulates | `scan_nodes`, `scan_links`, `scan_issues` |
| `state_*` | persistent operational data | no, must back up | `state_jobs`, `state_executions`, `state_summaries`, `state_enrichments`, `state_plugin_kvs` |
| `config_*` | user-owned configuration | no | `config_plugins`, `config_preferences`, `config_schema_versions` |

Backups preserve `state_*` + `config_*`. `scan_*` regenerated on demand.

### Naming conventions

- Tables: `snake_case`, **plural** (`scan_nodes`, `state_jobs`). Zone prefix required.
- Plugin tables: `plugin_<normalized_id>_<table>` where normalization = lowercase + `[^a-z0-9]` → `_` + collapse runs + strip leading/trailing. Collisions after normalization = load-time error.
- Columns: `snake_case`. PK = `id`. FK = `<referenced_table_singular>_id`.
- Timestamps: suffix `_at`, type **INTEGER** (Unix milliseconds).
- Durations: suffix `_seconds` or `_ms`.
- Booleans: prefix `is_` or `has_`.
- Hashes: suffix `_hash`, TEXT (hex).
- JSON blobs: suffix `_json`, TEXT.
- Counts: suffix `_count`, INTEGER.
- Enums: plain column + CHECK constraint, values kebab-case lowercase. No lookup tables.
- Indexes: `ix_<table>_<cols>`. Constraints: `fk_`, `uq_`, `ck_` prefixes.
- SQL keywords UPPERCASE, identifiers lowercase.

### Data-access layer

- **Kysely + CamelCasePlugin** inside the SQLite adapter.
- Kernel / CLI / Server / Skill consume typed repos exposing `camelCase` domain types. Never see SQL.
- Mapping `snake_case ↔ camelCase` is handled automatically inside the adapter.
- Full ORMs (Prisma, Drizzle, TypeORM) rejected, incompatible with hand-written `.sql` migrations.

### Migrations

- Format: `.sql` files only. Naming: `NNN_snake_case.sql` (3-digit sequential padded).
- Version tracking: `PRAGMA user_version` (fast check) + `config_schema_versions(scope, version, description, applied_at)` multi-scope.
- Direction: up-only. Rollback via `sm db restore <backup>`.
- Kernel auto-wraps each migration in `BEGIN` / `COMMIT`. Files contain only DDL.
- Strict versioning, no idempotency required.
- Location: `src/migrations/` (kernel), `<plugin-dir>/migrations/` (plugins).
- Auto-apply on startup with auto-backup (`.skill-map/backups/skill-map-pre-migrate-v<N>.db`). Config flag `autoMigrate: true` default.

### DB management commands

- `sm db reset`, drop `scan_*` only. Keeps `state_*` (history, jobs, summaries, enrichment) and `config_*`. Non-destructive; equivalent to asking for a fresh scan. No prompt.
- `sm db reset --state`, also drop `state_*` and every `plugin_<normalized_id>_*` table (mode B) and `state_plugin_kvs` (mode A). Keeps `config_*`. Destructive to operational history; requires interactive confirmation unless `--yes`.
- `sm db reset --hard`, delete the DB file entirely. Keeps the plugins folder on disk so the next boot re-discovers them. Destructive; requires interactive confirmation unless `--yes`.
- `sm db backup [--out <path>]`, WAL checkpoint + copy.
- `sm db restore <path>`, swap DB.
- `sm db shell`, interactive sqlite3.
- `sm db dump [--tables ...]`, SQL dump.
- `sm db migrate [--dry-run | --status | --to <n> | --kernel-only | --plugin <id> | --no-backup]`.

---

## Job system

### Core model

- **Job** = runtime instance of an Action applied to one or more Nodes. Lives in `state_jobs`.
- **Job file** = MD at `.skill-map/jobs/<id>.md` with rendered prompt + callback instruction. Kernel-generated. Ephemeral (pruned after retention).
- **ID formats**: base shape `<prefix>-YYYYMMDD-HHMMSS-XXXX` (UTC timestamp + 4 lowercase hex chars), with one optional `<mode>` segment on runs. Prefixes: `d-` for jobs, `e-` for execution records, and `r-[<mode>-]` for runs, carried in `runId` on progress events so parallel per-runner streams stay demuxable. Canonical `<mode>` values today: `ext` (external Skill claims), `scan` (scan runs), `check` (standalone issue recomputations). Without `<mode>`, runs are the CLI runner's own loop. Human-readable, sortable, collision-resistant for single-writer. Full analyzer in Decision #88.
- **No maildir**. State lives in DB (`state_jobs.status`); file is content only. Flat folder.

### Lifecycle

```
             submit
                │
                ▼
        ┌──────────┐   atomic claim   ┌──────────┐
        │  queued  │ ───────────────▶ │ running  │
        └────┬─────┘                  └─────┬────┘
             │                              │
             │ cancel                       │ callback success
             │                              │ callback failure
             │                              │ TTL expires (auto-reap)
             │                              │ runner-error / report-invalid
             ▼                              ▼
        ┌────────┐                    ┌──────────────────┐
        │ failed │                    │ completed/failed │
        └────────┘                    └──────────────────┘
```

Terminal states: `completed`, `failed`. `queued → failed` is only reachable via `sm job cancel` (reason `user-cancelled`). Full transition table in `spec/job-lifecycle.md`.

- Atomic claim: `UPDATE state_jobs SET status='running' WHERE id=(SELECT id FROM state_jobs WHERE status='queued' ORDER BY priority DESC, created_at ASC LIMIT 1) AND status='queued' RETURNING id`.
- Auto-reap at start of every `sm job run`: marks `running` rows with `claimed_at + ttl_seconds * 1000 < now` as failed (reason `abandoned`).

### TTL per action

Resolved at submit time in three steps; the outcome is frozen on `state_jobs.ttlSeconds` and never changes for the life of the job.

1. **Base duration** (seconds):
   - `action.expectedDurationSeconds` from the manifest, if declared.
   - Else `config.jobs.ttlSeconds` (default `3600`). Used for `mode: local` actions and any manifest that omits the hint.
2. **Computed TTL**:
   - `computed = max(base × config.jobs.graceMultiplier, config.jobs.minimumTtlSeconds)`.
   - Defaults: `graceMultiplier = 3`, `minimumTtlSeconds = 60` (acts as a floor, never a default).
3. **User overrides** (later wins):
   - `config.jobs.perActionTtl.<actionId>`, replaces steps 1+2 entirely.
   - `sm job submit --ttl <seconds>`, replaces everything.

Normative contract lives in `spec/job-lifecycle.md §TTL resolution`.

### Duplicate prevention

- On submit, check for active `(actionId, actionVersion, nodeId, contentHash)` in status `queued|running`. If exists: refuse with exit code 3 and display existing job-id.
- `--force` override bypasses the check.
- `contentHash = sha256(actionId + actionVersion + bodyHash + frontmatterHash + promptTemplateHash)`.
- Post-completion: no check; re-submit always allowed.

### Runners

Three execution paths, matching the three values the `runner` field in `job.schema.json` can take (`cli` / `skill` / `in-process`):

| Path | Role | `RunnerPort` impl | Execution engine | Isolation | Use case |
|---|---|---|---|---|---|
| **CLI runner loop** (`sm job run`, `runner: cli`) | Driving command that claims, invokes a `RunnerPort` impl, and records | `ClaudeCliRunner` (the driven adapter the loop uses in prod; `MockRunner` in tests) | `claude -p < jobfile.md` subprocess per item | Context-free (clean) | CI, cron, batch |
| **Skill agent** (`/skill-map:run-queue`, `runner: skill`) | Driving adapter that consumes `sm job claim` + `sm record` from inside an LLM session | **None**, the agent IS the execution; it does not cross `RunnerPort` | Agent executes in-session using its own LLM + tools | Context bleeds between items | Interactive |
| **In-process** (`mode: local` actions, `runner: in-process`) | Kernel-internal path for actions that do not need an LLM at all | **None**, the action's own code produces the report; no job file, no subprocess | Action function executes in the submitting process; kernel validates the returned report against `reportSchemaRef` and transitions the job straight to `completed` or `failed` | Same process as the submitter | Deterministic enrichment (`github-enrichment`), cheap aggregations, analyzer-like actions |

The `RunnerPort` interface is implemented by `ClaudeCliRunner` (plus `MockRunner` for tests). `sm job run` is the command loop that uses it, not the port impl itself. The **Skill agent** is a peer driving adapter to CLI / Server: it calls `sm job claim` + `sm record` as any other user of the binary would, and never crosses `RunnerPort`. The name "runner" applied to the skill path is descriptive, not structural. The **in-process** path skips the job file entirely: `sm job submit <local-action>` computes the report synchronously, writes the execution record, and returns. `sm job submit --run` and `sm job run` are no-ops for `mode: local` actions, they already ran.

Skill agent flow:
```
loop:
  1. bash: sm job claim         → <id> or exit 1 (queue empty)
  2. Read: .skill-map/jobs/<id>.md
  3. [agent reasons in-session]
  4. Write: <report-path>
  5. bash: sm record --id <id> --nonce <n> --status completed ...
```

### Nonce + callback auth

- Each job MD has unique `nonce` in frontmatter.
- `sm record` requires `--id <job-id> --nonce <nonce>`, mismatch rejects.
- Prevents forged callback closing someone else's pending dispatch.

### Prompt injection mitigation

Two kernel-enforced layers:

1. **User-content delimiters**: all interpolated node content wrapped in `<user-content id="<node.path>">...</user-content>`. Kernel escapes any literal occurrence of the closing tag inside the content by inserting a zero-width space before the `>`: `</user-content>` → `</user-content&#x200B;>` (U+200B). The substitution is reversed **only for display**, never when computing `bodyHash`, `frontmatterHash`, `contentHash`, or the `promptTemplateHash` fed into the job's content hash. Nesting of `<user-content>` blocks is forbidden; an action template that needs multiple nodes emits one top-level block per node. An action template that interpolates user text outside a `<user-content>` block is rejected at registration time. Full contract in `spec/prompt-preamble.md`.
2. **Canonical preamble**: kernel auto-prepends `spec/prompt-preamble.md` text before any action template. Action templates cannot modify, omit, or precede it. The preamble instructs the model: user-content is data, never instructions; detected injections must be noted in `safety` field of the report.

### Atomicity edge cases

| Scenario | Handling |
|---|---|
| DB `queued`/`running` but MD file missing | Mark `failed` with `error: job-file-missing`. `sm doctor` reports proactively. |
| MD file with no DB row | Reported by `sm doctor`. User runs `sm job prune --orphan-files`. Never auto-deleted. |
| User edited MD file before run | By design: runner uses current content. User owns the consequences. |
| `completed` + file present | Normal. Retention policy (`sm job prune`) eventually cleans. |
| Runner crash between claim and read | Covered by auto-reap; TTL expires → `failed` with `abandoned`. |

### Concurrency

The job subsystem runs jobs **sequentially within a single runner**, one claim / spawn / record cycle at a time. There is no pool or scheduler through `v1.0`.

Multiple runners MAY coexist (e.g. a cron `sm job run --all` in parallel with an interactive Skill agent draining via `sm job claim`). The atomic-claim semantics exist precisely for this case: the `UPDATE ... WHERE status='queued' RETURNING id` guarantees that no two runners ever claim the same row, even when they race.

The event schema carries `runId` + `jobId` so parallel per-runner sequences can be interleaved without losing order per `jobId`. True in-runner parallelism (a pool inside `sm job run`) is a non-breaking post-`v1.0` extension.

### Progress events

Canonical event stream (`spec/job-events.md`):

- **Job family (stable)**: `run.started`, `run.reap.started`, `run.reap.completed`, `job.claimed`, `job.skipped`, `job.spawning`, `model.delta`, `job.callback.received`, `job.completed`, `job.failed`, `run.summary`, plus the synthetic `emitter.error`.
- **Non-job families (experimental, v0.x)**: `scan.*` (`scan.started`, `scan.progress`, `scan.completed`) and `issue.*` (`issue.added`, `issue.resolved`). Shipped at Step 14 with the WebSocket broadcaster; shapes lock when promoted to `stable` in a later minor bump.

All events share the envelope `{ type, timestamp, runId, jobId, data }`. Non-job events use synthetic runs: scans run under `r-scan-…`, standalone issue recomputations under `r-check-…` (same `r-<mode>-…` pattern as `r-ext-…` for external Skill claims).

Emitted via `ProgressEmitterPort`. Three output adapters:
- **pretty** (default TTY): line progress, colored.
- **`--stream-output`**: pretty + model tokens inline (debug).
- **`--json`**: ndjson canonical.

Server re-emits the same events via **WebSocket**. Task UI integration (Claude Code's `TaskCreate` and any future host primitive) lives as a host-specific skill (`sm-cli-run-queue`), not as a CLI output mode. Cursor is explicitly out of scope (see §Discarded).

### `sm job` CLI surface

| Command | Purpose |
|---|---|
| `sm job submit <action> -n <id>` | Enqueue (or run inline for local mode). |
| `sm job submit <action> -n <id> --run` | Submit + spawn subprocess immediately. |
| `sm job submit <action> --all` | Apply to every node matching action's precondition. |
| `sm job submit ... --force` | Bypass duplicate check. |
| `sm job submit ... --ttl <seconds>` | Override computed TTL. |
| `sm job submit ... --priority <n>` | Override job priority (Decision #40). Integer; higher runs first; default `0`; negatives permitted. Frozen on `state_jobs.priority` at submit. |
| `sm job list [--status ...]` | List jobs. |
| `sm job show <id>` | Detail (includes TTL remaining for running). |
| `sm job preview <id>` | Render the MD (no execution). |
| `sm job claim [--filter <action>]` | Atomic primitive. Returns next queued id. |
| `sm job run` | CLI runner loop: claim + spawn + record. One job. |
| `sm job run --all \| --max N` | Drain the queue. |
| `sm job status [<id>]` | Counts or single-job status. |
| `sm job cancel <id> \| --all` | Force one or every queued/running job to `failed`. |
| `sm job prune` | Retention GC. |
| `sm job prune --orphan-files` | Clean orphan MD files. |

---

## Plugin system

### Six plugin kinds

| Kind | Role | Modes | Reads | Writes |
|---|---|---|---|---|
| **Provider** | Knows a platform: declares its kinds + their schemas + globs, classifies paths to kinds. | det only | filesystem | none directly |
| **Extractor** | Extracts data from a parsed node body, emits links, enriches the node, or persists custom data. | det / prob | one node | `links`, enrichment layer, or plugin's own table |
| **Analyzer** | Cross-node reasoning over the merged graph; emits issues. | det / prob | full graph | `issues` |
| **Action** | Operates on one or more nodes; the only kind that mutates source files. | det / prob | one or more nodes | filesystem (det) or rendered prompt to runner (prob) |
| **Formatter** | Serializes the graph to a string output (ASCII / Mermaid / DOT / JSON / custom). | det only | full graph | stdout (string) |
| **Hook** | Reacts to a curated set of kernel lifecycle events; declarative subscriber. | det / prob | event payload + node + job result | side effects (notifications, integrations, cascades) |

The six extension kinds are Provider, Extractor, Analyzer, Action, Formatter, Hook. The kernel ships `validate-all` as a Analyzer (post-scan AJV revalidation against the spec schemas); there is no Suite, Enricher, or composer kind, composition is explicit at the verb / Hook level.

### Drop-in installation

No `add` / `remove` verbs. User drops files in:
- `<cwd>/.skill-map/plugins/<plugin-id>/` (project, the only default discovery root)
- `--plugin-dir <path>` (per-invocation escape hatch on the `sm plugins …` verb family, replaces the default root with a custom directory)

**Analyzer (added in v0.8.0)**: the directory name MUST equal the manifest's `id` field. Mismatch → `invalid-manifest`. This eliminates same-root id collisions by filesystem construction. Cross-root collisions (project default vs any `--plugin-dir <path>` override, or built-in vs user-installed) produce a new status `id-collision`, both involved plugins are blocked, no precedence magic, the user resolves by renaming.

Layout:
```
<plugin-id>/
├── plugin.json              ← manifest
├── extensions/
│   ├── foo.extractor.js
│   ├── foo.hook.js
│   └── ...
├── conformance/             ← per-plugin conformance suite (Provider + others optional)
│   ├── cases/
│   └── fixtures/
├── schemas/                 ← Provider-only: per-kind frontmatter schemas
│   └── ...
└── migrations/              ← only if storage mode dedicated
    └── 001_initial.sql
```

Manifest:
```json
{
  "id": "my-cluster-plugin",
  "version": "1.0.0",
  "specCompat": "^0.8.0",
  "extensions": [
    "extensions/foo.extractor.js",
    "extensions/foo.hook.js"
  ],
  "storage": {
    "mode": "kv"
  }
}
```

Pre-`v1.0.0`, `specCompat` pins a **minor range** per `versioning.md` §Pre-1.0. Narrow pins are the defensive default because minor bumps MAY carry breaking changes while the spec is `0.y.z`. Once the spec ships `v1.0.0`, manifests move to `"^1.0.0"`.

### Loading

On boot or `sm plugins list`:
1. Walk `<cwd>/.skill-map/plugins/*` (or the `--plugin-dir <path>` override when set).
2. For each candidate plugin: read `plugin.json`; verify `directory == manifest.id` (else `invalid-manifest`); check id uniqueness across every active discovery root (else `id-collision` for both involved); run `semver.satisfies(specVersion, plugin.specCompat)` (else `incompatible-spec`).
3. Dynamic-import each extension. Validate against the kind schema. Register in the kernel under the qualified id `<plugin-id>/<extension-id>` per kind.
4. If plugin has storage mode dedicated: kernel provisions tables (prefix-enforced) and runs migrations.

The status set is now six: `loaded`, `disabled`, `incompatible-spec`, `invalid-manifest`, `load-error`, `id-collision`.

### Extension ids are qualified

Every extension is registered as `<plugin-id>/<extension-id>` per kind. Cross-extension references (`defaultRefreshAction`, CLI flags, dispatch identifiers) all use the qualified form. ESLint pattern (`plugin-name/analyzer-name`); two plugins can safely ship extensions with the same short id. Built-ins also qualify, the Claude Provider's walker becomes `claude/walk` (final id during implementation).

### Provider declares its kinds and their schemas

A Provider's manifest now carries a `kinds` map declaring every kind it emits, the schema for that kind's frontmatter, and the default refresh action:

```jsonc
{
  "id": "claude",
  "kind": "provider",
  "kinds": {
    "skill":    { "schema": "./schemas/skill.schema.json",    "defaultRefreshAction": "..." },
    "agent":    { "schema": "./schemas/agent.schema.json",    "defaultRefreshAction": "..." },
    "command":  { "schema": "./schemas/command.schema.json",  "defaultRefreshAction": "..." },
    "markdown": { "schema": "./schemas/markdown.schema.json", "defaultRefreshAction": "..." }
  }
}
```

The spec keeps only `frontmatter/base.schema.json` (universal). Per-kind schemas are no longer normative artifacts of the spec; each Provider owns its kind catalog. A future Cursor Provider would declare `mcp-server`, `mode`, etc. and ship its own schemas.

### Multi-provider rollout (Step 9.7)

Three conventions land together when more than one Provider is active in the same scope:

1. **Declarative `read` instead of hand-rolled `walk()`**. Provider manifests declare `read: { extensions, parser }` (e.g. `{ extensions: ['.md'], parser: 'frontmatter-yaml' }`). The kernel walker owns symlink-skip (audit M7), TOCTOU re-stat, ignore-filter consumption, prototype-pollution strip, and the `js-yaml` JSON_SCHEMA pin so every Provider inherits them by construction. Built-in parsers ship as a closed set inside the kernel (`frontmatter-yaml`, `plain`); user plugins cannot register their own. A Provider that needs non-standard discovery still implements `walk()` directly, it wins over `read` and accepts the duplication of audit defences.

2. **`classify(): string | null`**. With multiple Providers active, every Provider walks every file matching its `read.extensions`. Each Provider claims its own conventions and disclaims the rest by returning `null`. The orchestrator skips disclaimed paths, so the same path is never persisted twice. Concretely (current catalog): Claude claims `.claude/`, `notes/`, `CLAUDE.md`; OpenAI Codex claims `.codex/agents/*.toml` (and routes their TOML envelope through the kernel walker); the neutral `agent-skills` Provider claims `.agents/skills/<n>/SKILL.md` (the same on-disk home Google adopted for Antigravity skills after retiring the vendor-specific `.gemini/` layout); the `core` fallback owns generic `.md`. The `antigravity` Provider is metadata-only (always returns `null`) and only contributes lens identity + reserved-names. Files outside every Provider's territory are silently ignored. The spec's `provider-ambiguous` issue still fires when two Providers DO claim the same file (e.g. a misconfigured plugin); the disclaim contract prevents the legacy "Claude as catch-all for any markdown" footgun that otherwise produces the conflict by default.

3. **Format-named kinds = fallback only**. Each Provider has one fallback kind named after the file's *format* (`markdown` today; future `toml` for Codex's slash-commands, future `json` for Gemini's extension manifests). The convention: format-named kinds apply only when no specific role matches, a `.toml` file that IS a Codex agent classifies as `agent`, never `toml`. Specific roles (agent / command / skill) prevail over format naming. The Claude fallback was renamed `note` → `markdown` to land this convention.

### Per-Provider node painting (kindRegistry)

When two Providers declare the same kind name (e.g. Claude `agent` and Codex `agent`), the BFF's `kindRegistry` keeps every contribution under `entry.providers[<providerId>]` and points `primaryProviderId` at the first Provider in iteration order. The primary drives the kind's shared CSS var (`--sm-kind-<kind>`) so static stylesheets stay valid; per-node painting picks `entry.providers[node.provider]` to override the accent inline. Result: a Claude-sourced `agent` paints blue, a Codex-sourced `agent` paints with its own palette, on the same graph, without forcing different kind names. The UI exposes `KindRegistryService.providersOf(kind)` for surfaces that need the full per-Provider drill-down (inspector audit panel, future plugin-contributions panel).

The sibling **`providerRegistry`** carries the Provider's OWN identity (the manifest `presentation` block: label, color, optional `colorDark` / `icon` / `emoji` / `hideChip`), distinct from its kinds' visuals. The BFF assembles it at boot the same way (`buildProviderRegistry`) and embeds it on every payload-bearing envelope; the SPA's `ProviderRegistryService` feeds the active-lens dropdown, the topbar lens chip, and the per-node provider chip from it, so adding a Provider never requires a UI edit. `hideChip` (set by the universal `markdown` fallback) suppresses only the per-card badge. Auto-detect markers ride on the same manifest (`detect.markers`), so the detectable lens set also derives from the registered Providers rather than a hardcoded table.

### Extractor's three persistence channels

The Extractor receives in its `ctx`:
- `ctx.emitLink(link)` → kernel persists in the `links` table.
- `ctx.enrichNode(partial)` → kernel persists in a separate enrichment layer (see §Enrichment for staleness analyzers).
- `ctx.store.write(table, row)` → plugin's own table `plugin_<id>_*`.

The plugin chooses which channels it uses, possibly multiple in one `extract()` call. There is no `type` field; the plugin id is the natural namespace. **Deterministic-only**: every Extractor runs in `sm scan` Phase 1.3. LLM-driven enrichment of a node is an Action concern (queued as a job, dispatched via `sm job submit action:<plugin-id>/<action-id>`); Extractor manifests MUST NOT declare a `mode` field.

Optional `applicableKinds: ['skill', 'agent']` filter in the manifest lets the kernel skip invocation for non-applicable nodes (zero-cost CPU skip, Extractor is deterministic). Default absent = applies to all kinds. Optional `outputSchema` per `store.write` table (or per KV namespace) declares a JSON Schema; the kernel runs AJV validation on every write and throws on shape violations. Default absent = permissive.

### Incremental scan cache, per Extractor

A new table `scan_extractor_runs(node_path, extractor_id, body_hash_at_run, ran_at)` lets the orchestrator skip re-running an Extractor on a node when both (a) `node.body_hash` is unchanged and (b) that specific Extractor already ran against the same hash. When a new Extractor is registered between scans, only the new one runs against cached nodes; when an Extractor is unregistered, its links / enrichments are cleaned without invalidating the rest. The cache turns `sm scan --changed` into a one-row reuse on unchanged bodies, and the same machinery is what a future Action-issued probabilistic enrichment revision will leverage to reuse paid LLM output across unchanged bodies.

### Hook trigger set

The Hook manifest declares one or more `triggers` from the curated hookable set. Eight are pipeline-driven (emitted from inside `runScan`); two (`boot`, `shutdown`) are CLI-process-driven (emitted by `cli/entry.ts` before / after the verb runs):

1. `boot`, once per CLI process, BEFORE the verb routes. The dispatcher AWAITS subscribed hooks so anything they print lands above the verb's output (`core/update-check` relies on this); a slow hook delays the first verb paint. Dispatched via the entry-side dispatcher, not the orchestrator.
2. `scan.started`, pre-scan setup.
3. `scan.completed`, post-scan reaction.
4. `extractor.completed`, aggregated per-Extractor outputs and duration.
5. `analyzer.completed`, aggregated per-Analyzer outputs and severities.
6. `action.completed`, Action executed on a node.
7. `job.spawning`, pre-spawn of a runner subprocess (gating).
8. `job.completed`, most common trigger; notifications, integrations, future cascades.
9. `job.failed`, alerts, retry triggers.
10. `shutdown`, once per CLI process, AFTER the verb's exit code resolves and BEFORE `process.exit`. The dispatcher awaits subscribed hooks; a slow hook delays the exit but never alters the resolved exit code (errors are caught).

Other lifecycle events (`scan.progress` per node, `run.reap.*`, `job.claimed`, `model.delta`, `job.callback.received`, `run.started`, `run.summary`) are intentionally not hookable, too verbose, too internal, or already covered by another trigger. Declaring an unsupported trigger in a manifest is `invalid-manifest` at load time.

Hooks support declarative `filter` blocks per trigger; the kernel validates that the fields used in the filter are valid for the declared triggers (cross-field validation). Dual-mode (`mode: 'deterministic'` default).

The dispatcher itself lives in [`src/kernel/extensions/hook-dispatcher.ts`](./src/kernel/extensions/hook-dispatcher.ts) so both entry points (orchestrator for the eight pipeline triggers, CLI entry for `boot` / `shutdown`) share the same indexing / filter / error-handling semantics. First built-in concrete consumer: [`core/update-check`](./src/plugins/hooks/update-check/index.ts) (subscribes to `boot`).

### Storage modes

Plugin declares in manifest:

| Mode | Declaration | API | Backing |
|---|---|---|---|
| **A, KV** | `"storage": { "mode": "kv" }` | `ctx.store.{get,set,list,delete}` scoped by `plugin_id` | Kernel table `state_plugin_kvs(plugin_id, node_id, key, value_json, updated_at)`. Per spec `db-schema.md`, plugin-owned serialized values use the standard `_json` suffix. |
| **B, Dedicated** | `"storage": { "mode": "dedicated", "tables": [...], "migrations": [...] }` | Scoped `Database` wrapper | Kernel-provisioned tables `plugin_<normalized_id>_<table>` |

Each table (Mode B) or the KV namespace (Mode A) MAY declare an `outputSchema` for write-side validation (see Extractor section above).

### Triple protection (mode B)

1. **Prefix enforcement**: kernel injects `plugin_<id>_` into every DDL. Plugin cannot create un-prefixed tables.
2. **DDL validation**: reject FK to kernel tables, triggers on kernel tables, `DROP`/`ALTER` of kernel tables, `ATTACH`, global PRAGMAs.
3. **Scoped connection**: plugin receives a `Database` wrapper, not raw handle. Wrapper rejects cross-namespace queries at runtime.

Honest note: drop-in plugins are user-placed code; protection guards accidents, not hostile plugins. Post-v1.0 evaluates signing.

### Plugin commands

| Command | Purpose |
|---|---|
| `sm plugins list` | Auto-discovered from folders. Status column shows one of six values. |
| `sm plugins show <id>` | Manifest + compat status. |
| `sm plugins enable <id>... \| --all` | Toggle one, many, or every discovered plugin on (persisted in `config_plugins`). Batches are all-or-nothing. |
| `sm plugins disable <id>... \| --all` | Toggle one, many, or every discovered plugin off without deleting. Batches are all-or-nothing. |
| `sm plugins doctor` | Revalidate specCompat, exit 1 on any non-loaded / non-disabled plugin. |
| `sm conformance run [--scope spec\|provider:<id>\|all]` | Run conformance suites, spec only, a specific provider, or everything. |
| `sm check --include-prob` | Opt-in flag: `sm check` also runs probabilistic Analyzers, dispatched as jobs and awaited synchronously. Combines with `--analyzers <ids>` and `-n <node>`. |

### Default plugin pack

The reference impl bundles built-ins for each kind: one Provider (`claude`), several Extractors (`slash`, `at-directive`, `import`), several Analyzers (`trigger-collisions`, `dangling-refs`, `link-conflict`, `validate-all`), at least one Action, one Formatter (`ascii`). Hooks ship as needed for first-party integrations.

`github-enrichment` remains the firm commitment for the Action lineup (needed for hash verify property). Third-party plugins (Snyk, Socket) install post-`v1.0` against `spec/interfaces/security-scanner.md`.

---

## UI contribution system

### Why this exists

Out of the six plugin kinds, the only first-class UI surface today is the Provider's `kinds[*].ui` block (label, color, icon). Extractors that emit links and analyzers that emit issues ride the canonical kernel-built UI (`linked-nodes-panel`, issues panels). The moment a plugin author wants to surface anything else, a counter, a tag, a per-node breakdown, a tree, a key-value record from parsed frontmatter, there is no path. They cannot ship Angular components from a plugin (correctly, by design); the kernel has no extension surface for "render this data per node".

The annotation-contributions system (Step 9.6.6) covers sidecar root keys but only that. Everything else has been deferred to Decision #293 ("Third-party UI + BFF extensions") as post-v1.0.

This system fills the gap with a deterministic, scoped, built-in-driven model that lands pre-v1.0.

### Two layers (post-2026-05-10 collapse)

| Term | Owner | Definition |
|---|---|---|
| **Slot** | Spec + kernel + UI | A named visual surface in the UI that fixes both the renderer and the payload shape. Closed catalog of 15 slots in `spec/schemas/view-slots.schema.json`. The plugin author picks ONE slot per contribution; that pick is the entire mental model. |
| **Contribution** | Plugin | Per-node typed data emission via `ctx.emitContribution(id, payload)`, payload conforms to the slot's payload schema. |

Plugin authors pick slots. The kernel + spec publish the catalog and the per-slot AJV payload schemas. There is no separate "contract" abstraction, the slot IS the contract.

**Earlier model (superseded)**: a separate "Contract" layer (11 contract names like `node-counter`, `node-tag`) sat between Slot and Contribution. The plugin author picked a contract and the UI broadcast each contribution to ALL slots compatible with that contract. The 2026-05-10 redesign eliminated the contract layer because it doubled the mental model with no real win for plugin authors and produced surprise duplication when the same data appeared in 4 places automatically. See decision #9 below.

### Slot catalog (15)

Five monomorphic slots:
- `card.title.right`, icon marker
- `card.subtitle.left`, counter chip
- `card.footer.right`, counter chip
- `graph.node.alert`, corner badge
- `topbar.nav.start`, scope chip

Nine sub-slots from the three formerly-polymorphic surfaces (split via dotted suffix per shape):
- `card.footer.left` (counter, collapsed back to the bare base after the `card.footer.left.tag` sub-slot was dropped, leaving the counter as the sole shape on the left footer; symmetrical with `card.footer.right`)
- `inspector.header.badge.counter`, `inspector.header.badge.tag`
- `inspector.body.panel.breakdown`, `inspector.body.panel.records`, `inspector.body.panel.tree`, `inspector.body.panel.key-values`, `inspector.body.panel.link-list`, `inspector.body.panel.markdown`

Each slot has a single Angular renderer and a single payload shape. Multiple slots may share a renderer (e.g. NodeCounter is mounted in 4 slots). Documented in `spec/view-slots.md` with payload shape, renderer, and "Where it renders" per slot.

### Input-type catalog for settings (10)

`string-list`, `single-string`, `boolean-flag`, `integer`, `enum-pick`, `enum-multipick`, `path-glob`, `regex`, `secret`, `key-value-list`. Plugin authors declare settings by picking an input-type from this catalog; the autogenerated settings form picks the right control per type. Documented in `spec/input-types.md`.

### Manifest declaration

`viewContributions: Record<string, IViewContribution>` on each extension (parallel to `annotationContributions`). `settings: Record<string, ISettingDeclaration>` at the manifest root. New optional field `catalogCompat: string` (semver) at the manifest root, parallel to `specCompat`. New plugin-load status `incompatible-catalog`.

Worked example, a `keyword-finder` extractor:

```jsonc
{
  "id": "keyword-finder",
  "kind": "extractor",
  "viewContributions": {
    "breakdown": { "slot": "inspector.body.panel.breakdown", "label": "Keyword hits", "emptyText": "No matches." },
    "total":     { "slot": "card.footer.left",       "icon": "🔍", "label": "kw", "emitWhenEmpty": false }
  },
  "settings": {
    "keywords": { "type": "string-list", "label": "Keywords to track", "default": ["TODO", "FIXME"], "min": 1 }
  }
}
```

The plugin author types ONE slot id per contribution and a few presentation hints (label, icon, tooltip). Six attributes per contribution + the slot catalog page is the entire mental model. No JSON Schema, no renderer code, no separate "contract" lookup.

The `icon` string is now prefix-discriminated (emoji / `pi-foo` (or `pi pi-foo`) / `fa-{solid|regular|brands} fa-foo` / `fa-foo` shorthand → `fa-solid`); bare names without a `pi-` / `fa-` prefix are rejected at manifest load by the AJV pattern on `IconString`. Greenfield path: no compat shim. See `spec/view-slots.md` §Icon string.

### Slot configuration (UI-side)

```ts
{
  id: 'card.footer.left',
  cardinality: 'multi',           // 'single' | 'multi'
  maxItems: 5,                    // overflow → "+N" tooltip
  order: 'alphabetical',          // 'alphabetical' | 'fifo' | 'priority'
  strategy: 'append'              // 'append' | 'replace-with-warning'
}
```

Default order: alphabetical by `pluginId`, then `extensionId`, then `contributionId`. Deterministic, no priority field on plugin manifests. Replacement strategy `replace-with-warning` is opt-in by the kernel/UI per slot, never by the plugin.

### Persistence

New table `scan_contributions(plugin_id, extension_id, node_path, contribution_id, slot, payload_json, emitted_at)` in the `scan_*` family. Buffered during scan, persisted by `persistScanResult`, indexed on `node_path` + `plugin_id`. Cold-start: table-missing returns empty list (no 500).

**NOT pure replace-all.** The watcher's cached pass leaves the buffer empty for cached nodes (the orchestrator skips `extract()` when the per-(node, extractor) cache hits, so no `emitContribution` fires). A naive wipe-all would silently drop the prior valid rows on every watcher boot. The persist runs three passes inside the same tx:

1. **Orphan sweep**, drops rows whose `node_path` is NOT in the live node set. Disappeared nodes lose their contributions.
2. **Catalog sweep**, drops rows whose qualified id is NOT in the registered runtime catalog. Uninstalled-on-disk plugins / removed contributions lose their rows on the next scan. Disabled plugins are normally purged eagerly at toggle time via `StoragePort.contributions.purgeByPlugin` (called from `sm plugins disable` AND every `PATCH /api/plugins[/:id|/:bundleId/extensions/:extensionId]` variant, the single-id, qualified-id, and bulk forms share the helper); the catalog sweep is the fallback for the rare "config flipped between scans without going through the CLI/BFF" case.
3. **Upsert**, `INSERT ... ON CONFLICT DO UPDATE SET payload_json = excluded.payload_json` for every row in the buffer.

Cached nodes' rows survive untouched. See [`spec/db-schema.md`](spec/db-schema.md) §`scan_contributions` for the full sweep contract.

### BFF surface

- `GET /api/contributions/registered`, runtime catalog (parallel to `/api/annotations/registered`).
- `GET /api/contributions/:pluginId/:extensionId/:contributionId?path=...`, lazy per-node fetch (3 URL segments mirror the qualified id).
- `/api/nodes/:pathB64`, single-node response includes `contributions[]`.
- `/api/nodes` (bulk), embeds contributions for the page slice when `limit ≤ 200`. Above the cap: `meta.contributionsOmitted: true`. Hard cap controlled by setting `bff.maxBulkContributions`.
- `/api/scan`, embeds `contributions[]` on each `nodes[i]` so the SPA's `CollectionLoaderService` (which hydrates from this endpoint on F5 / cold boot) has them on first paint.

### Isolation (six analyzers)

1. No raw DOM from plugin, contributions are typed data, never HTML.
2. CSS scoping by Angular view encapsulation; plugin doesn't write CSS.
3. Data path namespaced and BFF-enforced (`pluginId` ↔ namespace).
4. Click actions are typed kernel verb dispatches by qualified id; no arbitrary URLs / effects.
5. AJV at three layers: manifest at load, payload at emit, envelope at BFF response.
6. Renderers MUST NOT bind contribution data to `[innerHTML]`, `[style]`, `[src]`, `[href]`, or any DomSanitizer DANGEROUS_ATTR. Lint-enforced.

Honest note (extends `plugin-kv-api.md:194`): isolated against accidents, not hostile code, until worker-thread / iframe sandbox post-v1.0.

### Scaffolder

`sm plugins create` is the canonical entry point for new plugins. Walks the author through the closed catalogs, emits a complete plugin directory (`plugin.json`, extension stub with typed `ctx`, test scaffold, README). Hand-writing remains supported (spec is source of truth) but is discouraged. Companion verbs:

- `sm plugins doctor`, extends with `incompatible-catalog` reporting and deprecated-slot warnings.
- `sm plugins upgrade <id>`, catalog migration via closed registry; CLI exit ≠ 0 + UI dialog when auto-migration is impossible.
- `sm plugins slots list`, prints the catalog (15 slots + 10 input types), flags deprecated entries.

### Built-in adopters at landing

- ~~`core/annotations` extractor → `inspector.body.panel.key-values`~~ (originally an adopter as `claude/frontmatter`, renamed to `core/annotations` during the cross-vendor bundle reorganisation; later dropped once the inspector card surfaced `title` / `description` / `version` / `stability` directly, the panel duplicated kernel data and was reclassified as a misadopter of the view contribution system).
- `core/external-url-counter` → `card.footer.right` (counter showing distinct-URL count).
- ~~`core/at-directive` → `card.footer.left`~~ (counter dropped 2026-05-11 along with the sibling `core/markdown-link` and `core/slash` chips, the three per-extractor counters were folded into the single `core/link-counts` pair below, which expresses the same outgoing-link information with the per-kind breakdown one hover away. The extractors still emit links / annotations; only their `viewContributions` block was removed).
- `core/link-counts` (analyzer) → emits two contributions on `card.footer.left`: `linksIn` (`pi-arrow-up`, incoming links by `Link.target`) and `linksOut` (`pi-arrow-down`, outgoing links by `Link.source`). Each chip ships a multi-line tooltip with an `in` / `out` header followed by a per-`Link.kind` breakdown. Promoted from no-op placeholder to active adopter 2026-05-11.
- `core/stability` (extractor) → `card.footer.right` (icon-only chips for `experimental` / `deprecated`; reads sidecar `annotations.stability` first, legacy frontmatter `metadata.stability` second). Migrated from hardcoded card markup in 2026-05-11; replaces the inline experimental SVG + `pi-ban` icons and removes the dead-code injection icon that shared the same wrapper.

The remaining built-ins stay untouched at landing, none have a clear UI surface that would benefit. Further migration is a separate "built-in coverage" sprint.

### Built-in soft-warning analyzers

- `core/unknown-slot`, emits `warn` Issue when a loaded plugin references a slot not in the current catalog (parallel to `core/unknown-field`). Renamed from `core/unknown-contract` in the 2026-05-10 collapse.
- `core/contribution-orphan`, emits `warn` Issue when `scan_contributions` rows point at a node that no longer exists (post-rename heuristic miss).

### Migration UX

`sm plugins upgrade` runs registered migrations against changed contracts / input-types. When auto-migration is impossible: console error, UI dialog, CLI exit ≠ 0. Catalog version on manifest (`catalogCompat`) controls when the upgrade verb runs; pre-1.0 versioning analyzer applies (no major bumps).

### Decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | Slot config ownership | ~~UI-only. Kernel/BFF stays slot-blind.~~ **Superseded 2026-05-10 (decision #9)**: slots are now spec-level. The UI may rearrange visual surfaces beneath a slot id without renaming, but the slot id itself is normative across kernel + BFF + UI. |
| 2 | Per-node payload shape | Always object envelope (`{ value, ... }`). |
| 3 | Multi-instance per extension | `Record<string, IViewContribution>` (parallel to annotations). |
| 4 | Settings change propagation | Rescan-required. UI surfaces "rescan needed" badge. |
| 5 | Catalog version compat | Semver `catalogCompat` field, parallel to `specCompat`. |
| 6 | Bulk endpoint cap | 200 nodes hard, override via `bff.maxBulkContributions`. |
| 7 | Migration UX on incompatibility | Console + dialog + exit ≠ 0. |
| 8 | Built-in adopter list at landing | Two at landing (`core/annotations`, `core/external-url-counter`); `core/annotations` later dropped as misadopter (kernel data, not plugin-derived). Post-2026-05-10: `core/at-directive` and `core/link-counts` joined as adopters of the new slot model. |
| 9 | **Contract layer eliminated (2026-05-10)** | The intermediate "contract" abstraction (11 named contracts the plugin author picked, with the UI broadcasting to all compatible slots) was removed. Plugin authors now pick `slot` directly from a closed catalog of 15 slots; each slot fixes a single renderer + a single payload shape. The polymorphic slots `inspector.body.panel`, `card.footer.left`, `inspector.header.badge` were split into per-shape sub-slots via dotted suffix (e.g. `inspector.body.panel.records`, `card.footer.left.tag`). Trade-off: lost automatic multi-slot broadcast (an author who wants the same data in two surfaces declares two contributions, one per slot); gained a smaller mental model (one catalog instead of two), no surprise duplication, and slot ids that map 1:1 to a payload shape. Slot vocabulary is now part of the public contract, a UI rename is a catalog-major bump. Pre-1.0 breaking change shipped as a minor bump in `@skill-map/spec` and `@skill-map/cli`. |

### Known limitations carried forward

- Catalog evolution treadmill, every new slot adds spec doc + AJV schema + UI renderer wiring + scaffolder support + tests + conformance fixtures.
- Cross-slot orchestration undefined, two contributions sharing underlying state can drift; no kernel arbitration today.
- Probabilistic plugins not modeled, deferred until deterministic model has bedded in.
- Multi-surface broadcast now requires N declarations, by design (decision #9). If a plugin author keeps the values in sync across declarations, they cannot accidentally desync; if they don't, the UI shows the same `mentions` chip with different counts in different places. Post-v1.0 we may revisit a "broadcast group" concept if real-world plugins hit this often.

### Replaces Decision #293

Decision #293 ("Third-party UI + BFF extensions", post-v1.0) is **superseded** by this section for the deterministic case. The probabilistic / sandboxed-iframe case for fully arbitrary third-party UI remains deferred to post-v1.0 per the original decision.

### Follow-up: slot debug overlay (do this properly)

While iterating on the slot map (which contracts go to which slots, where each slot mounts in the templates) it is useful to **see** every slot lit up on the page, even when empty. A throwaway implementation lives today under `ui/src/app/debug-slots.css` + `ui/src/app/services/debug-slots.ts` + greppable `sm-debug-slot` wrappers; activation is `?debug-slots=1` (persisted in `localStorage` under `sm-debug-slots`). It is intentionally hacky, flat CSS file, runtime class on `<html>`, no settings integration, because the runtime settings loader (§Configuration → "Runtime delivery to the UI") does not exist yet.

When the loader lands, replace the hack with a real feature:

1. Add `debug.slotsVisible: boolean` (default `false`) to `ISkillMapSettings` and ship it through `/config.json` like every other UI key.
2. Drive the `<html>` class from a signal fed by the settings, not from `localStorage`.
3. Bind the toggle to the UI, a small dev-mode menu next to the theme switch, or a status-bar entry. URL-driven activation can stay as the developer escape hatch.
4. Replace `<div class="sm-debug-slot" data-debug-slot="...">` wrappers with a tiny `<sm-slot-frame slot="...">` component so the markup names the slot once and the styling lives next to the host.
5. Remove the `DEBUG-SLOTS` markers (`grep -rn 'DEBUG-SLOTS\|sm-debug-slot' ui/src`), that grep is the cleanup checklist.

The hack is wired today to the **five** slots in the catalog, including `graph.node.alert` and `topbar.nav.start`, which previously had no producer. Those mounts are real and stay, only the styling layer is throwaway.

---

## Summarizer pattern

Each node-kind has a default Action that generates a semantic summary. Registered by the adapter:
- `skill-summarizer` → `kind: skill` (`skill-summarizer` lands at Step 10, the other four at Step 11; `v0.5.0` ships none)
- `agent-summarizer` → `kind: agent`
- `command-summarizer` → `kind: command`
- `hook-summarizer` → `kind: hook`
- `markdown-summarizer` → `kind: markdown`

### Schemas

Each summarizer declares a report schema in `spec/schemas/summaries/<kind>.schema.json`, extending `spec/schemas/report-base.schema.json`.

Example, skill:
```json
{
  "confidence": 0.85,
  "safety": { "injectionDetected": false, "contentQuality": "clean" },
  "whatItDoes": "One-sentence summary",
  "recipe": [ { "step": 1, "description": "..." } ],
  "preconditions": ["..."],
  "outputs": ["..."],
  "sideEffects": ["..."],
  "relatedNodes": ["..."],
  "qualityNotes": "..."
}
```

### Storage

Dedicated kernel table `state_summaries`:
```sql
CREATE TABLE state_summaries (
  node_id                  TEXT NOT NULL,
  kind                     TEXT NOT NULL,
  summarizer_action_id     TEXT NOT NULL,
  summarizer_version       TEXT NOT NULL,
  body_hash_at_generation  TEXT NOT NULL,
  generated_at             INTEGER NOT NULL,
  summary_json             TEXT NOT NULL,
  PRIMARY KEY (node_id, summarizer_action_id)
);
```

`sm show <node>` renders the summary if present; marks `(stale)` if current `body_hash ≠ body_hash_at_generation`.

### Probabilistic refresh

UI exposes two buttons per node:
- **🔄 det** → `sm scan -n <id>`: recomputes bytes, tokens, hashes, links. Sync.
- **🧠 prob** → `sm job submit <defaultRefreshAction-for-kind> -n <id>`: async, queued. The default refresh action per kind is the summarizer for that kind.

### Report base schema

All probabilistic reports (summarizers, LLM verbs) extend `report-base.schema.json`:

```json
{
  "confidence": 0.0,
  "safety": {
    "injectionDetected": false,
    "injectionDetails": null,
    "injectionType": null,
    "contentQuality": "clean"
  }
}
```

- `confidence` (0.0–1.0): model's metacognition about its own output.
- `safety.injectionDetected`: boolean; input contains injection attempt.
- `safety.injectionType`: enum (`direct-override`, `role-swap`, `hidden-instruction`, `other`).
- `safety.contentQuality`: enum (`clean`, `suspicious`, `malformed`).

---

## Frontmatter standard

Skill-map AGGREGATES vendor specs, it does not curate them. The base schema declares only what every node, on every Provider, MUST carry to participate in the graph. Vendor-specific fields (Anthropic Claude Code, Cursor, Continue, …) live in the Provider that emits the kind. A Provider's per-kind schema is a verbatim mirror of the vendor's documented frontmatter, skill-map does not pick a subset, does not rename fields, does not re-shape values. When the vendor evolves their schema, the Provider's mirror evolves with it; drift detection vs upstream docs is a deferred follow-up.

Cross-vendor research (Cursor, Continue, Aider, Copilot, Windsurf, Cline, Roo, Anthropic Claude Code, 2026-05) confirmed `description` is the only field universal across the indexable ecosystems; `name` is universal among formats with explicit identifiers (some vendors use the filename as identity, not a frontmatter field). All other fields, `tools`, `model`, `globs`, etc., are vendor idiosyncrasy.

Spec artifact: `spec/schemas/frontmatter/base.schema.json`. Per-kind schemas ship with the Provider that declares each kind, the Claude Provider declares `skill` / `agent` / `command` / `markdown`, ships the corresponding `*.schema.json` files under its own `schemas/` folder, and references them via the `kinds` map in its manifest. The OpenAI Codex Provider declares `agent` (consuming the TOML envelope under `.codex/agents/*.toml`, body extractor for the `instructions` field still pending pre-v1.0); the neutral `agent-skills` Provider declares `skill` only, claiming the open-standard `.agents/skills/<n>/SKILL.md` path that Antigravity also adopted after replacing Gemini CLI; the Antigravity Provider itself is metadata-only and ships no kinds. The retired Gemini Provider used to declare `agent` / `skill` / `markdown`; its bundle was removed in 2026-05 and its on-disk paths route through `agent-skills` (skills) and the `core/markdown` fallback (`AGENTS.md`). A different Provider (Cursor, Cline, custom runner) brings its own kind catalog and its own schemas; the kernel does not opine on the kind list.

### Base (universal, lives in spec)

**Two fields, both required**:

- `name`, short human-readable identifier (`string`, `minLength: 1`).
- `description`, one-to-three-sentence description (`string`, `minLength: 1`).

The base declares `additionalProperties: true` so vendor-specific fields and skill-map annotation fields flow through validation silently, formal validation of those happens in the per-kind extension (vendor fields) or in a future skill-map annotation schema (annotation fields, see §Skill-map annotation fields below).

This is intentionally minimal. Earlier versions of the base carried a richer field set (`type`, `author`, `authors`, `license`, `tools`, `allowedTools`, `metadata.{version, stability, supersedes, …}`); Step 9.5 (2026-05) trimmed it after the cross-vendor research showed those fields were either Claude-specific (`tools`, `allowedTools`) or skill-map-invented (`metadata.*`), neither is universal, neither belongs in the universal base. Decision #55 (which justified `tools`/`allowedTools` at base "to mirror Claude Code's frontmatter shape") is superseded by the absorb-verbatim principle.

### Kind-specific (lives in the Provider that declares the kind)

The Claude Provider's catalog mirrors Anthropic's official docs verbatim. Per-kind schema files extend `base.schema.json` via `allOf` + `$ref`; all declare `additionalProperties: true` so future Anthropic additions do not break consumers.

| Kind | Schema file | Anthropic source | Fields beyond `name`+`description` |
|---|---|---|---|
| `agent` | `claude/schemas/agent.schema.json` | https://code.claude.com/docs/en/sub-agents.md | 14 fields: `tools[]`, `disallowedTools[]`, `model`, `permissionMode` (enum), `maxTurns`, `skills[]`, `mcpServers[]`, `hooks` (object), `memory` (enum: `user` \| `project` \| `local`), `background`, `effort` (enum: `low` \| `medium` \| `high` \| `xhigh` \| `max`), `isolation` (enum: `worktree`), `color` (enum of 8), `initialPrompt`. |
| `skill` | `claude/schemas/skill.schema.json` | https://code.claude.com/docs/en/skills.md | Thin `allOf` extension of `skill-base.schema.json`. No skill-only fields today. |
| `command` | `claude/schemas/command.schema.json` | https://code.claude.com/docs/en/skills.md | Thin `allOf` extension of `skill-base.schema.json`. Per Anthropic: "custom commands have been merged into skills", the frontmatter is identical. The schemas are split (rather than aliased) because skill-map differentiates the two kinds in `IProviderKind.ui` (color, icon, label) and may diverge them on the schema side as Anthropic evolves. No command-only fields today. |
| (`skill-base`) | `claude/schemas/skill-base.schema.json` | https://code.claude.com/docs/en/skills.md | NOT a kind, shared base for `skill` and `command`. 14 fields: `when_to_use`, `argument-hint`, `arguments` (`string` \| `string[]`), `disable-model-invocation`, `user-invocable`, `allowed-tools` (`string` \| `string[]`), `disallowed-tools` (`string` \| `string[]`), `model`, `effort`, `context` (enum: `fork`), `agent`, `hooks`, `paths` (`string` \| `string[]`), `shell` (enum: `bash` \| `powershell`). |
| `markdown` | `claude/schemas/markdown.schema.json` | (skill-map fallback) | No extra fields. Catches any markdown that doesn't match a more specific Claude path. The kind is named after the *format* because the file is a generic fallback; format-named kinds apply only as the generic fallback (a TOML file that IS a Codex agent still classifies as `agent`, not `toml`). |

**Hook kind dropped** in Step 9.5. `.claude/hooks/*.md` is not a Claude Code convention, Anthropic hooks live in `settings.json` or as sub-objects of agent/skill frontmatter (https://code.claude.com/docs/en/hooks.md), never as standalone markdown files. The previous `hook` kind (with skill-map-invented fields `event`, `condition`, `blocking`, `idempotent`) was a fiction; files at `.claude/hooks/*.md` now classify as `markdown` (the fallback).

A future Cursor / Cline / custom Provider declares its own kinds and ships the matching schemas. The kernel calls `provider.kinds[<kind>].schema` during Phase 1.2 (Parse) of the scan after validating universal fields against `base`.

### Provider auxiliary schemas

Step 9.5 introduced an optional runtime-only field on `IProvider`: `schemas?: unknown[]`. It lets a Provider declare schemas that are not themselves a per-kind schema but are referenced via `$ref` from per-kind schemas. The Claude Provider uses it to ship `skill-base.schema.json` (referenced by both `skill.schema.json` and `command.schema.json`). The kernel pre-registers these auxiliary schemas with AJV before compiling per-kind validators so cross-file `$ref` resolves cleanly. The field is implementation-only (TypeScript-side); the public manifest schema (`provider.schema.json`) is unchanged.

### Validation, three-tier model

The kernel validates frontmatter on a graduated dial; tighter is opt-in.

| Tier | Mechanism | Behavior on unknown / non-conforming fields |
|---|---|---|
| **0, Default permissive** | `additionalProperties: true` on `base.schema.json` and per-kind schemas | Field passes silently, persists in `node.frontmatter`, available to Extractors / Analyzers / Actions / Formatters. |
| **1, Built-in `unknown-field` analyzer** | Deterministic Analyzer shipped with the kernel | Emits issue severity `warning` for every key outside the documented catalog (base + the matched kind's schema). Always active. |
| **2, Strict mode** | `project-config.json` with `"strict": true` (already in `project-config.schema.json`); also via `--strict` flag on `sm scan` / `sm check` | Promotes **all** frontmatter warnings to `error`. CI fails with exit code 1. |

The model is documented explicitly in `spec/plugin-author-guide.md`. No "schema-extender" plugin kind exists; users who want custom validation write a deterministic Analyzer, and `--strict` makes it CI-blocking automatically.

### DB denormalization

High-query fields stored as columns on `scan_nodes`: `stability`, `version`, `author`. These are read from `frontmatter.metadata.{stability, version, author}` when present, note that since Step 9.5 the `metadata` block is no longer formally declared in the base schema; it rides on `additionalProperties: true`. The denormalization layer accepts this transitional shape (the data still flows through fine) until the deferred annotation-home decision lands. Everything else lives in `frontmatter_json`. Provider-declared kinds map to whatever columns the Provider migrates into the kernel-owned schema; today the Claude Provider's kinds are baked into the kernel's `nodes` table, when other Providers join, the column set is reviewed for either widening or moving kind-specific fields out of denormalized columns.

### Skill-map annotation fields, co-located sidecars

Skill-map's own annotation layer (lifecycle, supersession, provenance, taxonomy, display, docs) lives in **co-located YAML sidecars** with extension `.sm`, in the same directory as the markdown node they annotate. The vendor file (`.claude/agents/code-reviewer.md`) stays untouched; the sidecar (`.claude/agents/code-reviewer.sm`) carries the annotations. Decision #125 (closes the deferred portion of #124), full conceptual rationale in `memory/project_annotation_architecture.md`.

**Spec artifacts** (Step 9.6.1, 2026-05):

- `spec/schemas/sidecar.schema.json`, root shape with reserved blocks `for` (identity link: `path` + `bodyHash` + `frontmatterHash`, optional `resolvedAs` for ambiguous classification overrides), `annotations`, `settings`, `audit`. `additionalProperties: true` at every level so plugins write to their own `<plugin-id>:` namespace without coordination.
- `spec/schemas/annotations.schema.json`, curated catalog of 10 conventional fields (trimmed from 31 on 2026-05-07 after UX review; `released` dropped 2026-05-07, then `requires`/`conflictsWith`/`related` dropped on 2026-05-15 because the three collapsed into the same `references` edge kind and added no extra graph semantics, see `CHANGELOG.md` §Step 9.6 → 9.6.7). Versioning + supersession: `version` (single integer monotonic, orthogonal to `stability`), `stability`, `supersedes`, `supersededBy`. Provenance: `authors`, `license`, `source`, `sourceVersion`. Taxonomy: `tags`. Docs: `docsUrl`. The activity timestamp lives in the reserved `audit:` block (`audit.lastBumpedAt`), not in `annotations:`. All optional; an empty `annotations: {}` is valid. Additional fields ride on `additionalProperties: true`; the built-in `unknown-field` analyzer warns on truly unrecognized keys (typo guard, also catches the three dropped keys in legacy sidecars). Plugins that want first-class custom keys with their own validation declare `annotationContributions` in their manifest (Step 9.6.6). Path-style `references` edges in the graph now come exclusively from `core/markdown-link` (over `[text](path)` syntax in the body), not from sidecar annotations.

**Identity + drift detection** (Step 9.6.2): `for.path` matches the canonical Node identifier; `for.bodyHash` and `for.frontmatterHash` carry the sha256 captured the last time the sidecar was bumped. The kernel computes the current hashes at scan time; mismatch in either emits the built-in `annotation-stale` warning (soft mode, never blocking). Stale state is **derived**, never stored, pure function over existing data, no flag drift risk.

**Bump model** (Step 9.6.3 onward): version increments via the built-in deterministic `bump` Action, kernel materializes the sidecar write through a new `SidecarStore` port (mirrors `StoragePort`, writes YAML files in the repo). Triggers: manual UI button gated by drift (lands in 9.6.5), `sm bump <node-path>` CLI for single-node bumps and `sm bump --pending [--staged]` for batch (shipped in 9.6.4), opt-in pre-commit hook installed via `sm hooks install pre-commit-bump` (shipped in 9.6.4) that auto-bumps staged drift on commit. Watch mode never auto-bumps.

**Migration**: greenfield, no automatic port of pre-9.6 `metadata: {}` blocks (per project policy; no released consumers depend on the prior shape). Optional CLI helper to import legacy `metadata: {}` blocks deferred, flagged in `CHANGELOG.md` §Step 9.6 → "Deferred (post-Step 9.6)" with rationale "no released consumer demands it; ship when first user asks".

**DB denormalization** carries forward unchanged: `scan_nodes.{stability, version, author}` columns are now sourced from `annotations.{stability, version, author}` of the matching sidecar (when present); fall-through to `frontmatter.metadata.{...}` until pre-9.6 fixtures exit the conformance suite.

---

## Enrichment

Two enrichment models coexist: (a) the GitHub provenance enrichment (a remote-fetch Action backed by `state_enrichments`) and (b) the universal Extractor enrichment layer for any plugin that wants to add data to a node. Both ride together; the analyzers below describe each.

### Two enrichment models

**Model A, Provenance enrichment (GitHub today, more registries post-v1.0)**: a remote fetch that reconciles the local `body_hash` against the canonical source. Lives in its own table `state_enrichments` keyed by `(node_id, provider_id)`. Invoked via `sm job submit github-enrichment [-n <id>] [--all]`. Concerned with verification and idempotency, not with adding interpretation.

**Model B, Plugin-driven node enrichment via Extractors (added in v0.8.0)**: any Extractor that wants to add structured data to a node calls `ctx.enrichNode(partial)` from its `extract()`. The kernel persists the partial in the dedicated `node_enrichments` table (one row per `(node, extractor)` pair). The author's `frontmatter` is **never overwritten**, it is immutable from any Extractor's perspective. Every consumer (Analyzer, Formatter, UI) receives a merged view: `node.merged.<field>` combines author + enrichment; `node.frontmatter.<field>` is author-only. Extractors are deterministic-only; rows regenerate via the A.9 fine-grained scan cache (overwrite via PRIMARY KEY on body change). The `body_hash_at_enrichment`, `stale`, and `is_probabilistic` columns persist on the row inert for now (always `0`) and are reserved for a future Action-issued probabilistic enrichment revision (queued LLM jobs that must preserve paid output across body changes).

If an Extractor wants to persist data that does NOT fit canonical Node shape (embeddings, version strings, owner mappings, anything else), it uses `ctx.store.write(table, row)` instead, that lives in the plugin's own table `plugin_<id>_*`, outside this enrichment model. The boundary between `enrichNode` (canonical, kernel-aware) and `store.write` (custom, plugin-owned) is a soft analyzer revisited post-v1.0 (see Decision log).

### Hash verification (idempotency, Model A)

Three layers:

1. **SHA pin**: if `metadata.sourceVersion` is a full commit SHA, the plugin resolves to immutable raw URL `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`. Deterministic.
2. **Tag / branch resolution**: if `sourceVersion` is a tag, branch, or absent, the plugin queries GitHub API for the current commit SHA. Stores `resolvedSha` in `state_enrichments.data_json`. Next refresh compares SHA; only re-fetches if changed.
3. **ETag / `If-None-Match`** (post-`v1.0`): saves bandwidth within rate limit.

### Stale tracking (Model B, reserved)

Extractors are deterministic-only, their enrichments regenerate via the per-Extractor scan cache (see §Plugin system, "Incremental scan cache") and never need stale flags. The `body_hash_at_enrichment`, `stale`, and `is_probabilistic` columns persist on `node_enrichments` inert for now and are reserved for the future Action-issued probabilistic enrichment revision: when an LLM job writes back through the enrichment layer, the kernel will key on `body_hash_at_enrichment != node.body_hash` to flag the surviving probabilistic row `stale = 1` (NOT delete it, the LLM cost is preserved).

- **Analyzers / `sm check` / CI decisions**: exclude stale by default once the revision lands. Automation never makes decisions on outdated LLM outputs.
- **UI / `sm show <node>`**: will surface stale records with a marker once the revision lands so humans see what to refresh.

### Refresh commands

- `sm refresh --stale` → batch re-runs every prob Extractor whose enrichments are stale. CI cron, nightly maintenance.
- `sm refresh <node>` → granular; runs all `applicableKinds`-matching prob Extractors against one node.
- **No** `sm scan --refresh-stale`. Mixing det scan with prob refresh in one command violates the "prob never runs in scan" analyzer.

### State storage

Model A keeps the legacy table:

```sql
CREATE TABLE state_enrichments (
  node_id      TEXT NOT NULL,
  provider_id  TEXT NOT NULL,
  data_json    TEXT NOT NULL,
  verified     BOOLEAN,
  fetched_at   INTEGER NOT NULL,
  stale_after  INTEGER,
  PRIMARY KEY (node_id, provider_id)
);
```

`verified: true` if local `body_hash` matches the hash computed over remote raw content. `false` with implicit `locallyModified: true` on mismatch.

Model B adds a parallel layer (final table / column shape decided in PR, candidate: a `node_enrichments(node_path, extractor_id, body_hash_at_enrichment, value_json, stale, fetched_at)` table that mirrors A's pattern but keys on the qualified Extractor id). The kernel materializes the `node.merged` view by joining `nodes` + `node_enrichments`.

### Invocation

- Model A: `sm job submit github-enrichment [-n <id>] [--all]`. Targeted fan-out via `--all`.
- Model B: Extractors are deterministic-only and run automatically inside `sm scan`. An LLM-driven enrichment is delivered via a probabilistic Action (`sm job submit action:<plugin-id>/<action-id>`); the future Action-issued enrichment revision lets such an Action write back through `ctx.enrichNode` so its output lands in `node_enrichments` alongside Extractor rows.

---

## Reference counts

Three denormalized integer columns on `scan_nodes`:

| Column | Meaning |
|---|---|
| `links_out_count` | outgoing links to other graph nodes |
| `links_in_count` | incoming links from other graph nodes |
| `external_refs_count` | http/https URLs in body (dedup exact match, normalized) |

Computed at scan time. No separate table for URL list, user cares about count, not identity. Reads the file if details needed. No liveness check (optional post-`v1.0` plugin).

Surfaces:
- `sm show`: "N in · M out · K external".
- `sm list --sort-by external-refs`: sort order.

---

## Trigger normalization

Extractors that emit invocation-style links (slashes, at-directives, command names) populate a `link.trigger` block with two fields. Field shape in `spec/schemas/link.schema.json`; normative pipeline in `spec/architecture.md §Extractor · trigger normalization`.

- `originalTrigger`, the exact text the Extractor saw in the source, byte-for-byte. Used for display in `sm show` and the UI.
- `normalizedTrigger`, the output of the pipeline below. Used for equality and collision detection (the `trigger-collision` analyzer keys on this field).

Both are always present on every trigger-bearing link. Never mutate one without the other.

### Pipeline (Decision #21, normative)

Applied at Extractor output time, in exactly this order:

1. **Unicode NFD**, decompose into canonical form so combining marks separate from their base characters.
2. **Strip diacritics**, remove every combining mark in the Unicode category `Mn` (Nonspacing_Mark).
3. **Lowercase**, ASCII and Unicode lowercase via locale-independent mapping.
4. **Separator unification**, map every hyphen (`-`), underscore (`_`), and run of whitespace to a single space.
5. **Collapse whitespace**, runs of two or more spaces become one.
6. **Trim**, remove leading and trailing whitespace.

Non-letter/non-digit characters outside the separator set (e.g. `/`, `@`, `:`, `.`) are **preserved**, they are often part of the invocation syntax (`/skill-map:explore`, `@frontmatter-extractor`). Stripping them is the Extractor's responsibility, not the normalizer's: the normalizer acts on what the Extractor considers "the trigger text".

### Worked examples

| `originalTrigger` | `normalizedTrigger` |
|---|---|
| `Hacer Review` | `hacer review` |
| `hacer-review` | `hacer review` |
| `hacer_review` | `hacer review` |
| `  hacer   review  ` | `hacer review` |
| `Clúster` | `cluster` |
| `/MyCommand` | `/mycommand` |
| `@FooDetector` | `@foodetector` |
| `skill-map:explore` | `skill-map:explore` → `skill map:explore` *(hyphen maps to space, colon preserved)* |

Note the last row: colons and slashes pass through untouched. Plugin authors that want stricter normalization (e.g. stripping the `/` prefix on slash commands) apply it inside their Extractor before emitting the link, not afterwards.

### Stability

The pipeline ordering is **stable** as of the next spec release. Adding a new step at the end is a minor bump; reordering, removing, or changing any existing step (including the character classes in step 4) is a major bump. Implementations MUST produce byte-identical `normalizedTrigger` output for byte-identical input.

---

## Configuration

`.skill-map/settings.json` is the canonical config file for both the CLI and the bundled UI. The loader walks a layered hierarchy and deep-merges per key. The filename, the `.local.json` partner, and the folder convention mirror Claude Code (`.claude/settings.json` + `.claude/settings.local.json`).

### Hierarchy (low → high precedence, last wins)

1. **Library defaults**, compiled into the bundle (`src/config/defaults.json` for the CLI, `ui/src/models/settings.ts` for the UI). Always present; the app must boot with these alone.
2. **Project config**, `<cwd>/.skill-map/settings.json`. Team-shared settings; committed.
3. **Project local**, `<cwd>/.skill-map/settings.local.json`. Per-developer overrides; gitignored by `sm init`. Carries `PROJECT_LOCAL_ONLY_KEYS` (`allowEditSmFiles`, `scan.referencePaths`).
4. **Env vars / CLI flags**, point-in-time overrides per invocation.

There is no user / global config layer; skill-map never reads `~/.skill-map/settings*.json` (see `spec/cli-contract.md` §Scope is always project-local). Per-machine preferences either live in project-local config or in the project itself.

`sm ui --config <path>` (Step 15) is a separate escape hatch: the supplied file **replaces** layers 2-3 entirely (single-source override; useful for reproducibility, CI, debugging). Defaults still apply underneath, env / flags still wrap on top.

Deep merge at load. Each layer may be a `Partial`; missing keys fall through to the next lower layer. Validated against `spec/schemas/project-config.schema.json` (CLI keys) and `spec/runtime-settings.schema.json` (UI keys, lands at Step 15). Malformed JSON or type-mismatches emit warnings and skip the offending key; the app never crashes on bad config. `--strict` flips warnings into fatal errors.

### Runtime delivery to the UI

The bundled UI is a static artifact, it does not read files from disk. The CLI sub-command `sm ui` (Step 15) loads + merges + validates the hierarchy and serves the resulting object as `GET /config.json` over the same HTTP server that hosts the UI bundle. The UI fetches that URL once on boot (via `APP_INITIALIZER`), then reads the data through a signal-backed `RuntimeConfigService`. When the bundle is served by a third party (nginx, S3, Caddy), the operator places a `config.json` next to `index.html`; same contract from the UI's side.

This is the only path by which UI-side keys reach the browser. There is no build-time UI config and no `fileReplacements`. Changing UI settings means editing one of the four files in the hierarchy (or the `--config` override) and restarting the server, see §Step 15 for why hot reload is deferred.

### Commands

| Command | Purpose |
|---|---|
| `sm config list` | Effective config. |
| `sm config get <key>` | Single value. |
| `sm config set <key> <value>` | Write to project config (or project-local for `PROJECT_LOCAL_ONLY_KEYS`). |
| `sm config reset <key>` | Remove override. |
| `sm config show <key> --source` | Reveals origin (default / project / project-local / env / flag). |

### Notable config keys

All declared in `spec/schemas/project-config.schema.json`. Defaults shown.

- `schemaVersion: 1`, shape version of the config file itself. Bumped on breaking changes to the config schema; consumers use it to detect older configs and apply migration paths.
- `autoMigrate: true`, apply pending kernel + plugin migrations at startup (after auto-backup). `false` → startup fails with exit 2 if migrations are pending.
- `tokenizer: "cl100k_base"`, offline token estimator. Stored alongside counts so consumers know which encoder produced them.
- `adapters: []`, adapter ids to enable, in priority order when multiple match a path. Empty/absent = all registered adapters active.
- `roots: []`, directories (relative to the config file) to scan. Defaults to the scope root.
- `ignore: [...]`, top-level glob patterns excluded from scan, in addition to `.skillmapignore`.
- `plugins: { <id>: { enabled, config } }`, per-plugin enable/disable overrides and plugin-specific config passed to extensions at load time. Keys are plugin ids; absent means the plugin's installed default (enabled) applies.
- `scan.tokenize: true`, `scan.strict: false`, `scan.followSymlinks: false`.
- `scan.maxFileSizeBytes: 1048576`, 1 MiB floor; oversized files are skipped with an `info` log.
- `history.share: false`, experimental. When `true`, `./.skill-map/skill-map.db` is expected to be committed (team removes it from `.gitignore`). No GC policy for `state_executions` through `v1.0`, the table is append-only (see `CHANGELOG.md` §Step 7). When demand appears post-`v1.0`, a `history.retention.*` block lands in a later minor bump with concrete defaults and enforcement semantics.
- `jobs.ttlSeconds: 3600`, base duration used when an action manifest omits `expectedDurationSeconds`. Fed into the formula `computed = max(base × graceMultiplier, minimumTtlSeconds)`. Typical for `mode: local` actions where the duration hint is advisory.
- `jobs.graceMultiplier: 3`, multiplier applied to the base duration before the floor check.
- `jobs.minimumTtlSeconds: 60`, TTL floor (never a default). Guarantees no job is claimed with a sub-minute deadline.
- `jobs.perActionTtl: { <actionId>: <seconds> }`, per-action TTL override. Replaces the computed TTL entirely; skips the formula.
- `jobs.perActionPriority: { <actionId>: <integer> }`, per-action priority override (decision #40). Higher runs first; ties break by `createdAt ASC`. Frozen at submit.
- `jobs.retention.completed: 2592000`, 30 days default; `null` → never auto-prune.
- `jobs.retention.failed: null`, never auto-prune; failed jobs kept for post-mortem.
- `i18n.locale: "en"`, experimental.

The default contents of a fresh `.skillmapignore` file (used by `sm init`) live in the reference impl under `src/config/defaults/` and are **not** a user-visible config key, editing the generated file is the supported override. The Settings → Project panel also exposes a CRUD list for the project's `.skillmapignore` (BFF route `/api/project-ignore`) so the operator can add / remove patterns without opening the file by hand; comments and blank lines are preserved on write.

### UI-side keys

Declared in `ui/src/models/settings.ts` and shipped via the runtime delivery path above. The interface is `ISkillMapSettings` (compile-time) and will be formalised in `spec/runtime-settings.schema.json` at Step 15 once the contract stabilises.

- `graph.perf.cache: true`, Foblex `[fCache]` toggle. Caches connector / connection geometry across redraws (pan, zoom, drag).
- `graph.perf.virtualization: false`, `*fVirtualFor` over node iteration. Renders only nodes whose bounding box intersects the viewport. Enable above ~300 visible nodes; below that the bookkeeping cost outweighs the gain. Off by default, flip to `true` when the perf HUD inside the graph view shows fps drops on large collections.
- `debug.slotsVisible: false`, *reserved, not implemented yet.* When the runtime settings loader lands, this key replaces the throwaway `?debug-slots=1` / localStorage path documented in §UI contribution system → "Follow-up: slot debug overlay". Toggling it ON adds `is-debug-slots` to `<html>`, lighting up every view-contribution slot wrapper (`card.footer.left`, `inspector.body.panel`, `inspector.header.badge`, `graph.node.alert`, `topbar.nav.start`) with a strong-color border so authors can see where each slot sits without having to emit data first.

These keys cohabit the same `.skill-map/settings.json` as the CLI keys above. They are merged by the same loader, served by `sm ui` over the same `/config.json` HTTP endpoint. The UI ignores keys it does not recognise (graceful forward-compat); the CLI does the same with UI keys (which it doesn't read directly).

---

## CLI surface

Shared flags (inherited by every verb): `--json` output · `-v`/`-q` · `--no-color` · `-h`/`--help` · `--db <path>` (escape hatch). There is no `-g/--global` flag (see `spec/cli-contract.md` §Scope is always project-local).

Env-var equivalents (Decision #38 + `spec/cli-contract.md §Global flags`): `SKILL_MAP_JSON`, `SKILL_MAP_DB`, `NO_COLOR`. Precedence: flag > env > config > default.

`--all` is not a shared flag. It is documented only on verbs with meaningful fan-out semantics, such as `sm job submit`, `sm job run`, `sm job cancel`, and `sm plugins enable/disable`.

### Exit codes

Normative across every verb (Decision #38; `spec/cli-contract.md §Exit codes`):

| Code | Meaning |
|---|---|
| `0` | Success, no issues. |
| `1` | Success with issues (analyzers emitted warnings/errors; pipelines use this to gate). |
| `2` | Generic operational error (bad input, runtime failure, missing binary). |
| `3` | Duplicate job, refused by the content-hash check; existing id reported. |
| `4` | Nonce mismatch on `sm record`, authentication failure, no state mutation. |
| `5` | Not found, node, job, or execution id did not resolve. |
| `6–15` | Reserved for future spec use. MUST NOT be taken by verb-specific codes. |
| `≥16` | Free for implementations to use on a per-verb basis (documented in `sm help <verb>`). |

### Elapsed time

**Elapsed-time reporting is normative** (see `spec/cli-contract.md §Elapsed time`). Every verb that walks the filesystem, hits the DB, spawns a subprocess, or renders a report MUST report its own wall-clock duration: `done in <N>ms | <N.N>s | <M>m <S>s` on stderr (suppressed by `--quiet`); and, when the verb's `--json` payload is a top-level object, an `elapsedMs` integer field. Sub-millisecond informational verbs (`--version`, `--help`, `sm version`, `sm help`, `sm config get/list/show`) are exempt. The grammar and field contract are **stable** from spec v1.0.0, changing them is a major bump.

### Setup & state

| Command | Purpose |
|---|---|
| `sm init [--no-scan] [--force]` | Bootstrap scope (creates `.skill-map/`, DB, runs first scan). `--no-scan` skips the initial scan. `--force` rewrites an existing config. |
| `sm tutorial [variant] [--force]` | Materialize a tester walkthrough as a single `.md` file in the cwd. Optional positional `variant` (closed set `{tutorial, master}`, default `tutorial`) selects which Claude Code skill ships: `tutorial` writes `sm-tutorial.md` (basic onboarding), `master` writes `sm-master.md` (advanced: plugin tour, plugin authoring, settings + view-slots). Runs in any directory (no `.skill-map/` required); the file is consumed by the matching Claude Code skill when the tester loads it with `ejecutá @sm-tutorial.md` (or `@sm-master.md`). `--force` overwrites the existing target file. Invalid `variant` values exit `2`. |
| `sm version` | CLI / kernel / spec / DB schema versions. |
| `sm doctor` | DB integrity, pending migrations, orphan files, plugins in error, LLM runner availability. |
| `sm help [<verb>] [--format human\|md\|json]` | Self-describing introspection. |

### Config

See [Configuration](#configuration).

### Scan

| Command | Purpose |
|---|---|
| `sm scan` | Full scan. |
| `sm scan -n <id>` | Partial (one node). Replaces `sm rescan`. |
| `sm scan --changed` | Incremental (mtime-based). |
| `sm scan --compare-with <path>` | Delta report. |

### Browse

| Command | Purpose |
|---|---|
| `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N]` | Tabular. |
| `sm show <id>` | Detail: weight (bytes + tokens triple-split), frontmatter, links in/out, issues, findings, summary. |
| `sm check` | All current issues (deterministic). |
| `sm findings [--kind ...] [--since ...] [--threshold <n>]` | Probabilistic findings (injection, stale summaries, low confidence). |
| `sm graph [--format ascii\|mermaid\|dot]` | Graph render. |
| `sm export <query> --format json\|md\|mermaid` | Filtered export. |
| `sm orphans` | History rows whose node is missing. |
| `sm orphans reconcile <orphan.path> --to <new.path>` | Forward migration: attach orphan's history rows to a live node after a rename the heuristic missed. |
| `sm orphans undo-rename <new.path> [--from <old.path>] [--force]` | Reverse a medium- or ambiguous-confidence auto-rename. Reads the prior path from the issue's `data_json`; `--from` disambiguates when the issue is `auto-rename-ambiguous`. |

### Actions

| Command | Purpose |
|---|---|
| `sm actions list` | Registered action types. |
| `sm actions show <id>` | Manifest detail. |

### Jobs

See [Job system](#job-system).

### Record (callback)

| Command | Purpose |
|---|---|
| `sm record --id <id> --nonce <n> --status completed --report <path> --tokens-in N --tokens-out N --duration-ms N --model <name>` | Success close. |
| `sm record --id <id> --nonce <n> --status failed --error "..."` | Failure close. |

### History

| Command | Purpose |
|---|---|
| `sm history [-n <id>] [--action <id>] [--status ...] [--since <date>]` | Executions log. |
| `sm history stats` | Aggregates (tokens per action, per month, top nodes). |

### Plugins

See [Plugin system](#plugin-system).

### LLM verbs (Step 11)

Shipped at Step 11 per Decision #49. Single-turn, each verb submits one probabilistic job, then renders a finding or structured report. A runner must be available (`sm doctor` reports status; see §Step 10). Exact flag surface locks per verb during Step 11.

| Command | Purpose |
|---|---|
| `sm what <id>` | LLM-produced description of what a node does. Reuses the cached summary when fresh; otherwise submits a `what` job. |
| `sm dedupe` | Find semantically-duplicate nodes across the graph. |
| `sm cluster-triggers` | Group equivalent triggers beyond the deterministic normalizer (Decision #21). |
| `sm impact-of <id>` | Reverse-dependency summary: which nodes rely on this one, directly or transitively. |
| `sm recommend-optimization` | Suggest refactors per node (size, redundancy, structure). Canonical caller for the `skill-optimizer` dual-surface action (Decision #86). |

### Database

See [Persistence](#persistence).

### Server

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--no-open]` | Hono + WebSocket for Web UI. |

### Introspection

- `sm help --format json`, structured surface dump.
- `sm help --format md`, canonical markdown for `context/cli-reference.md` (CI-enforced sync).
- Consumers: docs generator, shell completion, Web UI form generation, IDE extensions, test harness, the `sm-cli` skill (agent integration).

---

## Skills catalog

Single source of truth for every skill-shaped artifact shipped alongside `skill-map`. All use the `/skill-map:` namespace inside host agents (Claude Code today; future hosts register under the same namespace).

| Id | Type | Host | Ships at | Purpose |
|---|---|---|---|---|
| `/skill-map:explore` | Meta-skill (conversational) | Claude Code | Step 11 | Wraps every `sm … --json` verb into a single slash-command. Maintains follow-ups with the user, feeds CLI introspection to the agent, orchestrates multi-step exploration. Replaces the earlier per-verb `explore-*` idea. |
| `/skill-map:run-queue` (slash command) · `sm-cli-run-queue` (npm package) | Skill agent (driving adapter) | Claude Code | Step 10 | Drains the job queue in-session: loops `sm job claim` → Read → [agent reasons] → Write report → `sm record`. Does NOT implement `RunnerPort`; peer of CLI runner. The npm package is the distributable that a user drops into their Claude Code plugin folder; it wraps the skill manifest plus host-specific glue (e.g. `TaskCreate` integration for progress) and registers the slash command. |
| `sm-cli` | Agent integration package | Claude Code (installable) | Step 15 | Feeds `sm help --format json` to the agent so it can compose CLI invocations without hand-maintained knowledge. Mentioned in Decision #65; ships at distribution polish. |
| `skill-optimizer` | Dual-surface action + skill | Claude Code (skill) + any runner (action) | Skill exists before `v0.5.0`; action wrapper Step 10 | Canonical dual-mode example: exists as a Claude Code skill AND is wrapped as a `skill-map` Action in `invocation-template` mode. Serves as the reference pattern for "same capability, two surfaces". |

Naming analyzers:

- **Slash-command ids** (`/skill-map:<verb>`) are what the user types inside the host.
- **Package ids** (`sm-cli`, `sm-cli-run-queue`) are what the user installs. One package MAY register multiple slash-commands; one slash-command is registered by exactly one package.
- **Host-specific** skills live under `sm-cli-*` namespace. When a second host (Codex, Antigravity) lands as a full skill catalog, its packages get their own prefix (`sm-codex-*`, `sm-antigravity-*`), the namespace is owned by the host, not by the skill. The retired `sm-gemini-*` slot is preserved for historical references; current Antigravity skills route through the vendor-neutral `agent-skills` standard.

Non-skills shipped for context (listed here to prevent confusion, do NOT register as skills):

- **CLI runner loop**, the `sm job run` command itself. Driving adapter (uses `RunnerPort` via `ClaudeCliRunner`). Not a skill.
- **Default plugin pack**, `github-enrichment`, plus TBD Extractors/Analyzers. Not skills, but installable via drop-in.

---

## UI (Step 14 full)

### Step 14, Full UI (Flavor B)

Vertical slice with real kernel. Same prototype upgraded to consume the actual Hono server.

**Single-port mandate (non-negotiable)**: `sm serve` exposes the SPA, the BFF and the WebSocket under **one listener**. Consumers never need to know two ports exist.

```
sm serve --port 7777
│
├── GET  /api/*     → BFF endpoints (thin wrappers over kernel)
├── WS   /ws        → canonical job / scan / issue events
├── GET  /assets/*  → Angular bundles (JS/CSS/fonts)
└── GET  /*         → fallback to ui/dist/index.html (SPA routing)
```

- **Production**: Hono serves the Angular build via `serveStatic` alongside the API and WS. One process, one port, one command.
- **Development**: Angular dev server with HMR (its own port) proxies `/api` and `/ws` to Hono via `proxy.conf.json`. The SPA still sees a single origin.
- BFF role: **thin proxy** over the kernel. No domain logic. No second DI. Keep it minimal, that is why Hono was chosen over NestJS / Express.

WebSocket `/ws` endpoint:
- Server pushes the canonical event stream from `spec/job-events.md`: job family (stable) + `scan.*` + `issue.*` families (experimental in v0.x).
- UI sends commands (rescan, submit, cancel) on the same channel.
- REST HTTP reserved for discrete CRUD (config, exports).

Inspector panel renders:
```
External (github-enrichment, if applicable):
  stars, last commit, verified ✓/✗

Summary (per-kind summarizer, if run):
  kind-specific summary fields
  (stale) flag if bodyHash diverged

Links:
  incoming (N) and outgoing (M) with kinds

Issues: N     Findings: M
```

---

## Testing strategy

From commit 1. Same rigor as kernel-first.

| Layer | What it tests | When |
|---|---|---|
| Contract | Every registered extension conforms to its kind's schema | Each startup + CI |
| Unit | Each Extractor / Analyzer / Provider / etc. in isolation | CI + dev |
| Integration | Scanner end-to-end over fixtures | CI |
| Self-scan | `sm scan` on skill-map's own repo | CI (mandatory) |
| CLI | Spawn binary, assert stdout / stderr / exit codes | CI |
| Snapshot | Renderers produce byte-exact output | CI |

Framework: **`node:test`** (built-in, zero deps, Node 24+).

Every extension in `src/extensions/` ships a sibling `*.test.ts`. Missing test → contract check fails → tool does not boot.

**Performance budget**: `sm scan` on 500 MDs completes in ≤ 2s on a modern laptop, enforced by a CI benchmark (lands with Step 4 when the scanner goes end-to-end).

**Conformance cases deferred**: `preamble-bitwise-match` lands in Step 10 alongside `sm job preview` (needs a rendered job file for byte-exact comparison against `spec/conformance/fixtures/preamble-v1.txt`). The case is mandatory before the `v0.8.0` release.

---

## Stack conventions

- **Naming**: two analyzers, both normative and enforced spec-wide (see `spec/README.md` §Naming conventions).
  - **Filesystem artefacts in kebab-case**: every file, directory, enum value, and `issue.analyzerId` value, `scan-result.schema.json`, `job-lifecycle.md`, `auto-rename-medium`, `direct-override`. So a value can be echoed into a URL, a filename, or a log key without escaping.
  - **JSON content in camelCase**: every key in a schema, frontmatter block, config file, plugin/action manifest, job record, report, event payload, or API response, `whatItDoes`, `injectionDetected`, `expectedTools`, `supersededBy`, `docsUrl`, `ttlSeconds`, `runId`. The SQL layer is the sole exception (`snake_case` tables/columns, bridged by Kysely's `CamelCasePlugin`); nothing crosses the kernel boundary as `snake_case`.
- **Runtime**: Node 24+ (required, active LTS since Oct 2025; `node:sqlite` stable; WebSocket built-in; modern ESM loader).
- **Language**: TypeScript strict + ESM.
- **Build**: `tsup` / `esbuild`.
- **CLI framework**: **Clipanion** (pragmatic pick, introspection built-in, used by Yarn Berry).
- **HTTP server**: **Hono** (lightweight, ESM-native). Acts as the BFF for the Angular UI and any future client.
- **WebSocket**: server side uses the official `upgradeWebSocket` re-exported from `@hono/node-server@2.x` paired with the canonical `ws` Node WebSocket library (`ws@8.20.0`); both share the single Hono listener, single-port mandate. Client side uses the browser-native `WebSocket` (browser) or the Node 24 global `WebSocket` (Node-side tests and consumers, no extra dep needed beyond the server-side `ws`).
- **Single-port mandate**: `sm serve` exposes SPA + BFF + WS under one listener. Dev uses Angular dev server + proxy; prod uses Hono + `serveStatic`.
- **UI framework**: **Angular ≥ 21** (standalone components). Scaffolded at `^21.0.0`, later pinned to an exact version per the dependency-pinning policy, see §Analyzers for agents working in this repo in `AGENTS.md`.
- **Dependency versioning policy**: every dependency in `package.json` at root, `ui/`, and `src/` is pinned to an exact version (no `^` / `~`). `spec/` has no dependencies. Reproducibility takes priority over automatic patch drift; upgrades are explicit edits. Revisit if `src/` ever flips to public, published libs may want caret ranges so consumers can dedupe transitive deps.
- **Node-based UI library**: **Foblex Flow**.
- **Component library**: **PrimeNG** + `@primeuix/themes` for theming. The legacy `@primeng/themes` package is deprecated upstream (the registry marks it as `Deprecated. Please migrate to @primeuix/themes`) and is intentionally NOT used.
- **UI styling**: **SCSS scoped per component**. No utility CSS (no Tailwind, no PrimeFlex).
- **UI workspace**: `ui/` as pnpm workspace peer of `spec/` and `src/`. Kernel is Angular-agnostic; UI imports only typed contracts from `spec/` once those exist, see the DTO gap note below.
- **UI YAML parser**: **`js-yaml`**, locked at Step 0c when the prototype's mock-collection loader first needs to parse frontmatter in the browser. The second candidate (`yaml`) was dropped at pick time; revisit only if the impl-side pick diverges.

### UI-only deps (Step 0c onwards)

These deps live in `ui/package.json` only. The kernel does NOT import them and MUST never gain a transitive path to them, they stay on the UI side of the workspace boundary.

- **`js-yaml`** (+ `@types/js-yaml`), frontmatter parsing in the browser. Locked above; duplicated here so a reader of §UI-only deps has the full picture.
- **`@dagrejs/dagre`**, hierarchical graph auto-layout. Consumes `{ nodes, edges }`, returns `{ x, y }` per node; rendering stays with Foblex. Picked over the inactive `dagre` package (the `@dagrejs/*` scope is the maintained fork). No viable Angular-native alternative at Step 0c pick time; revisit only if Foblex ships its own layout primitive that covers the same cases.
- **`primeng`** + **`@primeuix/themes`**, already captured in §UI framework.
- **`@foblex/flow`** + peers, already captured in §Node-based UI library.
- **DB**: SQLite via `node:sqlite` (zero native deps).
- **Data-access**: **Kysely + CamelCasePlugin** (typed query builder, not an ORM).
- **Logger**: `pino` (JSON lines).
- **Tokenizer**: `js-tiktoken` (cl100k_base).
- **Semver**: `semver` npm package.
- **File watcher** (Step 7): `chokidar`.
- **Package layout**: pnpm workspaces, `spec/` (`@skill-map/spec`), `src/` (`@skill-map/cli`, with subpath `exports` for `./kernel` and `./conformance`), `ui/` (private, joins at Step 0c). The `alias/*` glob held un-scoped placeholder packages (`skill-map`, `skill-mapper`) for one publish round; once the names were locked on npm and a `npm deprecate` notice routed users to `@skill-map/cli`, the workspaces were dropped. Further `@skill-map/*` splits deferred until a concrete external consumer justifies them.

### Tech picks deferred (resolve at the step that first needs them)

~~YAML parser (`yaml` vs `js-yaml`)~~, **resolved at Step 0c: `js-yaml`.** · MD parsing strategy (regex vs `remark`/`unified`) · template engine for job MDs (template literals vs `mustache` vs `handlebars`) · pretty CLI output (`chalk` + `cli-table3` + `ora`) · path globbing (`glob` vs `fast-glob` vs `picomatch`) · diff lib (hand-written vs `deep-diff` vs `microdiff`).

Lock-in-abstract rejected during Step 0b: each pick lands with the step that first requires it, so the decision is made against a concrete use case rather than in the void.

### DTO gap, pending Step 2

The §Architecture section ("The kernel never imports Angular; `ui/` never imports `src/` internals. The sole cross-workspace contract is `spec/` (JSON Schemas + typed DTOs)") promises typed TypeScript DTOs emitted by `@skill-map/spec`. As of Step 1b the promise is still aspirational, `@skill-map/spec` exports only JSON Schemas and `index.json`, no `.d.ts`. Both the ui prototype (under `ui/src/models/`) and the kernel plugin loader (under `src/kernel/types/plugin.ts`) hand-curate local mirrors of the shapes they need. The drift risk is accepted because (a) the mirrors are small, 17 schemas total, with only five kernel-side interfaces exposed by `plugin.ts`; (b) AJV already enforces the real shapes at runtime against the authoritative schemas, so a divergent TS mirror surfaces as a validation error at boot rather than a silent bug. The canonical fix moves to **Step 2**, when the first real Provider/Extractor/Analyzer arrives as a third consumer and a single source of truth becomes justified against three real consumers instead of two. The pick (e.g. `json-schema-to-typescript` at build, or hand-curated `.d.ts` published via `spec/types/`) lands then. Until Step 2 ships, any type under `ui/src/models/` or `src/kernel/types/` that diverges from its schema is flagged as a review-pass issue at the close of whichever step introduces the divergence.

---

## Execution plan

Sequential build path. Each step ships green tests before the next begins.

### Step inventory at a glance

Closed Steps, green checkmark = "ships green tests, lives in the released code path". Per-step landing prose lives in `CHANGELOG.md`.

Phase A, `v0.5.0` (deterministic kernel + CLI):

- ✅ **0a / 0b / 0c**, Spec bootstrap, implementation bootstrap, UI prototype (Flavor A). See `CHANGELOG.md` §v0.5.0.
- ✅ **1a / 1b / 1c**, Storage + migrations / Plugin loader / Orchestrator + CLI dispatcher.
- ✅ **2 / 3 / 4 / 5 / 6 / 7 / 8 / 9**, First extensions, UI design refinement, scan end-to-end, history + orphans, config + onboarding, robustness, diff + export, plugin author UX (9.1–9.4).

Phase A → v0.6.0 (Web UI):

- ✅ **9.5**, Spec base cleanup: absorb provider verbatim. Pre-wave-2 prerequisite. See `CHANGELOG.md` §v0.6.0.
- ✅ **9.6**, Annotation system (sidecar `.sm` files). Sub-steps 9.6.1–9.6.7, review queue R1–R15 closed.
- ✅ **14.1–14.7**, Full Web UI (Hono BFF, REST, WS broadcaster, inspector polish, Foblex strict types + dark-mode tri-state, bundle hard cut + responsive scope + demo smoke).
- ✅ **Active-lens migration, Phases 1–6** (2026-05-19 → 2026-05-23), post-v0.6.0 deterministic polish that lands the multi-runtime story end-to-end:
  - **Phase 1**, lens model + Signal IR scaffold + numeric `Confidence` + MCP virtual nodes + OpenAI Codex provider (`.codex/agents/*.toml`) + extractor mudanza (`core/{markdown-link, slash, at-directive}` move to vendor-neutral `core`). Settings → Project → "Active provider" dropdown switches the runtime lens; switching drops `scan_*` and rebuilds the graph under the new lens. Single coherent migration in commit `29fb353`.
  - **Phase 2**, lens-only extractor gating (per-provider extractors run when the **active lens** matches, regardless of which provider classified the host file). Closes the cross-lens isolation contract.
  - **Phase 3**, provider-aware confidence bump for resolved invocation links + new `IProviderKind.identifiers` + `IProvider.resolution: Record<linkKind, targetKind[]>`. `@reviewer` mentions and `/explore` invokes that resolve render at confidence `1.0`.
  - **Phase 4**, Antigravity Provider onboarding (metadata-only, lens identity + reserved-names) + Gemini Provider retired (Google sunset Gemini CLI 2026-06-18; Antigravity ships under the open `.agents/skills/` standard, so the legacy `.gemini/` classifier had nothing to claim).
  - **Phase 5**, reserved-name catalog (`IProvider.reservedNames?: Record<kind, string[]>`) + `core/reserved-name` analyzer + post-walk confidence downgrade to `0.1` for links resolving to reserved targets. Claude ships the documented built-in catalog (`/help`, `/clear`, `/init`, `/agents`, `/model`, `general-purpose`, `output-style-setup`, `statusline-setup`); Antigravity ships its TUI slash built-ins.
  - **Phase 6**, observable link analysis: `core/link-counts` analyzer emits two `card.footer.left` chips per node (`linksIn` / `linksOut`) with per-`Link.kind` breakdown tooltips. Self-loops excluded from card chips. Link confidence renders as edge opacity in the graph view. Inspector linked-nodes panel groups by direction × kind.
  - **Phase 2/3 closure (Step 11.5, landed 2026-05-23)**, Signal IR resolver wired end-to-end: orchestrator calls `resolveSignals` after extract; all six link-emitter extractors emit Signals with byte ranges; cross-extractor range-overlap collisions detected via union-find clusters; new `core/signal-collision` analyzer surfaces losers as `warn` issues naming the winner extractor and tiebreak reason. Two conformance cases close coverage row 37. Phase 4+ stubs (per-extension enable filter, confidence floor) documented but not wired.
  - **Safety nets shipped alongside the migration**: lens-drift warning when `activeProvider` points at a disabled bundle, db-version skew detection at sqlite open, active-provider auto-detect on first scan (markers are provider-owned via each manifest's `detect.markers`, no central table: `.claude/` → claude, `.codex/` / `AGENTS.md` → openai, `.agents/` → agent-skills; persists to project `settings.json`; ambiguous → interactive prompt or `--yes` aborts with exit 2; no markers → soft warning).
  - **Deferred (post-v1.0)**: Phase 5b (MCP config-side discovery, the consumer side already ships) and Phase 6b (Codex AGENTS.md hierarchical walker + `.codex/skills/`). See §Deferred beyond v1.0.
  - **Pre-v1.0 deliverable remaining**: Codex body extractor (TOML `instructions` field), see Step 13.

Next (Phase B, `v0.8.0`):

- ⏸ **10**, Job subsystem + first probabilistic extension (`skill-summarizer` as a probabilistic Action; Extractors are deterministic-only). Phase 0 (`IAction` runtime contract) landed and dormant; Phases A–G paused.
- ⏸ **11**, Remaining probabilistic extensions + LLM verbs + findings.
- 🔮 **16**, Web UI: LLM surfaces v1 (initial). Render the probabilistic outputs Steps 10–11 emit, replaces the "Available in v0.8.0" empty-state placeholders shipped in 14.3 inspector with read-only surfaces for `state_summaries` / `state_enrichments` / `findings`. UI does not orchestrate jobs at this stage.

Phase C (`v1.0.0` target):

- 🔮 **12**, Additional Formatters (Mermaid, DOT, subgraph export with filters).
- 🔮 **13**, Multi-host Providers (Codex body extractor; Copilot; generic). Codex itself + agent-skills + Antigravity already landed during the active-lens migration; the Codex body extractor (TOML `instructions` field → markdown / at-directive / slash pipeline) and Copilot are the remaining pieces. The legacy Gemini Provider shipped at Step 9.7 and was retired in 2026-05.
- 🔮 **17**, Web UI: LLM surfaces v2 (deeper). Promote LLM verbs into interactive UI flows, `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization` become panels / wizards rather than CLI verbs reflected in summaries. Job orchestration surface (queue inspector, retries, cancellations) is part of this Step.
- 🔮 **15**, Distribution polish (single-package, docs site, release infra).

> 🔀 **Execution order**: between v0.5.0 and v0.8.0 the build order diverges from numeric Step order. Steps keep their stable numbers (so commits, changesets, and citations don't churn), but the actual sequence is: Step 14 (Web UI) executes immediately after v0.5.0 and ships v0.6.0, then wave 2 (Steps 10 → 11) resumes and ships v0.8.0. Steps 12–13 follow. Rationale: validating the deterministic kernel end-to-end against a real UI before adding LLM cost / probabilistic surfaces. See Decision #118.

### Step 10, Job subsystem + first probabilistic extension (wave 2 begins)

> ⏸ **Paused**: Phase 0 (`IAction` runtime contract) shipped; Phases A–G resume after Step 14 closes. Step 14 (Web UI) lands first so the deterministic kernel can be seen end-to-end before LLM costs land. Phase 0 stays dormant in the kernel; no new wave-2 work until v0.6.0 (deterministic + Web UI) ships. See Decision #118.

This is where **wave 2, probabilistic extensions** begins. Steps 0–7 shipped the deterministic half of the dual-mode model (the Claude Provider, three Extractors, three Analyzers + the `validate-all` Analyzer, the ASCII Formatter, all running synchronously inside `sm scan` / `sm check`). Step 10 turns on the second half: queued jobs, LLM runner, and the first probabilistic extension (`skill-summarizer`, an Action of `mode: 'probabilistic'`). The kernel surface (`ctx.runner`, the queue, the preamble, the safety/confidence contract on outputs) is what unlocks every subsequent probabilistic extension across the three dual-mode kinds, Analyzer, Action, Hook. (Extractor was reduced to deterministic-only ahead of wave 2: an LLM that wants to write data attached to a node lives in an Action, not in an Extractor.)

**Storage decision (B2, DB-only, content-addressed)**: rendered job content lives in a new `state_job_contents` table keyed by `content_hash`; report payloads live inline in `state_executions.report_json`. There are no `.skill-map/jobs/<id>.md` or `.skill-map/reports/<id>.json` filesystem artifacts. Multiple jobs that resolve to the same `content_hash` (retries, `--force` reruns, fan-outs that happen to render identically) share one content row, so DB-only does not blow up storage on heavy users. The decision lands as a spec change ahead of the implementation phases below; see `.changeset/job-subsystem-db-only-content.md` for the full diff and rationale.

The work splits into seven phases that ship as separate changesets:

- **Phase 0, `IAction` runtime contract**. New `src/kernel/extensions/action.ts` mirroring `extensions/action.schema.json`. Plugin loader accepts `kind: 'action'`. Manifest validation tests. No runtime invocation yet (the dispatcher lands with the queue in Phase A).
- **Phase A, Queue infrastructure**. Storage helpers for `state_jobs` + `state_job_contents` (insert in one transaction, content-addressed dedup via `INSERT OR IGNORE`). TTL resolution + priority resolution + `contentHash` computation. Real bodies for `sm job submit / list / show` (fan-out + duplicate detection + `--force` + `--ttl` + `--priority`, no rendering yet).
- **Phase B, Preamble render + `sm job preview`**. Kernel helper produces preamble + `<user-content>` + interpolated body, persists to `state_job_contents`. Real body for `sm job preview` (reads from DB). Closes conformance case `preamble-bitwise-match` (deferred from Step 0a).
- **Phase C, Atomic claim + cancel + status + reap**. `UPDATE ... RETURNING id` claim primitive. Real bodies for `sm job claim` (with `--json` returning `{id, nonce, content}` per the Skill-agent handover contract), `sm job cancel`, `sm job status`. Reap runs at the start of every `sm job run`.
- **Phase D, `sm record` + nonce auth**. Validate id + nonce, parse `--report` (path or `-` stdin), validate report payload against `reportSchemaRef`, transition the job, write `state_executions` with `report_json` inline. Exit-code matrix (3, 4, 5).
- **Phase E, `RunnerPort` impls + `sm job run` + `ctx.runner`**. `ClaudeCliRunner` (subprocess + temp-file dance for the `claude -p` interface; missing binary → exit 2). `MockRunner` for tests. Full `sm job run` loop (reap → claim → spawn → record). `sm doctor` learns to probe runner availability. `ctx.runner` plumbed through invocation contexts (per `spec/architecture.md` §Execution modes).
- **Phase F, `skill-summarizer` built-in + `state_summaries` write-through**. First probabilistic Action. Its existence proves the full pipeline (manifest with `mode: 'probabilistic'`, kernel routing through `RunnerPort`, prompt rendering, `sm record` callback, `state_summaries` upsert). Real bodies for `sm actions list / show`.
- **Phase G, Conformance, Skill agent, events, polish**. New conformance case `extension-mode-routing` (a probabilistic Action dispatched as a queued job; a deterministic Action invoked in-process, verifies dispatch routing matches manifest `mode`). `/skill-map:run-queue` + `sm-cli-run-queue` Skill agent package. Job event emission per `spec/job-events.md` (`run.*`, `job.*`, `model.*`, `run.reap.*`). `github-enrichment` bundled plugin (hash verification). ROADMAP + `coverage.md` updated.

Phase 0 has already landed in code (staged/committed under separate concerns); the rest land in order, each with its own changeset, build verification, and tests.

### Step 11, Remaining probabilistic extensions + LLM verbs + findings

Continuation of wave 2: the rest of the per-kind summarizers, the high-leverage LLM verbs that consume them, and the `findings` surface that probabilistic Analyzers / Audits emit into.

- Per-kind probabilistic summarizers (Actions): `agent-summarizer`, `command-summarizer`, `hook-summarizer`, `note-summarizer`.
- `sm what`, `sm dedupe`, `sm cluster-triggers`, `sm impact-of`, `sm recommend-optimization`, verbs that wrap probabilistic extensions and the queue.
- `sm findings` CLI verb.
- `/skill-map:explore` meta-skill.
- `state_summaries` is exercised by all five per-kind summarizers (the table lands in Step 10 with `skill-summarizer`; Step 11 fills out the remaining four kinds). `state_enrichments` accepts additional providers beyond `github-enrichment` when they ship, against the stable contract.

### Step 16, Web UI: LLM surfaces v1 (initial)

First UI hand-off for the probabilistic layer. Steps 10 and 11 fill `state_summaries`, `state_enrichments`, and the `findings` table; this Step makes that data visible without re-architecting any view.

- **Inspector view**, replace the three `<sm-empty-state>` placeholders shipped at 14.3 (enrichment / summary / findings) with real cards driven by per-node REST endpoints. New BFF endpoints land alongside: `GET /api/nodes/:pathB64/summary`, `/enrichments`, `/findings`. Schemas extend the `rest-envelope` from 14.2.
- **Findings page**, new `/findings` route: filterable list (by severity, analyzerId, node) with deep-link to inspector, mirroring the existing list-view shape. No bulk actions yet, that lives in Step 17.
- **Per-card refresh hooks**, the inspector's per-card refresh pattern from 14.5 extends to summary/enrichment cards so a re-summarize on the kernel side flows through without a full page reload.
- **Read-only stance**, the UI does not start jobs, retry them, or cancel them at this stage. All orchestration stays CLI-side. The job-event WebSocket from 14.4 already broadcasts `summarize.*` / `enrich.*` events; the inspector subscribes for the in-progress shimmer indicator only.
- **Token / cost surfacing**, when a summary carries token counts (`IReportSafety` and the per-summary metadata from `spec/schemas/summaries/*`) display them in the card footer. No aggregation across the collection, that is Step 17.
- **Out of scope**: action buttons that trigger summarization, the dedupe/cluster/impact verbs, the queue inspector. Those are Step 17 work.

Acceptance: every probabilistic table that Step 11 closes has a read-only surface in the UI; no `<sm-empty-state placeholder text "Available in v0.8.0">` survives in the codebase. Smoke test (Playwright, added at 14.7) updates to assert the new endpoints answer in demo mode (data baked into `web/demo/data.json` by the demo build script).

### ▶ v0.8.0, LLM optional layer

---

### Step 11.5, Signal IR resolver phase + collision detection (Phase 2/3 of the active-lens migration)

Closed at v0.36.x in a five-commit sequence (Phase 2.A through 2.E). The Signal IR scaffold (types, schema, `ctx.emitSignal` callback, pure `resolveSignals` function) shipped at v0.31.0 but was never wired to the orchestrator; this Step finishes the round-trip and unlocks cross-extractor range-overlap collision detection.

What landed:

- **Phase 2.A**, resolver wiring end-to-end. The orchestrator now calls `resolveSignals` after the extract phase, materialises winning candidates as Links, threads the annotated `Signal[]` through `IAnalyzerContext.signals` to analyzers. Algorithm: filter disabled extractors (Phase 4+ stub) → rank intra-Signal candidates by `IProvider.resolverRules.kindPriority` + confidence + extractor declaration order → build overlap clusters from body-scoped Signals sharing a source (union-find over byte-range intersection) → pick cluster winners by the same tiebreak (with range length inserted between confidence and declaration order) → materialise winners + annotate losers' `resolution.rejectedBy`. External-URL pseudo-link clusters skip cross-cluster ranking. 18 unit tests cover every branch.
- **Phase 2.B**, `claude/at-directive` emits Signals. Each `@<token>` match emits a single-candidate Signal carrying the byte range (start, end, line) and the same kind / target / confidence / trigger shape the prior direct-emit path produced. The resolver materialises identical Links so the migration is transparent at the graph level.
- **Phase 2.C**, remaining link-emitters migrate. `claude/slash`, `core/markdown-link`, `core/annotations`, `core/mcp-tools`, `core/external-url-counter` all route through `emitSignal`. Body-scoped Signals get byte ranges; frontmatter and sidecar Signals get `fieldPath`. Zero behavioural change.
- **Phase 2.D**, `core/signal-collision` analyzer surfaces resolver rejections as `warn` issues attached to the loser's source node, naming the winner extractor, the loser's matched text + range, and the tiebreak reason (`kind-priority` / `higher-confidence` / `longer-range` / `earlier-declaration`). Two conformance cases land at `spec/conformance/cases/{extractor-emits-signal,signal-collision-detection}.json`; coverage matrix row 37 flips to ✅. Phase 4+ stubs (`extractorDisabled`, `belowFloor`) are documented and stubbed but not yet wired.
- **Phase 2.E**, ROADMAP catches up.

Deferred to a future Step (the rest of the spec's resolver pipeline, NOT blocking v1.0):

- Phase 4+ per-extension enable filter inside the resolver (`plugins.<id>.extensions.<extId>.enabled` predicate). The Signal's `resolution.extractorDisabled` field exists for it; the analyzer's message template is in place.
- Phase 4+ confidence floor (drop a Signal whose top candidate falls below a threshold). Same posture: data shape + analyzer message ready, predicate not wired.
- Phase 5+ fragmentation detection (adjacent Signals representing a single authored intent). A different analyzer surface; the IR already supports it via the shared `source` + `range` fields.

### Step 12, Additional Formatters

- Mermaid, DOT / Graphviz.
- Subgraph export with filters.

### Step 13, More adapters

Promotes the long-deferred multi-host scope into Phase C so v1.0 ships supporting more than the Claude ecosystem out of the box. Each adapter recognises its host's on-disk layout, classifies files into the six extension kinds, and feeds the same scan pipeline, no kernel changes, pure composition over the `AdapterPort`.

- **Codex adapter**, file layout, frontmatter conventions, slash invocations. Phase 6 (shipped 2026-05-19) already onboarded openai/Codex as a first-class provider with TOML parsing and the `.codex/agents/*.toml` classifier; this Step finishes the round-trip.
- **Codex body extractor (TOML `instructions` field)**, today the openai provider parses the TOML envelope and classifies `.codex/agents/*.toml` into agent nodes, but the `instructions: """..."""` block (which carries the agent's actual markdown body) is not fed through the link extractors. Effect: a Codex agent whose instructions reference another agent via `@handle`, `[link](path.md)`, or a slash command stays invisible in the graph under any lens. Pre-v1.0 deliverable: a new `openai/body-extractor` that reads `parsed.instructions` and runs the same markdown / at-directive / slash pipeline the Claude body uses, plus an integration test fixture exercising every link kind against a TOML source. Effort: low-medium (~half-day), the extractor surface is settled and the only novel piece is teaching the orchestrator that "body" can live on a parsed-frontmatter field rather than a file's raw contents. Keeps Codex feature parity with Claude under `activeProvider=openai`. Compare with the post-v1.0 follow-ups for Codex (Phase 6b in §Deferred): hierarchical AGENTS.md walker, `.codex/skills/`. Those stay deferred; only the body extractor lands pre-1.0.
- ~~**Gemini adapter**, Google's agent file shape, Gemini-CLI conventions.~~ (Retired 2026-05 when Google sunset Gemini CLI; replaced by the Antigravity onboarding under the open `.agents/skills/` standard during the active-lens migration. The bullet is preserved as historical context; no implementation work is owed.)
- **Copilot adapter**, GitHub Copilot's prompt / instruction surface.
- **Generic adapter**, convention-light fallback driven entirely by frontmatter (`name`, `kind`, `triggers`); the bare-minimum contract for any future host or for users with a custom layout. Doubles as the reference implementation in the adapter author guide that ships at Step 9.
- Each adapter ships its own `sm-<host>-*` skill namespace (host owns its prefix; see §Skills catalog).
- Conformance: each adapter must classify the four worked examples in `spec/conformance/cases/adapters/` (added when this step is scheduled) and round-trip the trigger set through `trigger-normalize` without surprises.

### Step 17, Web UI: LLM surfaces v2 (deeper)

Builds on Step 16 (Phase B) once the probabilistic outputs are stable in the UI. Promotes LLM **verbs** into interactive flows, the user no longer has to drop to a terminal for the high-leverage analyses.

- **Verb panels**, one panel per kernel verb shipped at Step 11. Initial set:
  - `sm what <node>` → "What does this node do?" inspector tab driven by the existing summary cache + an on-demand re-run button.
  - `sm dedupe` → cluster view that highlights near-duplicate nodes (semantic distance from the per-kind summarizer's vector or a dedicated dedupe extension).
  - `sm cluster-triggers` → grouped view of trigger overlap across agents / commands / hooks, with drill-down to per-trigger conflicts.
  - `sm impact-of <change>` → "if I touch this node, what else moves?" propagation view that uses `state_links` + transitive closure.
  - `sm recommend-optimization` → opinionated wizard that walks the user through suggested rewrites (token budget, redundancy collapse, missing fields).
- **Job orchestration UI**, queue inspector that lists in-flight + recent jobs (id, kind, started, status, retries, elapsed, owner). Action affordances: cancel a running job, retry a failed one, requeue a finished one. Drives the BFF mutation endpoints that 14.x deferred, REST verbs + WebSocket back-pressure feedback.
- **Findings management**, the read-only findings list from Step 16 grows acknowledge / dismiss / snooze / re-evaluate states. Persistence via `state_findings_status` (new table, spec edit). Bulk actions land here, not in Step 16.
- **Cost / token dashboards**, collection-wide aggregation of LLM spend (per provider, per kind, per time window). Populates from `state_summaries` token counts + `state_executions` history.
- **Settings + plugins page**, ✅ plugin toggles shipped 2026-05-09, **revised 2026-05-11** to apply live (per-scan fresh resolver + buffered modal + bulk endpoint). Implementation diverged from the original sketch on two axes: **(1)** UX is a topbar gear → PrimeNG `p-dialog` modal rather than a `/settings` route, because the only setting today is plugin toggles and a route with one section was over-engineering for a surface that fits in 600 px of vertical space; the route can graduate when settings hierarchy / cost dashboards / verb-flow controls land and the modal stops being enough. **(2)** API verbs are `PATCH /api/plugins/:id` (bundle), `PATCH /api/plugins/:bundleId/extensions/:extensionId` (qualified), and `PATCH /api/plugins` (bulk) instead of separate `/enable` + `/disable` endpoints, one PATCH with a boolean body symmetrically covers both directions, the qualified-id form reuses the same path grammar, and the bulk variant lets the SPA ship a buffered modal delta in one transaction. Persistence still goes through `config_plugins` via `IConfigPluginsPort.set`, same row that `sm plugins enable / disable` writes to. **Apply window** (the 2026-05-11 revision): the original shape carried a persistent "Restart required" `<p-message>` banner because `composeScanExtensions` read the boot-cached `pluginRuntime.resolveEnabled`, which meant `POST /api/scan` and watcher chokidar batches both ignored any mid-session PATCH. The fix layered four pieces, (a) `core/runtime/fresh-resolver.ts` exposes `buildFreshResolver` + `composeResolver` reused by `routes/plugins.ts`, `routes/scan.ts`, and `core/watcher/runtime.ts`; (b) `composeScanExtensions` / `composeFormatters` / `registerEnabledExtensions` accept an optional `resolveEnabled` override and filter user-plugin extensions / manifests / annotation contributions / view contributions by it (previously only built-ins were filtered, so disabling a previously-enabled drop-in had no effect); (c) the watcher rebuilds the resolver from `config_plugins` per batch (one cheap SQLite read); (d) the BFF's `kindRegistry` + `contributionsRegistry` (boot-cached, embedded in every envelope) now include EVERY built-in's declarations regardless of boot-time enabled state, without this, re-enabling a built-in that had been disabled at boot left the new contributions unrenderable because the registries the UI read never knew about them. Drop-in user plugins still respect boot-time filtering at the registry level (their modules weren't imported and aren't reachable mid-session, same `startsAsDisabled` exception below). The buffered modal stages edits in `pendingState`, marks dirty rows, exposes `[Discard] [Apply]` in the footer, and intercepts close with a `<p-confirmDialog>` (`Discard` / `Keep editing` / `Apply`). Apply ships the bulk PATCH and triggers a scan via the shared `ScanTriggerService` (consumed by both the topbar refresh button and the modal). **Exception**, drop-in plugins whose discovery-time `status === 'disabled'` carry `startsAsDisabled: true` on the wire and surface a per-row hint when the user re-enables them: their handlers were never loaded into memory at boot, so re-engaging needs an `sm serve` restart. Hot-reload (re-discovering new plugins on disk without restart) was rejected, it would need to invalidate the kind / contributions registries plus any in-flight scan, and the boot-time discovery is the only path that compiles AJV validators against `plugin.json`. The modal also ships an About section (logo + version table + project folder + DB path) backed by two new wire fields on `GET /api/health` (`cwd`, `dbPath`); plugin rows render manifest-declared `description` text (built-ins declare it inline on `IBuiltInBundle`, drop-ins read `plugin.json#/description`) and the description is folded into the substring-search index. The topbar also gained a manual refresh button (`POST /api/scan` with a process-level mutex; `409 scan-busy` when a scan is already in flight) so users can re-run the pipeline without dropping back to the CLI. Still pending under this bullet: settings hierarchy viewer (merged `settings.json` with per-key provenance) and the proper `/settings` route once the surface outgrows a modal. Out of scope (still): editing the settings file from the UI (deferred indefinitely, restart-to-apply contract per §Configuration).
- **PrimeNG components added**, Step 17 likely pulls in `Drawer`, `Dialog`, `DataTable`, `Toast`, `OverlayPanel`. Each addition updates `ui:bundle-analyze` to confirm the eager budget still holds (lazy-load on first open is the default, only the shell topbar lives in the eager chunk).
- **A11y pass**, full WCAG AA pass for the verb flows (live regions for job status updates, focus trapping in dialogs, keyboard shortcuts for the queue inspector). Lighter passes were enough at 14.x; verb flows are interaction-heavy and warrant the audit.

Acceptance: every CLI verb shipped at Step 11 has a UI flow that does not require the user to know the verb name. The job subsystem is observable + steerable from the UI without going back to the terminal.

---

### Step 15, Distribution polish

- **Single npm package**: `@skill-map/cli` ships CLI + UI built (`ui/dist/` copied into the package at publish time). Two `bin` entries, `sm` (short, daily use) and `skill-map` (full name, scripting). Same binary, two aliases. Single version applies to both surfaces; CLI ↔ UI key mismatches degrade gracefully (unknown keys are warned + ignored, never fatal). Versioning details in §Stack conventions.
- **Alias / squat-defense packages** (historical): an `alias/*` glob workspace published two un-scoped placeholders to lock names against third-party squatters: `skill-map` (un-scoped top-level) and `skill-mapper` (lookalike). Each shipped a single `bin` that printed a warning to stderr pointing at `@skill-map/cli` and exited with code 1. They never delegated, never wrapped the real CLI as a dependency, never installed side-effect-free. Once both names were locked at `0.0.2` and a `npm deprecate` notice was attached on each (the official npm-side equivalent of the same redirect message, surfaced at install time and on every `npm view`), the workspaces themselves were dropped from the tree. The `@skill-map/*` scope is already protected by org ownership (the moment `@skill-map/spec` was published).

  Two extra names attempted at first publish that never made it into `alias/*`:

  - **`skillmap`**, npm's anti-squat policy auto-blocks "names too similar to an existing package" once `skill-map` is published. Got E403 with `"Package name too similar to existing package skill-map"`. Net effect: no third party can publish `skillmap` either, so the name is de-facto reserved. Cheaper than maintaining a workspace.
  - **`sm-cli`**, already taken on npm at first-publish time by an unrelated project. Not critical: `sm` is the binary name (alias of `skill-map`), not a package name we ship. The binary is delivered exclusively through `@skill-map/cli`, so a third party owning the `sm-cli` name does not affect the skill-map ecosystem.

  Lesson for future placeholder additions: `npm view <name>` before creating the workspace to detect both occupied names and likely anti-squat collisions; only commit a workspace if the name is publishable. And: a workspace is only worth keeping while you might re-publish it. Once the redirect lives in `npm deprecate`, the local workspace is dead weight, drop it.
- **`sm ui` sub-command**: serves the bundled UI on a static HTTP server. Loads + merges the settings hierarchy from §Configuration, validates, and serves the result as `GET /config.json` from the same origin. UI fetches once at boot. Flags: `--cwd <path>`, `--port <num>`, `--host <iface>`, `--config <path>` (single-source override of layers 2–5), `--print-config` (emit the merged settings to stdout and exit, for debugging), `--strict` (warnings become fatal), `--open` (launch the browser).
- **Settings loader** lives in the kernel and is shared across sub-commands: `loadSettings({ cwd, explicitConfigPath?, strict? }) → ISkillMapSettings`. Pure, stateless, fully testable. Same loader used by `sm config get/set/list` and by the dev wrapper that emulates the runtime delivery path under `ng serve`.
- **`spec/runtime-settings.schema.json`**: formalises the UI-side contract. Replaces the manual TS type guards with AJV validation. Decouples the UI bundle version from the CLI bundle version: as long as both adhere to the schema, mixing minor versions across them is safe.
- **No hot reload** in the v1.0 surface. Editing settings requires a restart of `sm ui`. SSE / WebSocket reload is a separate decision, deferred until a real use case appears.
- **Publishing workflow**: GitHub Actions for release automation + changelog generation + conventional commits. **Carry-over from 14.7**: the same workflow wires `pnpm --filter skill-map-e2e validate` (Playwright + Chromium against the demo bundle in `web/demo/`) into the release pipeline so a regression that activates the live-mode `RestDataSource` under demo never reaches the public site. Chromium install in CI uses Playwright's official action with cache on `~/.cache/ms-playwright/` keyed by the resolved `@playwright/test` version pinned in `e2e/package.json`.
- **Public-site `web/demo/` deploy** (carry-over from 14.7): wire the existing `pnpm web:build` (which already chains `pnpm demo:build` per Step 14.3) into the release pipeline so the deployed site at `skill-map.dev/demo/` ships the latest demo bundle on every release. The demo bundle already passes through the e2e smoke gate above before publish.
- **Documentation site**: **Astro Starlight** (static, minimal infra, good DX).
- **Plugin API reference**: JSDoc → Starlight auto-generated.
- **LLM-discoverable docs surface** (Decision #89): generate `/llms.txt` and `/llms-full.txt` at the root of `skill-map.dev` following the [llmstxt.org](https://llmstxt.org) standard. The short file lists curated entry points (README, spec contracts, CLI reference, plugin author guide); the full file inlines the same content for one-shot ingestion. Both are emitted by `web/scripts/build-site.js` from authoritative sources (`spec/`, `context/cli-reference.md`, `ROADMAP.md`) so they cannot drift. Once the spec freezes at `v1.0.0`, register the project on [context7](https://context7.com), it indexes public repos with a usable `llms.txt` and serves them through the `context7` MCP that AI agents already consume. Net effect: any LLM-driven workflow (Claude Code, Cursor, ChatGPT browse, etc.) finds skill-map docs without scraping the schemas. Pre-`v1.0.0` is intentionally too early, the spec is still moving and we'd be teaching context7 a stale shape.
- `mia-marketplace` entry.
- Claude Code plugin wrapper, a skill that invokes `sm` from inside Claude Code (`skill-optimizer` is the canonical dual-surface example: exists as a Claude Code skill AND as a skill-map Action via invocation-template mode).
- Telemetry opt-in.
- **Update notification**, passive once-per-day check against `https://registry.npmjs.org/@skill-map/cli/latest`. CLI prints a one-line banner on stderr at the END of every command when a newer release is available; UI renders a chip next to the "Beta" badge in the shell topbar. Cache state (`latestVersion`, `checkedAt`, `shownAt`) lives in the project DB on `config_preferences` under key `_kernel.update-check`, no new table, no migration. Bails on `SM_NO_UPDATE_CHECK=1`, `CI` truthy, non-TTY stderr, missing project DB, or `updateCheck.enabled: false` in `settings.json`. Probe runs AFTER the verb's output with a 1500ms timeout so it never delays a command. BFF surface: `GET /api/update-status` (read-only projection of the cache).
- Compatibility matrix (kernel ↔ plugin API ↔ spec).
- Breaking-changes / deprecation policy.
- `sm doctor` diagnostics for user installs (verifies the install, reads the merged settings, confirms each hierarchy layer is parseable).
- **Launch polish on `skill-map.dev`**: the domain is live (Railway-deployed Caddy + DNS at Vercel, serving `/spec/v0/**` schemas). The landing source lives in `web/` (editable HTML/CSS/JS, copied into `site/` by `web/scripts/build-site.js`). The build performs (a) i18n via `data-i18n` markers, content rendered once into `/index.html` (en) and `/es/index.html` (es), `web/i18n.json` itself excluded from the build output, (b) per-language `{{CANONICAL_URL}}` substitution, (c) generation of `robots.txt` and `sitemap.xml` (with `xhtml:link hreflang` alternates) at the site root. SEO surface in place: per-language `<title>` + `<meta name="description">`, `<link rel="canonical">`, full Open Graph (title / description / url / image / locale + locale:alternate), Twitter cards (`summary_large_image`, `@crystian` as site/creator), JSON-LD `SoftwareApplication` with translated `description`, `theme-color`, `color-scheme`. The 1200×630 OG image asset (`web/img/og-image.png`) is in place and copied verbatim into the site at build time, so social previews render with the proper card. Step 15 still adds HTTP redirects, Astro Starlight docs, and registration on JSON Schema Store once `v0 → v1` ships.

#### Distribution flow (end-to-end)

How a single package travels from this repo to a consumer's project:

```
   ┌────────────────────────────────────┐
   │   skill-map repo (this monorepo)   │
   │   ─────────────────────────────    │
   │   spec/         → @skill-map/spec  │
   │   src/          → @skill-map/cli   │
   │   ui/           → built and copied │
   │                   into src/dist/ui │
   │                   at publish time  │
   │   alias/<name>/ → name placeholders│
   │                   (skill-map, etc.)│
   │                                    │
   │   Versioned by changesets;         │
   │   integrity hashes enforced.       │
   └─────────────────┬──────────────────┘
                     │  release workflow
                     │  (Version Packages PR → merge)
                     │  changeset publish
                     ▼
   ┌────────────────────────────────────┐
   │   npm registry                     │
   │   ─────────────────────────────    │
   │   @skill-map/spec  (schemas+types) │
   │   @skill-map/cli   (CLI + UI dist) │
   │   skill-map        (deprecated)    │
   │   skill-mapper     (deprecated)    │
   └─────────────────┬──────────────────┘
                     │  npm i -g @skill-map/cli
                     │  (or `npx @skill-map/cli …`)
                     ▼
   ┌────────────────────────────────────┐
   │   consumer machine                 │
   │   ─────────────────────────────    │
   │   $PATH: sm, skill-map             │
   │   node_modules/@skill-map/cli/     │
   │   ├── dist/         CLI bundle     │
   │   └── ui/           UI bundle      │
   │                                    │
   │   .skill-map/                      │  ← user-supplied
   │   ├── settings.json       optional │
   │   ├── settings.local.json optional │
   │   └── plugins/<id>/       drop-in  │
   └─────────────────┬──────────────────┘
                     │  sm ui [--port N] [--config path]
                     │  (also: sm scan, sm check, …)
                     ▼
   ┌────────────────────────────────────┐
   │   sm ui process                    │
   │   ─────────────────────────────    │
   │   loadSettings() walks the         │
   │   hierarchy, deep-merges, validates│
   │                                    │
   │   static HTTP server on            │
   │   localhost:<port> :               │
   │     GET /              → ui/*.html │
   │     GET /assets/*      → ui/assets │
   │     GET /config.json   → merged    │
   │                          settings  │
   └─────────────────┬──────────────────┘
                     │  browser open
                     ▼
   ┌────────────────────────────────────┐
   │   Angular bundle (in browser)      │
   │   ─────────────────────────────    │
   │   APP_INITIALIZER fetch /config    │
   │   merge over compile-time defaults │
   │   render graph + filters + HUD     │
   │                                    │
   │   No build tooling at runtime.     │
   │   No file system reads.            │
   └────────────────────────────────────┘
```

The UI bundle is **agnostic to who serves it**, Step 15 ships `sm ui` as the canonical server, but a third-party host (nginx, S3, Caddy) that places a `config.json` next to `index.html` works identically. Same HTTP contract, zero coupling between the UI and the CLI runtime.

### ▶ v1.0.0, full distributable

---

## Decision log

The full numbered Decision log (every architectural decision, including superseded ones with their reasoning) lives in [`context/roadmap-history.md`](./context/roadmap-history.md#decision-log). All `Decision #N` citations across `spec/`, `AGENTS.md`, commits, PRs, and changesets resolve there.

Numbering is sparse on purpose: sub-items (`74a`…`74e`) land where they belong thematically, gaps reserved for future rows on the same topic. Rows are immutable, a changed decision gets a new row and the old row flips to "superseded by #N" with a date.

---

## Deferred beyond v1.0

- **Step 16+, Write-back**. Edit / create / refactor from UI. Git-based undo. Detectors become bidirectional.
- **Step 17+, Test harness**. Dry-run / real execution / subprocess, scope TBD.
- **Step 18+, Richer workflows**. Node-pipe API, JSON declarative workflows, visual DAG.
- **Step 19+, Additional lenses**. Docs-site, additional providers.
- **Step 20+, URL liveness plugin**. Network HEAD checks, `broken-external-ref` analyzer.
- **Step 21+, Schema v2 + migration tooling**. When breaking changes on the JSON output become necessary.
- **Step 22+, Density / token-economy plugin**. Drop-in bundle that closes the loop between *identifying* token-heavy nodes and *recovering* the value. Ships a deterministic Analyzer `oversized-node` (threshold on `scan_nodes.tokens_total`, per-kind configurable via plugin KV) plus cheap-filter proxies for information density, Shannon entropy over tokens, or a gzip-ratio substitute for a coarser signal. Summarizers emit a probabilistic finding `low-information-density` when they detect repetition without added signal. A Hook on `analyzer.completed` (filtered to the `oversized-node` Analyzer) walks the flagged candidates and pipes them into `skill-optimizer` (Decision #86, canonical dual-surface Action) via `sm job submit`. Cheap-filter + expensive-verifier: deterministic proxies pre-filter for free, the LLM summarizer confirms before committing tokens. Exactly the drop-in story the plugin architecture was designed to support, zero kernel changes, pure composition of Analyzer + Finding + Hook + Action.
- **Step 23+, Built-in graph formatters: Mermaid + DOT + JSON**. Today only `ascii` ships in `src/plugins/formatters/`. The public site copy (`pe.formatter.brief` in `web/i18n.json`) advertises Mermaid (for READMEs), DOT (for Graphviz), and JSON (for pipelines) as common targets, those are the next built-in Formatter plugins to land so the site copy reflects shipped reality. Pure deterministic. No spec change required, Formatter is already a stable extension kind.
- **npm + other registry enrichment plugins**. When registries publish documented APIs.
- **ETag / conditional GET** for GitHub enrichment. Bandwidth optimization.
- **Governance / RFC process**. When external contributors appear.
- **Claude Code hook auto-record**. A PostToolUse hook that auto-calls `sm record` after an action completes. Partial coverage already via the Skill agent; full auto-record hook deferred.
- **Adversarial testing suite** for prompt injection. Fixtures with known payloads.
- **Parallel job execution**. Event schema already supports demuxing by id.
- **Multi-turn conversational jobs in DB**. If a strong case appears.
- **Plugin signing / hash verification**. Post v1.0 distribution hardening.
- **Telemetry (opt-in)**. Know which Extractors / Actions are used in the wild.
- **`.ts` migrations** (escape hatch for SQL-impossible data transforms).
- **`sm graph --root <node-path>` (focused subgraph render)**. Today `sm graph` always renders the whole collection through the chosen formatter; on large scopes the user has no way to focus on "what does THIS node connect to". Surface a `--root` flag that scopes the render to the transitive closure (in + out edges) of the named node, with `--depth N` to bound the walk. Useful for inspector-style flows from the CLI without round-tripping through `sm export`.
- **`sm conformance run --format json` (machine-readable conformance output)**. Today the runner prints a human summary; CI pipelines that want to gate on per-case results have to parse the prose. Add `--format json` returning `{ scope, cases: [{ id, status, durationMs, message? }], totals }`, mirroring the JSON shape of `sm version` / `/api/health`.
- **Standalone executable (no Node required on the host)**. Today `@skill-map/cli` ships as an npm package with two `bin` aliases (`sm`, `skill-map`); both require a Node runtime on the user's machine and a `npm install -g` (or `npx`) round-trip. The deferred goal is a self-contained binary per-OS, drop it on the box, run it, no Node, no `node_modules`. Tooling target: **`bun build --compile`** (produces a standalone executable that bundles the Bun runtime + the CLI; cross-compile to linux/macOS/windows targets is supported out of the box). Implications worth flagging: (a) the bundled runtime is Bun, not Node, any kernel code that touches Node-only APIs (e.g. `node:sqlite`, `process.binding`) needs a compat audit before flipping; (b) plugins are user-supplied JS dropped into `.skill-map/plugins/<id>/`, under a Bun standalone they execute through Bun's loader, so the plugin author guide gets a "supported runtime APIs" surface; (c) the npm package still ships in parallel, the standalone is an additional distribution channel for users who don't have or don't want Node, not a replacement. Distribution mechanics (signed releases, GitHub Releases attachments, Homebrew tap, scoop bucket) are part of the same step. Targets post-v1.0 because the v1.0 Phase C distribution polish (Step 15) intentionally locks the npm path first; standalone is a packaging extension once the npm channel is stable and the runtime-API audit is done.
- **Plugin-to-plugin dependencies**. Today the manifest declares compatibility against the spec (`specCompat`) and the contracts catalog (`catalogCompat`), but a plugin cannot declare it requires another plugin. The current escape valve is the data graph: a plugin that consumes Markdown nodes simply finds none if no Markdown extractor is installed, and the user has to discover the missing piece by absence. Use cases that break this pattern: a Markdown-validation Analyzer that is meaningless without a Markdown Extractor; a probabilistic Summarizer that extends a deterministic Extractor's output schema; a Hook chained to another plugin's Action. Add a manifest field, `requires: { "<plugin-id>": "<semver-range>" }`, checked at load time alongside `specCompat`/`catalogCompat`. Resolution order: missing dependency → status `missing-dependency` (load skipped, doctor surfaces it); incompatible version → `incompatible-dependency`; cyclic graph → load aborts with a named cycle. `sm plugins doctor` lists missing/incompatible dependencies; `sm plugins install` (when distribution lands) walks the closure. Out of scope for this entry: runtime imports between plugins (cross-plugin code reuse), that is a packaging problem, not a manifest one, and stays deferred independently. Targets post-v1.0 because the v1.0 plugin set is small enough that the data-graph fallback is acceptable, and the design needs the catalog evolution story to settle first (catalog-major + plugin-dep-major interactions).
- **Third-party UI + BFF extensions**. Today plugins extend the kernel via the six declarative kinds (Provider / Extractor / Analyzer / Action / Formatter / Hook); they cannot ship Angular components, Hono routes, or any code that runs in the browser or in the BFF process. A future plugin kind (or two new kinds, `UIExtension` + `BFFExtension`) lets third parties contribute: (a) Angular lazy modules that mount in declared extension points (extra inspector tabs, list-view columns, graph node decorations, side-nav routes, custom views, driven by the same plugin manifest field surface used today for `annotationContributions`); (b) Hono route bundles mounted under `/api/plugins/<plugin-id>/*` with their own middleware + Zod validation, sharing the BFF's broadcaster + kernel handle. Use cases: a vendor's plugin adds a "Verify against upstream" tab calling its own BFF endpoint to check the agent against the published version; a team's plugin adds an internal-scoring column in the list view sourced from a private cache; a security plugin adds a heatmap of agents that touch sensitive paths. Risk surface is non-trivial: sandboxing the contributed UI so it can't break the host SPA (CSP, isolated bundles, signed builds), securing plugin BFF endpoints (auth scope, rate limits, no kernel-bypass), versioning the contribution APIs (new sub-spec, plugin-author guide expansion). Distribution model TBD, likely the plugin author ships an extra `ui/` and `bff/` folder under their plugin, the kernel composes them at boot. Targets a deliberate post-v1.0 step because the security + sandboxing design needs masticación before any third-party code runs in the browser or the BFF process.
- **Action discovery surface in the node inspector**. The spec now carries two complementary fields that together describe "what can the user do with this node": (a) `Action.precondition` (already shipped, see `src/kernel/extensions/action.ts:108`) declares which nodes an Action applies to from the Action's own side (`kind`, `provider`, `stability`, `custom`); (b) `Analyzer.recommendedActions` (added in this iteration) declares per-Analyzer which per-node Actions are the canonical resolution for that Analyzer's issues. The UI work pending is the inspector hookup: when the user lands on a node, render two lists, "Applicable Actions" (every Action whose `precondition` matches the current node) and "Recommended for issues" (for each Issue on the node, the `recommendedActions` of the Analyzer that fired it). Actions are per-node by design; project-level operations (orphan-file prune, contribution relink) stay as CLI verbs (e.g. `sm job prune --orphan-files`) and do NOT participate in this surface. A future iteration MAY extend `IActionPrecondition` with scope-level dimensions if a real graph-scoped Action surfaces; until then the surface stays strictly per-node. Built-in pairings shipping today: `core/annotation-stale.recommendedActions = ['core/bump']` (stale sidecar → run `bump`).
- **Graph-level analyzer scope (workflow-wide checks)**. Today every analyzer receives the full graph via `IAnalyzerContext` (`ctx.nodes` + `ctx.links`), but the convention is per-node or per-link iteration (each Issue carries `nodeIds: [path]` with `minItems: 1`). Workflow-wide checks are technically possible already (an analyzer can do a graph traversal in its `evaluate` body), but two pieces are missing for them to be first-class: (a) a `scope: 'node' | 'link' | 'graph'` hint on `IAnalyzer` so the kernel can decide caching / parallelization differently (per-node analyzers are trivially parallel and incremental-friendly; `graph`-scoped ones need a full pass) and the UI can render their findings differently (a "the graph has a cycle between A → B → C" finding is qualitatively distinct from "node X is stale"); (b) an Issue shape for findings that do not attach to a specific node, today the workaround is "emit Issue with all involved nodes in `nodeIds`", which works but couples the graph-finding semantics to the node-finding shape. Concrete future analyzers that warrant this surface: supersession-chain cycle detection (`A supersededBy B supersededBy A`), orphan-cluster detection (subgraphs with no path to a designated root), missing-handler detection ("no node has a trigger for `/deploy` despite N callers using it"), agent-skill coverage gaps. Defer until ≥3 concrete graph-level analyzers exist; before then, model each one as a per-node Issue with every involved path in `nodeIds`. The decision is whether the spec needs `IAnalyzer.scope` + an `IGraphIssue` companion shape, or if the per-node Issue with multi-path `nodeIds` is sufficient at scale.
- **Live agent conversation view (real-time LLM transcript in the UI)**. Today LLM jobs (probabilistic Extractors / Analyzers / Summarizers, and any Action that delegates to an agent) surface in the Jobs panel as status + final summary; the user sees that *something* is running and what it produced, but not the back-and-forth, prompt turns, partial assistant deltas, tool calls, tool results, intermediate reasoning. The deferred goal is a streaming transcript view: while a job runs, the UI tails the conversation token-by-token (or turn-by-turn for tool calls), so the operator can watch what the agent is thinking, catch a runaway prompt early, and inspect *why* a finding was emitted without re-running with `--verbose`. Scope sketch: (a) extend `spec/job-events.md` with a `conversation.turn` event family, `turn.start` (role, turn index), `turn.delta` (token chunk, opaque to the kernel), `turn.tool_call` (name + arguments), `turn.tool_result` (truncated payload), `turn.end` (final text + token usage); kernel + runner emit them through the same broadcaster the Jobs panel already consumes; (b) persist a bounded ring of turns per job in `.skill-map/jobs/<id>/conversation.ndjson` so re-opening the UI after the job finished still shows the full transcript without re-running; (c) UI: a "Conversation" tab inside the Job inspector, virtualized list of turns, syntax-highlighted tool-call JSON, collapsible long deltas, copy-to-clipboard per turn, "jump to live" affordance; (d) a CLI mirror, `sm job tail <id> --conversation` for terminal users, sharing the same event stream. Implications worth flagging: provider abstraction needs to expose streaming deltas uniformly (Anthropic / OpenAI / local LLMs all stream differently, the kernel should normalize to the `turn.*` event shape, not leak SDK types); secret redaction passes over each `turn.delta` before it hits the broadcaster (today `cli-output-style` redacts post-hoc on text output, streaming needs the same guarantees in-flight); storage cap analyzers (a 100k-turn job should not bloat `.skill-map/`, so the ring is byte-capped with an "elided N turns" marker, mirroring the existing job-output truncation behavior); the conversation log is the operator's debugging surface, not a normative artifact, it does NOT feed back into the graph and does NOT get committed to git (`.skill-map/jobs/` is already gitignored). Targets post-v1.0 because the v1.0 LLM layer (Step 11) intentionally ships with the simpler "status + summary" UX; live transcript adds non-trivial provider-streaming + secret-redaction + UI virtualization work that is independent of correctness and benefits from being prioritized once the LLM verbs have real-world usage to guide the affordances.
- **MCP config-side discovery (Phase 5b of the active-lens migration)**. Phase 5 (shipped 2026-05-19) materialises MCP server nodes from the *consumer* side: the `core/mcp-tools` extractor scans `frontmatter.tools` on every skill / agent / command, picks up `mcp__<server>__<tool>` entries, and emits one virtual `mcp://<server>` node + a `references` link per unique server. The graph today shows MCPs only when at least one node uses them; declared-but-unused servers stay invisible, and used-but-undeclared servers materialise without any provenance back to where they should have been declared. Phase 5b closes the loop by reading the authoritative config files: Claude `settings.json` `mcpServers`, Cursor `.cursor/mcp.json`, OpenAI Codex `~/.codex/config.toml` + per-project `.codex/config.toml`, Gemini inline `mcp_servers` on subagents. Each per-provider extractor emits the same `mcp://<server>` virtual node with richer metadata (transport, command, args, declared `tools_provided`) and `derivedFrom: [<config path>]`. First-wins dedup in the orchestrator keeps the config-side node canonical when both sides emit the same id; the consumer-side stays as fallback for references that have no declaration. With both halves wired, three states become distinguishable: (a) declared + used → solid node + edges; (b) declared + unused → orphan node, surfaces as a hint that an MCP is set up but no agent uses it; (c) referenced + undeclared → `broken-ref` warning under sabor A, the operator sees they need to add it to the config. Architectural decision pending before implementation: extend `Provider.walk()` to emit synthetic nodes derived from config files (cleaner, the provider owns its filesystem territory), or add a new `ctx.readFile(path)` callback on the extractor surface (more flexible, requires a new kernel API). The `~/.codex/config.toml` reader extends the documented closed list of `os.homedir()` callers per `AGENTS.md` § Skill-map MUST NEVER read `$HOME` by default. UI follow-up: render MCP cards with the config-side metadata (transport, command, tools list) instead of the placeholder body the Phase 5 cards carry today. Effort: ~2-3 hours focused once the architectural decision lands; the rest is per-provider mechanical work.
- **Codex AGENTS.md hierarchical walker + `.codex/skills/` (Phase 6b of the active-lens migration)**. Phase 6 (shipped 2026-05-19) onboarded OpenAI Codex as a first-class provider with a TOML parser and a classifier for `.codex/agents/*.toml`. Two pieces stayed deferred. **(1) AGENTS.md hierarchical cascade.** Codex reads `AGENTS.md` at every level from project root down to CWD, concatenates them in depth order, applies per-level `AGENTS.override.md` shadow files, and caps the total at `project_doc_max_bytes` (default 32 KiB). Today each `AGENTS.md` is just another markdown node the `core/markdown` fallback claims; the hierarchy is invisible. Two modelling options: (a) keep each `AGENTS.md` as its own node and add `extends` / `overrides` edges between them so the user reads the cascade visually (simpler, ~1.5 hours, refects the source faithfully); (b) synthesise virtual `agents-md://<dir>/` nodes representing "the effective instruction set Codex sees when working in `<dir>`" with `derivedFrom: [list of source AGENTS.md]` (more ambitious, ~3-4 hours, exposes runtime semantics but the synthetic body has no real-file backing). Option (a) is the recommended starting point; (b) opens when concrete demand for runtime-view appears. Both options need to support `project_doc_fallback_filenames` (Codex can be configured to also read `CLAUDE.md`, `CONTRIBUTING.md`, etc.) and surface a warning when a level's concatenated payload exceeds the configured cap. **(2) `.codex/skills/<name>/SKILL.md` classification.** Codex's skill convention mirrors Claude's `.claude/skills/<name>/SKILL.md` but the openai provider's `classify()` currently disclaims those paths, so they fall to the markdown fallback. Extending `classify()` is a 15-minute change reusing the existing skill schema. The vendor-neutral `.agents/skills/<name>/SKILL.md` open standard is already covered by the `agent-skills` provider, so the openai provider does not need to overlap on that path. Effort: 15 min for the `.codex/skills/` classify; ~1.5 hours for the simple cascade (edges between real nodes); ~half a day for the full package including override semantics, fallback-filenames opt-in, and tests.

---

## Discarded (explicitly rejected)

Explicitly rejected proposals (with rationale) live in [`context/roadmap-history.md`](./context/roadmap-history.md#discarded-explicitly-rejected). Use that file when wondering whether an idea was already considered and dropped, the reasoning is preserved verbatim there.
