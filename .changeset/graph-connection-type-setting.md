---
"@skill-map/cli": patch
---

Add a per-browser graph edge style preference to Settings → General. The new selector picks between the four Foblex connection shapes (orthogonal / straight / bezier / adaptive curve) and persists in `localStorage`, so it does not sync across machines.

Implementation: new `GraphPreferencesService` (signal + localStorage round-trip) consumed by the graph view's `<f-connection [fType]>` binding and a `<p-selectbutton>` in the Settings modal. Default stays `segment` (orthogonal), matching the historical behaviour.

## User-facing

**Graph edge style picker** — Settings → General now has an "Edge style" control. Pick **Orthogonal** (default), **Straight**, **Bezier**, or **Adaptive curve** and the graph re-renders immediately. The choice is remembered in this browser only.
