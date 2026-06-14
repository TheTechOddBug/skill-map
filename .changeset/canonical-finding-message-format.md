---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Normalize every built-in analyzer finding into one canonical message shape via the shared `formatFinding` helper: an optional backtick-quoted subject line, then `L<line>: <what>; <why>` (the `L<line>:` prefix only when the finding maps to body line(s)). Remediation advice moves out of `message` into `Issue.fix.summary`. `issue.schema.json` documents the grammar as normative; all 14 message-emitting analyzers were migrated, so `sm check` and the UI Inspector read consistently.

## User-facing

**Finding messages now read the same way everywhere.** Each one shows the offending subject on its own line, then `L<line>: what; why`, with the fix hint shown separately instead of appended. Output in `sm check` and the Inspector is more consistent and easier to scan.
