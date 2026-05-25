# Architecture diagram

High-level view of skill-map's hexagonal architecture. Companion to `spec/architecture.md` (the normative version).

Terminology follows `spec/architecture.md` verbatim: **driving adapters** call into the kernel, the **kernel** is domain-pure, **driven adapters** implement ports the kernel declares.

```mermaid
flowchart TB
    %% ─── Driving adapters (primary) ───────────────────────────────────
    subgraph DRIVERS["Driving adapters (primary)"]
        direction LR
        CLI["CLI<br/><i>sm command</i>"]
        SERVER["Server<br/><i>Hono BFF (src/server/)</i>"]
        SKILL["Skill<br/><i>agent / IDE</i>"]
    end

    UI["UI · Angular SPA<br/><i>(ui/)</i>"]:::ui
    UI -.->|"HTTP / WS"| SERVER

    %% ─── Kernel (hexagonal core) ──────────────────────────────────────
    subgraph KERNEL["Kernel (domain-pure, hexagonal)"]
        direction LR
        REG["Registry"]
        ORCH["Orchestrator"]
        UC["Use cases<br/><i>scan · refresh · action · watch</i>"]
        CONFIG["Config layering<br/><i>defaults → project → project-local → override</i>"]
    end

    CLI ==>|"ports"| KERNEL
    SERVER ==>|"ports"| KERNEL
    SKILL ==>|"ports"| KERNEL

    %% ─── Driven adapters (secondary) ──────────────────────────────────
    subgraph DRIVEN["Driven adapters (secondary)"]
        direction LR
        STORAGE["Storage<br/><i>SQLite (better-sqlite3)</i>"]
        FS["FS<br/><i>walker · watcher (chokidar)</i>"]
        subgraph PLUGINS["Plugins (closed catalog, 6 kinds)"]
            direction TB
            EXT["extractors"]
            ANA["analyzers"]
            ACT["actions"]
            HOOK["hooks"]
            FMT["formatters"]
            PROV["providers"]
        end
    end

    KERNEL ==> STORAGE
    KERNEL ==> FS
    KERNEL ==> PLUGINS

    %% ─── Cross-cutting: spec ──────────────────────────────────────────
    SPEC[/"spec/ — normative contracts: JSON Schemas, architecture.md, cli-contract.md, job-events.md, conformance suite"/]:::spec

    %% ─── Styling ──────────────────────────────────────────────────────
    classDef driver fill:#a5d8ff,stroke:#1971c2,stroke-width:2px,color:#000
    classDef ui fill:#bac8ff,stroke:#3b5bdb,stroke-width:1px,color:#000,stroke-dasharray: 5 3
    classDef kernel fill:#b2f2bb,stroke:#2f9e44,stroke-width:2px,color:#000
    classDef adapter fill:#dee2e6,stroke:#495057,stroke-width:2px,color:#000
    classDef plugin fill:#ffec99,stroke:#e67700,stroke-width:2px,color:#000
    classDef spec fill:#ffd8a8,stroke:#d9480f,stroke-width:2px,color:#000

    class CLI,SERVER,SKILL driver
    class REG,ORCH,UC,CONFIG kernel
    class STORAGE,FS adapter
    class EXT,ANA,ACT,HOOK,FMT,PROV plugin
```

## Reading guide

**Three driving adapters, not four.** CLI, Server, and Skill are the primary actors the spec recognizes. The UI is *not* a driving adapter, it is an HTTP/WS client of the Server. A fourth driving adapter (VSCode extension, TUI) MAY be added by third parties without spec changes.

**The kernel is domain-pure.** It never imports a filesystem API, a database driver, or a subprocess spawner directly. Every IO call crosses a port. That is what makes the boundary hexagonal: the inside knows nothing about the outside's technology choices.

**Plugins are driven adapters of a special kind.** They are not "infrastructure" like Storage or FS, but the spec puts them on the same side because the kernel invokes them through ports just like the others. The six kinds are a *closed catalog*, the spec enumerates them and no others are allowed.

**Active provider lens is project-scope state.** Although `providers` is one of the six plugin kinds, exactly one provider is active per project at any time (see `spec/architecture.md#active-provider-lens`). The lens determines which extractors and classifiers apply during a scan.

**Config layering is per-project, never global.** The four layers (`defaults → project → project-local → override`) all live under `<cwd>/.skill-map/`. There is a narrow `$HOME` exception for `~/.skill-map/settings.json` (update-check toggle today, future locale/theme), validated against `spec/schemas/user-settings.schema.json` and *not* merged into the project layers.

