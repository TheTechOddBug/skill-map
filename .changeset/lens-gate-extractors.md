---
'@skill-map/cli': patch
---

Wire the active-provider lens gate through the orchestrator so per-provider extractors run only when both the node's provider AND the active lens are in the extractor's declared `precondition.provider` allowlist.

Per `spec/architecture.md` §Universal extractors and per-provider extractors, provider-specific extractors (Claude's `@`-directive and `/`-directive parsers, Gemini's at-directive flavours, future Codex AGENTS.md walker) are supposed to be silent when the project is being scanned under a different lens. Until now the orchestrator only checked the first half of the rule (node provider matches), so under `activeProvider=gemini` the Claude extractors still emitted links on `.claude/*` nodes. This patch adds the missing lens half.

**Resolution chain for the active lens:**

1. Production callers (the runtime `scan-runner`) resolve once from `~/.skill-map/settings.json` and, if empty, from filesystem markers at `ctx.cwd`, with a fallback that re-scans the effective scan roots so out-of-tree invocations (`sm scan /some/path` from a directory without `.skill-map/`) still discover a lens.
2. Direct kernel callers (`runScan` from out-of-band tests / embedders) that omit the option get an auto-detect from the scan roots inside `runScanInternal`, so existing integration tests with `.claude/` fixtures keep working without explicit threading. Passing `null` is reserved for "explicit no lens" (spec-strict skip).

**`matchesProviderPrecondition` semantics:**

- Universal extractors (no `precondition.provider`): always run, regardless of node provider or lens.
- Provider-gated extractors: run only when both `nodeProvider` AND `activeProvider` are in the allowlist. A `claude` node under lens `gemini` (or vice versa) is silent.
- `activeProvider === null`: provider-gated extractors are unconditionally skipped (spec-strict).

Cache invalidation already piggy-backs on the lens-switch drop of `scan_*`, so the per-scan cache cannot retain stale per-lens decisions.

## User-facing

Switching the active provider now changes which provider-specific edges appear in the graph. Under the Gemini lens, Claude's `@`/`/` directive edges on `.claude/*` no longer pollute the graph; each file shows only the links the active runtime would invoke.
