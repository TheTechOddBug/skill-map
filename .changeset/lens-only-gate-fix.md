---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Loosen the active-provider lens gate to lens-only: per-provider extractors run on every visited node when the active lens is in the extractor's declared `precondition.provider` allowlist, regardless of which provider classified the node.

The previous gate (shipped in 0.34.0) double-checked `nodeProvider AND activeProvider`. That broke a real surface: a `@handle` in `CLAUDE.md` or `notes/todo.md` (files the `claude` provider disclaims to `core/markdown` because markdown is provider-agnostic) never got parsed under the `claude` lens, because the node's provider was `core`, not `claude`. The runtime grammar the lens represents applies across every markdown surface, not only the files the provider's `classify()` owns, so the lens is the single discriminator. Cross-lens isolation is preserved by the lens half alone: under `gemini`, claude extractors are silent on every node (including `.claude/*`), because the lens authorisation is missing.

Spec wording in `spec/architecture.md` §Universal extractors and per-provider extractors updated to match. `matchesProviderPrecondition` signature simplified to `(ex, activeProvider)`; the `provider` field is removed from `computeCacheDecision` opts. Unit tests rewritten with the lens-only matrix.

## User-facing

**`@handle` and `/command` now resolve outside `.claude/`.** Under the Claude lens, mentions and invokes in `CLAUDE.md`, `notes/*.md`, and any markdown across the project are picked up as Claude edges. Switching lens hides them so the graph mirrors the active runtime.
