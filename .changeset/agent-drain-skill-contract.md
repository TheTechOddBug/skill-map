---
"@skill-map/spec": minor
---

The CLI contract gains §Agent drain skill: `sm agent install / uninstall / status` materialise the canonical, CLI-versioned `sm-run-queue` skill into the active lens's `scaffold.skillDir`, teaching any agent runtime the claim → execute → record drain protocol (byte-exact staleness probe, idempotent reinstall, no separate package and no network fetch).
