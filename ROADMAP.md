# skill-map

> Design document and execution plan for `skill-map`. Architecture, decisions, phases, deferred items, and open questions. Target: distributable product (not personal tool). Versioning policy, plugin security, i18n, onboarding docs, and compatibility matrix all apply.

## Project overview

The project description, problem statement, target audience, and philosophy live in the README. Both language variants carry the same content:

- **English (default)**: [README.md](./README.md).
- **Español**: [README.es.md](./README.es.md).

Each README also ships a short essentials-only glossary with a pointer back to the full [§Glossary](#glossary) below. This document (`ROADMAP.md`) is the design narrative, architecture decisions, execution plan, decision log, and deferred work, and sits beneath the READMEs; it is maintained in English only.

---

## Table of contents

1. [Project overview](#project-overview), language variants, document scope.
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

> **Step vs Phase glossary**: a **Step** (e.g. `Step 9`, `Step 14.4.b`) is an atomic feature milestone, one PR or a tightly-related sequence. A **Phase** (e.g. `Phase A`, `Phase B`, `Phase C`) is a multi-Step release target. Phase A = `v0.5.0` → `v0.6.0` (deterministic kernel + CLI + Web UI), Phase B = the stabilization run that ships **Beta** (`v0.52.0`: multi-runtime lens, Signal IR, annotations, extensible inspector, fused workspace, hardening), Phase C = real-time exploration (watch execution as it happens, the next milestone before the LLM layer), Phase D = `v0.8.0` (job subsystem + LLM verbs), Phase E = `v1.0.0` (surface + distribution). Execution prose mixes both: `Step 14 ships v0.6.0 inside Phase A` is correct shorthand.

---

## Glossary

> Canonical vocabulary of the project. The rest of the roadmap uses these terms without ambiguity.

### Domain and graph

| Concept | Description |
|---|---|
| **Node** | Markdown file representing a unit (skill, agent, command, markdown, for the Claude built-in catalog; other Providers may declare their own kinds). Identified by path relative to the scope root. |
| **Link** | Directed relation between two nodes (replaces the term "edge"). Carries `kind` (invokes / references / mentions / points), confidence (high / medium / low), and sources (which Extractors produced it). |
| **Issue** | Problem emitted by a deterministic analyzer when evaluating the graph. Has severity (warn / error). |
| **Finding** | Result emitted by probabilistic analysis (summarizer, LLM verb), persisted in the DB. Covers injection detection, low confidence, stale summaries. |
| **Node kind** | Category of a node, declared by the classifying Provider. Open by design, built-in Claude Provider catalog: `skill` / `agent` / `command` / `markdown`; built-in OpenAI Codex Provider: `agent` (TOML envelopes) + `skill` (the open `.agents/skills/` standard, inherited from `agent-skills` by manifest composition); neutral `agent-skills` Provider: `skill`; built-in Antigravity Provider: `workflow` (`.agent/workflows/*.md`, its own) + `skill` (the open `.agents/skills/` standard, inherited from `agent-skills` by manifest composition). The retired Gemini Provider declared `agent` / `skill` / `markdown` and was removed when Google sunset Gemini CLI 2026-05; the historical entries above survive in `context/roadmap-history.md`. External Providers MAY declare their own. Field `node.kind` in the spec. Distinct from **link kind** (value of `link.kind`) and **extension kind** (plugin category, see next table). All three are polysemic specializations of the generic term "kind"; the prefix is used when context is not obvious. |

### Extensions (6 extension kinds)

"Extension kind" is the category of a plugin piece, distinct from **node kind** in the previous table. The ecosystem exposes six, and they form the stable kernel contract. Three kinds are dual-mode (deterministic / probabilistic, see §Execution modes below); three kinds are deterministic-only because they sit on the deterministic scan path.

| Concept | Description |
|---|---|
| **Provider** | Extension kind. Recognizes a platform (today's built-in catalog: `claude`, `codex` for Codex, `antigravity` (its own `.agent/workflows/*.md` workflows plus the open-standard skills it adopted), `agent-skills` for the vendor-neutral `.agents/skills/<n>/SKILL.md` layout, plus the `core` fallback that owns `markdown`), classifies each file into its node kind, and declares its on-disk `kinds` catalog (per-kind frontmatter `schema` + `ui` presentation block). **Deterministic-only**. The retired `gemini` Provider was removed when Google sunset Gemini CLI on 2026-06-18 and replaced it with Antigravity (which declares its own `workflow` kind for `.agent/workflows/` and reuses the open-standard `.agents/skills/` classifier via the `agent-skills` Provider, so under its lens those skills classify as `antigravity`/`skill`). |
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
| **Summarizer** | Per-kind Action that produces a structured semantic summary. One summarizer per Provider-declared kind (e.g. `claude/summarize-skill`, `claude/summarize-agent`, `claude/summarize-markdown`, `codex/summarize-agent`, `agent-skills/summarize-skill`, ...). |
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
| **Zone config_** | Prefix for user-owned tables: plugin import-trust grants, preferences, schema versions. |
| **Migration** | Versioned `.sql` file (`NNN_snake_case.sql`) that evolves the schema. Up-only. |
| **user_version** | Built-in SQLite PRAGMA. Fast tracking of the kernel schema. |
| **Auto-backup** | Automatic copy of the DB to `.skill-map/backups/…db` before applying migrations. |

### CLI and UI

| Concept | Description |
|---|---|
| **Introspection** | Property of the CLI to emit its own structure (`sm help --format json`), consumed by docs, completion, UI, agents. |
| **Graph view** | Main UI view: nodes + links, interactive. |
| **List view** | Tabular view of nodes with filters and sort. |
| **Scan corpus vs render cap** | Two separate knobs. The scan walks + analyzes + reference-validates the full corpus up to `scan.maxScan` (default 50000), so links resolve across a large monorepo regardless of what is drawn; the graph map renders only a selected folder branch capped at `scan.maxNodes` (default 256, a Foblex projection bound). The folders tree is the full-corpus navigator: it lists everything with per-folder issue badges and scopes the map to a chosen branch (banner when the branch exceeds the cap). |
| **Inspector panel** | UI section showing detail of the selected node: metadata, weight, summary, links, issues, findings. |
| **Issues panel** | UI section fed by `sm check` (deterministic). |
| **Findings panel** | UI section fed by `sm findings` (probabilistic). |
| **WebSocket** | Bidirectional protocol between server and UI. Push of events (job lifecycle, scan updates) + user commands (rescan, submit, cancel). |

---

## Visual roadmap

Mirrors the interactive timeline on `skill-map.ai` (driven by `web/modules/roadmap.js` `PHASES`). Seven segments (0 / A / B / C / D / E / F): six phases to 1.0 (0 through E), plus F beyond; 0 ships highlights, A/B/D/E ship numbered steps, C/F ship sketches.

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
● 293 architectural decisions, logged
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
●  7    Robustness                   sm watch + chokidar · link-kind-conflict analyzer · sm job prune · trigger normalization
●  8    Diff + export                sm graph · sm scan compare-with · sm export with mini query language
●  9    Plugin author UX             plugin runtime · plugin migrations · author guide
●  ALm  Active-lens migration        Phases 1–6 (2026-05-19→05-23): active-provider lens · Signal IR scaffold · numeric `Confidence` · MCP virtual nodes + `core/mcp-tools` extractor · OpenAI Codex provider (`.codex/agents/*.toml`) · Antigravity onboarded + Gemini retired · lens-only extractor gating · provider-aware confidence bump on resolved links · reserved-name catalog + analyzer + confidence downgrade · observable link analysis (`core/link-counts` chips, in/out per-kind tooltip) · lens-drift warning · db-version skew detection · auto-detect on first scan
  ────────────────────────────────────────────────────────────────────────
   ▶ deterministic core + Web UI shipped · skill-map@0.6

═══════════════════════════════════════════════════════════════════════════
  PHASE B · STABILIZATION (deterministic core hardened into Beta)
═══════════════════════════════════════════════════════════════════════════
● Plugin model settled · six kinds · Audit absorbed into Analyzer · open node kinds
● Active-lens multi-provider · claude · codex/codex · agent-skills · antigravity (gemini retired)
● Signal IR + cross-extractor collision detection · core/extractor-collision
● Annotations · co-located .sm sidecars · drift detection · git-author · write-consent
● MCP virtual nodes + observable link analysis · core/link-counts chips · edge opacity
● Reserved-name catalog + analyzer
● Extensible inspector · plugin action buttons · per-plugin sections · parametrized actions
● Fused workspace · files rail + graph + inspector · map curation · isolate-chain
● Hardening · loopback-only serve · node caps · opt-in off-by-default telemetry
  ────────────────────────────────────────────────────────────────────────
   ▶ YOU ARE HERE, deterministic core complete and stabilized · skill-map@0.52. The last pre-v1.0 deterministic deliverable, the Codex body extractor (Step 13), has landed. Phase C (real-time exploration) is next; the LLM optional layer (Phase D) follows, opening with Step 10 (job subsystem).
  ────────────────────────────────────────────────────────────────────────
   ▶ Beta

═══════════════════════════════════════════════════════════════════════════
  PHASE C · REAL-TIME EXPLORATION (next, watch execution as it happens)
═══════════════════════════════════════════════════════════════════════════
○       Event stream                 live WebSocket from the kernel to the UI
○       Execution snapshot           immutable audit of every run
○       Real-time exploration        watch agents and skills as they run
  ────────────────────────────────────────────────────────────────────────
   ▶ target: next, real-time exploration before the LLM optional layer

═══════════════════════════════════════════════════════════════════════════
  PHASE D · LLM AS AN OPTIONAL LAYER (summaries, semantic verbs)
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
  PHASE E · SURFACE & DISTRIBUTION (formatters, full web UI, single-binary release)
═══════════════════════════════════════════════════════════════════════════
○  12   Additional formatters        Mermaid · DOT/Graphviz · subgraph export with filters
○  13   Multi-host adapters          Codex body extractor · Copilot · per-host sm-<host>-* skill namespace · adapter conformance · (Codex + agent-skills + Antigravity onboarded during the post-v0.6.0 active-lens migration; legacy Gemini Provider shipped at 9.7 and retired 2026-05 when Antigravity replaced Gemini CLI)
○  14a  Web UI: BFF + transport      Hono BFF · WebSocket /ws · single-port mandate · Angular SPA + REST + WS under one listener · sm serve --port N
○  14b  Web UI: Flavor B slice       Inspector with enrichment + summaries + findings · command submit from UI · chokidar live updates · MD body renderer pick
○  14c  Web UI: polish & budgets     URL-synced filter state · responsive scope · bundle budget · dark mode tri-state · Foblex types reassessment
○  17   UI: LLM surfaces v2          Verbs as flows (what · dedupe · cluster-triggers · impact-of · recommend-optimization) · queue inspector · findings management · cost dashboard · settings + plugins page · WCAG AA pass
○  15a  Single package distrib       @skill-map/cli with UI bundled · sm + skill-map binary aliases · sm ui sub-command · settings loader + runtime-settings schema
○  15b  Documentation site           Astro Starlight · plugin API reference (JSDoc → Starlight) · llms.txt + llms-full.txt · skill-map.ai launch · context7
○  15c  Release infrastructure       GH Actions release + changelog · telemetry opt-in · compatibility matrix · breaking-changes policy · sm doctor diagnostics · Claude Code wrapper
  ────────────────────────────────────────────────────────────────────────
   ▶ target: v1.0.0, full distributable

═══════════════════════════════════════════════════════════════════════════
  PHASE F · BEYOND (post-v1.0, to evaluate)
═══════════════════════════════════════════════════════════════════════════
○       Live agent conversation      stream the LLM transcript turn-by-turn (depends on the LLM layer)
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
- Canonical URLs: `https://skill-map.ai/spec/v0/<path>.schema.json` (live today via Railway-deployed Caddy; DNS at Vercel). Scheme bumps to `v1` at the first stable release.
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

The kernel accepts ports (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`) and never imports SQLite, fs, or subprocess directly. The normative port contract and IO discipline live in [`spec/architecture.md`](./spec/architecture.md) (§Ports, §Layering). Design consequences worth restating here:

- Each adapter is swappable: `InMemoryStorageAdapter` / `MockRunner` in tests, `SqliteStorageAdapter` / `ClaudeCliRunner` in production. The test pyramid collapses cleanly, unit tests inject mocks into the kernel, integration tests wire real adapters.
- CLI and UI are **peers** consuming the same kernel API; neither depends on the other.

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

SQLite at `<cwd>/.skill-map/skill-map.db`, **gitignored by default** because it carries per-developer state (job runs, summaries, plugin KV) most teams do not want to diff in PRs; a team opts into sharing audit history via the experimental `history.share` flag (then removes the DB from its `.gitignore`). There is no global / user scope: the CLI never reads `$HOME` by default, and the only way to extend the scan beyond `<cwd>` is passing positional roots to `sm scan` (per-invocation, never persisted). The one documented `$HOME` exception is `~/.skill-map/settings.json` (per-machine preferences, read directly, never merged into the project layers). Scope principle: [`spec/cli-contract.md`](./spec/cli-contract.md) §Scope is always project-local.

The full table catalog, column conventions, and migration rules are normative in [`spec/db-schema.md`](./spec/db-schema.md). Design shape worth restating:

- **Three zones**: `scan_*` (last scan result, truncated and repopulated by `sm scan`), `state_*` (persistent operational data: jobs, executions, summaries, enrichments, plugin KV), `config_*` (user-owned config). Backups preserve `state_*` + `config_*`; `scan_*` regenerates on demand.

- **Data access**: Kysely + CamelCasePlugin inside the SQLite adapter; the kernel and adapters consume typed `camelCase` repos and never see SQL (the `snake_case ↔ camelCase` mapping is automatic). Full ORMs (Prisma, Drizzle, TypeORM) were rejected as incompatible with hand-written `.sql` migrations. Table / column / index naming conventions are in [`spec/db-schema.md`](./spec/db-schema.md).
- **Migrations**: up-only `.sql` files, auto-applied on startup with auto-backup. **Pre-1.0 schema drift**: while the kernel is in `0.Y.Z` there are no incremental kernel migrations; a write-side open (`sm scan`, `sm watch`, `sm serve` before listening) detects drift on two axes, the recorded `scan_meta.scanned_by_version` against the running CLI (any `major.minor` mismatch is drift) AND the recorded `scan_meta.schema_fingerprint` (sha256 of the bundled migration DDL) against the live fingerprint (any mismatch, or a NULL value from a pre-fingerprint DB, is drift). The fingerprint axis catches an inline `001_initial.sql` column add within the same `major.minor` (greenfield posture, no version bump) that the version axis cannot see. Either axis deletes and rebuilds the DB from `001_initial.sql` (the cache is derived; `.sm` sidecars hold the real data); a TTY operator confirms first (`--yes` / non-TTY auto-rebuild), declining aborts with a nonzero exit. Read verbs surface a WARN advisory (point at `sm scan` / `sm db reset`) instead of rebuilding. Real up-only migrations land at `1.0.0`. See [`spec/db-schema.md`](./spec/db-schema.md) §Schema drift (pre-1.0).
- **`sm db` verbs** (`reset` / `reset --state` / `reset --hard` / `backup` / `restore` / `shell` / `dump` / `migrate`) are specified in [`spec/cli-contract.md`](./spec/cli-contract.md).

---

## Job system

### Core model

- **Job** = runtime instance of an Action applied to one or more Nodes, in `state_jobs`. The **job file** (`.skill-map/jobs/<id>.md`) holds the rendered prompt + callback instruction; it is kernel-generated, ephemeral, and content-only (state lives in `state_jobs.status`, no maildir, flat folder).
- **ID formats**: base shape `<prefix>-YYYYMMDD-HHMMSS-XXXX` (UTC + 4 hex); prefixes `d-` jobs, `e-` execution records, `r-[<mode>-]` runs (modes `ext` / `scan` / `check`), carried in `runId` so parallel runner streams stay demuxable. Full analyzer in Decision #88.

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

Terminal states `completed` / `failed`; `queued → failed` is reachable only via `sm job cancel`. Two mechanisms make multiple runners safe to race, both normative in [`spec/job-lifecycle.md`](./spec/job-lifecycle.md): the **atomic claim** (`UPDATE ... WHERE status='queued' ... RETURNING id`, single-row, priority then FIFO) and the start-of-run **auto-reap** (TTL-expired `running` rows flipped to `failed`, reason `abandoned`).

**TTL** is resolved at submit time and frozen on `state_jobs.ttlSeconds`: `action.expectedDurationSeconds` (else `config.jobs.ttlSeconds`, default 3600) times `graceMultiplier` (3), floored at `minimumTtlSeconds` (60), with `config.jobs.perActionTtl.<id>` or `--ttl` overriding. **Duplicate prevention**: a submit matching an active `(actionId, actionVersion, nodeId, contentHash)` in `queued|running` is refused with exit 3 unless `--force`.

### Runners

Three execution paths, matching the `runner` field in `job.schema.json` (`cli` / `skill` / `in-process`):

- **CLI runner loop** (`sm job run`, `runner: cli`): claims, invokes a `RunnerPort` impl (`ClaudeCliRunner` in prod, `MockRunner` in tests) as a `claude -p < jobfile.md` subprocess per item, then records. Context-free; for CI / cron / batch.
- **Skill agent** (`/skill-map:run-queue`, `runner: skill`): a peer driving adapter (to CLI / Server) that consumes `sm job claim` + `sm record` from inside an LLM session, the agent IS the execution and never crosses `RunnerPort` (the "runner" label here is descriptive, not structural). Context bleeds between items; for interactive use.
- **In-process** (`mode: local`, `runner: in-process`): the action's own code produces the report synchronously, no job file, no subprocess; the kernel validates it against the action's report schema and transitions straight to terminal. `--run` / `sm job run` are no-ops (it already ran). For deterministic enrichment and cheap aggregations.

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

Each job MD carries a unique `nonce` in frontmatter; `sm record` requires a matching `--id` + `--nonce`, so a forged callback cannot close someone else's pending dispatch.

### Prompt injection mitigation

Two kernel-enforced layers, normative in [`spec/prompt-preamble.md`](./spec/prompt-preamble.md): (1) every interpolated node body is wrapped in `<user-content id="...">...</user-content>` delimiters (the kernel escapes any literal closing tag with a zero-width space, reversed only for display, never for hashing; nesting is forbidden, one block per node; a template interpolating user text outside a block is rejected at registration); (2) the canonical preamble is auto-prepended before every action template (templates cannot modify, omit, or precede it) and instructs the model to treat user-content as data and record detected injections in the report's `safety` field.

### Atomicity edge cases

Orphan-file / missing-file / mid-run-crash handling (DB row with no MD file → `failed: job-file-missing`; MD file with no DB row → `sm job prune --orphan-files`, never auto-deleted; crash between claim and read → covered by auto-reap) is specified in [`spec/job-lifecycle.md`](./spec/job-lifecycle.md). A user who edits a job MD before it runs owns the consequences: the runner uses current content by design.

### Concurrency

The job subsystem runs jobs **sequentially within a single runner**, one claim / spawn / record cycle at a time. There is no pool or scheduler through `v1.0`.

Multiple runners MAY coexist (e.g. a cron `sm job run --all` in parallel with an interactive Skill agent draining via `sm job claim`). The atomic-claim semantics exist precisely for this case: the `UPDATE ... WHERE status='queued' RETURNING id` guarantees that no two runners ever claim the same row, even when they race.

The event schema carries `runId` + `jobId` so parallel per-runner sequences can be interleaved without losing order per `jobId`. True in-runner parallelism (a pool inside `sm job run`) is a non-breaking post-`v1.0` extension.

### Progress events

Emitted via `ProgressEmitterPort` (adapters: `pretty` default TTY, `--stream-output` adds model tokens for debug, `--json` ndjson) and re-emitted over **WebSocket** by the server. The canonical event catalog, the `{ type, timestamp, runId, jobId, data }` envelope, and the synthetic-run pattern (`r-scan-…` / `r-check-…`) are in [`spec/job-events.md`](./spec/job-events.md): the **job family** is stable, the **`scan.*` / `issue.*`** families are experimental until promoted. Task-UI integration (Claude Code's `TaskCreate`, future host primitives) lives as a host-specific skill (`sm-cli-run-queue`), not a CLI output mode; Cursor is out of scope (see §Discarded).

### `sm job` CLI surface

The verb surface (`submit` / `list` / `show` / `preview` / `claim` / `run` / `status` / `cancel` / `prune`, with `--run` / `--all` / `--force` / `--ttl` / `--priority` / `--orphan-files`) is specified in [`spec/cli-contract.md`](./spec/cli-contract.md).

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
| **Hook** | Reacts to a curated set of kernel lifecycle events; declarative subscriber. | det only | event payload | side effects (notifications, integrations, cascades) |

The six extension kinds are Provider, Extractor, Analyzer, Action, Formatter, Hook. The kernel ships `validate-all` as a Analyzer (post-scan AJV revalidation against the spec schemas); there is no Suite, Enricher, or composer kind, composition is explicit at the verb / Hook level.

### Drop-in installation

No `add` / `remove` verbs: the user drops a plugin folder into `<cwd>/.skill-map/plugins/<plugin-id>/` (the only default discovery root), or points `--plugin-dir <path>` at a custom root per invocation. The directory name MUST equal the plugin id (mismatch → `invalid-manifest`), which eliminates same-root id collisions by construction; cross-root collisions block **both** plugins with status `id-collision` (no precedence, the user renames one).

**Plugin enable vs import trust (security boundary, two orthogonal axes).** Dropping a folder is not consent to run it. A project-local plugin is discovered (manifest parsed, listed) but its code is imported by the runtime verbs (`sm scan`, `sm serve`, ...) only when it is BOTH **enabled** (operational, shareable, in the config layers, `settings.json` overlaid by `settings.local.json`, written by `sm plugins enable / disable`) AND **trusted** (security, LOCAL per-machine, a per-plugin row in the `config_plugins` DB trust store written by `sm plugins trust / untrust`, or the local opt-in `pluginTrust.projectEnabled`). The committed `settings.json` baseline cannot grant import trust, a cloned repo controls its own `settings.json` and the DB never travels in a commit, so cloning-and-scanning never auto-executes the repo's plugins; the runtime emits a one-time "found but not loaded" notice pointing at `sm plugins trust`. Built-ins and explicit `--plugin-dir` are exempt; `--no-plugins` skips discovery. The two not-loaded reasons stay distinct (`disabledByConfig` vs `untrustedNotLoaded`), so an explicit disable never re-reads as untrusted. Normative in [`spec/architecture.md`](./spec/architecture.md) §Locality. **Revised 2026-06-27: enable (operational) split from trust (security), enable moved from the DB to the config layers, `config_plugins` repurposed to the trust store, new `sm plugins trust / untrust` verbs plus a per-plugin UI Trust control and the `pluginTrust.projectEnabled` escape hatch.**

The folder layout (`<kind>s/<name>/index.js` per extension, `kinds/` for Providers, `migrations/` for dedicated storage) and the manifest shape (`version` / `specCompat` / `catalogCompat` / `description`, no `id`, no `extensions[]` array) are documented in [`spec/plugin-author-guide.md`](./spec/plugin-author-guide.md). Pre-`v1.0.0`, `specCompat` pins a minor range because minor bumps MAY carry breaking changes while the spec is `0.y.z` ([`versioning.md`](./spec/versioning.md) §Pre-1.0); manifests move to `"^1.0.0"` once the spec ships `v1.0.0`.

### Loading and qualified ids

On boot (or `sm plugins list`) the kernel walks the plugin root, validates each manifest (directory name == id, id unique across roots, `specCompat` satisfied), dynamic-imports and schema-validates each extension, and registers it under the **qualified id** `<plugin-id>/<extension-id>` per kind; dedicated-storage plugins get their prefix-enforced tables provisioned. Qualified ids namespace every cross-extension reference, so two plugins can safely ship the same short id. The seven load statuses (`loaded` / `disabled` / `incompatible-spec` / `incompatible-catalog` / `invalid-manifest` / `load-error` / `id-collision`) and the full load contract are in [`spec/plugin-author-guide.md`](./spec/plugin-author-guide.md) §Discovery and §Diagnostics.

### Provider declares its own kind catalog

Each Provider owns the catalog of kinds it emits and their frontmatter schemas; the spec keeps only the universal `frontmatter/base.schema.json`. Since the structure-as-truth refactor the catalog lives **on disk** at `<plugin>/kinds/<kindName>/{schema.json, kind.json}` (not an inline manifest map, and there is no `defaultRefreshAction`), so a future Cursor Provider would just ship `kinds/mcp-server/`, `kinds/mode/`, etc. See [`spec/plugin-author-guide.md`](./spec/plugin-author-guide.md) §Providers and [`spec/architecture.md`](./spec/architecture.md) §Provider.

### Multi-provider rollout (Step 9.7)

Three conventions land together when more than one Provider is active in the same scope:

1. **Declarative `read` instead of hand-rolled `walk()`**. Provider manifests declare `read: { extensions, parser }` (e.g. `{ extensions: ['.md'], parser: 'frontmatter-yaml' }`). The kernel walker owns symlink-skip (audit M7), TOCTOU re-stat, ignore-filter consumption, prototype-pollution strip, and the `js-yaml` JSON_SCHEMA pin so every Provider inherits them by construction. Built-in parsers ship as a closed set inside the kernel (`frontmatter-yaml`, `plain`); user plugins cannot register their own. A Provider that needs non-standard discovery still implements `walk()` directly, it wins over `read` and accepts the duplication of audit defences.

2. **`classify(): string | null`**. With multiple Providers active, every Provider walks every file matching its `read.extensions`. Each Provider claims its own conventions and disclaims the rest by returning `null`. The orchestrator skips disclaimed paths, so the same path is never persisted twice. Concretely (current catalog): Claude claims `.claude/`, `notes/`, `CLAUDE.md`; OpenAI Codex claims `.codex/agents/*.toml` (and routes their TOML envelope through the kernel walker); the neutral `agent-skills` Provider claims `.agents/skills/<n>/SKILL.md` (the same on-disk home Google adopted for Antigravity skills after retiring the vendor-specific `.gemini/` layout); the `core` fallback owns generic `.md`. The `antigravity` Provider claims `.agent/workflows/<n>.md` (singular `.agent`) as its own `workflow` kind, AND reuses the `agent-skills` classifier by manifest composition for skills (so under its lens `.agents/skills/<n>/SKILL.md` classifies as `antigravity`/`skill`); it also contributes lens identity plus its own reserved-name verbs layered on the open-standard base catalog that `agent-skills` owns and every standard adopter inherits. Files outside every Provider's territory are silently ignored. The spec's `provider-ambiguous` issue still fires when two Providers DO claim the same file (e.g. a misconfigured plugin); the disclaim contract prevents the legacy "Claude as catch-all for any markdown" footgun that otherwise produces the conflict by default.

3. **Format-named kinds = fallback only**. Each Provider has one fallback kind named after the file's *format* (`markdown` today; future `toml` for Codex's slash-commands, future `json` for Gemini's extension manifests). The convention: format-named kinds apply only when no specific role matches, a `.toml` file that IS a Codex agent classifies as `agent`, never `toml`. Specific roles (agent / command / skill) prevail over format naming. The Claude fallback was renamed `note` → `markdown` to land this convention.

### Per-Provider node painting (kindRegistry)

When two Providers declare the same kind name (e.g. Claude `agent` and Codex `agent`), the BFF's `kindRegistry` keeps every contribution under `entry.providers[<providerId>]` and points `primaryProviderId` at the first Provider in iteration order. The primary drives the kind's shared CSS var (`--sm-kind-<kind>`) so static stylesheets stay valid; per-node painting picks `entry.providers[node.provider]` to override the accent inline. Result: a Claude-sourced `agent` paints blue, a Codex-sourced `agent` paints with its own palette, on the same graph, without forcing different kind names. The UI exposes `KindRegistryService.providersOf(kind)` for surfaces that need the full per-Provider drill-down (inspector audit panel, future plugin-contributions panel).

The sibling **`providerRegistry`** carries the Provider's OWN identity (the manifest `presentation` block: label, color, optional `colorDark` / `icon` / `emoji` / `hideChip`), distinct from its kinds' visuals. The BFF assembles it at boot the same way (`buildProviderRegistry`) and embeds it on every payload-bearing envelope; the SPA's `ProviderRegistryService` feeds the active-lens dropdown, the topbar lens chip, and the per-node provider chip from it, so adding a Provider never requires a UI edit. `hideChip` (set by the universal `markdown` fallback) suppresses only the per-card badge. Auto-detect markers ride on the same manifest (`detect.markers`), so the detectable lens set also derives from the registered Providers rather than a hardcoded table. The lens dropdown additionally greys out Providers the operator has currently disabled (the `selectable` set on `GET /api/active-provider`, resolved live from the per-extension enabled state): a disabled Provider stays listed but cannot be chosen as the lens, matching the scan-time rule that a lens pointing at a disabled Provider runs none of its extractors.

### Extractor persistence channels and scan cache

An Extractor emits through three context channels, in any combination per `extract()` call: `ctx.emitLink(link)` (the `links` table), `ctx.enrichNode(partial)` (the separate enrichment layer, see §Enrichment), and `ctx.store.write(table, row)` (the plugin's own `plugin_<id>_*` table). Extractors are **deterministic-only** (they run inside `sm scan`; LLM-driven enrichment is an Action concern, so Extractor manifests carry no `mode`), and a manifest may narrow which kinds it runs on via `precondition.kind` and validate its own writes via an opt-in storage schema. The per-`(node, extractor)` cache (`scan_extractor_runs`) turns `sm scan --changed` into a one-row reuse on unchanged bodies: a newly registered Extractor runs against cached nodes, an uninstalled one has its links / enrichments cleaned without invalidating the rest. Full contracts: [`spec/plugin-author-guide.md`](./spec/plugin-author-guide.md) §Extractors and [`spec/architecture.md`](./spec/architecture.md) §Extractor.

### Hook trigger set

Hooks subscribe to a curated set of **ten** lifecycle events: eight pipeline-driven (`scan.started`, `scan.completed`, `extractor.completed`, `analyzer.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`) plus two CLI-process-driven, `boot` (before the verb routes, the dispatcher awaits hooks so their output lands above the verb, `core/update-check` relies on this) and `shutdown` (after the exit code resolves, never altering it). Everything else (`scan.progress`, `model.delta`, `job.claimed`, ...) is intentionally not hookable. Hooks are **deterministic-only** and may narrow with a declarative `filter`; the shared dispatcher (`src/kernel/extensions/hook-dispatcher.ts`) serves both the orchestrator and the CLI entry, with `core/update-check` (on `boot`) as the first built-in consumer. Full catalog and payloads: [`spec/architecture.md`](./spec/architecture.md) §Hook.

### Storage modes

Plugins persist state by declaring `storage` in the manifest: **Mode A (KV)** gives `ctx.store.{get,set,list,delete}` over the kernel-owned `state_plugin_kvs` table; **Mode B (dedicated)** provisions prefix-namespaced `plugin_<id>_*` tables from the plugin's own migrations. Both can opt into write-side schema validation. Mode B is guarded by triple protection (prefix enforcement on every DDL, DDL validation rejecting cross-table FKs / `ATTACH` / global pragmas, and a scoped `Database` wrapper that rejects cross-namespace queries at runtime). **Honest note**: drop-in plugins are user-placed code, so the protection guards accidents, not hostile plugins; signing is a post-v1.0 question. Full contracts: [`spec/plugin-kv-api.md`](./spec/plugin-kv-api.md) and [`spec/db-schema.md`](./spec/db-schema.md).

### Plugin commands

The `sm plugins` family (`list` / `show` / `enable` / `disable` / `doctor` / `create` / `upgrade`), plus `sm conformance run` and `sm check --include-prob`, is specified in [`spec/cli-contract.md`](./spec/cli-contract.md).

### Default plugin pack

The reference impl bundles built-ins for each kind: one Provider (`claude`), several Extractors (`slash`, `at-directive`, `markdown-link`, `backtick-path`), several Analyzers (`trigger-collisions`, `dangling-refs`, `link-kind-conflict`, `validate-all`), at least one Action, one Formatter (`ascii`). Hooks ship as needed for first-party integrations. `backtick-path` is the deliberate inverse of the code-strip policy: it extracts relative `.md` paths FROM code spans / fences (the Agent Skills standard's "load referenced files on demand" contract, the dominant reference shape in agent-authored skills) as `points` edges (Decision #127), normative in `spec/architecture.md` §Extractor · code-region file references. The prose-side extractors additionally strip raw HTML (comments + tag tokens) via `stripCodeAndHtml`, so a link commented out as `<!-- [x](old.md) -->` or hiding in an attribute value never becomes a phantom edge; that HTML strip stays independent of the code-region inverse mask (HTML is not a code region).

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
| **Slot** | Spec + kernel + UI | A named visual surface in the UI that fixes both the renderer and the payload shape. Closed catalog of 14 slots in `spec/schemas/view-slots.schema.json`. The plugin author picks ONE slot per contribution; that pick is the entire mental model. |
| **Contribution** | Plugin | Per-node typed data emission via `ctx.emitContribution(ref, payload)`, payload conforms to the slot's payload schema. |

Plugin authors pick slots. The kernel + spec publish the catalog and the per-slot AJV payload schemas. There is no separate "contract" abstraction, the slot IS the contract.

**Earlier model (superseded)**: a separate "Contract" layer (11 contract names like `node-counter`, `node-tag`) sat between Slot and Contribution. The plugin author picked a contract and the UI broadcast each contribution to ALL slots compatible with that contract. The 2026-05-10 redesign eliminated the contract layer because it doubled the mental model with no real win for plugin authors and produced surprise duplication when the same data appeared in 4 places automatically. See decision #9 below.

### Catalogs and manifest

Plugin authors pick a `slot` from the closed catalog (14 slots, [`spec/view-slots.md`](./spec/view-slots.md)) and, for settings, an input-type from the closed catalog (10 types, [`spec/input-types.md`](./spec/input-types.md)), writing zero JSON Schema and zero renderer code. View contributions are declared in the extension manifest's `ui` map (alongside `settings` and `annotation`) and emitted per node at scan time via `ctx.emitContribution(ref, payload)`; the manifest carries `catalogCompat` (parallel to `specCompat`), and a catalog mismatch surfaces as `incompatible-catalog`. The per-slot renderers and payload shapes, the prefix-discriminated icon strings, and the UI-side slot configuration (cardinality, deterministic ordering, replacement strategy) live in [`spec/plugin-author-guide.md`](./spec/plugin-author-guide.md) §View contributions, [`spec/view-slots.md`](./spec/view-slots.md), and [`context/view-slots.md`](./context/view-slots.md).

### Author API (emit by reference + dev-time payload types, 2026-06-07)

The author surface was tightened to remove the string-id duplication and to push payload validation up to author time. Three changes, all breaking (minor, pre-1.0):

- **Emit by reference, not by id.** A contribution is declared as a module-level const and listed in `ui` by shorthand (`const facts = { slot: '...' } satisfies IViewContribution; ui: { facts }`); `evaluate` / `extract` emit by passing that const **by reference** (`ctx.emitContribution([nodePath,] facts, payload)`), never a string id. The kernel recovers the contribution id (the `ui` key) by **object identity** against the `ui` map. A ref that is not a declared `ui` value (a spread copy, an inline literal) drops with a loud `extension.error` (`reason: undeclared-contribution-ref`), never silently. This kills the old failure mode where a typo'd string id dropped at runtime with no compile-time signal. (The id is still the `ui` key, kebab-cased per the manifest schema, not the const's variable name.)
- **Dev-time payload types.** `emitContribution` is generic: `emitContribution<C extends IViewContribution>([nodePath,] ref: C, payload: SlotPayload<C['slot']>)`. `SlotPayload<S>` + the per-slot payload interfaces are **generated from `view-slots.schema.json#/$defs/payloads`** by `json-schema-to-typescript` (wired into `scripts/generate-view-catalog.js`, drift-guarded by `view-catalog:check`). A TS author who writes `satisfies IViewContribution` gets a compile-time error on a wrong-shape payload. The generics are a dev-time layer **on top of**, not a replacement for, the runtime AJV check, which stays the authority across the plugin trust boundary (JS plugins, `as any`, and hostile code all bypass the types). The repo's fixture plugins moved to `.ts` (typecheck wired into `validate:compile`) to dogfood the net.
- **Self-documenting list-payload fields.** The three array payloads were renamed off the overloaded `entries`: breakdown `bars`, key-values `pairs`, link-list `links` (records `columns`/`rows` and tree `children` unchanged).

The runtime off-shape is now **visible** post-scan (shipped as the follow-up). Rejected contributions (undeclared ref, or a payload that fails the slot's AJV schema) are persisted per scan to a replace-all `scan_contribution_errors` table and surfaced two ways: `sm plugins doctor` reads the last scan's errors, prints a "Runtime contribution errors (last scan)" section grouped by plugin, and promotes its exit code to 1 when any exist; the Settings plugin panel shows a per-plugin warning badge + a collapsible diagnostics list, fed by an embedded `runtimeContributionErrors[]` field on `GET /api/plugins`. The `extension.error` event still fires on the scan stream; the persisted table is the post-scan surface for the load-static doctor and the no-live-scan UI.

### Persistence, BFF, isolation

Emissions persist to a `scan_contributions` table in the `scan_*` family. The persist is **not** a pure replace-all: because the watcher's cached pass skips `extract()` (no `emitContribution` fires) for unchanged nodes, a naive wipe-all would drop valid rows, so the kernel runs orphan-sweep + catalog-sweep + upsert passes that leave cached rows untouched (full sweep contract in [`spec/db-schema.md`](./spec/db-schema.md) §`scan_contributions`). The BFF serves the runtime catalog and per-node contributions (embedded on `/api/nodes`, `/api/nodes/:pathB64`, `/api/scan`, capped by `bff.maxBulkContributions`), enforcing `pluginId` ↔ namespace at the route level (see [`spec/architecture.md`](./spec/architecture.md) §View contribution system). Isolation rests on six rules (typed data only, no plugin CSS/DOM, BFF-namespaced reads, typed verb dispatches, AJV at load/emit/response, no `[innerHTML]` / dangerous-attr binding); **honest note**: isolated against accidents, not hostile code, until a worker-thread / iframe sandbox post-v1.0.

### Scaffolder, built-ins, soft-warnings

`sm plugins create <kind> <plugin-id>` is the canonical entry point (it scaffolds a loader-clean stub for any of the six extension kinds, provider / extractor / analyzer / action / formatter / hook, the kind is the required first positional; the closed slot / input-type catalog is browsable via `sm plugins slots list`, not walked interactively, and the kernel + CLI mirrors of that catalog are generated from the spec by `scripts/generate-view-catalog.js` with a `view-catalog:check` drift guard wired into `validate:compile`); `sm plugins upgrade <id>` runs catalog migrations (console error + UI dialog + non-zero exit when auto-migration is impossible) and `sm plugins doctor` reports `incompatible-catalog` + deprecated-slot usage. Two built-in soft-warning analyzers ship with the system: `core/unknown-slot` (a loaded plugin references a slot outside the current catalog) and `core/contribution-orphan` (a `scan_contributions` row points at a vanished node). At landing there are a handful of built-in adopters, notably `core/link-counts` (the `linksIn` / `linksOut` footer pair) and `core/stability` (the experimental / deprecated chips); the rest have no clear UI surface and migrate in a later coverage sprint.

### Inspection verbs (`list` / `show`)

The two read-only inspection verbs split by altitude so each datum lives in exactly one place. `sm plugins list` is the index, one row per plugin (glyph, extension count, source) and nothing else; `sm plugins list <id>` drills into one plugin (manifest fields plus a per-extension block with kind / version / per-extension toggle glyph); `sm plugins show <plugin>/<ext>` renders a single extension's detail (Kind / Version / Stability / Description / Preconditions / Entry). Because the index carries no extension names and `show` is extension-only, the two off-altitude shapes are rejected with a directed redirect to the sibling verb: a bare `show <plugin>` points at `list <id>`, a qualified `list <plugin>/<ext>` points at `show`. The qualified-id parse + validation is shared with `enable` / `disable` (one helper in `cli/commands/plugins/shared.ts`). Pre-1.0 breaking change shipped as a minor bump in `@skill-map/spec` and `@skill-map/cli`.

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
| 9 | **Contract layer eliminated (2026-05-10)** | The intermediate "contract" abstraction (11 named contracts the plugin author picked, with the UI broadcasting to all compatible slots) was removed. Plugin authors now pick `slot` directly from a closed catalog of 14 slots; each slot fixes a single renderer + a single payload shape. The polymorphic slots `inspector.body.panel`, `card.footer.left`, `inspector.header.badge` were split into per-shape sub-slots via dotted suffix (e.g. `inspector.body.panel.records`, `card.footer.left.tag`). Trade-off: lost automatic multi-slot broadcast (an author who wants the same data in two surfaces declares two contributions, one per slot); gained a smaller mental model (one catalog instead of two), no surprise duplication, and slot ids that map 1:1 to a payload shape. Slot vocabulary is now part of the public contract, a UI rename is a catalog-major bump. Pre-1.0 breaking change shipped as a minor bump in `@skill-map/spec` and `@skill-map/cli`. |

### Known limitations carried forward

- Catalog evolution treadmill, every new slot adds spec doc + AJV schema + UI renderer wiring + scaffolder support + tests + conformance fixtures.
- Cross-slot orchestration undefined, two contributions sharing underlying state can drift; no kernel arbitration today.
- Probabilistic plugins not modeled, deferred until deterministic model has bedded in.
- Multi-surface broadcast now requires N declarations, by design (decision #9). If a plugin author keeps the values in sync across declarations, they cannot accidentally desync; if they don't, the UI shows the same `mentions` chip with different counts in different places. Post-v1.0 we may revisit a "broadcast group" concept if real-world plugins hit this often.

### Replaces Decision #293

Decision #293 ("Third-party UI + BFF extensions", post-v1.0) is **superseded** by this section for the deterministic case. The probabilistic / sandboxed-iframe case for fully arbitrary third-party UI remains deferred to post-v1.0 per the original decision.

### Follow-up: slot debug overlay (do this properly)

While iterating on the slot map (which contracts go to which slots, where each slot mounts in the templates) it is useful to **see** every slot lit up on the page, even when empty. A throwaway implementation lives today under `ui/src/app/debug-slots.css` + `ui/src/app/services/debug-slots.ts` + greppable `sm-debug-slot` wrappers; activation is `?debug=1` (persisted in `localStorage` under `sm-debug-slots`). It is intentionally hacky, flat CSS file, runtime class on `<html>`, no settings integration, because the runtime settings loader (§Configuration → "Runtime delivery to the UI") does not exist yet.

When the loader lands, replace the hack with a real feature:

1. Add `debug.slotsVisible: boolean` (default `false`) to `ISkillMapSettings` and ship it through `/config.json` like every other UI key.
2. Drive the `<html>` class from a signal fed by the settings, not from `localStorage`.
3. Bind the toggle to the UI, a small dev-mode menu next to the theme switch, or a status-bar entry. URL-driven activation can stay as the developer escape hatch.
4. Replace `<div class="sm-debug-slot" data-debug-slot="...">` wrappers with a tiny `<sm-slot-frame slot="...">` component so the markup names the slot once and the styling lives next to the host.
5. Remove the `DEBUG-SLOTS` markers (`grep -rn 'DEBUG-SLOTS\|sm-debug-slot' ui/src`), that grep is the cleanup checklist.

The hack is wired today to the **five** slots in the catalog, including `graph.node.alert` and `topbar.nav.start`, which previously had no producer. Those mounts are real and stay, only the styling layer is throwaway.

---

## Summarizer pattern

Each node-kind has a default summarizer Action that generates a semantic summary (`skill-summarizer` at Step 10, the other four, `agent` / `command` / `hook` / `markdown`, at Step 11; `v0.5.0` ships none). Each declares a report schema at `spec/schemas/summaries/<kind>.schema.json` extending `report-base.schema.json`, the universal probabilistic-report envelope: a `confidence` (0.0-1.0, the model's metacognition) plus a `safety` block (`injectionDetected`, `injectionType` enum, `contentQuality` enum). Summaries persist in the kernel-owned `state_summaries` table keyed by `(node_id, summarizer_action_id)` with the body hash at generation, so `sm show <node>` renders the summary and marks it `(stale)` when the body changed. A node is refreshed either deterministically (`sm scan -n <id>`, recomputes bytes / hashes / links) or probabilistically (queue the kind's summarizer as a job). Schemas: [`spec/schemas/summaries/`](./spec/schemas/summaries) and [`spec/schemas/report-base.schema.json`](./spec/schemas/report-base.schema.json).

---

## Frontmatter standard

Skill-map AGGREGATES vendor specs, it does not curate them. The base schema declares only what every node, on every Provider, MUST carry to participate in the graph. Vendor-specific fields (Anthropic Claude Code, Cursor, Continue, …) live in the Provider that emits the kind. A Provider's per-kind schema is a verbatim mirror of the vendor's documented frontmatter, skill-map does not pick a subset, does not rename fields, does not re-shape values. When the vendor evolves their schema, the Provider's mirror evolves with it; drift detection vs upstream docs is a deferred follow-up.

Cross-vendor research (Cursor, Continue, Aider, Copilot, Windsurf, Cline, Roo, Anthropic Claude Code, 2026-05) confirmed `description` is the only field universal across the indexable ecosystems; `name` is universal among formats with explicit identifiers (some vendors use the filename as identity, not a frontmatter field). All other fields, `tools`, `model`, `globs`, etc., are vendor idiosyncrasy.

Spec artifact: `spec/schemas/frontmatter/base.schema.json`. Per-kind schemas ship with the Provider that declares each kind, the Claude Provider declares `skill` / `agent` / `command` / `markdown`, ships the corresponding `*.schema.json` files under its own `schemas/` folder, and references them via the `kinds` map in its manifest. The OpenAI Codex Provider declares `agent` (consuming the TOML envelope under `.codex/agents/*.toml`, with the `developer_instructions` field fed through the body extractors via the declarative `read.bodyField` knob) and inherits the open-standard `skill` kind from `agent-skills` by manifest composition (classifying `.agents/skills/<n>/SKILL.md`, the open layout Codex actually reads), expressing the mixed TOML+Markdown surface via a multi-rule `read` array; the neutral `agent-skills` Provider declares `skill` only, claiming the open-standard `.agents/skills/<n>/SKILL.md` path that Antigravity also adopted after replacing Gemini CLI; the Antigravity Provider declares its own `workflow` kind (`.agent/workflows/<n>.md`, singular `.agent`, shipping a `workflow.schema.json` under its own `schemas/` folder) AND reuses the open-standard `skill` kind + classifier by manifest composition. The retired Gemini Provider used to declare `agent` / `skill` / `markdown`; its plugin was removed in 2026-05 and its on-disk paths route through `agent-skills` (skills) and the `core/markdown` fallback (`AGENTS.md`). A different Provider (Cursor, Cline, custom runner) brings its own kind catalog and its own schemas; the kernel does not opine on the kind list.

### Base (universal, lives in spec)

**Two fields, both defined, neither required at base level**:

- `name`, short human-readable identifier (`string`, `minLength: 1`).
- `description`, one-to-three-sentence description (`string`, `minLength: 1`).

The base DEFINES these two cross-vendor fields (so a present value is validated as non-empty) but deliberately does NOT mark them `required`: whether either is mandatory is a per-kind decision, not a universal one. A kind whose vendor mandates the fields adds `required` on its own per-kind extension (Claude `agent`, OpenAI Codex `agent`, the Agent Skills `skill`); the generic `markdown` fallback and Claude `skill` / `command` leave them optional, no normative Markdown standard mandates frontmatter fields, and Anthropic's merged skill/command contract defaults `name` to the directory/file name and `description` to the first paragraph. This refines Decision #124 (which originally placed `required: [name, description]` on the universal base); the requirement now lives per-kind, so the per-kind schema is the single source of truth and the kernel enforces it at scan time via `frontmatter-invalid`.

The base declares `additionalProperties: true` so vendor-specific fields and skill-map annotation fields flow through validation silently, formal validation of those happens in the per-kind extension (vendor fields) or in a future skill-map annotation schema (annotation fields, see §Skill-map annotation fields below).

This is intentionally minimal. Earlier versions of the base carried a richer field set (`type`, `author`, `authors`, `license`, `tools`, `allowedTools`, `metadata.{version, stability, supersedes, …}`); Step 9.5 (2026-05) trimmed it after the cross-vendor research showed those fields were either Claude-specific (`tools`, `allowedTools`) or skill-map-invented (`metadata.*`), neither is universal, neither belongs in the universal base. Decision #55 (which justified `tools`/`allowedTools` at base "to mirror Claude Code's frontmatter shape") is superseded by the absorb-verbatim principle.

### Kind-specific schemas

Each Provider mirrors its vendor's documented frontmatter **verbatim** (no subsetting, renaming, or reshaping) in per-kind schema files that extend `base.schema.json` via `allOf` + `$ref`, all `additionalProperties: true` so vendor additions never break consumers. The Claude Provider's `agent` / `skill` / `command` / `markdown` schemas (and the shared auxiliary `skill-base`, referenced by `$ref`) live under its own `schemas/` folder and track Anthropic's docs; the `hook` kind was dropped in Step 9.5 (Anthropic hooks live in `settings.json` or as frontmatter sub-objects, never standalone markdown, so `.claude/hooks/*.md` now classify as the `markdown` fallback). Format-named kinds (`markdown`, future `toml`) apply only as the generic fallback, a `.toml` that IS a Codex agent classifies as `agent`. A future Cursor / Cline / custom Provider ships its own kinds and schemas; the kernel does not opine on the list. The three-tier validation model (permissive `additionalProperties` → an always-on `unknown-field` warning → `--strict` / `scan.strict` promoting warnings to CI-failing errors, no "schema-extender" kind) and the `scan_nodes` denormalization (`stability` / `version` / `author` columns, sourced from the sidecar's `annotations` block) are documented in [`spec/plugin-author-guide.md`](./spec/plugin-author-guide.md) and [`spec/db-schema.md`](./spec/db-schema.md).

### Skill-map annotation fields, co-located sidecars

Skill-map's own annotation layer (lifecycle, supersession, provenance, taxonomy, docs) lives in **co-located YAML `.sm` sidecars** next to each node, leaving the vendor file untouched (Decision #125; full rationale in `memory/project_annotation_architecture.md`). The sidecar shape (reserved `for` / `annotations` / `settings` / `audit` blocks plus opt-in `<plugin-id>:` namespaces), the curated 10-field annotations catalog (versioning / supersession / provenance / taxonomy / docs, all optional), identity + drift detection (a `for.bodyHash` / `for.frontmatterHash` mismatch emits the advisory `annotation-stale` signal (info severity, never blocking), drift derived never stored), and the deterministic bump model (`sm bump <node>` / `--pending [--staged]`, the optional `pre-commit-bump` hook, the `SidecarStore` write port; watch never auto-bumps) are normative in [`spec/architecture.md`](./spec/architecture.md) §Annotation system and the `sidecar` / `annotations` schemas. Tags are a skill-map concept (no vendor carries them), so they live here, not in vendor frontmatter; `references` edges come from `core/markdown-link` and `points` edges from `core/backtick-path` (relative `.md` paths inside code spans / fences, the dominant reference shape in agent-authored skills, Decision #127), not sidecar keys. Migration is greenfield (no port of pre-9.6 `metadata: {}` blocks).

---

## Enrichment

Two enrichment models coexist. **Model A, provenance enrichment** (GitHub today, more registries post-v1.0): a remote-fetch Action (`sm job submit github-enrichment [-n <id>] [--all]`) backed by `state_enrichments`, concerned with verification and idempotency, not interpretation. It reconciles the local `body_hash` against the canonical source via a SHA pin (an immutable raw URL when `sourceVersion` is a full commit SHA) or tag/branch resolution (query the API, store `resolvedSha`, re-fetch only on change); `verified: true` means local matches remote. **Model B, plugin-driven node enrichment**: any Extractor calls `ctx.enrichNode(partial)` and the kernel persists it in `node_enrichments` (one row per `(node, extractor)`), **never** overwriting the author's immutable frontmatter, consumers read a merged view. Extractors are deterministic-only, so their rows regenerate via the per-Extractor scan cache and never need stale flags; the `stale` / `is_probabilistic` / `body_hash_at_enrichment` columns are reserved inert for a future Action-issued probabilistic enrichment revision (LLM jobs writing back through `ctx.enrichNode`, where a stale row is flagged not deleted so paid output survives a body change). Data that does not fit the canonical Node shape uses `ctx.store.write` (the plugin's own table) instead. Refresh via `sm refresh <node>` / `sm refresh --stale`; there is deliberately no `sm scan --refresh-stale` (a probabilistic refresh never runs inside a deterministic scan). Table and column contracts: [`spec/db-schema.md`](./spec/db-schema.md) and [`spec/architecture.md`](./spec/architecture.md) §Extractor · enrichment layer.

---

## Reference counts

`scan_nodes` carries three denormalized integer columns computed at scan time, `links_out_count`, `links_in_count`, and `external_refs_count` (distinct http/https URLs in the body, normalized). They surface in `sm show` ("N in · M out · K external") and `sm list --sort-by external-refs`. There is no URL-list table (the user cares about the count, not identity) and no liveness check pre-v1.0. Column contract: [`spec/db-schema.md`](./spec/db-schema.md).

Alongside the counts, `scan_nodes.modified_at_ms` records each file's on-disk modification time (`mtime`, Unix ms), captured for free from the walker's existing TOCTOU `lstat` (no extra syscall) and exposed on the node wire shape as `modifiedAtMs` (nullable, virtual / derived nodes have no backing file). It backs the files-view "Modified" column (ISO short date in the cell, full date+time on hover) which sorts by the raw timestamp and sinks fileless nodes to the bottom. It is pure file metadata: it never participates in `body_hash` / `frontmatter_hash`, so touching a file without changing content does not flag drift.

---

## Trigger normalization

Extractors that emit invocation-style links populate a `link.trigger` block with `originalTrigger` (exact source text, for display) and `normalizedTrigger` (the equality / resolution key the post-walk resolver reads; the same normalization applied to `frontmatter.name` backs the `name-collision` analyzer); both are always present together, never mutated independently. The normalization pipeline (NFD, strip diacritics, lowercase, unify `-` / `_` / whitespace to a single space, collapse, trim, while **preserving** syntax characters like `/` `@` `:` so `/skill-map:explore` stays comparable), its worked examples, and its stability contract are normative in [`spec/architecture.md`](./spec/architecture.md) §Extractor · trigger normalization and [`spec/schemas/link.schema.json`](./spec/schemas/link.schema.json) (Decision #21). Stripping a sigil such as the leading `/` is the Extractor's job, applied before emitting, not the normalizer's.

---

## Configuration

`.skill-map/settings.json` is the canonical config for both the CLI and the bundled UI (the filename + `.local.json` partner mirror Claude Code). The loader deep-merges four layers, low → high precedence: **defaults** (compiled into the bundle) → **project** (`<cwd>/.skill-map/settings.json`, committed) → **project-local** (`settings.local.json`, gitignored, the only home for `PROJECT_LOCAL_ONLY_KEYS` like `allowEditSmFiles` / `scan.referencePaths`) → **env / flags**. There is **no user / global layer** (skill-map never reads `~/.skill-map/settings*.json`; per-machine preferences live in project-local). A malformed key warns and is skipped (the app never crashes on bad config); `--strict` makes it fatal. The layered loader is normative in [`spec/architecture.md`](./spec/architecture.md) §Config layering; the `sm ui --config <path>` escape hatch (Step 15) replaces the project + project-local layers with a single file.

### Runtime delivery to the UI

The bundled UI is a static artifact, it does not read files from disk. The CLI sub-command `sm ui` (Step 15) loads + merges + validates the hierarchy and serves the resulting object as `GET /config.json` over the same HTTP server that hosts the UI bundle. The UI fetches that URL once on boot (via `APP_INITIALIZER`), then reads the data through a signal-backed `RuntimeConfigService`. When the bundle is served by a third party (nginx, S3, Caddy), the operator places a `config.json` next to `index.html`; same contract from the UI's side.

This is the only path by which UI-side keys reach the browser. There is no build-time UI config and no `fileReplacements`. Changing UI settings means editing one of the four files in the hierarchy (or the `--config` override) and restarting the server, see §Step 15 for why hot reload is deferred.

### Commands and keys

The `sm config` verbs (`list` / `get` / `set` / `reset` / `show --source`, where `set` targets project-local for `PROJECT_LOCAL_ONLY_KEYS`) are specified in [`spec/cli-contract.md`](./spec/cli-contract.md), and every key with its default is normative in [`spec/schemas/project-config.schema.json`](./spec/schemas/project-config.schema.json): `schemaVersion`, `tokenizer`, `roots` / `ignore`, `plugins.<id>.enabled`, the `scan.*` block (`tokenize` / `strict` / `maxFileSizeBytes`), and the `jobs.*` block (the TTL formula `max(base × graceMultiplier, minimumTtlSeconds)` plus `perActionTtl` / `perActionPriority` / `retention`). The generated `.skillmapignore` is editable directly and through the Settings → Project CRUD (BFF route `/api/project-ignore`, comments preserved).

### UI-side keys

UI-only keys (declared in `ui/src/models/settings.ts`, to be formalised in `spec/runtime-settings.schema.json` at Step 15) cohabit the same file and reach the browser through the runtime-delivery path above: `graph.perf.cache` (Foblex `[fCache]` geometry caching), `graph.perf.virtualization` (`*fVirtualFor`, worth enabling above ~300 visible nodes), and `debug.slotsVisible` (reserved; will replace the throwaway `?debug=1` overlay once the runtime loader lands). Each side ignores keys it does not recognise (graceful forward-compat).

---

## CLI surface

Shared flags (inherited by every verb): `--json`, `-v`/`-q`, `--no-color`, `-h`/`--help`, `--db <path>`, with `SKILL_MAP_*` env equivalents and `flag > env > config > default` precedence. There is no `-g/--global` flag (scope is always project-local). `--all` is documented only on verbs with meaningful fan-out (`sm job submit/run/cancel`, `sm plugins enable/disable`). The normative **exit codes** (`0` success, `1` success-with-issues, `2` operational error, `3` duplicate job, `4` nonce mismatch, `5` not found, `6–15` reserved, `≥16` per-verb) and the normative **elapsed-time** reporting grammar (`done in <N>ms | <N.N>s | <M>m <S>s` on stderr plus an `elapsedMs` field in object `--json` payloads) are specified in [`spec/cli-contract.md`](./spec/cli-contract.md).

### Verb families

The verb surface is specified in [`spec/cli-contract.md`](./spec/cli-contract.md); each verb's flags and JSON shape live there and in `sm help <verb>`. The families:

- **Setup & state**: `init` (bootstrap `.skill-map/` + first scan), `tutorial` (materialize the single tester walkthrough skill, a "book" of parts whose advanced parts, plugins/settings/view-slots, the CLI in depth, are reached from its in-skill menu), `example` (drop a ready-to-explore example project into an empty cwd, the same wired harness the public demo renders, sourced from the single canonical `fixtures/demo-scope/` fixture, so a new user can `sm scan` then `sm serve` against a real graph without authoring files first), `version`, `doctor`, `help`. Bare `sm` in an empty folder surfaces `tutorial` and `example` as an interactive getting-started menu (and the no-project hint points at them too); see [`spec/cli-contract.md`](./spec/cli-contract.md) §Binary.
- **Scan**: `scan` (full), `scan -n <id>` (one node), `scan --changed` (incremental), `scan --compare-with <path>` (delta).
- **Browse**: `list`, `show`, `check`, `findings`, `graph`, `export`, and `orphans` (with `orphans reconcile` / `orphans undo-rename` for rename recovery).
- **Actions**: `actions list` / `actions show`.
- **Record**: `record --id <id> --nonce <n> --status completed|failed ...`, the job callback.
- **History**: `history`, `history stats`.
- **Config**, **Jobs**, **Plugins**, **Database**, **Server** (`serve`): see [Configuration](#configuration), [Job system](#job-system), [Plugin system](#plugin-system), [Persistence](#persistence), and below.

### LLM verbs (Step 11)

Shipped at Step 11 (Decision #49): single-turn verbs that each submit one probabilistic job and render a finding or report (a runner must be available; `sm doctor` reports status). The set: `sm what <id>` (describe a node, reusing a fresh cached summary), `sm dedupe` (semantically-duplicate nodes), `sm cluster-triggers` (group equivalent triggers beyond the deterministic normalizer, Decision #21), `sm impact-of <id>` (reverse-dependency summary), and `sm recommend-optimization` (per-node refactor suggestions; the canonical caller for the `skill-optimizer` dual-surface action, Decision #86). The exact flag surface locks per verb during Step 11.

### Server and introspection

`sm serve [--port N] [--host ...] [--no-open]` runs the Hono + WebSocket server for the Web UI. `sm help --format json|md` is the self-describing surface dump consumed by the docs generator, shell completion, UI form generation, IDE extensions, and the `sm-cli` skill (the `md` form is generated on demand, not committed).

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
- Transport keep-alive: the server pings every connected client on a fixed interval (30s) so idle connections survive intermediary proxies (the dev-server proxy, hosted load balancers) and half-open peers get reaped; the browser auto-pongs, no client code or envelope involved. The client resets its reconnect backoff only after a connection proves stable, so a flapping endpoint escalates to a non-fatal "connection lost" banner instead of re-seeding `/api/scan` in a tight loop. See `spec/cli-contract.md` § WebSocket protocol.

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

### Workspace (fused view)

The SPA's former two destinations (a standalone files list and a standalone graph) were fused into a single **workspace** at route `/`: a drag-resizable files tree rail on the left, the graph canvas in the center, and the inspector as a floating right-side slide-over, all linked through the shared `?path` selection. The rail doubles as a **map-visibility curation** surface: per-file and per-folder (tri-state) checkboxes pick which nodes the graph shows; folder-depth presets (0/1/2) and an "isolate" gesture (focus a node and its direct, 1-hop neighbors) are one-click shortcuts; the curated set persists to localStorage. The graph's layout reset re-arranges only the currently visible nodes when the view is curated. The old `/files` and `/map` routes and their topbar tabs were retired.

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
  - **JSON content in camelCase**: every key in a schema, frontmatter block, config file, plugin/action manifest, job record, report, event payload, or API response, `whatItDoes`, `injectionDetected`, `expectedTools`, `sourceVersion`, `docsUrl`, `ttlSeconds`, `runId`. The SQL layer is the sole exception (`snake_case` tables/columns, bridged by Kysely's `CamelCasePlugin`); nothing crosses the kernel boundary as `snake_case`.
- **Runtime**: Node 24+ (required, active LTS since Oct 2025; `node:sqlite` stable; WebSocket built-in; modern ESM loader).
- **Language**: TypeScript strict + ESM.
- **Build**: `tsup` / `esbuild`.
- **CLI framework**: **Clipanion** (pragmatic pick, introspection built-in, used by Yarn Berry).
- **HTTP server**: **Hono** (lightweight, ESM-native). Acts as the BFF for the Angular UI and any future client.
- **WebSocket**: server side uses the official `upgradeWebSocket` re-exported from `@hono/node-server@2.x` paired with the canonical `ws` Node WebSocket library (`ws@8.20.0`); both share the single Hono listener, single-port mandate. Client side uses the browser-native `WebSocket` (browser) or the Node 24 global `WebSocket` (Node-side tests and consumers, no extra dep needed beyond the server-side `ws`).
- **Single-port mandate**: `sm serve` exposes SPA + BFF + WS under one listener. Dev uses Angular dev server + proxy; prod uses Hono + `serveStatic`.
- **UI framework**: **Angular ≥ 21** (standalone components). Scaffolded at `^21.0.0`, later pinned to an exact version per the dependency-pinning policy, see §Operating rules in `AGENTS.md`.
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
- **Tokenizer**: `js-tiktoken`, selected by the `tokenizer` project-config key from a closed allow-list of two encoders, `cl100k_base` (default) and `o200k_base`. The chosen rank table is lazily imported per scan (bundler-safe literal dynamic imports), the resolved encoder is persisted in `scan_meta.tokenizer` / `ScanResult.tokenizer`, and changing it forces a token recompute on the next incremental scan (the cache cannot serve counts from the other encoder).
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

Closed Steps, green checkmark = "ships green tests, lives in the released code path". Per-step landing prose lives in the git history and the per-package changelogs.

Phase A, `v0.5.0` (deterministic kernel + CLI):

- ✅ **0a / 0b / 0c**, Spec bootstrap, implementation bootstrap, UI prototype (Flavor A).
- ✅ **1a / 1b / 1c**, Storage + migrations / Plugin loader / Orchestrator + CLI dispatcher.
- ✅ **2 / 3 / 4 / 5 / 6 / 7 / 8 / 9**, First extensions, UI design refinement, scan end-to-end, history + orphans, config + onboarding, robustness, diff + export, plugin author UX (9.1–9.4).

Phase A → v0.6.0 (Web UI):

- ✅ **9.5**, Spec base cleanup: absorb provider verbatim. Pre-wave-2 prerequisite.
- ✅ **9.6**, Annotation system (sidecar `.sm` files). Sub-steps 9.6.1–9.6.7, review queue R1–R15 closed.
- ✅ **14.1–14.7**, Full Web UI (Hono BFF, REST, WS broadcaster, inspector polish, Foblex strict types + dark-mode tri-state, bundle hard cut + responsive scope + demo smoke).
Phase B, Stabilization (deterministic core hardened into **Beta**, `v0.6.0` → `v0.52.0`):

- ✅ **Active-lens migration, Phases 1–6** (2026-05-19 → 2026-05-23), post-v0.6.0 deterministic polish that lands the multi-runtime story end-to-end:
  - **Phase 1**, lens model + Signal IR scaffold + numeric `Confidence` + MCP virtual nodes + OpenAI Codex provider (`.codex/agents/*.toml`) + extractor mudanza (`core/{markdown-link, slash, at-directive}` move to vendor-neutral `core`). Settings → Project → "Active provider" dropdown switches the runtime lens; switching drops `scan_*` and rebuilds the graph under the new lens. Single coherent migration in commit `29fb353`.
  - **Phase 2**, lens-only extractor gating (per-provider extractors run when the **active lens** matches, regardless of which provider classified the host file). Closes the cross-lens isolation contract.
  - **Phase 3**, provider-aware confidence bump for resolved invocation links + new `IProviderKind.identifiers` + `IProvider.resolution: Record<linkKind, targetKind[]>`. `@reviewer` mentions and `/explore` invokes that resolve render at confidence `1.0`.
  - **Phase 4**, Antigravity Provider onboarding (metadata-only, lens identity + reserved-names) + Gemini Provider retired (Google sunset Gemini CLI 2026-06-18; Antigravity ships under the open `.agents/skills/` standard, so the legacy `.gemini/` classifier had nothing to claim).
  - **Phase 5**, reserved-name catalog (`IProvider.reservedNames?: Record<kind, string[]>`) + `core/reserved-name` analyzer + post-walk confidence downgrade to `0.1` for links resolving to reserved targets. Claude ships the documented built-in catalog (`/help`, `/clear`, `/init`, `/agents`, `/model`, `general-purpose`, `output-style-setup`, `statusline-setup`); Antigravity ships its `agy` slash built-ins under `skill`; it adopts the open `.agents/skills/` standard by reusing the `agent-skills` classifier in its own manifest, so under its lens those skills classify as `antigravity` and self scope catches the collisions (refined post-migration from `agy /help` v1.0.3; the earlier cross-provider lens-scope rule was removed in favour of manifest composition). **Refinement (2026-06-13):** the post-walk model gains a third outcome, a `BROKEN_TARGET_CONFIDENCE = 0.5` downgrade for links that resolve to nothing (no path match, no name-index entry, the same kind-agnostic notion `core/reference-broken` uses), and `core/markdown-link` is corrected to emit the spec's `0.95` "unambiguous syntax" tier instead of a hardcoded `1.0`. Together a dangling markdown / `@file.md` / `/command` edge now renders at `0.5` (fainter than a resolved `1.0`, above the reserved `0.1`) instead of being indistinguishable from a resolved one. A fourth outcome lands alongside: a link resolving to a `virtual: true` node (e.g. an `mcp://<server>` node `core/mcp-tools` fabricates from frontmatter, never verified on disk) keeps its extractor emit value instead of bumping to `1.0`, the edge resolves and stays navigable but an unverified entity is not full certainty, the same principle as the reserved downgrade. **Scoring-model redesign (2026-06-15):** the per-extractor emit floor is discarded; the kernel now seeds a **1.0 baseline on every link** (in `liftResolvedLinkConfidence`) and the score-phase detectors apply a fixed `delta` penalty on top, folded and clamped to `[0,1]`: `core/name-reserved` subtracts `RESERVED_PENALTY = 0.9` (reserved → 0.1) and `core/reference-broken` subtracts `BROKEN_PENALTY = 0.5` (broken → 0.5), each co-located with the finding it reports so disabling a detector drops both its report and its score effect (the link falls back to 1.0). The built-in `core/score-resolution` analyzer (whose only remaining job was the clean-resolution `set 1.0`) is deleted, the baseline is the kernel's, not an op; a clean resolved link records no `scan_link_scores` row. Constants renamed `RESERVED_TARGET_CONFIDENCE` / `BROKEN_TARGET_CONFIDENCE` (final values) → `RESERVED_PENALTY` / `BROKEN_PENALTY` (the deltas). **Refinement (2026-06-25):** the reserved-name catalog gains an open-standard base. The neutral `agent-skills` Provider now owns the universal cross-agent verbs under `skill` (`COMMONS_RESERVED_NAMES`, the curated Claude∩Antigravity common subset, since the open standard documents no reserved names of its own); every standard adopter inherits them by manifest composition and appends its own (Antigravity spreads the base and layers `agy`'s extras on top), so the neutral lens enforces the base directly while vendor verbs stay vendor-scoped. The reusable open-standard primitives the Provider exports were renamed to a `COMMONS_*` vocabulary (read / kinds / resolution / reserved-names / classifier); the user-facing lens label is `Agent Skills`. **Lens-selector simplification (2026-06-25):** the `agent-skills` Provider is promoted to `stable` and locked-enabled (`agent-skills/agent-skills` in the host lock-list), becoming the universal DEFAULT lens a no-vendor project resolves to (replacing the old `markdown` default). The non-gated `core/markdown` Provider is demoted from a selectable lens to the invisible universal BASE: it still classifies every orphan `.md` underneath whatever lens is active, but it is no longer offered in the lens dropdown nor settable as `activeProvider`. A `gatedByActiveLens`-derived `isLens` flag on each `providerRegistry` entry drives the dropdown (lenses only); the BFF `selectable` set and `PATCH /api/active-provider` enforce the same gate server-side; a stale persisted `activeProvider: 'markdown'` is coerced to the default. The selector now shows one open lens (`Agent Skills`) instead of two confusing entries (`Markdown` + `Open Skills`).
  - **Phase 6**, observable link analysis: `core/link-counts` analyzer emits two `card.footer.left` chips per node (`linksIn` / `linksOut`) with per-`Link.kind` breakdown tooltips. Self-loops excluded from card chips. Link confidence renders as edge opacity in the graph view. Inspector linked-nodes panel groups by direction × kind.
  - **Phase 2/3 closure (Step 11.5, landed 2026-05-23)**, Signal IR resolver wired end-to-end: orchestrator calls `resolveSignals` after extract; all six link-emitter extractors emit Signals with byte ranges; cross-extractor range-overlap collisions detected via union-find clusters; new `core/extractor-collision` analyzer surfaces losers as `warn` issues naming the winner extractor and tiebreak reason. Two conformance cases close coverage row 37. Phase 4+ stubs (per-extension enable filter, confidence floor) documented but not wired.
  - **Safety nets shipped alongside the migration**: lens-drift warning when `activeProvider` points at a disabled plugin, db-version skew detection at sqlite open, active-provider auto-detect on first scan (markers are provider-owned via each manifest's `detect.markers`, no central table: `.claude/` → claude, `.codex/` → codex (`AGENTS.md` is NOT a marker, it is the vendor-neutral agents.md standard), `.agents/` → agent-skills; persists to project `settings.json`; ambiguous → interactive prompt or `--yes` aborts with exit 2; no vendor markers → default to the open-standard `agent-skills` lens, unpersisted and silent, so a vendor marker added later still auto-detects).
  - **Deferred (post-v1.0)**: Phase 5b (MCP config-side discovery, the consumer side already ships) and Phase 6b's Codex AGENTS.md hierarchical walker (its skill half shipped 2026-06-25, the open `.agents/skills/` standard via composition). See §Deferred beyond v1.0.
  - **Codex body extractor (TOML `developer_instructions` field)**: ✅ landed via `read.bodyField: 'developer_instructions'` (Step 13); the codex provider is now beta (enabled by default, auto-detects `.codex/`).

Next (Phase C, real-time exploration):

- 🔮 **Real-time exploration**, watch agents and skills as they run: event stream (live WebSocket from the kernel to the UI), execution snapshot (immutable audit of every run), and a live view of which skill ran, what triggered it, and which nodes it touched. The next milestone after the Beta, lands before the LLM optional layer. The LLM-dependent half (live agent conversation, transcript streaming) stays deferred with the LLM layer, see §Deferred beyond v1.0.

Phase D (LLM optional layer, `v0.8.0`):

- ⏸ **10**, Job subsystem + first probabilistic extension (`skill-summarizer` as a probabilistic Action; Extractors are deterministic-only). Phase 0 (`IAction` runtime contract) landed and dormant; Phases A–G paused.
- ⏸ **11**, Remaining probabilistic extensions + LLM verbs + findings.
- 🔮 **16**, Web UI: LLM surfaces v1 (initial). Render the probabilistic outputs Steps 10–11 emit, replaces the "Available in v0.8.0" empty-state placeholders shipped in 14.3 inspector with read-only surfaces for `state_summaries` / `state_enrichments` / `findings`. UI does not orchestrate jobs at this stage.

Phase E (`v1.0.0` target):

- 🔮 **12**, Additional Formatters (Mermaid, DOT, subgraph export with filters).
- 🔮 **13**, Multi-host Providers (Codex body extractor; Copilot; generic). Codex itself + agent-skills + Antigravity already landed during the active-lens migration; the Codex body extractor (TOML `developer_instructions` field → markdown / at-directive / slash pipeline) landed via `read.bodyField`, and Antigravity grew its own `workflow` kind (`.agent/workflows/*.md`, singular `.agent`) on top of the open-standard skills it adopts, leaving Copilot as the remaining piece. The legacy Gemini Provider shipped at Step 9.7 and was retired in 2026-05.
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
- **Phase 2.D**, `core/extractor-collision` analyzer surfaces resolver rejections as `warn` issues attached to the loser's source node, naming the winner extractor, the loser's matched text + range, and the tiebreak reason (`kind-priority` / `higher-confidence` / `longer-range` / `earlier-declaration`). Two conformance cases land at `spec/conformance/cases/{extractor-emits-signal,extractor-collision-detection}.json`; coverage matrix row 37 flips to ✅. Phase 4+ stubs (`extractorDisabled`, `belowFloor`) are documented and stubbed but not yet wired.
- **Phase 2.E**, ROADMAP catches up.

Deferred to a future Step (the rest of the spec's resolver pipeline, NOT blocking v1.0):

- Phase 4+ per-extension enable filter inside the resolver. The Signal's `resolution.extractorDisabled` field exists for it; the analyzer's message template is in place. The config surface for per-extension state was partially restored when operator-configurable extension settings landed (see the per-extension settings entry below): `plugins.<id>.extensions.<extId>.settings` now exists in `project-config.schema.json`, so the sibling `plugins.<id>.extensions.<extId>.enabled` toggle this filter needs can slot in alongside it when the filter is actually built.
- Phase 4+ confidence floor (drop a Signal whose top candidate falls below a threshold). Same posture: data shape + analyzer message ready, predicate not wired.
- Phase 5+ fragmentation detection (adjacent Signals representing a single authored intent). A different analyzer surface; the IR already supports it via the shared `source` + `range` fields.

### Step 12, Additional Formatters

- Mermaid, DOT / Graphviz.
- Subgraph export with filters.

### Step 13, More adapters

Promotes the long-deferred multi-host scope into Phase E so v1.0 ships supporting more than the Claude ecosystem out of the box. Each adapter recognises its host's on-disk layout, classifies files into the six extension kinds, and feeds the same scan pipeline, no kernel changes, pure composition over the `AdapterPort`.

- **Codex adapter**, file layout, frontmatter conventions, slash invocations. Phase 6 (shipped 2026-05-19) already onboarded codex/Codex as a first-class provider with TOML parsing and the `.codex/agents/*.toml` classifier; this Step finishes the round-trip.
- **Codex body extractor (TOML `developer_instructions` field)**, ✅ landed. The codex provider parses the TOML envelope and classifies `.codex/agents/*.toml` into agent nodes; the `developer_instructions = """..."""` block (the agent's markdown body) now flows through the link extractors via the declarative `read.bodyField: 'developer_instructions'` knob: the kernel walker yields that frontmatter field as the node body so the universal extractors (markdown-link, backtick-path, external-url) plus the lens-gated `claude/at-directive` + `claude/slash-command` (precondition widened to `['claude', 'codex']`) run over it. This is the "body can live on a parsed-frontmatter field" approach rather than a dedicated `codex/body-extractor`, so it generalises to any future provider whose prompt lives in frontmatter (e.g. a Gemini `prompt` field). A Codex agent whose instructions reference another agent via `@handle`, `[link](path.md)`, or a backtick path now surfaces in the graph under `activeProvider=codex`, feature parity with Claude. The inspector renders these TOML nodes the same way it renders a `.md` node, by surfacing the provider's `read.bodyField` on the `providerRegistry` wire entry: the inspector resolves it (no hardcoded provider id), renders `frontmatter.developer_instructions` as the Body section (its parsed value already ships in `node.frontmatter`, so no extra disk read), and excludes that one key from the Definition/metadata card so the prompt is never double-rendered as a chip. The remaining post-v1.0 follow-up for Codex (Phase 6b in §Deferred) is the hierarchical AGENTS.md walker; Codex skills shipped 2026-06-25 (the open `.agents/skills/` standard classified as `codex`/`skill` via manifest composition over a multi-rule `read`). Remaining Step 13 work: Copilot.
- ~~**Gemini adapter**, Google's agent file shape, Gemini-CLI conventions.~~ (Retired 2026-05 when Google sunset Gemini CLI; replaced by the Antigravity onboarding under the open `.agents/skills/` standard during the active-lens migration. The bullet is preserved as historical context; no implementation work is owed.)
- **Copilot adapter**, GitHub Copilot's prompt / instruction surface.
- **Generic adapter**, convention-light fallback driven entirely by frontmatter (`name`, `kind`, `triggers`); the bare-minimum contract for any future host or for users with a custom layout. Doubles as the reference implementation in the adapter author guide that ships at Step 9.
- Each adapter ships its own `sm-<host>-*` skill namespace (host owns its prefix; see §Skills catalog).
- Conformance: each adapter must classify the four worked examples in `spec/conformance/cases/adapters/` (added when this step is scheduled) and round-trip the trigger set through `trigger-normalize` without surprises.

### Step 17, Web UI: LLM surfaces v2 (deeper)

Builds on Step 16 (Phase D) once the probabilistic outputs are stable in the UI. Promotes LLM **verbs** into interactive flows, the user no longer has to drop to a terminal for the high-leverage analyses.

- **Inspector action buttons + plugin-driven badges**, ✅ landed 2026-06-06 (Phase 1). The inspector is now extensible by plugins, not just cards / header. A new `inspector.action.button` view slot renders buttons that dispatch a kernel Action through the generic `POST /api/actions/:id` endpoint (generalises the retired bespoke `/api/sidecar/bump`); the two header badge sub-slots (`inspector.header.badge.counter` / `.tag`) collapsed into one unified `inspector.header.badge` slot; and the `.sm` write consent split into `confirm` (one-shot grant) vs `always` (persists `allowEditSmFiles`), surfaced as an "always allow" checkbox on the consent dialog. First adopter: `core/annotation-stale` emits the Bump button (`enabled` flips with drift, always emitted so the upsert refreshes it, no sweep) and the stale badge as contributions, retiring the hardcoded inspector wiring plus the three mock "Plugin actions". Contribution-driven by decision (the plugin emits the affordance; the dispatch + consent live in the host). **Revised by Decision #130 (2026-06): the button is now self-projected by the dispatching Action's own deterministic scan-time `project(ctx)` (read-only graph), not a sibling projector Analyzer; the pure projectors `core/supersede` / `core/tags` were deleted and `core/annotation-stale` trimmed to badge + issue (its Bump button moved to `core/node-bump.project()`).** Follow-up phases also landed 2026-06-06: parametrized actions via a `prompt` field + a UI input-type renderer (`single-string` / `enum-pick` / `string-list`, seeded with the node's current value), driving Set stability (`core/node-stability` + `core/node-set-stability`) and Edit tags (`core/node-set-tags`) (post-#130 the Edit-tags button is self-projected by its action; before #130 it came from the `core/tags` projector analyzer; the Set-stability button likewise self-projects from `core/node-set-stability.project()`, finishing #130 after it lingered on the `core/node-stability` analyzer, which also stopped raising an `info` for `experimental` nodes, the chip alone carries that state). The plugin-owned inspector body surface settled on **one collapsible section per plugin** (`<sm-inspector-plugin-sections>`): the `inspector.body.panel.*` contributions are grouped by the trusted `pluginId` (titled by it, collapsed by default), replacing the former shared "View contributions" drawer; the short-lived `inspector.body.section` slot was retired before release (its role is absorbed by the grouping). Two optional inspector-only `order` fields, plugin-level (`plugin.json`, sorts sections) and extension-level (extension manifest, sorts bricks), drive layout (default 100, denormalised onto each `contributionsRegistry` entry as `pluginOrder` / `extensionOrder`); `inspector.action.button` is uncapped. Still deferred to the post-v1.0 iframe sandbox (Decision #293): arbitrary HTML / JS inside a plugin section.
- **Verb panels**, one panel per kernel verb shipped at Step 11. Initial set:
  - `sm what <node>` → "What does this node do?" inspector tab driven by the existing summary cache + an on-demand re-run button.
  - `sm dedupe` → cluster view that highlights near-duplicate nodes (semantic distance from the per-kind summarizer's vector or a dedicated dedupe extension).
  - `sm cluster-triggers` → grouped view of trigger overlap across agents / commands / hooks, with drill-down to per-trigger conflicts.
  - `sm impact-of <change>` → "if I touch this node, what else moves?" propagation view that uses `state_links` + transitive closure.
  - `sm recommend-optimization` → opinionated wizard that walks the user through suggested rewrites (token budget, redundancy collapse, missing fields).
- **Job orchestration UI**, queue inspector that lists in-flight + recent jobs (id, kind, started, status, retries, elapsed, owner). Action affordances: cancel a running job, retry a failed one, requeue a finished one. Drives the BFF mutation endpoints that 14.x deferred, REST verbs + WebSocket back-pressure feedback.
- **Findings management**, the read-only findings list from Step 16 grows acknowledge / dismiss / snooze / re-evaluate states. Persistence via `state_findings_status` (new table, spec edit). Bulk actions land here, not in Step 16.
- **Cost / token dashboards**, collection-wide aggregation of LLM spend (per provider, per kind, per time window). Populates from `state_summaries` token counts + `state_executions` history.
- **Settings + plugins page**, ✅ plugin toggles shipped 2026-05-09, **revised 2026-05-11** to apply live (per-scan fresh resolver + buffered modal + bulk endpoint). Implementation diverged from the original sketch on two axes: **(1)** UX is a topbar gear → PrimeNG `p-dialog` modal rather than a `/settings` route, because the only setting today is plugin toggles and a route with one section was over-engineering for a surface that fits in 600 px of vertical space; the route can graduate when settings hierarchy / cost dashboards / verb-flow controls land and the modal stops being enough. **(2)** API verbs are `PATCH /api/plugins/:id` (bundle macro), `PATCH /api/plugins/:pluginId/extensions/:extensionId` (qualified), and `PATCH /api/plugins` (bulk) instead of separate `/enable` + `/disable` endpoints, one PATCH with a boolean body symmetrically covers both directions, the qualified-id form reuses the same path grammar, and the bulk variant lets the SPA ship a buffered modal delta in one transaction. Persistence went through `config_plugins` via `IConfigPluginsPort.set`, same row that `sm plugins enable / disable` wrote to (**revised 2026-06-27: enable moved to the config layers and `config_plugins` was repurposed to the per-plugin import-trust store, splitting enable and trust into separate axes / verbs, see the Import trust bullet above**). **Apply window** (the 2026-05-11 revision): the original shape carried a persistent "Restart required" `<p-message>` banner because `composeScanExtensions` read the boot-cached `pluginRuntime.resolveEnabled`, which meant `POST /api/scan` and watcher chokidar batches both ignored any mid-session PATCH. The fix layered four pieces, (a) `core/runtime/fresh-resolver.ts` exposes `buildFreshResolver` + `composeResolver` reused by `routes/plugins.ts`, `routes/scan.ts`, and `core/watcher/runtime.ts`; (b) `composeScanExtensions` / `composeFormatters` / `registerEnabledExtensions` accept an optional `resolveEnabled` override and filter user-plugin extensions / manifests / annotation contributions / view contributions by it (previously only built-ins were filtered, so disabling a previously-enabled drop-in had no effect); (c) the watcher rebuilds the resolver from `config_plugins` per batch (one cheap SQLite read); (d) the BFF's `kindRegistry` + `contributionsRegistry` (boot-cached, embedded in every envelope) now include EVERY built-in's declarations regardless of boot-time enabled state, without this, re-enabling a built-in that had been disabled at boot left the new contributions unrenderable because the registries the UI read never knew about them. Drop-in user plugins still respect boot-time filtering at the registry level (their modules weren't imported and aren't reachable mid-session, same `startsAsDisabled` exception below). The buffered modal stages edits in `pendingState`, marks dirty rows, exposes `[Discard] [Apply]` in the footer, and intercepts close with a `<p-confirmDialog>` (`Discard` / `Keep editing` / `Apply`). Apply ships the bulk PATCH and triggers a scan via the shared `ScanTriggerService` (consumed by both the topbar refresh button and the modal). **Exception**, drop-in plugins whose discovery-time `status === 'disabled'` carry `startsAsDisabled: true` on the wire and surface a per-row hint when the user re-enables them: their handlers were never loaded into memory at boot, so re-engaging needs an `sm serve` restart. Hot-reload (re-discovering new plugins on disk without restart) was rejected, it would need to invalidate the kind / contributions registries plus any in-flight scan, and the boot-time discovery is the only path that compiles AJV validators against `plugin.json`. The modal also ships an About section (logo + version table + project folder + DB path) backed by two new wire fields on `GET /api/health` (`cwd`, `dbPath`); plugin rows render manifest-declared `description` text (built-ins declare it inline on `IBuiltInPlugin`, drop-ins read `plugin.json#/description`) and the description is folded into the substring-search index. The topbar also gained a manual refresh button (`POST /api/scan` with a process-level mutex; `409 scan-busy` when a scan is already in flight) so users can re-run the pipeline without dropping back to the CLI. Still pending under this bullet: settings hierarchy viewer (merged `settings.json` with per-key provenance) and the proper `/settings` route once the surface outgrows a modal. Out of scope (still): editing the settings file from the UI (deferred indefinitely, restart-to-apply contract per §Configuration). **Per-extension operator settings, landed end to end (2026-06-13)**: extensions declare operator-configurable `settings` in their manifest; the new `sm plugins config <plugin>/<ext>` verb reads / writes the values (resolved through the config layers under `plugins.<id>.extensions.<extId>.settings`, coerced to the declared input-type, `secret`-typed values forced into the gitignored `settings.local.json` with no encryption), and the scan resolver populates `ctx.settings`. A `number` (decimal) input-type was added alongside `integer`. `GET`/`PATCH /api/plugins` carry the declarations + resolved values, and Settings renders a dedicated section per plugin (below About) holding its extensions' option forms (all 11 input-type controls), committed through one global modal Apply that also carries the plugin enable/disable toggles. See decision #132.
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
- **Public-site `web/demo/` deploy** (carry-over from 14.7): wire the existing `pnpm web:build` (which already chains `pnpm demo:build` per Step 14.3) into the release pipeline so the deployed site at `skill-map.ai/demo/` ships the latest demo bundle on every release. The demo bundle already passes through the e2e smoke gate above before publish.
- **Documentation site**: **Astro Starlight** (static, minimal infra, good DX).
- **Plugin API reference**: JSDoc → Starlight auto-generated.
- **LLM-discoverable docs surface** (Decision #89): generate `/llms.txt` and `/llms-full.txt` at the root of `skill-map.ai` following the [llmstxt.org](https://llmstxt.org) standard. The short file lists curated entry points (README, spec contracts, CLI reference, plugin author guide); the full file inlines the same content for one-shot ingestion. Both are emitted by `web/scripts/build-site.js` from authoritative sources (`spec/`, `sm help --format md`, `ROADMAP.md`) so they cannot drift. Once the spec freezes at `v1.0.0`, register the project on [context7](https://context7.com), it indexes public repos with a usable `llms.txt` and serves them through the `context7` MCP that AI agents already consume. Net effect: any LLM-driven workflow (Claude Code, Cursor, ChatGPT browse, etc.) finds skill-map docs without scraping the schemas. Pre-`v1.0.0` is intentionally too early, the spec is still moving and we'd be teaching context7 a stale shape.
- `mia-marketplace` entry.
- Claude Code plugin wrapper, a skill that invokes `sm` from inside Claude Code (`skill-optimizer` is the canonical dual-surface example: exists as a Claude Code skill AND as a skill-map Action via invocation-template mode).
- **Telemetry opt-in (error reporting, Level 1)**, implemented: anonymous crash reporting via Sentry across CLI / BFF / UI, **OFF by default**, normative contract in [`spec/telemetry.md`](./spec/telemetry.md). Consent persists in `~/.skill-map/settings.json` (`telemetry.errorsEnabled`), surfaced through `GET/PATCH /api/preferences` and a Settings Privacy toggle; `SKILL_MAP_TELEMETRY=0` force-disables every surface; a pure, deny-by-default scrubber strips home paths and host identity in `beforeSend`. The CLI and BFF share one Sentry project (told apart by a `surface` tag), the UI has its own, so two real DSNs ship centralized in `src/public-config.ts` / `ui/src/app/core/public-config.ts`; each surface is dormancy-gated, setting its DSN to `''` forces it inert (no init, no prompt, no network, the UI SDK is not even fetched). Usage analytics (which Extractors / verbs run in the wild) ships as a separate Level 3 surface, now implemented (see the Level 3 bullet below).
- **Update notification**, passive once-per-day check against `https://registry.npmjs.org/@skill-map/cli/latest`. CLI prints a one-line banner on stderr at the END of every command when a newer release is available; UI renders a chip next to the "Beta" badge in the shell topbar. Cache state (`latestVersion`, `checkedAt`, `shownAt`) lives in the project DB on `config_preferences` under key `_kernel.update-check`, no new table, no migration. Bails on `SM_NO_UPDATE_CHECK=1`, `CI` truthy, non-TTY stderr, missing project DB, or `updateCheck.enabled: false` in `settings.json`. Probe runs AFTER the verb's output with a 1500ms timeout so it never delays a command. BFF surface: `GET /api/update-status` (read-only projection of the cache).
- Compatibility matrix (kernel ↔ plugin API ↔ spec).
- Breaking-changes / deprecation policy.
- `sm doctor` diagnostics for user installs (verifies the install, reads the merged settings, confirms each hierarchy layer is parseable).
- **Launch polish on `skill-map.ai`**: the domain is live (Railway-deployed Caddy + DNS at Vercel, serving `/spec/v0/**` schemas). The landing source lives in `web/` (editable HTML/CSS/JS, copied into `site/` by `web/scripts/build-site.js`). The build performs (a) i18n via `data-i18n` markers, content rendered once into `/index.html` (en) and `/es/index.html` (es), `web/i18n.json` itself excluded from the build output, (b) per-language `{{CANONICAL_URL}}` substitution, (c) generation of `robots.txt` and `sitemap.xml` (with `xhtml:link hreflang` alternates) at the site root. SEO surface in place: per-language `<title>` + `<meta name="description">`, `<link rel="canonical">`, full Open Graph (title / description / url / image / locale + locale:alternate), Twitter cards (`summary_large_image`, `@crystian` as site/creator), JSON-LD `SoftwareApplication` with translated `description`, `theme-color`, `color-scheme`. The 1200×630 OG image asset (`web/img/og-image.png`) is in place and copied verbatim into the site at build time, so social previews render with the proper card. Step 15 still adds HTTP redirects, Astro Starlight docs, and registration on JSON Schema Store once `v0 → v1` ships.

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
- **Step 22+, Density / token-economy plugin**. Drop-in plugin that closes the loop between *identifying* token-heavy nodes and *recovering* the value. Ships a deterministic Analyzer `oversized-node` (threshold on `scan_nodes.tokens_total`, per-kind configurable via plugin KV) plus cheap-filter proxies for information density, Shannon entropy over tokens, or a gzip-ratio substitute for a coarser signal. Summarizers emit a probabilistic finding `low-information-density` when they detect repetition without added signal. A Hook on `analyzer.completed` (filtered to the `oversized-node` Analyzer) walks the flagged candidates and pipes them into `skill-optimizer` (Decision #86, canonical dual-surface Action) via `sm job submit`. Cheap-filter + expensive-verifier: deterministic proxies pre-filter for free, the LLM summarizer confirms before committing tokens. Exactly the drop-in story the plugin architecture was designed to support, zero kernel changes, pure composition of Analyzer + Finding + Hook + Action.
- **Step 23+, Built-in graph formatters: Mermaid + DOT + JSON**. Today only `ascii` ships in `src/plugins/formatters/`. The public site copy (`pe.formatter.brief` in `web/i18n.json`) advertises Mermaid (for READMEs), DOT (for Graphviz), and JSON (for pipelines) as common targets, those are the next built-in Formatter plugins to land so the site copy reflects shipped reality. Pure deterministic. No spec change required, Formatter is already a stable extension kind.
- **npm + other registry enrichment plugins**. When registries publish documented APIs.
- **ETag / conditional GET** for GitHub enrichment. Bandwidth optimization.
- **Governance / RFC process**. When external contributors appear.
- **Claude Code hook auto-record**. A PostToolUse hook that auto-calls `sm record` after an action completes. Partial coverage already via the Skill agent; full auto-record hook deferred.
- **Adversarial testing suite** for prompt injection. Fixtures with known payloads.
- **Parallel job execution**. Event schema already supports demuxing by id.
- **Multi-turn conversational jobs in DB**. If a strong case appears.
- **Plugin signing / hash verification**. Post v1.0 distribution hardening.
- **Telemetry usage analytics (Level 3)**, implemented: opt-in, anonymous PostHog usage across CLI + UI (which verbs and built-in extractors run, which UI views open), OFF by default, three independent toggles (`usageCliEnabled` / `usageUiEnabled` / `errorsEnabled`) consented through the one shared first-run prompt, a shared anonymous install id as the PostHog `distinct_id`. Normative contract in [`spec/telemetry.md`](./spec/telemetry.md).
- **`.ts` migrations** (escape hatch for SQL-impossible data transforms).
- **`sm graph --root <node-path>` (focused subgraph render)**. Today `sm graph` always renders the whole collection through the chosen formatter; on large scopes the user has no way to focus on "what does THIS node connect to". Surface a `--root` flag that scopes the render to the transitive closure (in + out edges) of the named node, with `--depth N` to bound the walk. Useful for inspector-style flows from the CLI without round-tripping through `sm export`.
- **`sm conformance run --format json` (machine-readable conformance output)**. Today the runner prints a human summary; CI pipelines that want to gate on per-case results have to parse the prose. Add `--format json` returning `{ scope, cases: [{ id, status, durationMs, message? }], totals }`, mirroring the JSON shape of `sm version` / `/api/health`.
- **Standalone executable (no Node required on the host)**. Today `@skill-map/cli` ships as an npm package with two `bin` aliases (`sm`, `skill-map`); both require a Node runtime on the user's machine and a `npm install -g` (or `npx`) round-trip. The deferred goal is a self-contained binary per-OS, drop it on the box, run it, no Node, no `node_modules`. Tooling target: **`bun build --compile`** (produces a standalone executable that bundles the Bun runtime + the CLI; cross-compile to linux/macOS/windows targets is supported out of the box). Implications worth flagging: (a) the bundled runtime is Bun, not Node, any kernel code that touches Node-only APIs (e.g. `node:sqlite`, `process.binding`) needs a compat audit before flipping; (b) plugins are user-supplied JS dropped into `.skill-map/plugins/<id>/`, under a Bun standalone they execute through Bun's loader, so the plugin author guide gets a "supported runtime APIs" surface; (c) the npm package still ships in parallel, the standalone is an additional distribution channel for users who don't have or don't want Node, not a replacement. Distribution mechanics (signed releases, GitHub Releases attachments, Homebrew tap, scoop bucket) are part of the same step. Targets post-v1.0 because the v1.0 Phase E distribution polish (Step 15) intentionally locks the npm path first; standalone is a packaging extension once the npm channel is stable and the runtime-API audit is done.
- **Plugin-to-plugin dependencies**. Today the manifest declares compatibility against the spec (`specCompat`) and the contracts catalog (`catalogCompat`), but a plugin cannot declare it requires another plugin. The current escape valve is the data graph: a plugin that consumes Markdown nodes simply finds none if no Markdown extractor is installed, and the user has to discover the missing piece by absence. Use cases that break this pattern: a Markdown-validation Analyzer that is meaningless without a Markdown Extractor; a probabilistic Summarizer that extends a deterministic Extractor's output schema; a Hook chained to another plugin's Action. Add a manifest field, `requires: { "<plugin-id>": "<semver-range>" }`, checked at load time alongside `specCompat`/`catalogCompat`. Resolution order: missing dependency → status `missing-dependency` (load skipped, doctor surfaces it); incompatible version → `incompatible-dependency`; cyclic graph → load aborts with a named cycle. `sm plugins doctor` lists missing/incompatible dependencies; `sm plugins install` (when distribution lands) walks the closure. Out of scope for this entry: runtime imports between plugins (cross-plugin code reuse), that is a packaging problem, not a manifest one, and stays deferred independently. Targets post-v1.0 because the v1.0 plugin set is small enough that the data-graph fallback is acceptable, and the design needs the catalog evolution story to settle first (catalog-major + plugin-dep-major interactions).
- **Third-party UI + BFF extensions**. Today plugins extend the kernel via the six declarative kinds (Provider / Extractor / Analyzer / Action / Formatter / Hook); they cannot ship Angular components, Hono routes, or any code that runs in the browser or in the BFF process. A future plugin kind (or two new kinds, `UIExtension` + `BFFExtension`) lets third parties contribute: (a) Angular lazy modules that mount in declared extension points (extra inspector tabs, list-view columns, graph node decorations, side-nav routes, custom views, driven by the same plugin manifest field surface used today for annotation contributions); (b) Hono route bundles mounted under `/api/plugins/<plugin-id>/*` with their own middleware + Zod validation, sharing the BFF's broadcaster + kernel handle. Use cases: a vendor's plugin adds a "Verify against upstream" tab calling its own BFF endpoint to check the agent against the published version; a team's plugin adds an internal-scoring column in the list view sourced from a private cache; a security plugin adds a heatmap of agents that touch sensitive paths. Risk surface is non-trivial: sandboxing the contributed UI so it can't break the host SPA (CSP, isolated bundles, signed builds), securing plugin BFF endpoints (auth scope, rate limits, no kernel-bypass), versioning the contribution APIs (new sub-spec, plugin-author guide expansion). Distribution model TBD, likely the plugin author ships an extra `ui/` and `bff/` folder under their plugin, the kernel composes them at boot. Targets a deliberate post-v1.0 step because the security + sandboxing design needs masticación before any third-party code runs in the browser or the BFF process.
- **Action discovery surface in the node inspector**. The spec now carries two complementary fields that together describe "what can the user do with this node": (a) `Action.precondition` (already shipped, see `src/kernel/extensions/action.ts:108`) declares which nodes an Action applies to from the Action's own side (`kind`, `provider`, `stability`, `custom`); (b) `Analyzer.recommendedActions` (added in this iteration) declares per-Analyzer which per-node Actions are the canonical resolution for that Analyzer's issues. The UI work pending is the inspector hookup: when the user lands on a node, render two lists, "Applicable Actions" (every Action whose `precondition` matches the current node) and "Recommended for issues" (for each Issue on the node, the `recommendedActions` of the Analyzer that fired it). Actions are per-node by design; project-level operations (orphan-file prune, contribution relink) stay as CLI verbs (e.g. `sm job prune --orphan-files`) and do NOT participate in this surface. A future iteration MAY extend `IActionPrecondition` with scope-level dimensions if a real graph-scoped Action surfaces; until then the surface stays strictly per-node. Built-in pairings shipping today: `core/annotation-stale.recommendedActions = ['core/bump']` (stale sidecar → run `bump`).
- **Graph-level analyzer scope (workflow-wide checks)**. Today every analyzer receives the full graph via `IAnalyzerContext` (`ctx.nodes` + `ctx.links`), but the convention is per-node or per-link iteration (each Issue carries `nodeIds: [path]` with `minItems: 1`). Workflow-wide checks are technically possible already (an analyzer can do a graph traversal in its `evaluate` body), but two pieces are missing for them to be first-class: (a) a `scope: 'node' | 'link' | 'graph'` hint on `IAnalyzer` so the kernel can decide caching / parallelization differently (per-node analyzers are trivially parallel and incremental-friendly; `graph`-scoped ones need a full pass) and the UI can render their findings differently (a "the graph has a cycle between A → B → C" finding is qualitatively distinct from "node X is stale"); (b) an Issue shape for findings that do not attach to a specific node, today the workaround is "emit Issue with all involved nodes in `nodeIds`", which works but couples the graph-finding semantics to the node-finding shape. Concrete future analyzers that warrant this surface: orphan-cluster detection (subgraphs with no path to a designated root), missing-handler detection ("no node has a trigger for `/deploy` despite N callers using it"), agent-skill coverage gaps. Defer until ≥3 concrete graph-level analyzers exist; before then, model each one as a per-node Issue with every involved path in `nodeIds`. The decision is whether the spec needs `IAnalyzer.scope` + an `IGraphIssue` companion shape, or if the per-node Issue with multi-path `nodeIds` is sufficient at scale.
- **Live agent conversation view (real-time LLM transcript in the UI)**. Today LLM jobs (probabilistic Extractors / Analyzers / Summarizers, and any Action that delegates to an agent) surface in the Jobs panel as status + final summary; the user sees that *something* is running and what it produced, but not the back-and-forth, prompt turns, partial assistant deltas, tool calls, tool results, intermediate reasoning. The deferred goal is a streaming transcript view: while a job runs, the UI tails the conversation token-by-token (or turn-by-turn for tool calls), so the operator can watch what the agent is thinking, catch a runaway prompt early, and inspect *why* a finding was emitted without re-running with `--verbose`. Scope sketch: (a) extend `spec/job-events.md` with a `conversation.turn` event family, `turn.start` (role, turn index), `turn.delta` (token chunk, opaque to the kernel), `turn.tool_call` (name + arguments), `turn.tool_result` (truncated payload), `turn.end` (final text + token usage); kernel + runner emit them through the same broadcaster the Jobs panel already consumes; (b) persist a bounded ring of turns per job in `.skill-map/jobs/<id>/conversation.ndjson` so re-opening the UI after the job finished still shows the full transcript without re-running; (c) UI: a "Conversation" tab inside the Job inspector, virtualized list of turns, syntax-highlighted tool-call JSON, collapsible long deltas, copy-to-clipboard per turn, "jump to live" affordance; (d) a CLI mirror, `sm job tail <id> --conversation` for terminal users, sharing the same event stream. Implications worth flagging: provider abstraction needs to expose streaming deltas uniformly (Anthropic / OpenAI / local LLMs all stream differently, the kernel should normalize to the `turn.*` event shape, not leak SDK types); secret redaction passes over each `turn.delta` before it hits the broadcaster (today `cli-output-style` redacts post-hoc on text output, streaming needs the same guarantees in-flight); storage cap analyzers (a 100k-turn job should not bloat `.skill-map/`, so the ring is byte-capped with an "elided N turns" marker, mirroring the existing job-output truncation behavior); the conversation log is the operator's debugging surface, not a normative artifact, it does NOT feed back into the graph and does NOT get committed to git (`.skill-map/jobs/` is already gitignored). Targets post-v1.0 because the v1.0 LLM layer (Step 11) intentionally ships with the simpler "status + summary" UX; live transcript adds non-trivial provider-streaming + secret-redaction + UI virtualization work that is independent of correctness and benefits from being prioritized once the LLM verbs have real-world usage to guide the affordances.
- **MCP config-side discovery (Phase 5b of the active-lens migration)**. Phase 5 (shipped 2026-05-19) materialises MCP server nodes from the *consumer* side: the `core/mcp-tools` extractor scans `frontmatter.tools` on every skill / agent / command, picks up `mcp__<server>__<tool>` entries, and emits one virtual `mcp://<server>` node + a `references` link per unique server. The graph today shows MCPs only when at least one node uses them; declared-but-unused servers stay invisible, and used-but-undeclared servers materialise without any provenance back to where they should have been declared. Phase 5b closes the loop by reading the authoritative config files: Claude `settings.json` `mcpServers`, Cursor `.cursor/mcp.json`, OpenAI Codex `~/.codex/config.toml` + per-project `.codex/config.toml`, Gemini inline `mcp_servers` on subagents. Each per-provider extractor emits the same `mcp://<server>` virtual node with richer metadata (transport, command, args, declared `tools_provided`) and `derivedFrom: [<config path>]`. First-wins dedup in the orchestrator keeps the config-side node canonical when both sides emit the same id; the consumer-side stays as fallback for references that have no declaration. With both halves wired, three states become distinguishable: (a) declared + used → solid node + edges; (b) declared + unused → orphan node, surfaces as a hint that an MCP is set up but no agent uses it; (c) referenced + undeclared → `broken-ref` warning under sabor A, the operator sees they need to add it to the config. Architectural decision pending before implementation: extend `Provider.walk()` to emit synthetic nodes derived from config files (cleaner, the provider owns its filesystem territory), or add a new `ctx.readFile(path)` callback on the extractor surface (more flexible, requires a new kernel API). The `~/.codex/config.toml` reader extends the documented closed list of `os.homedir()` callers per `AGENTS.md` § Skill-map MUST NEVER read `$HOME` by default. UI follow-up: render MCP cards with the config-side metadata (transport, command, tools list) instead of the placeholder body the Phase 5 cards carry today. Effort: ~2-3 hours focused once the architectural decision lands; the rest is per-provider mechanical work.
- **Codex AGENTS.md hierarchical walker (remaining half of the former Phase 6b)**. Phase 6 (shipped 2026-05-19) onboarded OpenAI Codex as a first-class provider with a TOML parser and a classifier for `.codex/agents/*.toml`. **Codex skills landed 2026-06-25.** The earlier draft of this item assumed Codex skills lived in a proprietary `.codex/skills/<name>/SKILL.md` mirroring Claude's `.claude/skills/`; per the official docs (https://developers.openai.com/codex/skills) that was wrong, Codex reads skills from the OPEN `.agents/skills/<name>/SKILL.md` standard (scanned CWD → repo root), the same on-disk home `agent-skills` already owns. The codex provider now classifies them as `codex`/`skill` by composing the `agent-skills` open-standard pieces (read rule, kind, resolution, reserved names) over a **multi-rule `read` array** (`.toml` agents + `.md` skills, one parser each); the `read` schema gained array support to express the mixed format, and `invokes` → `skill` resolution means an agent's `/skill-name` slash now links to its skill. One piece is still deferred. **AGENTS.md hierarchical cascade.** Codex reads `AGENTS.md` at every level from project root down to CWD, concatenates them in depth order, applies per-level `AGENTS.override.md` shadow files, and caps the total at `project_doc_max_bytes` (default 32 KiB). Today each `AGENTS.md` is just another markdown node the `core/markdown` fallback claims; the hierarchy is invisible. Two modelling options: (a) keep each `AGENTS.md` as its own node and add `extends` / `overrides` edges between them so the user reads the cascade visually (simpler, ~1.5 hours, refects the source faithfully); (b) synthesise virtual `agents-md://<dir>/` nodes representing "the effective instruction set Codex sees when working in `<dir>`" with `derivedFrom: [list of source AGENTS.md]` (more ambitious, ~3-4 hours, exposes runtime semantics but the synthetic body has no real-file backing). Option (a) is the recommended starting point; (b) opens when concrete demand for runtime-view appears. Both options need to support `project_doc_fallback_filenames` (Codex can be configured to also read `CLAUDE.md`, `CONTRIBUTING.md`, etc.) and surface a warning when a level's concatenated payload exceeds the configured cap. Effort: ~1.5 hours for the simple cascade (edges between real nodes); ~half a day for the full package including override semantics, fallback-filenames opt-in, and tests.

---

## Discarded (explicitly rejected)

Explicitly rejected proposals (with rationale) live in [`context/roadmap-history.md`](./context/roadmap-history.md#discarded-explicitly-rejected). Use that file when wondering whether an idea was already considered and dropped, the reasoning is preserved verbatim there.
