---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Add opt-in, anonymous error reporting (Sentry) across the CLI, BFF, and UI, OFF by default. Consent lives in `~/.skill-map/settings.json` (`telemetry.errorsEnabled`), surfaced through `GET/PATCH /api/preferences` and a new Settings Privacy toggle; `SKILL_MAP_TELEMETRY=0` force-disables every surface. A pure, deny-by-default scrubber strips home paths and host identity from every event before it leaves the machine. The normative contract is `spec/telemetry.md`.

## User-facing

skill-map can now report crashes anonymously to help fix bugs, and it is OFF by default. Turn it on or off in Settings under Privacy, or set `SKILL_MAP_TELEMETRY=0` to force it off. File contents, paths, and your settings are never sent.
