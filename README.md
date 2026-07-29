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

![skill-map lighting up live as you edit .md files](https://github.com/user-attachments/assets/3d4f7b22-0787-4fb1-9369-f5649607e18e)

## What it is

An AI harness (Claude Code, Codex, Antigravity, Copilot, and others) grows by accumulation: dozens of skills, agents, commands, and loose Markdown nobody fully sees. skill-map scans the project and puts everything on one live graph: what exists, what each file costs in tokens, who invokes whom, which triggers collide, what is obsolete, and what can be deleted without breaking anything.

The scanner is deterministic (pure code, offline, CI-safe). An optional LLM layer adds semantic judgment (duplicates, bloat, contradictions) through YOUR agent; skill-map never ships or requires a key.

## Quick start

```bash
npm i -g @skill-map/cli
cd your/project
sm
```

Bare `sm` offers to initialize a project that is not set up yet, then opens the Web UI at `http://127.0.0.1:4242` with the watcher running: edit any `.md` and the graph updates live. Everything the UI does is also a CLI verb (`sm help`). No install? Try the [live demo](https://skill-map.ai/demo/).

> Something not behaving? The per-OS and per-runtime fine print lives in [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

### Guided tutorial (recommended)

With your agent (Claude Code, Codex, Antigravity, OpenCode), the fastest evaluation is the bundled interactive tutorial: a ~10 minute live-UI prologue, then a menu of deeper parts (real time, the AI layer, plugins, the CLI). Runs in an empty folder:

```bash
mkdir try-skill-map && cd try-skill-map
sm tutorial
claude        # or your runtime's CLI; then, at the prompt: run the tutorial
```

## How it works

1. A **deterministic scanner** walks the files, parses frontmatter, resolves references, and emits the graph (nodes, links, issues).
2. An optional **probabilistic layer** queues LLM jobs (summaries, finders, fixers, tagging) that your own agent executes.
3. The **`sm` CLI** is the primary surface; the bundled **Web UI** (bare `sm`) renders the graph live.
4. A **plugin system** (Providers, Extractors, Analyzers, Actions, Formatters, Hooks) extends everything without touching the kernel.

Every analytical extension declares itself `deterministic` (runs inside `sm scan`, CI-safe) or `probabilistic` (queued job, never during scan): same plugin model, two cost profiles.

## Philosophy

- **Design made visible**: a harness is designed, not accumulated; skill-map makes your design verifiable as it grows.
- **CLI-first**: everything the UI does is reachable from the command line.
- **Deterministic by default**: the LLM is optional; the product works offline.
- **A public standard**: the spec in [`spec/`](./spec/README.md) is enough to build an alternative implementation.
- **Platform-agnostic**: adapters ship for Claude Code, Codex, Antigravity, and OpenCode; the architecture takes any Markdown ecosystem.

## The Quick Start panel

> [!TIP]
> Everything the next sections do with commands can also be done from the UI: the rocket button opens **Quick Start**, which enables, installs, and verifies each capability with one click per row.

## Watch your agents run

With the server open, the map lights each node the moment your runtime touches it (the skill it loaded, the agent it delegated to, the file it read), and delegations draw live spawn arrows between agents. Wire it once per provider:

```bash
sm activity install claude    # or: codex, antigravity, opencode
```

Hooks are project-local, everything stays on loopback, and `sm activity uninstall` reverses exactly what install added. What each runtime can and cannot show: [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

## Drive it from your agent (MCP)

`sm` can expose the project as an [MCP](https://modelcontextprotocol.io) server at `/mcp` (off by default): the map as read-only typed tools and live resources, plus queue and findings operations under the same contract as the CLI, so an MCP host can BE the processing agent.

```bash
sm --mcp
```

## Processing the job queue

skill-map never runs an LLM itself: probabilistic work parks in a queue and YOUR agent claims, executes, and records it through the `sm-process-jobs` skill (`sm agent install`). Every supported agent speaks the same protocol.

## Sidecar `.sm` files

Human curation (version, stability, tags, audit trail) lives in a sibling YAML file (`demo-agent.md` → `demo-agent.sm`), never inside the `.md`: the agent and you own the `.md`, skill-map owns the `.sm`. They appear only when you opt in (`sm bump`, `sm sidecars annotate`; scans never write them), and they are source: commit them. Full design: [`spec/architecture.md` §Annotation system](./spec/architecture.md#annotation-system).

## Specification

The spec is the source of truth, separated from the implementation since day zero: JSON Schemas (draft 2020-12), prose contracts, and a conformance suite, published as [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec) and served at [skill-map.ai](https://skill-map.ai). Anyone can build an alternative implementation consuming only `spec/`. Inventory: [`spec/README.md`](./spec/README.md).

## Compatibility

What works where, at a glance (✓ full, ~ partial, ✗ not available):

| | Claude Code | Codex | Antigravity | OpenCode |
|---|---|---|---|---|
| Live node activity | ✓ | ~ (file reads stay dark) | ~ (reads only) | ✓ |
| Spawn arrows between agents | ✓ | ✓ | ✗ | ✓ (one hop) |
| MCP (map + queue) | ✓ | ✓ | ✓ | ✓ |
| Resident processing agent, zero idle cost | ✓ | ✓ (MCP park) | ~ (pass by pass) | ✓ (MCP park) |

The complete list, with the why behind every gap: [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

## Links

- Website: [skill-map.ai](https://skill-map.ai/)
- Full design and roadmap: [ROADMAP.md](./ROADMAP.md)
- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Troubleshooting (per-OS and per-runtime fine print): [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Spec overview: [spec/README.md](./spec/README.md)
- Architecture (ports & adapters): [spec/architecture.md](./spec/architecture.md)
- CLI contract: [spec/cli-contract.md](./spec/cli-contract.md)
- MCP server contract: [spec/mcp-server.md](./spec/mcp-server.md)
- CLI reference: run `sm help` (add `--format md` for markdown)
- Reference implementation: [src/README.md](./src/README.md)
- Spanish version of this README: [README.es.md](./README.es.md)
- License: [MIT](./LICENSE)

## Acknowledgements

The graph view that gives skill-map its identity is built on [**Foblex Flow**](https://flow.foblex.com), an excellent Angular flow library that handles nodes, connectors, pan, and zoom. Huge thanks to the Foblex team.

Also standing on the shoulders of [Angular](https://angular.dev), [PrimeNG](https://primeng.org), [Hono](https://hono.dev), and [Kysely](https://kysely.dev).

## Star History

<a href="https://www.star-history.com/?repos=crystian%2Fskill-map&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&theme=dark&legend=top-left&sealed_token=JtsEAnZCNzvD5vqADlaPvZ1GRu6kcb7LGAq55Vwz90KhdHuvfVotQnfQ9LDA8wzxt7bNvTX1S3zewen--lnL9r6Z-SS05JVk4gu5Kuq2ogcn28wY_XerVg" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left&sealed_token=JtsEAnZCNzvD5vqADlaPvZ1GRu6kcb7LGAq55Vwz90KhdHuvfVotQnfQ9LDA8wzxt7bNvTX1S3zewen--lnL9r6Z-SS05JVk4gu5Kuq2ogcn28wY_XerVg" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left&sealed_token=JtsEAnZCNzvD5vqADlaPvZ1GRu6kcb7LGAq55Vwz90KhdHuvfVotQnfQ9LDA8wzxt7bNvTX1S3zewen--lnL9r6Z-SS05JVk4gu5Kuq2ogcn28wY_XerVg" />
 </picture>
</a>

---

Made with ❤️&nbsp; by [Crystian](https://github.com/crystian/) · [LinkedIn](https://www.linkedin.com/in/crystian/)
