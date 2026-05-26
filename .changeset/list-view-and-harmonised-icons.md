---
'@skill-map/cli': minor
---

List view as a first-class surface, harmonised severity icons across graph and list.

**Built-in plugin icons swapped to PrimeIcons**

- `core/issue-counter` manifest now declares `pi-times-circle` (error) and `pi-exclamation-triangle` (warn) instead of the FontAwesome `fa-circle-xmark` / `fa-circle-exclamation`. Shape-distinct glyphs (triangle vs circle) so error and warn read apart at a glance regardless of color contrast.
- `<sm-node-counter>` renderer and `<sm-severity-palette>` updated to the same glyphs; severity-tinted icons softened to opacity 0.85 in graph-card density.

**SPA list view**

- `/list` route re-enabled in the topbar (was a `(coming soon)` placeholder).
- Redesigned table: Kind, Name, Tags, Path, Tokens, Stability, Stale, Issues.
  - Tag chips column with author / user variants and `+N` overflow (tooltip lists the hidden tags).
  - Tokens column with compact `12k` formatting + raw-value sort.
  - Stale column (icon-only, sidecar drift, severity-tinted clock + per-row tooltip).
  - Issues column with the new PI glyphs + tabular count, no chip background, opacity 0.65 so the chrome stays quiet at table density.
  - Typography normalised behind six `--list-fs-*` tokens.
  - Sort icons hidden until column hover / keyboard focus / active sort.
- `<sm-filter-bar>` inputs and toggles switched to `size="small"` so they match the table density (applies in the graph view too).
- `FilterStoreService.nodeHasIssues` now considers a node "having issues" when the scan attached any error/warn issue to it, not just when it is deprecated or superseded. Same `severityCtx` the `apply()` chain already gets is threaded into the predicate, so the broad `Has issues` toggle returns a useful set instead of the historical near-empty one.

## User-facing

**List view** is live. Click **List** in the topbar for a sortable, filterable table of every node (Kind, Name, Tags, Path, Tokens, Stability, Stale, Issues). Click a row to inspect on the graph. Graph card chips now share the same icons as the list.
