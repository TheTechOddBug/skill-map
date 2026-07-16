---
'@skill-map/spec': minor
'@skill-map/cli': patch
---

Fixers no longer refuse a node whose findings merely went stale. Staleness is node-level, so any fix stales every finding on the node, including ones about untouched sections whose defects are still present; excluding them discarded valid judgments and forced a re-detection between fixes. The injection now includes stale findings flagged `stale: true`, the agent verifies each against the current body and declines what no longer applies, and submit refuses only when no matching findings exist.

## User-facing

You can now queue every fixer for a file in a row: fixing one issue no longer blocks the rest with "no findings to resolve". Agents check each older finding against the current text and skip the ones already gone.
