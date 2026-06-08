---
'@skill-map/cli': patch
---

The default graph layout direction is now left-to-right instead of top-to-bottom. The "Balanced" (dagre network-simplex) algorithm was already the default, so only the direction changed: a fresh map with no saved layout preference now flows horizontally. Users who already picked a direction keep their choice.

## User-facing

New maps now lay out left-to-right by default (with the Balanced algorithm), so the skill dependency chain reads along the natural left-to-right axis. You can switch back to top-to-bottom from the graph toolbar or Settings.
