---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

New read-only verb `sm activity status [provider]` (normative row in cli-contract.md §Activity): one line per activity-capable provider reporting installed, not installed, or partial (config wired but the shared bridge artifact missing; the inverse reads as not installed because the bridge is shared across hook-file providers), and the `activity install`/`uninstall` help texts now describe both install shapes with opencode examples.

## User-facing

**Check where live activity stands with `sm activity status`.** One line per provider tells you if its hook is installed, missing, or half-broken, plus the exact re-install command that repairs it.
