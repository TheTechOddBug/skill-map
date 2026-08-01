---
'@skill-map/spec': minor
---

`user-settings.schema.json` gains `logLevel`, the standing per-machine log-level preference, and the CLI contract records the full precedence chain plus why the key belongs to the user file rather than project config: a committed value would push one operator's debugging onto the whole team, and the level is resolved at process boot before any project config exists. The field is deliberately not an `enum`, so a typo cannot invalidate the whole document and discard unrelated preferences.
