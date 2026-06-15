---
"@skill-map/cli": minor
---

Fix two built-in finding messages that drifted from the canonical `<what>; <why>` shape: `core/name-reserved` said "Name collision" (clashing with the separate `core/name-collision` rule) and now reads "Reserved name"; `core/job-file-orphan` now names the orphan file as the finding subject, matching `core/annotation-orphan`. A new format-consistency test pins every analyzer body to the grammar so messages stay uniform.

## User-facing

**Finding messages read more consistently.** Reserved-name findings no longer say "Name collision" (now "Reserved name"), and orphan-job-file findings name the file they point at, like the other findings.
