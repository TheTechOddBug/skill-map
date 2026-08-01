---
"@skill-map/cli": minor
---

Error reporting moves to per-incident consent: when a verb crashes on an interactive terminal, or an unhandled error hits the UI, skill-map now asks whether to send that one report (with a scrubbed-payload preview), defaulting to Yes; an explicit no always wins and nothing is remembered between crashes. Auto-capturing Sentry integrations are gone on both surfaces, making verb-boundary errors reportable at last; non-interactive runs auto-send only with the persisted opt-in.

## User-facing

When something crashes, skill-map now asks right there whether to send that one anonymous error report, and can show exactly what would be sent. Enter (or 60s of silence) sends; saying no always wins, applies to that report only, and is never remembered against a future crash.
