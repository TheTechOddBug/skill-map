---
'@skill-map/cli': patch
---

Phase 2.C of the Signal IR migration: the remaining five link-emitter extractors (`claude/slash`, `core/markdown-link`, `core/annotations`, `core/mcp-tools`, `core/external-url-counter`) now route through `ctx.emitSignal` instead of `ctx.emitLink`. Each one emits single-candidate Signals with the same kind / target / confidence / trigger shape the prior emission produced; the resolver materialises them as Links indistinguishable from direct-emit shape so 1734 tests and full `pnpm validate` stay green with zero behavioural change.

What each extractor carries on the Signal:
- `claude/slash`: body-scope, `range = { start, end, line }`, `raw = '/cmd'`, single candidate `invokes` at 0.8.
- `core/markdown-link`: body-scope, range covers the whole `[text](path)` match, single candidate `references` at 1.0.
- `core/annotations`: sidecar-scope, `fieldPath = ['annotations', <key>, <index?>]`, single candidate `supersedes` at 1.0.
- `core/mcp-tools`: frontmatter-scope, `fieldPath = ['tools', <index>]`, single candidate `references` at 0.85 targeting `mcp://<server>`.
- `core/external-url-counter`: body-scope, range covers the URL match, single candidate `references` at 0.3 targeting the normalised URL. The resolver's external-URL cluster skip keeps these out of cross-extractor collision detection.

Phase 2.D follows: the new `core/signal-collision` analyzer that surfaces range-overlap losers as `warn` issues, plus the two missing conformance cases (`extractor-emits-signal` and `signal-collision-detection`).
