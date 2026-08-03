---
"@skill-map/cli": patch
---

An outdated agent process skill now announces itself in Settings instead of waiting to be found. The chassis reads `ProcessingAgentReadinessService.skillUpdateAvailable` and marks the Project sidebar row with an attention dot; the row itself takes a stripe, an "Update available" chip and a warn-toned action. New `--sm-attention` token, orange rather than the amber severity-warn: an older skill is a pending action, not a finding.

## User-facing

Settings now shows an orange dot next to Project when your agent process skill is older than the one shipping with this version, and the row explains why. The dot clears as soon as you update.
