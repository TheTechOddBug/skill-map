---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

`POST /api/activity` now emits one diagnostic log line per ingested event so an operator debugging a Provider's live-activity wiring (`sm serve --log-level info`) sees whether a hook fired and where it ended up, instead of the silent 202 short-circuits. The line names the provider, a sanitized hook-type discriminator, and the outcome (resolved with counts / no-signals / no-nodes / unresolved at INFO; no-provider and token mismatch at WARN). The event body is never logged.

## User-facing

Run `sm serve --log-level info` to see one line per live-activity event: which provider and hook fired, and whether it resolved, mapped nothing, or was dropped (e.g. an untrusted provider). Hard drops and token mismatches show even at the default level.
