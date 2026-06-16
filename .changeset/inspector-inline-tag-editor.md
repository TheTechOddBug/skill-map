---
"@skill-map/cli": minor
"@skill-map/spec": patch
---

The inspector tag row (`<sm-node-tags>`) is now an inline editor: `core/node-set-tags` no longer self-projects an `inspector.action.button`; a pencil opens an add / remove editor (shown even with no tags) that offers the tags already present in the graph as click-to-add chips, derived live from the loaded scan; typing a brand-new tag still works. The author guide's self-projection example switched from Edit tags to Set stability.

## User-facing

Edit a node's tags right where they are shown: click the pencil in the inspector's tag row to add or remove them inline, with one-click chips for tags already used in your graph (you can still type new ones). The separate Edit tags button is gone.
