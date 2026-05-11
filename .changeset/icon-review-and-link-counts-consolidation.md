---
"@skill-map/cli": minor
---

Consolidate the card-footer link counters into a single `core/link-counts` pair and run a top-to-bottom icon-review pass across the topbar, the graph card, and the alert / chip surfaces of `broken-ref` + `unknown-field` + `stability`. Greenfield: no `catalogCompat` bump, no migration shim — the manifest catalog of built-in view contributions changes shape (three extractor chips drop, two analyzer chips appear, two analyzer payloads change) and no released external plugin keys off these IDs.

**Built-in view contributions — kernel side**

- `core/link-counts` (analyzer) — was a no-op placeholder; now the exclusive owner of `card.footer.left` link counters. Emits two contributions per node:
  - `linksIn` (`pi-arrow-up`) — every `Link.target === node.path`, grouped by `Link.kind`.
  - `linksOut` (`pi-arrow-down`) — every `Link.source === node.path`, same per-kind grouping.

  Both chips ship a multi-line tooltip with a direction header line so each chip is self-identifying when only one of the pair is visible:

  ```
  in
  invokes: 2
  mentions: 1
  references: 3
  ```

  Helpers `bump`, `emitChip`, and `formatBreakdown` factor the shared tally / render logic. Caps at `value: 99` to match the `_counter` slot ceiling; the raw count survives in the tooltip. `emitWhenEmpty: false` on both, so silent nodes stay quiet.

- `core/slash`, `core/at-directive`, `core/markdown-link` (extractors) — entire `viewContributions` block + the matching `ctx.emitContribution('count', ...)` call removed. The three per-extractor chips that used to render side-by-side on `card.footer.left` (`/`, `@`, `📎` with the unified `pi-arrow-down` glyph) were noisy in aggregate; `core/link-counts` now expresses the same information as a single `↑ N` / `↓ N` pair with the per-kind breakdown one hover away.

- `core/broken-ref` (analyzer) — icon + severity overhaul:
  - Alert (`graph.node.alert`): `pi-times-circle` → `fa-solid fa-circle-xmark` (filled, attention-grabbing); severity `warn` → `danger`; payload no longer carries `count` — the corner alert is icon-only and the chip below covers the number.
  - Chip (`card.footer.right`): `pi-times-circle` → `fa-regular fa-circle-xmark` (outlined, pairs with the count); severity `warn` → `danger`.

  The filled-vs-outlined split keeps the corner alert visually distinct from the footer chip even though both originate from the same analyzer.

- `core/unknown-field` (analyzer) — icon + payload overhaul:
  - Alert (`graph.node.alert`): `pi-info-circle` → `fa-solid fa-triangle-exclamation` (matches the broken-ref "solid alert" pattern); payload no longer carries `count` (icon-only corner).
  - Chip (`card.footer.right`): `pi-info-circle` → `pi-question-circle`; chip now emits `value: 0` so NodeCounter renders icon-only, and the manifest flips `emitWhenEmpty: false` → `emitWhenEmpty: true` (the slot would otherwise treat `value: 0` as empty and drop the emission). The glyph weight now matches `annotation-stale`'s `pi-clock` chip sitting next to it on the same footer row.

- `core/stability` (extractor) — `experimental` icon `pi-bolt` → `fa-solid fa-flask` (matches the "experimental" metaphor); `deprecated` stays `pi-ban`.

- `src/test/server-endpoints.test.ts` — `bootWithDisabledBuiltIns` flips its disabled built-in from `core/at-directive` (which no longer carries a view contribution) to `core/tools-count`; the matching assertion checks `core/tools-count/count` in `contributionsRegistry`.

**UI side — slot model + renderer + shell**

- `ui/src/app/slots/slot-config.ts` — new `order: 'severity'` mode and new `showOverflowBadge?: boolean` flag on `ISlotConfig`. `graph.node.alert` is now `{ maxItems: 1, order: 'severity', showOverflowBadge: false }`: the worst severity claims the corner and the rest are suppressed silently (no `+N` badge — the corner is a single decoration by design). The severity rank is `danger > warn > info > success`, tie-breaks alphabetically.
- `ui/src/app/components/view-contributions-host/view-contributions-host.ts` — new `severityRank` helper + `severity` branch in `sortBySlotOrder`; template guard `&& showOverflowBadge()` on the `+N` badge with a matching `showOverflowBadge` computed driven by the slot registry.
- `ui/src/app/renderers/node-alert/node-alert.ts` — `.vc-alert` font-size `0.7rem` → `0.85rem`, `min-width / -height` `1rem` → `1.1rem` so the corner badge reads at a more legible size now that it is the sole decoration on the corner.

**UI side — topbar + cards**

- `ui/src/app/app.html` + `app.ts` + `app.css` — topbar icon sweep: update chip uses `pi pi-download`; nav-search uses `pi pi-search`; scan trigger uses `pi pi-sync` (with `pi-spin` while a scan runs); settings trigger uses `pi pi-sliders-h`. Theme switcher: `light` → `pi pi-sun`, `auto` → `pi pi-desktop`, `dark` stays `fa-regular fa-moon`. The update chip's padding is rebalanced to `3px 8px` (symmetric) with a 1px `translateY` nudge on the inner `<i>` to compensate for PrimeIcons' asymmetric metrics. New `.shell__nav-disabled` style for the List nav, which is converted from `<a routerLink>` to `<button disabled>` (the route stays reachable from the URL bar; only the nav surface is gated until the page is feature-complete).
- `ui/src/styles.css` — `--sm-severity-warn` (light theme) `#92400e` → `#ca8a04` (yellow-600). Reads as gold rather than brown-red so warnings register as yellow against the new `danger` red used by broken-ref.
- `ui/src/i18n/app.texts.ts` — `graphInfo` tooltip prepends `Run scan\n` so the scan trigger's tooltip names the action on top with the scope stats underneath; new `listLabel` / `listTooltip` for the disabled List nav.
- `ui/src/app/views/graph-view/graph-view.html` — empty-state icons migrated to FontAwesome: loading `fa-spinner fa-spin`, error `fa-circle-exclamation`, filtered `fa-filter-circle-xmark`; toolbar reset-layout `pi-refresh` → `pi pi-history`.
- `ui/src/app/components/node-card/node-card.html` — path icon `pi-folder-open` → `fa-regular fa-folder-open`; error stat `pi-times-circle` → `fa-solid fa-circle-xmark`; warn stat `pi-exclamation-triangle` → `fa-solid fa-triangle-exclamation`. Favorite button stays as `pi-star-fill` / `pi-star`.
- `ui/src/app/components/node-card/node-card.css` — favorite repositioned via `top: -3px` so it sits closer to the chevron above; path styling adds `unicode-bidi: plaintext` alongside the existing `direction: rtl` so the start-side ellipsis still wins but the bidi algorithm no longer reorders neutral characters (the "trailing period" artifact after `.md` is gone).

**Why one commit**

The UI's `order: 'severity'` + `showOverflowBadge: false` on `graph.node.alert` and the analyzers' new corner-only icon-only payloads are one contract: shipping them split puts either the UI ahead of the kernel (the corner would show two icons with `+1` for a beat) or the kernel ahead of the UI (the suppressed alerts would surface as `+N` clutter). Same logic for the link-counts consolidation: dropping the three extractor chips before the analyzer reinstates the pair would leave nodes with zero left-footer counters for a window.

**Verification**

- `npm test` in `src/` → 1336 / 1337 pass. The one failure is the pre-existing flaky `scan-benchmark.test.ts` (timing-sensitive, unrelated).
- `npx tsc --noEmit -p tsconfig.app.json` in `ui/` → exit 0.

## User-facing

Footer link counters now read as a single in/out arrow pair (`↑` incoming, `↓` outgoing) with a per-kind tooltip; broken-reference corner alerts and counts read as red, unknown-field alerts get a clearer warning triangle. Topbar and card icons sharpened across the UI.
