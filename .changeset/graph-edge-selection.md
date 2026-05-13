---
"@skill-map/cli": patch
---

Enable user-driven edge selection in the graph view. Removed `[fSelectionDisabled]="true"` from `<f-connection>` so Foblex's built-in click-to-select kicks in. When an edge is selected it grows from its per-kind base (1-1.5px) to 2.5px and re-colors to PrimeNG's primary, marker dot and arrowhead included, so the picked edge reads cleanly above the muted base palette.

## User-facing

**Click an edge to highlight it** — clicking a connection in the graph now selects it: the line grows a touch thicker and switches to the UI's primary color along with its dot / arrow markers. Click elsewhere on the canvas to clear the selection.
