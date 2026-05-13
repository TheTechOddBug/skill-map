---
"@skill-map/cli": patch
---

Add a per-browser graph edge style preference to Settings → General. The new selector picks between the four Foblex connection shapes (orthogonal / straight / bezier / adaptive curve) and persists in `localStorage`, so it does not sync across machines.

Implementation: new `GraphPreferencesService` (signal + localStorage round-trip) consumed by the graph view's `<f-connection [fType]>` binding and a `<p-selectbutton>` in the Settings modal. Default flipped from the historical `segment` to `adaptive-curve`, the curve follows the top/bottom connector pinning and reads cleaner in a top-down dagre layout.

## User-facing

**Graph edge style picker** — Settings → General now has an "Edge style" control. Pick **Orthogonal**, **Straight**, **Bezier**, or **Adaptive curve** (new default) and the graph re-renders immediately. The choice is remembered in this browser only.
