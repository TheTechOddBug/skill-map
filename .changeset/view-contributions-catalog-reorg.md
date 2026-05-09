---
"@skill-map/spec": minor
---

view contribution catalog reorg + `node-counter` narrowing + `priority` field. Pre-1.0 minor per `spec/versioning.md`; covers what would otherwise be a catalog-major bump.

**Slot rename to `surface.location.name` pattern** — `card.chip` → `card.footer.left`, `inspector.body` → `inspector.body.panel`, `topbar.indicator` → `topbar.actions.indicator`, `graph.node.marker` → `graph.node.alert`. `inspector.header.badge` already conformed. The closed slot enum stays the same shape (5 entries) but every id now self-describes its surface and position; mounts in the UI moved to match where ambiguous (e.g. `card.footer.left` now lives inside `.sm-gnode__footer` next to the hardcoded stats, the position the new name promises).

**Contract rename to `<scope>-<form>` pattern** — the catalog drops the `per-` prefix on per-node entries and tightens semantics on two: `per-node-counter` → `node-counter`, `per-node-tag` → `node-tag`, `per-node-breakdown` → `node-breakdown`, `per-node-records` → `node-records`, `per-node-tree` → `node-tree`, `per-node-key-values` → `node-key-values`, `per-node-link-list` → `node-link-list`, `per-node-summary` → `node-markdown` (semantic narrowing — was always the LLM-style markdown text, name now says so), `node-marker` → `node-alert`, `scope-summary` → `scope-stat`. Catalog size unchanged (still 10 contracts). `spec/view-contracts.md`, the per-contract payload schemas in `spec/schemas/view-contracts.schema.json`, the prose references in `spec/architecture.md` and `spec/plugin-author-guide.md` all renamed in lockstep.

**`node-counter` contract narrowed** — payload is now `{ value, severity?, tooltip? }`; the inline `label` is gone (manifest `label` is metadata only — used by docs / `sm plugins doctor` and as `aria-label` for screen readers). `icon` is now REQUIRED on the manifest declaration via JSON-Schema `if/then` on `contract === 'node-counter'`. Renderers align with the host card's stat row (icon + value, no separate label line).

**New `priority` field on `IViewContribution`** — optional number, default 100. Slots configured with `order: 'priority'` sort contributions ASC by this value with alphabetical tie-break by qualified id. Plugins use it to suggest where their contribution belongs relative to others sharing the same slot; the slot has the final say (it can keep `'alphabetical'` / `'fifo'` ordering and ignore the field). Kernel publishes the value through `IRegisteredViewContribution.priority` so the UI can pick it up at lookup time.

**Pre-1.0 breaking note**: every plugin manifest authored against the v1 catalog needs the contract / slot ids retyped, plus `icon` if it declared a `node-counter`. `sm plugins upgrade` is the structural migration verb; no automatic rename rules are registered (the renames are mechanical search-and-replace).
