---
"@skill-map/cli": patch
---

The inspector's Activity section now refreshes live off the `node.activity` / `agent.spawn` streams (debounced), so a node's recent-execution rows, counters, and spawn threads update the moment the assistant runs, instead of waiting for the next watcher re-scan.

## User-facing

The inspector's Activity panel now updates live while your assistant runs: recent executions, counters, and spawn threads refresh as they happen, not only on the next scan.
