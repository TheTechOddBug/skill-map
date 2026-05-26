# View slots

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before touching the slot catalog, the renderer catalog, or `ctx.emitContribution`. Affects kernel, BFF, UI, and plugin manifests, the sections below say which.

## What this annex covers

The "Plugin UI Contributions Model" introduces two layers, **slot**, **contribution**, for plugins to surface per-node data in the UI without shipping any UI code. Design narrative + decision table live in `ROADMAP.md` § "UI contribution system". The normative spec is split between `spec/view-slots.md` (slot catalog), `spec/input-types.md` (settings catalog), `spec/architecture.md` § "View contribution system" (kernel surface), and `spec/plugin-author-guide.md` § "View contributions" (author tutorial).

This annex is the **agent-facing operating guide**: where each catalog lives, how to extend it safely, what the lint analyzers forbid, and which `data-testid`s the new components carry.

## Two layers, quick recap

| Layer | Owner | Lives in | Visible to plugin author? |
|---|---|---|---|
| **Slot** | Spec + kernel + UI (the catalog is normative) | `spec/schemas/view-slots.schema.json` (catalog enum + payload schemas), `src/kernel/types/view-catalog.ts` (`TSlotName` type), `ui/src/app/slots/slot-config.ts` (`SLOT_REGISTRY` layout config), `ui/src/app/slots/slot-renderer-map.ts` (`SLOT_RENDERERS` 1:1 map) | Yes, picked by name |
| **Contribution** | Plugin (per-node payload) | Emitted via `ctx.emitContribution(id, payload)`; persisted in `scan_contributions` | Yes, plugin authors emit |

The plugin author **picks a slot**. The slot fixes both the renderer (which Angular component draws) and the payload shape (what AJV validates at emit). There is no separate "contract" abstraction, the slot IS the contract.

## Slot catalog

15 slots, listed in `spec/schemas/view-slots.schema.json#/$defs/SlotName` and mirrored in `src/kernel/types/view-catalog.ts#TSlotName`. To add a new slot:

1. **Spec first** (per `AGENTS.md`): add the slot id to the closed enum in `view-slots.schema.json`, add a `$defs.payloads.<slot>` schema (or `$ref` to a shared shape), regenerate `spec/index.json`.
2. Mirror the type in `src/kernel/types/view-catalog.ts#TSlotName`.
3. UI: add an entry to `SLOT_REGISTRY` in `ui/src/app/slots/slot-config.ts` with `cardinality`, `maxItems`, `order`, `strategy`. Add the slot id to the `TSlotId` union (mirrors the kernel type). Add the renderer mapping in `slot-renderer-map.ts#SLOT_RENDERERS`.
4. Mount `<sm-view-contributions-host slot="<new-id>" ...>` in the relevant template (inspector / card / graph / topbar).
5. Document in this annex's table and in `spec/view-slots.md`.

| Slot id | Renderer | Mounted in |
|---|---|---|
| `card.title.right` | NodeIcon | `node-card.html` (right of title) |
| `card.subtitle.left` | NodeCounter | `node-card.html` (subtitle row, left) |
| `card.footer.left` | NodeCounter | `node-card.html` (footer left cluster) |
| `card.footer.right` | NodeCounter | `node-card.html` (footer right cluster) |
| `graph.node.alert` | NodeAlert | `graph-view.html` (corner badge inside `[fNode]`). **Reserved**: catalog keeps the surface available for special-case signals, NO built-in core analyzer emits here. Routine "this node has a problem" findings (`reference-broken`, `annotation-field-unknown`, `schema-violation`) ship as chips on `card.footer.right` instead. See the policy note on the slot entry in `ui/src/app/slots/slot-config.ts`. |
| `inspector.header.badge.counter` | NodeCounter | `inspector-view.html` (badge row under title) |
| `inspector.header.badge.tag` | NodeTag | `inspector-view.html` (badge row, adjacent to counter sub-slot) |
| `inspector.body.panel.breakdown` | NodeBreakdown | `inspector-view.html` (body panel) |
| `inspector.body.panel.records` | NodeRecords | `inspector-view.html` (body panel) |
| `inspector.body.panel.tree` | NodeTree | `inspector-view.html` (body panel) |
| `inspector.body.panel.key-values` | NodeKeyValues | `inspector-view.html` (body panel) |
| `inspector.body.panel.link-list` | NodeLinkList | `inspector-view.html` (body panel) |
| `inspector.body.panel.markdown` | NodeMarkdown | `inspector-view.html` (body panel) |
| `topbar.nav.start` | ScopeStat | `app.html` (topbar) |

Default order across the catalog (when `SLOT_REGISTRY[slot].order === 'alphabetical'`): `pluginId` ASC → `extensionId` ASC → `contributionId` ASC. Deterministic. Slots with `order: 'priority'` sort by the manifest-declared `priority` (default 100) with alphabetical tie-break.

`strategy: 'replace-with-warning'` is opt-in by the kernel/UI per slot, never by the plugin. When two plugins compete for a single-cardinality slot: last-load-wins; emit one console warning per slot per scan AND surface in the UI plugin-doctor dialog.

## Renderer catalog

One Angular component per slot under `ui/src/app/renderers/<renderer-id>/`. The renderer id is the historical name of the visual primitive (e.g. `node-counter`, `node-tag`); multiple slots may bind to the same renderer (NodeCounter is reused across `card.subtitle.left`, `card.footer.right`, `card.footer.left`, and `inspector.header.badge.counter`). Mapping lives in `ui/src/app/slots/slot-renderer-map.ts`:

```ts
export const SLOT_RENDERERS: Record<TSlotId, ComponentType> = {
  'card.title.right':                NodeIcon,
  'card.subtitle.left':              NodeCounter,
  'card.footer.left':        NodeCounter,
  'card.footer.right':               NodeCounter,
  'graph.node.alert':                NodeAlert,
  'inspector.header.badge.counter':  NodeCounter,
  'inspector.header.badge.tag':      NodeTag,
  'inspector.body.panel.breakdown':  NodeBreakdown,
  'inspector.body.panel.records':    NodeRecords,
  'inspector.body.panel.tree':       NodeTree,
  'inspector.body.panel.key-values': NodeKeyValues,
  'inspector.body.panel.link-list':  NodeLinkList,
  'inspector.body.panel.markdown':   NodeMarkdown,
  'topbar.nav.start':        ScopeStat,
};
```

The host (`view-contributions-host.ts`) filters `node.contributions[]` by `c.slot === thisSlot` and dispatches via `SLOT_RENDERERS[slot]`. No per-contract → multi-slot indirection, the slot is the routing key.

To add a new visual primitive (rare, discuss in ROADMAP first):

1. Spec change first (`spec/view-slots.md` + `spec/schemas/view-slots.schema.json`); regenerate `spec/index.json`.
2. Add the renderer component under `ui/src/app/renderers/<id>/`.
3. Add one or more slot entries to `TSlotName` (kernel) + `TSlotId` (UI) + `SLOT_REGISTRY` + `SLOT_RENDERERS`.
4. Mount the host in the appropriate template.
5. Add a conformance fixture under `spec/conformance/cases/`.
6. Update the scaffolder catalog (`VIEW_SLOTS_CATALOG` in `src/cli/commands/plugins/slots-catalog.ts`).

## Chip vs Issue, what counts and what only shows

Every analyzer that wants to surface a finding on the graph card has TWO independent channels:

- **`Issue`** (returned from `evaluate(ctx)`): a structured record with `severity: 'error' | 'warn' | 'info'`. Issues feed the card's **aggregated stat indicators** (`errorCount()` / `warnCount()` in `ui/src/app/components/node-card/node-card.ts`) and `sm scan` / `sm check` **exit codes** (`error` → exit 1, others → exit 0). `info` issues are tracked but neither displayed in the card's expanded issues list nor counted in the aggregated stats. They surface only in `sm show` / `sm check --json`.
- **View contribution** to `card.footer.right` (a chip): a payload with optional `severity: 'info' | 'success' | 'warn' | 'danger'`. The chip's `severity` controls only the **chip's own color**, never the aggregated count, never the exit code. A chip with `value: N` shows `N` next to its icon; a chip with `value: 0` renders icon-only.

The two channels are decoupled by design: an analyzer chooses what to emit on each independently. The 4 combinations and what they mean:

| Goal | Emit Issue? | Emit chip? | Issue severity | Chip severity | Visible in card |
|---|---|---|---|---|---|
| **Surface a problem AND count it** | yes | yes | `error` or `warn` | `danger` (matches `error`) or `warn` (matches `warn`) | Chip in footer + adds to the aggregated stat |
| **Show an attribute without counting** (e.g. `experimental` flag, `stale` marker) | no, or `info` | yes | `info` (or none) | `info` / `success` / none (neutral) | Chip in footer only, no stat impact |
| **Count without a dedicated chip** | yes | no | `error` or `warn` | — | Aggregated stat + entry in the expanded issues list |
| **No surface** | no | no | — | — | nothing |

### Color rule (chip color implies counting)

A chip MAY paint `warn` (yellow) or `danger` (red) **only when** the same analyzer also emits a matching Issue:

- chip `severity: 'danger'` → MUST emit at least one `Issue` with `severity: 'error'` for the same node
- chip `severity: 'warn'` → MUST emit at least one `Issue` with `severity: 'warn'` (or `'error'`) for the same node

A purely informational / decorative chip uses `severity: 'info'`, `'success'`, or omits the field (the renderer pick its neutral default). Concrete examples in the built-ins:

- `reference-broken` emits chip `danger` + Issue `error` per source node. Consistent (red chip, counts as error, escalates `sm scan` to exit 1).
- `node-stability` for `experimental` emits chip with no severity (neutral) + Issue `info`. Consistent (chip shows, nothing counts).
- `node-stability` for `deprecated` emits chip `warn` + Issue `warn`. Consistent (yellow chip, counts as warn, no exit-code impact).

The rule is enforced by code review only at present, the analyzer manifest doesn't carry a `severity` constraint cross-channel. If you author a new analyzer whose chip wants to read as "attention" without producing a finding, choose a neutral colour and use the tooltip for the explanatory text.

### Why the corner `graph.node.alert` slot is NOT in this matrix

The corner slot is **reserved** (see policy on the `graph.node.alert` table row above). No built-in core analyzer emits there, and the chip-vs-issue dual-channel decision does not apply: the corner is a single-decoration surface for genuinely independent signals, not a "this node has X findings" mirror. Routine findings always belong on the footer chip.

## Renderer attr-sanitization analyzer (LINT-ENFORCED)

Renderer components **MUST NOT** bind contribution data to:
- `[innerHTML]`
- `[style]` (object form or string form)
- `[src]` on `<img>`, `<iframe>`, `<script>`, `<embed>`, `<object>`
- `[href]` on `<a>` or `<link>`
- `[srcdoc]`
- `[formaction]`, `[action]`
- Any attribute Angular's `DomSanitizer` flags as `DANGEROUS_ATTR`

Use Angular's interpolation `{{ }}` (auto-sanitized text), `[textContent]`, `[attr.title]` (auto-sanitized), and `[attr.aria-*]`. For displaying user-provided URLs (e.g. `node-link-list`), pass through `Router.navigate` with the path as a route param, never emit raw `[href]` from contribution data.

**Why**: contribution data crosses the plugin/UI trust boundary. An emoji-named, alphabetic icon name from a plugin counter feels harmless until it's `<img src="x" onerror="...">` injected via `[innerHTML]`. Angular's interpolation sanitizes; the listed bindings do not.

The analyzer is enforced via `@angular-eslint/template/no-any` in `.eslintrc` for renderer-component templates. Adding a new renderer that needs one of these bindings → discuss in ROADMAP, do not bypass the lint.

## Isolation analyzers summary

(Full text in `ROADMAP.md` § "UI contribution system" → "Isolation".)

1. No raw DOM from plugin, typed data only.
2. CSS scoping by Angular view encapsulation; plugin doesn't write CSS.
3. Data path namespaced and BFF-enforced (`pluginId` ↔ namespace).
4. Click actions are typed kernel verb dispatches by qualified id.
5. AJV at three layers: manifest at load, payload at emit, envelope at BFF response.
6. Renderer attr-sanitization (see above).

Honest note (extends `spec/plugin-kv-api.md:194-200`): isolated against accidents, not hostile code, until worker-thread / iframe sandbox post-v1.0.

## `data-testid` convention for new components

Follows the existing repo convention (kebab-case, `<area>-<element>`):

| Component | testid |
|---|---|
| `<sm-view-contributions-host>` (slot host) | `view-contributions-host-<slot-id>` with dots replaced by dashes (e.g. `view-contributions-host-card-footer-left`) |
| `<sm-view-contributions>` (inspector body grouping panel) | `view-contributions` |
| Per-renderer root | `renderer-<renderer-id>` (e.g. `renderer-node-counter`) |
| Per-contribution rendered instance | `contribution-<plugin-id>-<extension-id>-<contribution-id>` (sanitized to kebab-case) |
| Empty placeholder | `<base>-empty` |
| Invalid placeholder | `<base>-invalid` |
| Overflow `+N` chip | `<base>-overflow` |

## Naming watchlist

Two existing components consume the word "contributions", DO NOT collide:

- `<sm-plugin-contributions>`, **existing**, surfaces sidecar root keys (annotation contributions). Lives at `ui/src/app/components/plugin-contributions/`.
- `<sm-view-contributions>`, surfaces view contributions in `inspector.body.panel.*` slots. Lives at `ui/src/app/components/view-contributions/`.
- `<sm-view-contributions-host>`, generic slot host that filters / sorts / dispatches per slot. Lives at `ui/src/app/components/view-contributions-host/`.

The two systems are independent: annotation contributions write to the sidecar `.sm` file; view contributions emit per-node payloads stored in `scan_contributions`. They share the "plugin contributes data, kernel exposes catalog, UI renders" pattern but never overlap in storage or routing.

## Persistence semantics, orphan + catalog sweep + upsert (NOT replace-all)

The `scan_contributions` table is **NOT pure replace-all** like `scan_links` / `scan_issues`. The watcher's cached pass leaves the contributions buffer empty for cached nodes (no `extract()` → no `emitContribution`); a wipe-all would silently drop their valid prior rows on every watcher boot. The persist runs three passes inside the same tx:

1. **Orphan sweep**, drop rows whose `node_path` is NOT in `livePaths` (derived from `result.nodes`).
2. **Catalog sweep**, drop rows whose qualified id is NOT in `registeredContributionKeys` (derived from `composed.extractors + composed.analyzers` via `collectRegisteredContributionKeys`).
3. **Upsert**, `INSERT ... ON CONFLICT DO UPDATE SET payload_json = excluded.payload_json, slot = excluded.slot` for every buffer row.

When extending the persist path:
- Pass `livePaths` and `registeredContributionKeys` to `IPersistOptions` so the sweeps activate. Absent / empty values fall back to legacy wipe-all (orphan) and skip-sweep (catalog).
- Don't add `replaceAllScanContributions(trx, [])` calls outside the sweep flow, empty buffer is the cached-pass case and wiping it is the bug we just fixed.

Full contract in [`spec/db-schema.md`](../spec/db-schema.md) §`scan_contributions`. Note: column is `slot TEXT NOT NULL` (mirrors `view-slots.schema.json#/$defs/SlotName`).

## SPA hydration paths

The collection-loader hydrates from `/api/scan` on F5 / cold boot, that endpoint MUST embed `contributions[]` per node alongside the standard fields, otherwise the inspector / card slot hosts have nothing to render until the next per-node fetch. The decoration is a single bulk `port.contributions.listForPaths(...)` round-trip after `scans.load()`. Bulk `/api/nodes` and single `/api/nodes/:pathB64` already embed via the route-level decorator; `/api/scan` joined the family explicitly.

Projection layer: `ui/src/services/collection-loader.ts:projectNode(api: INodeApi): INodeView` MUST copy `contributions` through. Forgetting to project drops the data silently, any new view-contribution-aware UI surface needs to verify the projection before debugging the host.

## Where the rest lives

| Concern | File |
|---|---|
| Design narrative | `ROADMAP.md` § "UI contribution system" |
| Decision table | Same section, "Decisions" subsection |
| Slot catalog (normative) | `spec/view-slots.md` + `spec/schemas/view-slots.schema.json` |
| Input-type catalog (normative) | `spec/input-types.md` |
| Kernel surface (normative) | `spec/architecture.md` § "View contribution system" |
| Persistence shape (normative) | `spec/db-schema.md` § `scan_contributions` |
| Author tutorial | `spec/plugin-author-guide.md` § "View contributions" |
| Slot kernel type | `src/kernel/types/view-catalog.ts` (`TSlotName`) |
| Slot UI layout config | `ui/src/app/slots/slot-config.ts` (`SLOT_REGISTRY`) |
| Slot → renderer map | `ui/src/app/slots/slot-renderer-map.ts` (`SLOT_RENDERERS`) |
| Storage table | `src/migrations/001_initial.sql` (`scan_contributions`) |
| BFF envelope | `src/server/envelope.ts` (`contributionsRegistry` field) |
| Scaffolder + verbs | `src/cli/commands/plugins/create.ts` (`PluginsCreateCommand`), `src/cli/commands/plugins/slots.ts` (`PluginsSlotsListCommand`), `src/cli/commands/plugins/slots-catalog.ts` (catalog constants) |
