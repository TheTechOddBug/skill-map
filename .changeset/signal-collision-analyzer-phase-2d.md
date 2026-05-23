---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Phase 2.D of the Signal IR migration: new `core/signal-collision` built-in analyzer surfaces resolver rejections as operator-visible `warn` issues. The analyzer reads `IAnalyzerContext.signals`, finds every Signal whose `resolution.outcome === 'rejected'`, and emits one issue per rejection naming the loser extractor + matched text + byte range, the winner extractor + range, and the tiebreak reason (`kind-priority` / `higher-confidence` / `longer-range` / `earlier-declaration`). Phase 4+ stubs (`extractorDisabled`, `belowFloor`) are handled with their own message templates so the surface stays forward-compatible.

Closes spec conformance coverage row 37 (`signal.schema.json`) with the two required cases:
- `extractor-emits-signal`: a body with a single `[text](path)` markdown link materialises as one Link via the Signal IR resolver path; `sources[0] === 'markdown-link'`.
- `signal-collision-detection`: a body with `[@./api.md](./api.md)` triggers a cross-extractor range overlap (markdown-link's range contains at-directive's range); markdown-link wins on confidence; the loser surfaces as exactly one `core/signal-collision` warn issue.

## User-facing

`sm scan` now warns when two extractors detect overlapping byte ranges. The graph keeps the winner; the issue panel explains which detection lost and why, so a markdown link wrapping an `@`-directive no longer looks like silent disappearing intent.
