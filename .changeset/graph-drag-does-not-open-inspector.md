---
'@skill-map/cli': patch
---

Dragging a node on the map no longer opens the inspector. Foblex selects the node under the pointer on pointerdown and reports it once the drag threshold is crossed, bypassing the click handler's drag guard. The graph now rejects selections reported while the flow host carries `f-dragging` and re-asserts its own selection when the drag settles, so moving a node leaves selection untouched and a plain click still opens the panel.

## User-facing

Dragging a node around the map no longer opens the inspector panel. Moving a node just moves it; a plain click still opens it.
