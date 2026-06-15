// Conformance fixture: a THIRD-PARTY `score`-phase analyzer. It declares
// `phase: 'score'` (newly admitted by `analyzer.schema.json#/properties/phase`)
// and calls `ctx.adjustConfidence(link, op)` to compose confidence ops on
// top of the kernel's own 1.0 baseline.
//
// The companion case `score-phase-confidence.json` scans a `source.md`
// whose `[text](./target.md)` link resolves to `target.md`. The kernel
// seeds the 1.0 baseline on every link and a clean resolved link gets no
// built-in score-phase op; this drop-in then folds a `delta -0.4` (→ 0.6)
// and a `floor 0.5` (no-op, 0.6 > 0.5) on top. The fold is deterministic
// and clamped to [0,1], so the persisted `scan_links.confidence` is
// exactly `0.6`.
//
// A scorer emits no issues; its only output is the confidence ops, so
// `evaluate` returns `[]`. The callback is present ONLY in the score
// phase, the `?.` guard keeps the extension inert if it ever runs
// elsewhere.
export default {
  version: '0.1.0',
  description: 'score-phase scorer: delta -0.4 then floor 0.5 on every link',
  mode: 'deterministic',
  phase: 'score',

  evaluate(ctx) {
    for (const link of ctx.links) {
      ctx.adjustConfidence?.(link, { kind: 'delta', value: -0.4 });
      ctx.adjustConfidence?.(link, { kind: 'floor', value: 0.5 });
    }
    return [];
  },
};
