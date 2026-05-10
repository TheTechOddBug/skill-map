---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Eliminate the view-contribution `contract` abstraction — plugin authors now pick `slot` directly.

The previous model exposed two layers to the plugin author: a closed catalog of 11 "contracts" (`node-counter`, `node-tag`, `node-breakdown`, ...) plus an internal UI map from contract → N compatible slots. Picking a contract caused the same data to render in EVERY compatible slot (e.g. `node-counter` broadcast to four surfaces simultaneously). The 2026-05-10 collapse drops the contract layer: the plugin author picks ONE slot from a closed catalog of 14 slots; the slot fixes both the renderer and the payload shape; nothing renders implicitly. Smaller mental model, no surprise duplication, slot ids that map 1:1 to a payload.

**Spec changes** (`@skill-map/spec`):

- `spec/schemas/view-contracts.schema.json` renamed to `spec/schemas/view-slots.schema.json`. `$defs.ContractName` (11-entry closed enum) replaced by `$defs.SlotName` (14-entry closed enum). `$defs.IViewContribution.contract` field renamed to `slot`. `$defs.payloads` re-keyed by slot id; slots that share a payload shape (`card.subtitle.left`, `card.footer.right`, `card.footer.left.counter`, `inspector.header.badge.counter` all use the counter shape) `$ref` a shared internal definition. The conditional `allOf` discriminators that mandated `icon` on `node-counter` and `node-icon` now mandate `icon` on every counter slot and on `card.title.right`.
- The three previously-polymorphic slots are split via dotted suffix:
  - `card.footer.left` → `card.footer.left.counter` (single sub-slot — the `card.footer.left.tag` sub-slot was considered and dropped: the counter sub-slot is multi-element, no built-in adopter wanted a tag here, and the `inspector.header.badge.tag` slot covers the remaining tag-shaped use case)
  - `inspector.header.badge` → `inspector.header.badge.counter`, `inspector.header.badge.tag`
  - `inspector.body.panel` → `inspector.body.panel.breakdown`, `.records`, `.tree`, `.key-values`, `.link-list`, `.markdown` (one per shape, narrative order in the inspector body)
- The five monomorphic slots (`card.title.right`, `card.subtitle.left`, `card.footer.right`, `graph.node.alert`, `topbar.actions.indicator`) keep their ids unchanged.
- `spec/view-contracts.md` renamed to `spec/view-slots.md` and rewritten as a 14-slot catalog (one section per slot: payload shape, manifest declaration, emit example, where it renders).
- `spec/architecture.md` § View contribution system: rewritten to reflect the two-layer model. The "Plugin author NEVER picks a slot" guidance is inverted; the comparison table's "Plugin author writes" row now says "`slot` name from a closed catalog"; the "Surfaces in" row now says "fixed renderer per slot, mounted at exactly the slot the author declared".
- `spec/plugin-author-guide.md` § View contributions: rewritten tutorial. Manifest example uses `slot:`; the slot-catalog table replaces the contract-catalog table; new "Multi-slot rendering" sub-section explains that the same data in two surfaces requires two declarations (intentional).
- `spec/db-schema.md` § `scan_contributions`: column `contract TEXT NOT NULL` renamed to `slot TEXT NOT NULL`; comment now references `view-slots.schema.json#/$defs/SlotName`.
- `spec/schemas/extensions/base.schema.json`, `spec/schemas/api/rest-envelope.schema.json`, `spec/schemas/plugins-registry.schema.json`: `contract` field references swept to `slot`; doc strings re-pointed at `view-slots.schema.json`. `contributionsRegistry` envelope entries now carry `slot` (not `contract`).
- `spec/conformance/coverage.md` row 30 re-pointed at `view-slots.schema.json` and the renamed conformance case.

**Implementation changes** (`@skill-map/cli`):

- `src/kernel/types/view-catalog.ts`: `TContractName` (11 entries) renamed to `TSlotName` (14 entries). `IViewContribution.contract` and `IRegisteredViewContribution.contract` renamed to `slot`.
- `src/kernel/orchestrator.ts`: extractor + rule emit paths read `declared.slot`, validate via `validateContributionPayload(declared.slot, payload)`, persist with `slot:` field. Also threads a new `freshlyRunTuples` set down through `walkAndExtract` → `runScanInternal` → caller (see Persistence-fix block below).
- `src/kernel/adapters/schema-validators.ts`: `SUPPORTING_SCHEMAS` reads `view-slots.schema.json`. `validateContributionPayload(slot, payload)` keys validators by slot id (14 keys); error code renamed from `'unknown-contract'` to `'unknown-slot'`. The validator filters out internal `$ref` targets (`_counter`, `_tag`, `_TreeNode`) so they cannot be queried by accident.
- `src/migrations/001_initial.sql`: `scan_contributions.contract` column renamed to `slot`. No migration script — pre-1.0 greenfield, fixtures purge on next scan.
- `src/kernel/adapters/sqlite/contributions.ts`, `src/kernel/adapters/sqlite/schema.ts`: field rename in record types and SQL queries.
- `src/built-in-plugins/extractors/external-url-counter/index.ts`: `contract: 'node-counter'` → `slot: 'card.footer.right'`.
- `src/built-in-plugins/extractors/at-directive/index.ts`: `contract: 'node-counter'` → `slot: 'card.footer.left.counter'`.
- `src/built-in-plugins/rules/link-counts/index.ts`: `linksOut.contract` → `slot: 'card.footer.right'`; `linksIn.contract` → `slot: 'card.footer.left.counter'`.
- `src/built-in-plugins/rules/unknown-contract/` renamed (via `git mv`) to `src/built-in-plugins/rules/unknown-slot/`. Export `unknownContractRule` → `unknownSlotRule`. Internal id `'unknown-contract'` → `'unknown-slot'`. Message "declares unknown contract" → "declares unknown slot". `KNOWN_CONTRACTS` set replaced by `KNOWN_SLOTS` (14 entries).
- `src/built-in-plugins/rules/link-counts/index.ts`: rule paused — view-contributions block stripped, `evaluate()` is now a no-op `return []`. The `linksOut` chip duplicated the per-extractor counters living next to it (`@N` from at-directive, `📎N` from markdown-link, `/N` from slash); `linksIn` was unique but kept here for symmetry. Rule remains registered (no-op) so re-enabling is a single-file change.
- `src/built-in-plugins/extractors/markdown-link/index.ts`, `src/built-in-plugins/extractors/slash/index.ts`: gain a `card.footer.left.counter` view contribution each (`📎N` and `/N` chips), aligning with `at-directive`'s existing `@N` chip and removing the rationale for the paused `link-counts` `linksOut`.
- `src/built-in-plugins/built-ins.ts`: import path updated.
- `src/cli/commands/plugins.ts`: `VIEW_CONTRACTS_CATALOG` (11 entries) renamed to `VIEW_SLOTS_CATALOG` (14 entries with summaries derived from `view-slots.md`). `PluginsContractsListCommand` renamed to `PluginsSlotsListCommand`; verb path `['plugins', 'contracts', 'list']` → `['plugins', 'slots', 'list']`. `PluginsCreateCommand` scaffolder emits manifest stubs with `slot:` (default `card.footer.left.counter`); help text and tip lines now reference `sm plugins slots list`. `plugins show` qualifies extension names with `<bundleId>/<extensionId>` for `granularity=extension` so shadowed siblings stay distinguishable in the listing.
- `src/server/contributions-registry.ts`, `src/server/routes/contributions.ts`, `src/server/envelope.ts`: registry entries and lookup items use `slot:` field.
- `src/core/runtime/plugin-runtime.ts`: `collectViewContributions` reads `entry.slot` and pushes `slot: entry.slot as TSlotName`.
- `context/cli-reference.md` regenerated to absorb the verb rename.

**Persistence fix — per-tuple sweep on `scan_contributions`** (`@skill-map/cli`):

The pre-fix persist layer ran three passes (orphan → catalog → upsert) keyed at the `(plugin, extension, node, contributionId)` level, and that wasn't enough to catch the case "extractor used to emit for node X, body change removes the trigger, prior row stays stale". A 4th pass — a per-tuple sweep keyed by `(pluginId, extensionId, nodePath)` — now drops rows whose key is absent from the current scan's contribution buffer, but ONLY for tuples that actually ran this scan.

- `src/kernel/types/storage.ts`: `IPersistOptions` gains an optional `freshlyRunTuples?: ReadonlySet<string>` field (format `<pluginId>/<extensionId>/<nodePath>`). Empty / absent set = no per-tuple sweep (legacy callers preserve the pre-fix behaviour where stale rows linger).
- `src/kernel/orchestrator.ts`: `walkAndExtract` accumulates a `freshlyRunTuples: Set<string>`. Extractor + cache miss → tuple INCLUDED. Extractor + cache hit → tuple OMITTED (prior rows must survive). After `applyRules`, `runScanInternal` folds in `(rule × node)` for every rule that declares `viewContributions` (rules always run and see the full graph, no per-(rule, node) cache like extractors have). The set is returned alongside `contributions` and threaded into the persist call.
- `src/kernel/adapters/sqlite/contributions.ts` + `src/kernel/adapters/sqlite/scan-persistence.ts` + `src/kernel/adapters/sqlite/storage-adapter.ts`: persist accepts the set, runs the sweep DELETE before the upsert, scoped to keys whose `(plugin, extension, node)` is in the set but whose `(plugin, extension, node, contributionId)` is NOT in the buffer. Cached-extractor tuples remain absent from the set, so their rows are untouched.
- `src/core/runtime/scan-runner.ts` + `src/core/watcher/runtime.ts`: thread `freshlyRunTuples` from the orchestrator return into the persist call.
- Backwards-compat: the field is optional. The persist layer treats an absent / empty set as "skip the sweep", matching pre-fix behaviour bit-for-bit.

**UI changes** (private `ui/` workspace, ships bundled in `@skill-map/cli`):

- `ui/src/app/contracts/contract-renderer-map.ts` renamed (via `git mv`) to `ui/src/app/slots/slot-renderer-map.ts`. The `CONTRACT_RENDERERS` + `CONTRACT_SLOTS` two-map structure is replaced by a single `SLOT_RENDERERS: Record<TSlotId, ComponentType>` (14 entries, 1:1 slot → renderer); `isKnownContract` renamed to `isKnownSlot`.
- `ui/src/app/slots/slot-config.ts`: `TSlotId` union expanded to 14 entries; `SLOT_REGISTRY` rebuilt with sub-slots inheriting `maxItems` / `order` / `respectSeverity` from their former polymorphic parent.
- `ui/src/app/slots/icon-glyph.ts` (new): tiny shared `<sm-icon-glyph>` component that resolves a manifest-declared `icon` per spec (`Extended_Pictographic` → emoji text; otherwise → `<i class="pi pi-{icon}">`). Adopted by `node-counter`, `node-alert`, `node-icon`, `scope-stat` — fixes the regression where `arrow-up` rendered as the literal three-character string instead of the PrimeIcons class.
- `ui/src/app/components/view-contributions-host/view-contributions-host.ts`: dispatch simplified — `contractMatchesSlot(c.contract, slot)` replaced by `c.slot === slot`; renderer lookup is `SLOT_RENDERERS[slot]`.
- `ui/src/models/api.ts`: `IContributionApi.contract` and `IContributionsRegistryEntryApi.contract` renamed to `slot`.
- HTML templates: the polymorphic mounts split into per-shape hosts. `node-card.html` mounts `card.footer.left.counter` (single sub-slot, no `.tag`). `inspector-view.html` mounts `inspector.header.badge.counter` + `.tag` adjacent and the six `inspector.body.panel.*` sub-slots stacked in narrative order (breakdown → records → tree → key-values → link-list → markdown). `graph-view.html`, `app.html`, and the monomorphic mounts are unchanged.
- `ui/src/app/debug-slots.css`: 10 new entries for the sub-slots (varied hue tones for visual distinction); 3 obsolete entries removed.
- 11 renderer components had their `IRendererInputs` import path updated to the new `slots/slot-renderer-map`; doc strings refreshed.

**Tests**:

- `src/test/view-contributions.test.ts`: helper interfaces and fixtures swapped to `slot:`. Validation tests now call `validateContributionPayload(<slot-id>, ...)`. Negative test "rejects unknown contract names" renamed to "rejects unknown slot names" with assertion `result.errors === 'unknown-slot'`.
- `src/test/server-annotations-endpoint.test.ts`, `src/test/server-sidecar-endpoint.test.ts`: schema path strings updated.
- `src/test/plugin-runtime-branches.test.ts`: rule-id list assertion updated (`'unknown-contract'` → `'unknown-slot'`).
- `src/built-in-plugins/rules/link-counts/link-counts.test.ts`: manifest assertions reflect the new slot ids.

**Breaking** (per the pre-1.0 minor convention — see `CONTRIBUTING.md` / `spec/versioning.md` §Pre-1.0):

- Plugin manifests declaring `viewContributions[*].contract: 'node-counter'` (or any of the other 10 contract names) now load as `invalid-manifest`. Migration is mechanical: rename the field to `slot` and pick one of the 14 slot ids that matches the prior contract's payload shape. Recommended mapping: `node-counter` → `card.footer.right` (or another counter slot), `node-tag` → `inspector.header.badge.tag` (the only tag slot in the catalog now), `node-breakdown/records/tree/key-values/link-list/markdown` → `inspector.body.panel.<shape>`, `node-alert` → `graph.node.alert`, `node-icon` → `card.title.right`, `scope-stat` → `topbar.actions.indicator`.
- The CLI verb `sm plugins contracts list` is removed and replaced by `sm plugins slots list`.
- The built-in soft-warning rule `core/unknown-contract` is removed and replaced by `core/unknown-slot` (same semantics, slot-keyed walk).
- The database column `scan_contributions.contract` is renamed to `slot`. No migration script ships — purge fixture DBs and re-run `sm scan` after upgrading. The pre-1.0 greenfield posture (no schema versioning) holds.

## User-facing

**The view-contribution model is simpler.** Plugin authors now pick **one slot** from a closed catalog of 14; the slot decides where the data renders, what payload shape is expected, and which renderer draws it. The previous model required learning two catalogs (contracts and slots) and accepted that the same data would broadcast to multiple surfaces automatically — that broadcast is gone.

Visible changes in the SPA:

- The URL-counter chip from `core/external-url-counter` now renders only in the card's footer-right cluster (was visible in four surfaces simultaneously).
- The `@-mention` chip from `core/at-directive`, plus new `📎` (markdown links) and `/` (slash directives) counter chips from `core/markdown-link` and `core/slash`, render only in the card's footer-left cluster.
- The `core/link-counts` rule is paused — its `linksOut` / `linksIn` chips are temporarily off the card. `linksOut` duplicated the new per-extractor counters; `linksIn` will return when the chip surface is reinstated. The rule stays registered as a no-op so re-enabling is a single-file change.
- The CLI verb to browse the catalog is now `sm plugins slots list` (was `sm plugins contracts list`).
- **Stale view contributions are cleaned up.** Editing a node so an extractor stops emitting a chip (e.g. removing the last `@mention` from a doc) now removes the chip on the next scan. Previously the chip would linger until the row was clobbered by an unrelated edit.
- Renderer icons resolve correctly across emoji and PrimeIcons names (an icon like `arrow-up` no longer leaks as the literal three-character string when the renderer expected a class name).
