[![lang: EN](https://img.shields.io/badge/lang-English-7C3AED)](./README.md)
[![lang: ES](https://img.shields.io/badge/lang-Espa%C3%B1ol-lightgrey)](./README.es.md)

# skill-map

> From multi-agent chaos to predictable agents and skills, the missing map for your generative-AI harness.

[![CI](https://img.shields.io/github/actions/workflow/status/crystian/skill-map/ci.yml?branch=main&logo=github&label=CI)](https://github.com/crystian/skill-map/actions/workflows/ci.yml)
[![npm: @skill-map/cli](https://img.shields.io/npm/v/@skill-map/cli?color=7C3AED&logo=npm&label=%40skill-map%2Fcli)](https://www.npmjs.com/package/@skill-map/cli)
[![npm: @skill-map/spec](https://img.shields.io/npm/v/@skill-map/spec?color=7C3AED&logo=npm&label=%40skill-map%2Fspec)](https://www.npmjs.com/package/@skill-map/spec)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## In a sentence

From multi-agent chaos to predictable agents and skills, the missing map for your Markdown-based generative-AI harness (Claude Code, Codex, Antigravity, Copilot, and others). Detects collisions, orphans, semantic duplicates, and bloated skills on a single graph, with deterministic and optional semantic (LLM) analysis.

![skill-map UI](https://skill-map.ai/img/screenshot-1.jpg)

## The problem it solves

Developers working with AI agents accumulate dozens of skills, agents, commands, and loose documents. Nobody has visibility into:

- How much each Markdown file costs in tokens, invisible until you measure it, expensive at scale.
- What exists and where it lives.
- Who invokes whom (dependencies, cross-references).
- Which triggers overlap or step on each other.
- What is alive vs obsolete.
- What can be deleted without breaking anything.
- When each skill was last optimized or validated.

No official tool (Anthropic, Cursor, GitHub, skills.sh) covers this. `skill-map` fills that gap.

## Who it's for

- **Teams and platform architects**, multiple projects, multiple agents, divergent copies of the same skill. One scan puts the whole hive in the same graph.
- **Authors**, skill, agent, or command creators who want to spot duplicates, redundancies, and optimization opportunities before publishing.
- **Agent debuggers**, when the agent picked the wrong invocation, follow the path from the trigger phrase to the skill that won the match, in real time.
- **Tool builders**, anyone wiring CLI, JSON output, or plugins on top of the graph.

## How it works (high level)

1. **Deterministic scanner** walks files, parses frontmatter, detects references, and emits structured graph data (nodes, links, issues).
2. **Optional LLM layer** consumes that data and adds semantic intelligence: validates ambiguous references, clusters equivalent triggers, compares nodes, answers questions.
3. **`sm` CLI** is the primary surface, every operation reachable from the command line. Bare `sm` opens the Web UI directly.
4. **Web UI**, bundled with the CLI, launched in one command. The graph updates live as you edit any `.md` file. A standalone [demo](https://skill-map.ai/demo/) runs in-browser without installing anything.
5. **Plugin system** (drop-in, kernel + extensions) lets third parties add Providers, Extractors, Analyzers, Actions, Formatters, or Hooks without touching the kernel.

## Two execution modes

Every analytical extension declares one of two modes: **`deterministic`** (pure code, fast, free, runs inside `sm scan` / `sm check`, CI-safe) or **`probabilistic`** (calls an LLM through the kernel, runs as a queued job, never during scan). Same plugin model, two cost profiles. Run deterministic in pre-commit; let probabilistic catch up on-demand or nightly.

Full contract: [`spec/architecture.md`](./spec/architecture.md) §Execution modes.

## Philosophy

- **CLI-first**, everything the UI does is reachable from the command line.
- **Deterministic by default**, the LLM is optional, never required. The product works offline.
- **Public standard**, the spec (JSON Schemas + conformance suite + contracts) lives in `spec/`. Anyone can build an alternative UI, an implementation in another language, or complementary tooling consuming only the spec.
- **Platform-agnostic**, the first adapter is Claude Code, but the architecture supports any MD ecosystem.

Architecture details (hexagonal kernel, ports & adapters) live in [`spec/architecture.md`](./spec/architecture.md).

## Quick start

```bash
npm i -g @skill-map/cli
cd your/project
sm init
sm
```

That last `sm` opens the Web UI on `http://127.0.0.1:4242` with the watcher running. Edit any `.md` file in the project and the graph updates live in your browser.

Want to try it without installing? Open the [live demo](https://skill-map.ai/demo/).

## Interactive tutorial (recommended)

If you use [Claude Code](https://claude.ai/code), the fastest way to evaluate skill-map is the bundled interactive tutorial. It is a single guided "book": a first-timer walks the live-UI prologue (about **10 minutes**), then picks further parts from an in-skill menu, extend skill-map with plugins, settings, and view-slots, and the CLI in depth.

```bash
mkdir try-skill-map && cd try-skill-map
sm tutorial             # installs the sm-tutorial skill
claude                  # open Claude Code in the same dir
# Then, in the Claude prompt:
run the tutorial
```

Claude takes over from there: drops a fixture, walks you through `sm init`, opens the Web UI, edits files in front of your eyes, and shows the watcher reacting live (including how `.skillmapignore` hides files in real time). You see the full flow before pointing it at your real project, no commitment, fully reversible. When the prologue ends it offers a menu of deeper parts (plugins, settings, view-slots, the CLI); pick whichever you want, or stop there.

## Real-time node activity (watch your assistant run)

With `sm serve` open, the map can light up each node **the moment your AI runtime actually invokes it**: the skill it just loaded, the agent it delegated to, the markdown it read. Wire it once per provider:

```bash
sm activity install claude   # or: codex, antigravity, opencode
```

(or from the UI: Settings → Project, below the lens selector; both paths ask for confirmation before touching the provider's config). The install merges hook entries into the provider's **project-local** hook config and drops a tiny bridge under `.skill-map/activity/`; the provider's own hooks forward events to your local server, which matches them against the scanned map and pushes the glow to the browser over the live socket. Everything stays on your machine (loopback only, never telemetry); `sm activity uninstall <provider>` reverses exactly what install added. Toggles live in Settings → General (Live updates / Real-time node activity).

What lights up depends on what each runtime's hook system exposes:

| Provider | Lights up | Known gaps (and why) |
|---|---|---|
| `claude` (Claude Code) | Slash commands, skills (typed or model-invoked), agents including nested delegation chains, markdown file reads | Auto-loaded context (`CLAUDE.md` at session start) fires no hook, so it stays invisible |
| `codex` (Codex CLI) | `$skill` invocations from your prompt, named agents from `.codex/agents/` (nested chains too if you raise `agents.max_depth`), spawn arrows between agents with per-edge conversation counters and opt-in conversation viewing | Markdown reads and skills followed by subagents stay dark: Codex hooks do not fire for its `read_file` tool yet ([openai/codex#18491](https://github.com/openai/codex/issues/18491)); spawns of the generic `worker` type match no node; execution totals (duration/tools/tokens) stay empty, the runtime does not report them |
| `antigravity` (Antigravity CLI) | Everything that gets READ: markdown files, a skill's `SKILL.md` and its resources whenever the agent views them, workflows followed in prose; the whole chain goes dark when the conversation goes FULLY idle (mid-run naps while subagents work no longer darken it) | `/skill` invocations stay dark (the runtime injects the content with no hook event, ask for the skill in prose instead); subagents have no on-disk definition and spawns return no child id, so there is no node to light and no spawn arrow to draw |
| `opencode` (OpenCode) | The richest surface: skills, commands and agents all arrive NAMED (they fire even when invoked in prose), markdown reads light by path, and each session's whole chain goes dark the moment it idles (native `session.idle`) | Built-in agents without an on-disk file (`build`, `plan`) have no node to light |
| `markdown` | No runtime to hook; nothing lights | |

Full contract (bridge invariants, privacy posture, per-provider signal notes): [`spec/provider-activity.md`](./spec/provider-activity.md).

## Sidecar `.sm` files (don't be alarmed when they appear)

The first time you run `sm bump` or `sm sidecar annotate`, skill-map writes a sibling YAML file next to each `.md`: `demo-agent.md` → `demo-agent.sm` in the same directory. They are intentional, they are part of the design, and **they belong in your repo**.

**They appear only when you opt in.** `sm scan`, `sm watch`, and the live UI **never create `.sm` files**, they only read existing ones. If you just installed skill-map and ran `sm init` / `sm` / `sm scan`, no sidecar exists yet; they show up the first time you call `sm bump` (or `sm sidecar annotate`) on a node, and never before.

**Why a separate file?** Your `.md` belongs to the vendor (Claude Code, Codex, Cursor, …) and to your own prose. Stuffing skill-map's bookkeeping (version, stability, supersession, tags, audit trail) inside its frontmatter would contaminate vendor input and bloat what the agent reads on every invocation. The `.sm` sidecar keeps the two layers cleanly separated: the vendor and the human own the `.md`; skill-map owns the `.sm`.

**Commit them to git.** `.sm` files are source, they carry the metadata that drives `sm check`, drift detection, and supersession graphs. Treat them like any other tracked file: don't add them to `.gitignore`, don't strip them on deploy. The opt-in pre-commit hook (`sm hooks install pre-commit-bump`) keeps them in lockstep with their `.md` automatically.

Full spec: [`spec/architecture.md` §Annotation system](./spec/architecture.md#annotation-system).

## Windows / WSL

skill-map runs under WSL2, but keep your project on the **Linux filesystem** (for example `~/projects/...`), not on a mounted Windows drive (`/mnt/c/...`).

The live map's file watcher uses the OS's native change notifications (inotify), and Windows drives mounted into WSL do not deliver those events. A one-shot `sm scan` still reads files under `/mnt/c` (slowly), but `sm serve` / `sm watch` will not refresh the map when they change, and neither watcher backend (`chokidar` or `parcel`) changes that. This cross-filesystem boundary is unsupported by design; there is no polling fallback. A symlink inside a Linux-hosted project that points at a Windows path behaves the same way: it is followed on a full scan, never live-watched.

## Specification

The spec is the source of truth and lives in [`spec/`](./spec/), separated from the reference implementation since day zero, so third parties can build alternative implementations using only `spec/`.

- Canonical URL: **[skill-map.ai](https://skill-map.ai)** (schemas at `https://skill-map.ai/spec/v0/<path>.schema.json`).
- npm package: [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec).
- Contents: JSON Schemas (draft 2020-12) + prose contracts + conformance suite. Full inventory in [`spec/README.md`](./spec/README.md).

## Repo layout

```
skill-map/                     pnpm workspaces root (private)
├── spec/                      specification, published as @skill-map/spec
├── src/                       reference implementation, published as @skill-map/cli (bins: sm, skill-map)
├── ui/                        Angular SPA (graph, list, inspector), bundled into @skill-map/cli
├── web/                       public site (skill-map.ai), hosts the demo bundle
├── scripts/                   build & validation scripts (spec index, CLI reference, demo dataset, …)
├── ...
├── AGENTS.md                  agent operating manual
└── ROADMAP.md                 design narrative (decisions, phases, deferred)
```

## Links

- Website: [skill-map.ai](https://skill-map.ai/)
- Full design and roadmap: [ROADMAP.md](./ROADMAP.md)
- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Spec overview: [spec/README.md](./spec/README.md)
- Architecture (ports & adapters): [spec/architecture.md](./spec/architecture.md)
- CLI contract: [spec/cli-contract.md](./spec/cli-contract.md)
- CLI reference: run `sm help` (add `--format md` for markdown)
- Reference implementation: [src/README.md](./src/README.md)
- Spanish version of this README: [README.es.md](./README.es.md)
- License: [MIT](./LICENSE)

## Acknowledgements

The graph view that gives skill-map its identity is built on [**Foblex Flow**](https://flow.foblex.com), an excellent Angular flow library that handles nodes, connectors, pan, and zoom. Huge thanks to the Foblex team.

Also standing on the shoulders of [Angular](https://angular.dev), [PrimeNG](https://primeng.org), [Hono](https://hono.dev), and [Kysely](https://kysely.dev).

## Star history

[![Star History Chart](https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left)](https://www.star-history.com/?repos=crystian%2Fskill-map&type=timeline&legend=top-left)

---

Made with ❤️&nbsp; by [Crystian](https://github.com/crystian/) · [LinkedIn](https://www.linkedin.com/in/crystian/)
