---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Wire the active-provider lens gate through the orchestrator so per-provider extractors run on every visited node when the active lens is in the extractor's declared `precondition.provider` allowlist, regardless of which provider classified the node.

Per `spec/architecture.md` §Universal extractors and per-provider extractors, provider-specific extractors (Claude's `@`-directive and `/`-directive parsers, Gemini's at-directive flavours, future Codex AGENTS.md walker) are supposed to be silent when the project is being scanned under a different lens. Until now the orchestrator did not check the lens at all, so under `activeProvider=gemini` the Claude extractors still emitted links on `.claude/*` nodes. This patch adds the lens half of the rule.

**Why the node's provider is NOT part of the gate.** An earlier draft of this patch double-checked `nodeProvider AND activeProvider`. That broke a real surface: a `@handle` in `CLAUDE.md` or `notes/todo.md` (files the `claude` provider disclaims to `core/markdown` because markdown is provider-agnostic) never got parsed under the `claude` lens, because the node's provider was `core`, not `claude`. The runtime grammar the lens represents applies across every markdown surface, not only the files the provider's `classify()` owns, so the lens is the single discriminator. Cross-lens isolation is preserved by the lens half alone: under `gemini`, claude extractors are silent on every node (including `.claude/*`), because the lens authorisation is missing.

**Resolution chain for the active lens:**

1. Production callers (the runtime `scan-runner`) resolve once from `~/.skill-map/settings.json` and, if empty, from filesystem markers at `ctx.cwd`, with a fallback that re-scans the effective scan roots so out-of-tree invocations (`sm scan /some/path` from a directory without `.skill-map/`) still discover a lens.
2. Direct kernel callers (`runScan` from out-of-band tests / embedders) that omit the option get an auto-detect from the scan roots inside `runScanInternal`, so existing integration tests with `.claude/` fixtures keep working without explicit threading. Passing `null` is reserved for "explicit no lens" (spec-strict skip).

**`matchesProviderPrecondition` semantics:**

- Universal extractors (no `precondition.provider`): always run, regardless of lens.
- Provider-gated extractors: run when `activeProvider` is in the allowlist. Skip on every other lens.
- `activeProvider === null`: provider-gated extractors are unconditionally skipped (spec-strict).

Cache invalidation already piggy-backs on the lens-switch drop of `scan_*`, so the per-scan cache cannot retain stale per-lens decisions.

## User-facing

**`@handle` and `/command` tokens now resolve outside `.claude/`.** Under the Claude lens, mentions in `CLAUDE.md`, `notes/*.md`, and any markdown across the project are picked up as Claude edges. Switching lens hides them so the graph mirrors the active runtime.
