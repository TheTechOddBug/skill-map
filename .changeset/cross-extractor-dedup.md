---
'@skill-map/cli': patch
---

Unify path normalisation between `claude/at-directive` and `core/markdown-link`, and upgrade `dedupeLinks` to merge cross-extractor duplicates with the maximum confidence.

**Background:** the providers re-pass test plan finding 5.A.4 documented that two extractors emitting "the same edge" against the same source body produced two distinct `Link` records because they normalised the target differently. `core/markdown-link` resolved relative paths against the source node's directory (`.claude/agents/source.md` + `./target.md` → `.claude/agents/target.md`); `claude/at-directive` stripped the leading `./` only (`@./target.md` → `target.md`). The orchestrator's post-walk `dedupeLinks` keys on `(source, target, kind, normalizedTrigger)` and saw two different `target` strings, so the same conceptual edge inflated link counters and rendered as two parallel edges in the UI.

**This change:**

1. `claude/at-directive` now resolves `./x` / `../x` / bare `x.ext` against `dirname(ctx.node.path)` via `pathPosix.normalize`, matching `core/markdown-link`'s `resolveTarget`. The emitted `target` is the canonical root-relative `Node.path`. `normalizedTrigger` is the same resolved path (no more lowercase divergence with markdown-link's `resolved`).

2. `@/abs/foo.md` is now skipped (returns no link) instead of being emitted verbatim. This aligns with `core/markdown-link`'s rejection of leading `/` so the two syntaxes have the same "absolute paths are ambiguous in a markdown body" stance.

3. `dedupeLinks` bumps `existing.confidence = max(existing.confidence, link.confidence)` on merge. The classic case is `markdown-link` (0.95) merging with `at-directive` (0.85) on the same edge: the post-merge record carries the markdown-link's stronger 0.95 so the UI's opacity-by-confidence rules see the strongest signal instead of whichever extractor happened to run first.

**Tests:** new unit test on `dedupeLinks` covers the cross-extractor merge with confidence-max + `sources[]` union. Full CLI suite stays green (1614 pass, 4 skipped, 0 fail).

**Breaking shape:** if an external consumer was relying on `at-directive` emitting a raw path string (e.g. `target.md` instead of `.claude/agents/target.md`), they will see the canonical root-relative path now. Closes the `bd-3nr` structural finding.

## User-facing

`[link](./foo.md)` and `@./foo.md` from the same file now merge into a single graph edge (was two). Edges with multiple sources show the strongest confidence in the UI, not the first detector's value.
