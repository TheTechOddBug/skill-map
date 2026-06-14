---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Make the link-confidence scoring mechanism spec-official. `analyzer.schema.json` gains a `phase` enum so external analyzers can declare `phase: 'score'` and adjust link confidence via `ctx.adjustConfidence(link, op)` (op kinds `set` / `delta` / `ceil` / `floor`), folded deterministically and clamped to [0,1] before the read-only phases. The spec now documents the phase, the fold, and the `scan_link_scores` attribution table, with a `score-phase-confidence` conformance case locking it.

## User-facing

**Plugin authors can ship a `score`-phase analyzer that adds or subtracts link confidence.** Declare `phase: 'score'` and call `ctx.adjustConfidence(link, op)` to compose on top of the kernel's own scoring; every adjustment is recorded in `scan_link_scores` for auditing.
