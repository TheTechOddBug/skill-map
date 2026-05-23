---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Phase 2.B of the Signal IR migration: `claude/at-directive` extractor now routes through `ctx.emitSignal` instead of `ctx.emitLink`. Each `@<token>` match emits a single-candidate Signal carrying the byte range, scope (`body`), and a candidate with the same kind / target / confidence / trigger / rationale shape the extractor used to embed directly into a Link. The resolver phase materialises the winning candidate as a Link indistinguishable from the prior direct-emit shape, including `occurrences[]` round-tripping; full `pnpm validate` stays green with 1734 tests passing and zero behaviour change.

Why through Signals: byte ranges now flow into the kernel resolver, which unlocks cross-extractor range-overlap collision detection (a future `core/signal-collision` analyzer will surface losers as `warn` issues). The single-candidate shape keeps the migration narrow; multi-candidate emissions for cases of genuine intra-Signal ambiguity stay deferred until a real case demands it.

Spec: `signal.schema.json` gains an optional `range.line` field so extractors that already compute line tracking (via `computeLineStarts` / `lineFor`) thread the line number through to the materialised `Link.location.line` without the resolver re-walking the body.

Kernel: resolver's `materialise()` synthesises a one-entry `occurrences[]` from the winning candidate's trigger + range so multi-extractor `dedupeLinks` merges accumulate occurrences through the same code path as direct emissions. `extractorOrder` and `link.sources` now both use short extractor ids (e.g. `'at-directive'`) to match the cache layer's lookup contract.

Test harness: `src/plugins/core/extractors/__tests__/extractors.spec.ts` `extract()` helper auto-flushes Signals via the resolver so tests that assert on the resulting `links` array see identical shape regardless of whether the extractor went through `emitLink` directly or routed through `emitSignal`.
