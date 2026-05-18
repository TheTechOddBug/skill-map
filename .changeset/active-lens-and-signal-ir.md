---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Active-provider lens model, Signal IR scaffold, numeric `Confidence`, MCP virtual nodes, OpenAI Codex provider, and the Phase 4b extractor mudanza in one coherent migration.

**Spec foundation**

- New `activeProvider` field on `project-config.schema.json` (per-project lens id, drives the new drop+rescan lifecycle and the per-extension `precondition.provider` gating).
- New `signal.schema.json` defining the multi-candidate `Signal` IR emitted by extractors via `ctx.emitSignal()`.
- `Node.virtual` (boolean) and `Node.derivedFrom` (string[]) on `node.schema.json` so synthetic / derived entities (MCP servers, future Codex AGENTS.md cascade) coexist with filesystem-backed nodes.
- `link.confidence` migrates from the `'high' | 'medium' | 'low'` string union to `number` in `[0..1]`. The SQL column flips to `REAL` with a range check.
- `spec/architecture.md` gets a top-level **Active Provider Lens** section and an **Extractor · Signal IR (opt-in)** subsection. `spec/cli-contract.md` documents the lens-change UX. `spec/db-schema.md` notes the scan-zone drop on lens change. Coverage matrix gains a row for the Signal schema.

**Kernel**

- `Signal` / `SignalCandidate` / `SignalRange` / `SignalContext` types alongside `Link` in `kernel/types.ts`. `ConfidenceTier` constants (`HIGH = 0.9`, `MEDIUM = 0.6`, `LOW = 0.3`) preserve bucket-thinking call sites.
- New `IExtractorCallbacks.emitSignal` and `IExtractorCallbacks.emitNode` plus the `IEmittedNode` payload. Orchestrator wires both with validators that drop off-spec emissions via `extension.error` events; the walker merges virtual nodes into the accumulator with first-wins dedup.
- New `orchestrator/resolver.ts` scaffold (first-candidate-wins today; provider `resolverRules` land later).
- `frontmatter-toml` parser registered in the kernel parser registry (`smol-toml@1.6.1` pinned).
- `precondition.provider` is now enforced in `computeCacheDecision`: an extractor whose manifest declares `['claude']` only runs on nodes the `claude` provider classified.

**Lens model wiring**

- `src/core/config/active-provider.ts`: `resolveActiveProvider(cwd)` with filesystem auto-detect (`.claude/` / `.gemini/` / `.codex/` / `AGENTS.md` / `.cursor/`) and `isExtensionActiveUnderLens` predicate.
- `src/cli/util/scan-zone-drop.ts`: atomic `DELETE FROM scan_*` helper, shared by `sm db reset` and the new `sm config set activeProvider` hook.
- `sm config set activeProvider <id>` drops the scan zone and prints the lens-switch receipt with a hint to rescan.
- BFF: `GET / PATCH /api/active-provider` with the same drop-on-switch semantic, registered before the catch-all.
- Settings UI: new "Active provider" row in the Project tab (now at the top of the section), confirm dialog before the destructive switch, post-switch announcement.

**Numeric `Confidence` migration**

Atomic across spec / kernel / SQL / extractors / tests:
- `Confidence = number` in `kernel/types.ts`; `enum-parsers.ts` range-checks `[0..1]`.
- `validateLink` rejects out-of-range values with a `link-confidence-out-of-range` extension.error.
- The 5 universal extractors emit calibrated numeric values (`annotations` 1.0, `markdown-link` 0.95, `external-url-counter` 0.3, `at-directive` 0.85/0.5, `slash` 0.8).
- `sm show` renders confidence as a percent (`85%`).
- `link-conflict` `rankConfidence` reduces to identity; resolver's `bucketConfidence` bridge removed.
- Rename heuristic uses `ConfidenceTier.HIGH/MEDIUM` and exposes `renameTierLabel` for the analyzer-id mapping.
- DB column flips from `TEXT` (enum check) to `REAL` (range check) in `001_initial.sql`.

**MCP virtual nodes**

- New `core/mcp-tools` extractor: detects `tools: [mcp__<server>__<tool>]` in agent/skill/command frontmatter and emits one virtual MCP node (`mcp://<server>`, `kind: 'mcp'`, `virtual: true`, `derivedFrom: [source]`) plus a `references` link from the source. Idempotent: N skills referencing the same server collapse into one node.
- Claude provider registers the `mcp` kind in its catalog (violet, server icon).

**OpenAI Codex provider (MVP)**

- New `src/plugins/openai/` bundle: declarative `read: { extensions: ['.toml'], parser: 'toml' }`, classifies `.codex/agents/*.toml` as `agent`. Schema mirrors Codex sub-agent fields (`name`, `description`, `model`, `instructions`, `tools`, `mcp_servers`, `approval_policy`, `sandbox_mode`).
- `BUNDLE_ORDER` extended in the built-ins generator. 5 bundles, 29 built-in extensions total.

**Phase 4b extractor mudanza**

- `at-directive` and `slash` move from `src/plugins/core/extractors/` to `src/plugins/claude/extractors/`. Both declare `pluginId: 'claude'` and `precondition: { provider: ['claude'] }`. Universal extractors (markdown-link, external-url-counter, annotations, tools-count, mcp-tools) stay in `core/`.

**Settings UI polish**

- `<sm-settings-project>` reorders to put the Active provider selector first.
- `<sm-kind-palette>` filters kinds with zero nodes; the left palette no longer shows always-empty buttons for kinds the loaded set has no instances of. New `__tests__/kind-palette.spec.ts` regression-guards the filter.

## User-facing

Settings → Project: new Active provider dropdown switches the runtime lens (Claude / Gemini / Codex / Cursor). Tools matching `mcp__name__*` surface MCP nodes in the graph. Codex `.toml` sub-agents under `.codex/agents/` are classified. Link confidence renders as percent.
