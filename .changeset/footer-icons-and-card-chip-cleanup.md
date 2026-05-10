---
"@skill-map/cli": patch
---

Unify footer-chip icons across the three outgoing-reference extractors and remove three legacy hardcoded chips from the card now that the per-extension view contributions cover them.

**Footer icons unified (built-in extractors)**

- `core/external-url-counter` (`card.footer.right`): icon `🔗` (emoji) → `'link'` (PrimeIcons `pi-link`), matching the legacy hardcoded `pi-link` chip it now replaces in the card footer.
- `core/at-directive`, `core/markdown-link`, `core/slash` (all `card.footer.left`): icons `'@'` / `'📎'` / `'/'` → `'arrow-down'` (PrimeIcons `pi-arrow-down`). All three are outgoing references from the node; the shared glyph clusters the left-footer visually as a single "out-counts" cluster. The manifest `label` (`mentions` / `links` / `commands`) still distinguishes them at the tooltip / a11y layer.

**Renderer plumbing fixes**

- `ui/src/app/slots/icon-glyph.ts`: `<i>` and `<span>` are forced to `font-size: inherit; line-height: inherit` so the wrapper's font-size reaches the glyph regardless of branch. The `<i>` branch also gets `transform: translateY(1px)` to compensate PrimeIcons' asymmetric metrics — mirrors the legacy `.sm-gnode__stat i` rule the renderer used to inherit before the slot model.
- `ui/src/app/renderers/node-counter/node-counter.ts`: wraps `<sm-icon-glyph>` in a `<span class="vc-counter__icon">` so the font-size rule lives in NodeCounter's own template and reaches the icon via inheritance, not via cross-component encapsulation boundaries.
- `ui/src/app/components/view-contributions-host/view-contributions-host.ts`: gap `0.25rem` → `0.7rem`, consistent with `.sm-gnode__footer { gap: 0.7rem }` so the new chip cluster sits at the same rhythm as the legacy footer.

**Legacy chips removed from `node-card`**

`node-card.html` / `.ts` / `.spec.ts` / `i18n/node-card.texts.ts` drop three hardcoded chips:

- `linksIn` chip (`pi-arrow-down`) — was driven by the (currently paused) `core/link-counts` analyzer; will return through the view-contribution slot when the analyzer is reactivated.
- `linksOut` chip (`pi-arrow-up`) — same story; the new per-extractor counters (`at-directive`, `markdown-link`, `slash`) already cover outgoing references via plugin-emitted chips.
- `externalRefsCount` chip (`pi-link`) — fully replaced by `core/external-url-counter` rendering in `card.footer.right`, with the unified `pi-link` glyph above.

Three spec tests dropped; 318 → 315 UI tests, all green.

**Debug-slot visualizer (dev only)**

`ui/src/app/debug-slots.css` now draws a per-contribution outline (color rotates via `:nth-child(4n+1..4)`) with a label tile above each chip showing the slot's `data-testid`. Uses `outline` (not `border`/`padding`/`margin`) so toggling debug does not shift layout. Only active when the URL has `?debug=slots`.

**Graph-view defensive overrides**

`ui/src/app/views/graph-view/graph-view.css` adds `--ff-connection-drag-handle-fill: transparent`, `--ff-connector-accent-color: transparent`, plus scoped `::ng-deep` rules to force `background`/`border-color`/`box-shadow: transparent` on `.f-node-output:not(.f-node)` / `.f-node-input:not(.f-node)` and `fill: transparent; stroke: transparent` on `.f-connection-drag-handle`. The visible "connector circle" at the source endpoint persisted despite token overrides; the wholesale rule kills it without breaking Foblex's internal geometry.

## User-facing

The card footer is cleaner: the three outgoing counters (`@`-mentions, markdown links, `/`-commands) share a single `↓` arrow glyph on the left, and the URL counter keeps its link glyph on the right. Three legacy hardcoded chips (in / out links, external URLs) were removed.
