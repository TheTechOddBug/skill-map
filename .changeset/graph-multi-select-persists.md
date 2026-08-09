---
"@skill-map/cli": patch
---

Graph multi-selection now survives its own gestures: releasing a Shift+drag rectangle no longer clears the set (the background-click deselect ignores clicks that conclude a drag), Ctrl/Cmd+click toggles nodes without collapsing to a single selection, dragging any selected node moves the whole group and keeps it selected, and Escape clears a lingering multi-selection.

## User-facing

On the map you can now select several nodes at once (Shift+drag a rectangle, or Ctrl/Cmd+click) and drag them together; the selection stays after you drop them. Press Escape or click empty canvas to clear it.
