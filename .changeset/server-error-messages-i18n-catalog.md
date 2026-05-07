---
"@skill-map/cli": patch
---

Internal refactor: move BFF error message literals (catch-all 404 envelopes, sidecar bump refusals, body-parse failures, missing-invoke envelope) into `src/server/i18n/server.texts.ts` so every operator-facing string lives in one catalog. The route bodies now reference `SERVER_TEXTS.*` keys (interpolated through `tx()` for the path-bearing 404s) instead of inlining the literals.

No wire / behavior change: the rendered messages are byte-identical to what the routes emitted before, including the load-bearing `sidecar-fresh:` prefix on the 409 refusal that the UI pattern-matches against. The local `REFUSAL_MESSAGE` constant in `routes/sidecar.ts` is dropped — its sole consumer reads the catalog now.

Why: the i18n catalog already owned every other operator-facing string (boot banners, watcher errors, broadcaster diagnostics); these eight remained inlined and were the last drift surface for "where do server error messages live". Future locale work / log-grep affinity benefits from the single source.
