---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Lens-gated classification for vendor providers. Vendor Providers (`claude`, `openai`, `antigravity`) now opt into being gated by the active lens via a new `gatedByActiveLens: true` field on their manifest. The walker (`src/kernel/orchestrator/walk.ts`) pre-filters `opts.providers` before the walk loop: a gated Provider runs only when `provider.id === opts.activeProvider`, so vendor providers no longer attempt to classify files outside their lens. Universal providers (`core/markdown`, future `agent-skills` open standard) leave the flag absent / `false` and run unconditionally.

**Motivation.** The real runtimes never cross-read each other's on-disk formats: Claude Code does not consume `.codex/`, Codex CLI does not consume `.claude/`, Antigravity has no on-disk kind beyond the open standard yet. Offering every file to every provider during classification fabricated cross-vendor graph edges the runtimes themselves reject, the operator saw `openai/agent` nodes for `.codex/agents/*.toml` in a `claude`-lensed project even though Claude Code would never resolve them. The pre-filter in the walker is the cheap path: a gated-off Provider does NOT walk its territory at all, no per-file cost.

**Spec.** `spec/schemas/extensions/provider.schema.json` mirrors the new optional boolean field with the full normative description (vendor MUST opt in, universal SHOULD omit, `null` lens bypasses the gate). The matching prose lives in `spec/architecture.md` §"Active-lens scope for providers (classification gate)" (landing alongside drift-detection in a follow-up commit; the changeset for that commit owns the architecture.md prose bump).

**`null` lens semantics.** When `activeProvider === null` (a project with no provider markers, no setting), the walker bypasses the gate entirely and every Provider runs. This matches the extractor-side fallback for unlensed projects: a plain-markdown repo keeps classifying with every Provider, no gates fire.

**Backward compatibility.** Providers without the field default to `gatedByActiveLens === undefined ≡ false`, the universal behaviour. Existing third-party providers keep working unchanged; only providers that explicitly opt in change classification semantics.

**Tests.** `src/kernel/orchestrator/__tests__/walk-lens-gate.spec.ts` covers the walker filter at the unit level (3 cases: claude lens excludes openai territory, openai lens excludes claude territory, `null` lens admits both). `src/__tests__/integration/lens-gated-classification.spec.ts` covers the end-to-end shape across a 4-file fixture per lens (2 cases).

Pre-1.0 minor per `spec/versioning.md`: additive optional field on the Provider manifest schema (`@skill-map/spec`) plus an additive walker behaviour change on `@skill-map/cli`. No removed surface, no breaking change for universal providers.

## User-facing

Cross-provider files (e.g. a `.codex/agents/*.toml` while the lens is `claude`) are no longer claimed by the foreign provider. They surface as plain markdown / unclassified instead, matching how the agent itself would see them at runtime.
