---
"@skill-map/cli": patch
---

Enable user-driven edge selection in the graph view. Removed `[fSelectionDisabled]="true"` from `<f-connection>` so Foblex's built-in click-to-select kicks in. When an edge is selected, the line grows from its per-kind base (1-1.5px) to 2.5px and the kind's muted base colour is promoted to its full-saturation `*-active` counterpart (e.g. `invokes` goes from desaturated `#b8843a` to vivid `#f59e0b`), marker dot and arrowhead follow the path so the picked edge pops without changing hue family.

## User-facing

**Click an edge to highlight it** — clicking a connection in the graph now selects it: the line grows a touch thicker and saturates to its full colour (same hue as the base, just louder). Click elsewhere on the canvas to clear the selection.
