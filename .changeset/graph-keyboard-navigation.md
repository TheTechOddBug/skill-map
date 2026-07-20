---
"@skill-map/cli": patch
---

The graph view adopts Foblex Flow 19: node connectors move to the unified `fConnector` model (plain node ids, connection-level sides), selection becomes single-owner (Foblex's selection drives the inspector/highlight state through one bridge), and the v19 opt-in keyboard layer is enabled with connection-creation and delete actions unbound for the read-only map.

## User-facing

The map is now keyboard-navigable: Tab into it, move between nodes with the arrow keys (Ctrl+arrow follows the links), Home/End jump to the first/last node, Space plus arrows moves a node, and +/- zoom. The selected node opens in the inspector, same as clicking.
