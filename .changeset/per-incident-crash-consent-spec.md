---
"@skill-map/spec": minor
---

`spec/telemetry.md` gains §Per-incident crash-report consent: on every promptable crash the CLI and UI ask whether to send that one report, defaulting to Yes (an explicit no always wins; the CLI's announced bounded wait resolves Yes). `telemetry.errorsEnabled` is re-scoped to the non-interactive fallback only. Nothing is persisted per incident, the kill switch and DSN dormancy stay hard gates, the BFF keeps the toggle-only model, and the prompt must offer a scrubbed-payload preview.
