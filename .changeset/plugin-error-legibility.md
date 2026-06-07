---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Plugin load failures read better. A wrong view-slot value collapses AJV's `must be equal to constant` wall into one `<path> is not a valid value` linking to the slot catalog (`spec/view-slots.md`) on GitHub; other manifest errors link to the kind schema. The warning is one non-repetitive line, `plugin <id> (<status>), all extensions skipped: <reason>`. Plugin-load warnings also no longer print twice at `sm serve` boot.

## User-facing

Clearer plugin errors: a wrong view-slot name now gives a short message linking to the slot catalog, and the warning spells out that the plugin and all its extensions were skipped. It also no longer appears twice when the server starts.
