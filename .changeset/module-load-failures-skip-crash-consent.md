---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Rule 6 of `spec/telemetry.md` §Per-incident crash-report consent now excludes UI module-load failures: a dynamically imported chunk that fails to fetch (the three browser phrasings, matched on the error message) never opens the crash-report consent dialog, since the crash is environmental (serving process gone or a stale cached shell) with nothing actionable to report; the UI early-returns on that class and the error still reaches the console.

## User-facing

**No crash-report prompt when the server is gone.** If a page fails to load because `sm serve` is not running (or the browser kept an old copy of the app), skill-map no longer asks to send a crash report; the server being unreachable is not a bug worth reporting.
