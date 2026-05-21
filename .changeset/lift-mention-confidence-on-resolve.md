---
'@skill-map/cli': patch
---

Post-resolution confidence bump for `mentions` links (closes `bd-owi`).

**Context:** the `claude/at-directive` extractor emits a `mentions` link with confidence `0.5` when it sees a bare handle (`@reviewer`) in a body, because at extraction time it cannot tell whether `reviewer` is a real graph entity or just nominal prose. The providers-test-plan re-pass surfaced this as confusing UX: an edge to a resolvable agent rendered with the same visual weight as an edge to nothing.

**This change:** a new post-walk transform `liftMentionConfidence` runs in the orchestrator between `dedupeLinks` and `recomputeLinkCounts`. For each `mentions` link whose `normalizedTrigger` (sigil-stripped) matches a node's `frontmatter.name` index, OR whose `target` matches a node's path, the confidence is bumped to `1.0`. Unresolved mentions keep their `0.5` so the `broken-ref` analyzer still sees the un-bumped state and the UI can still differentiate "real-but-ambiguous" from "broken".

The bump is a separate function in `src/kernel/orchestrator/lift-mention-confidence.ts`. It is NOT a new extension kind (the Arquitecto's explicit constraint was "no sixth extension type"); it's internal-only to the kernel, alongside `dedupeLinks`. A follow-up task (`bd-1ul`) tracks unifying these post-walk transforms under a single internal type or merging them into the existing Signal resolver phase.

**Tests:** 7 new unit tests in `lift-mention-confidence.spec.ts` cover the matrix (resolved via name index, resolved via path, unresolved stays 0.5, non-mentions untouched, mixed array, no-op early-exit when no mentions present, pre-normalised trigger flow). Full CLI suite: 1633 pass, 4 skipped, 0 fail. End-to-end verified: `@reviewer` resolves to `.claude/agents/reviewer.md` and emits confidence 1.0; `@no-such-handle` stays at 0.5 alongside a `broken-ref` issue.

## User-facing

Bare `@handle` mentions that resolve to a real agent / skill / node now render with full confidence (1.0) instead of 0.5. Broken mentions keep their lower weight, so the graph's opacity-by-confidence visibly separates "resolved" from "broken".
