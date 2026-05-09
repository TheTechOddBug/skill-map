---
"@skill-map/cli": minor
---

view contribution catalog reorg — kernel side + bundled UI debug toolkit. Pre-1.0 minor per `spec/versioning.md`; pairs with the matching `@skill-map/spec` minor that drives the rename.

**Kernel surface aligned** — `TContractName` / `IViewContribution` / `IRegisteredViewContribution` in `src/kernel/types/view-catalog.ts` follow the new `<scope>-<form>` names (`node-counter`, `node-tag`, `node-breakdown`, `node-records`, `node-tree`, `node-key-values`, `node-link-list`, `node-markdown`, `node-alert`, `scope-stat`). Optional `priority?: number` (default 100) added to both the manifest type and the registered projection so the UI can read the ordering hint at lookup time.

**Built-in plugin manifests updated** — `core/annotations` (`node-key-values`), `core/external-url-counter` (`node-counter` — re-declares `icon` per the new manifest requirement), `core/unknown-contract` rule (catalog references). `src/cli/commands/plugins.ts` (the `sm plugins create` scaffolder + `sm plugins contracts list` listing) prints the new names; `src/test/view-contributions.test.ts` covers the rename + the `node-counter` payload narrowing + `icon` required check + the priority field.

**UI bundled in this CLI release** (the `ui/` workspace ships inside `@skill-map/cli` per AGENTS.md):

- Renderer folders renamed in lockstep (`ui/src/app/renderers/<contract>`); slot host (`<sm-view-contributions-host>`) now strips `severity` from the forwarded payload when the slot declares `respectSeverity: false`, so the same contract can render tinted in one slot and neutral in another.
- `card.footer.left` slot (formerly `card.chip`) flips to `order: 'priority'` and remounts to live next to the hardcoded stat row in `node-card.html` — the position the new name describes.
- New corner anchor at the NE tip of every graph node card hosts the `graph.node.alert` slot (formerly `graph.node.marker`), with a placeholder lucide-style AlertTriangle SVG until a real plugin emits `node-alert`. `pointer-events: none` on the anchor so clicks fall through.
- Two new severity background tokens (`--sm-severity-info-bg`, `--sm-severity-success-bg`) round out the palette in light + dark.

**New debug toolkit** for the bundled UI (opt-in, off by default):

- `?debug-slots=1` — toggles a dashed outline + hover label on every slot mount via `DebugSlotsService`, persisted in localStorage so reloads keep the overlay. Uses `box-shadow` so toggling does not shift layout. Two slots (`graph.node.alert`, `topbar.actions.indicator`) gained their first real `<sm-view-contributions-host>` mount in this release; the overlay makes the empty state visible.
- `?debug-perf=1` — one-shot query override that forces the floating PerfHud on (`DebugPerfService`), no localStorage; falls back to `DEFAULT_SETTINGS.graph.perfHud` once the query is gone.
- `DemoContributionsService` — sprinkles synthetic `node-counter` / `node-tag` chips across nodes (empty / one / a few / overflow buckets by hash of `node.path`) and exposes a `lookup()` that returns synthetic registry entries with debug emoji icons (fire / lightning / sparkles / target / rocket / gem for counters; tag / bookmark / pin for tags). The contributions host consults it as a fallback when the real registry has no record, so demo data renders without a real plugin loaded.
