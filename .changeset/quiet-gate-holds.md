---
"@skill-map/cli": patch
---

The Check Agent probe no longer enables the AI affordances mid-check: a check that starts with the submit gate closed latches it closed (skill / MCP probe refreshes and the claim heal apply only once the check settles), so only the green verdict reopens them, and a green claim now re-reads MCP status immediately instead of waiting out the poll. Abandoning a check mid-watch settles it with a neutral `abandoned` verdict instead of wedging the shared single-flight slot and the latch.

## User-facing

Pressing Check Agent no longer lights up the AI buttons while the check is still running: they stay disabled until the check actually comes back green.
