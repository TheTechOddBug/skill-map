# View contributions

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before touching the view contracts catalog, the slot catalog, the renderer catalog, or `ctx.emitContribution`. Affects kernel, BFF, UI, and plugin manifests — the sections below say which.

## What this annex covers

The "Plugin UI Contributions Model" introduces three layers — **slot**, **contract**, **contribution** — for plugins to surface per-node data in the UI without shipping any UI code. Design narrative + decision table live in `ROADMAP.md` § "UI contribution system". The normative spec is split between `spec/view-contracts.md` (contracts catalog), `spec/input-types.md` (settings catalog), `spec/architecture.md` § "View contribution system" (kernel surface), and `spec/plugin-author-guide.md` § "View contributions" (author tutorial).

This annex is the **agent-facing operating guide**: where each catalog lives, how to extend it safely, what the lint rules forbid, and which `data-testid`s the new components carry.

## Three layers — quick recap

| Layer | Owner | Lives in | Visible to plugin author? |
|---|---|---|---|
| **Slot** | UI driving adapter | `ui/src/app/slots/slot-config.ts` | No — kernel doesn't expose slots |
| **Contract** | Kernel | `spec/view-contracts.md` + `spec/schemas/view-contracts.schema.json` | Yes — picked by name |
| **Contribution** | Plugin (per-node payload) | Emitted via `ctx.emitContribution(id, payload)`; persisted in `scan_contributions` | Yes — plugin authors emit |

The plugin author **never** picks a slot. They pick a contract by name; the kernel exposes the contract catalog with input schemas; the UI maps `contract → slot(s) + renderer`.

## Slot catalog

The catalog is the **single source of truth** in `ui/src/app/slots/slot-config.ts`. To add a new slot:

1. Add an entry to `SLOT_REGISTRY: Record<TSlotId, ISlotConfig>` with `cardinality`, `maxItems`, `order`, `strategy`.
2. Add the slot id to the `TSlotId` union.
3. Mount `<sm-view-contributions-host slot="<new-id>" ...>` in the relevant template (inspector / card / graph view).
4. Update this annex's table.

| Slot id | Cardinality | maxItems | Order | Strategy | Mounted in |
|---|---|---|---|---|---|
| `card.chip` | multi | 5 | alphabetical | append | `node-card.html` (`.sm-gnode__tagrow`) |
| `inspector.body` | multi | 50 | alphabetical | append | `inspector-view.html` (parallel to `<sm-plugin-contributions>`) |
| `inspector.header.badge` | multi | 4 | alphabetical | append | `inspector-view.html` (badge row under title) |
| `graph.node.marker` | multi | 1 | alphabetical | append | `graph-view.html` (sibling of `<sm-node-card>` inside `[fNode]`) |
| `topbar.indicator` | multi | 3 | alphabetical | append | reserved — no built-in producer yet |

Default order across the catalog: `pluginId` ASC → `extensionId` ASC → `contributionId` ASC. Deterministic, no `priority` field on plugin manifests.

`strategy: 'replace-with-warning'` is opt-in by the kernel/UI per slot, never by the plugin. When two plugins compete for a single-cardinality slot: last-load-wins; emit one console warning per slot per scan AND surface in the UI plugin-doctor dialog.

## Renderer catalog

One Angular component per contract under `ui/src/app/renderers/<contract-id>/`. Mapping lives in `ui/src/app/contracts/contract-renderer-map.ts`:

```ts
export const CONTRACT_RENDERERS: Record<TContractId, ComponentType> = {
  'per-node-counter':       PerNodeCounter,
  'per-node-tag':           PerNodeTag,
  'per-node-breakdown':     PerNodeBreakdown,
  'per-node-records':       PerNodeRecords,
  'per-node-tree':          PerNodeTree,
  'per-node-key-values':    PerNodeKeyValues,
  'per-node-link-list':     PerNodeLinkList,
  'per-node-summary':       PerNodeSummary,
  'node-marker':            NodeMarker,
  'scope-summary':          ScopeSummary,
};

export const CONTRACT_SLOTS: Record<TContractId, TSlotId[]> = {
  'per-node-counter':       ['card.chip', 'inspector.header.badge'],
  'per-node-tag':           ['card.chip', 'inspector.header.badge'],
  'per-node-breakdown':     ['inspector.body'],
  // ...
};
```

To add a new contract (rare — discuss in ROADMAP first):

1. Spec change first (`spec/view-contracts.md` + `spec/schemas/view-contracts.schema.json`); regenerate `spec/index.json`.
2. Add the renderer component under `ui/src/app/renderers/<id>/`.
3. Wire into `CONTRACT_RENDERERS` and `CONTRACT_SLOTS`.
4. Add a conformance fixture under `spec/conformance/cases/`.
5. Update the scaffolder catalog (`src/cli/commands/plugins/scaffolder/`).

## Renderer attr-sanitization rule (LINT-ENFORCED)

Renderer components **MUST NOT** bind contribution data to:
- `[innerHTML]`
- `[style]` (object form or string form)
- `[src]` on `<img>`, `<iframe>`, `<script>`, `<embed>`, `<object>`
- `[href]` on `<a>` or `<link>`
- `[srcdoc]`
- `[formaction]`, `[action]`
- Any attribute Angular's `DomSanitizer` flags as `DANGEROUS_ATTR`

Use Angular's interpolation `{{ }}` (auto-sanitized text), `[textContent]`, `[attr.title]` (auto-sanitized), and `[attr.aria-*]`. For displaying user-provided URLs (e.g. `per-node-link-list`), pass through `Router.navigate` with the path as a route param — never emit raw `[href]` from contribution data.

**Why**: contribution data crosses the plugin/UI trust boundary. An emoji-named, alphabetic icon name from a plugin counter feels harmless until it's `<img src="x" onerror="...">` injected via `[innerHTML]`. Angular's interpolation sanitizes; the listed bindings do not.

The rule is enforced via `@angular-eslint/template/no-any` in `.eslintrc` for renderer-component templates. Adding a new renderer that needs one of these bindings → discuss in ROADMAP, do not bypass the lint.

## Isolation rules summary

(Full text in `ROADMAP.md` § "UI contribution system" → "Isolation".)

1. No raw DOM from plugin — typed data only.
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
| `<sm-view-contributions-host>` (slot host) | `view-contributions-host-<slot-id>` (e.g. `view-contributions-host-card-chip`) |
| `<sm-view-contributions>` (inspector body grouping panel) | `view-contributions` |
| Per-renderer root | `renderer-<contract-id>` (e.g. `renderer-per-node-counter`) |
| Per-contribution rendered instance | `contribution-<plugin-id>-<extension-id>-<contribution-id>` (sanitized to kebab-case) |
| Empty placeholder | `<base>-empty` |
| Invalid placeholder | `<base>-invalid` |
| Overflow `+N` chip | `<base>-overflow` |

## Naming watchlist

Two existing components consume the word "contributions" — DO NOT collide:

- `<sm-plugin-contributions>` — **existing**, surfaces sidecar root keys (annotation contributions). Lives at `ui/src/app/components/plugin-contributions/`.
- `<sm-view-contributions>` — **new**, surfaces view contributions in `inspector.body`. Lives at `ui/src/app/components/view-contributions/`.
- `<sm-view-contributions-host>` — **new**, generic slot host that filters / sorts / dispatches per slot. Lives at `ui/src/app/components/view-contributions-host/`.

The two systems are independent: annotation contributions write to the sidecar `.sm` file; view contributions emit per-node payloads stored in `scan_contributions`. They share the "plugin contributes data, kernel exposes catalog, UI renders" pattern but never overlap in storage or routing.

## Persistence semantics — orphan + catalog sweep + upsert (NOT replace-all)

The `scan_contributions` table is **NOT pure replace-all** like `scan_links` / `scan_issues`. The watcher's cached pass leaves the contributions buffer empty for cached nodes (no `extract()` → no `emitContribution`); a wipe-all would silently drop their valid prior rows on every watcher boot. The persist runs three passes inside the same tx:

1. **Orphan sweep** — drop rows whose `node_path` is NOT in `livePaths` (derived from `result.nodes`).
2. **Catalog sweep** — drop rows whose qualified id is NOT in `registeredContributionKeys` (derived from `composed.extractors + composed.rules` via `collectRegisteredContributionKeys`).
3. **Upsert** — `INSERT ... ON CONFLICT DO UPDATE SET payload_json = excluded.payload_json` for every buffer row.

When extending the persist path:
- Pass `livePaths` and `registeredContributionKeys` to `IPersistOptions` so the sweeps activate. Absent / empty values fall back to legacy wipe-all (orphan) and skip-sweep (catalog).
- Don't add `replaceAllScanContributions(trx, [])` calls outside the sweep flow — empty buffer is the cached-pass case and wiping it is the bug we just fixed.

Full contract in [`spec/db-schema.md`](../spec/db-schema.md) §`scan_contributions`.

## SPA hydration paths

The collection-loader hydrates from `/api/scan` on F5 / cold boot — that endpoint MUST embed `contributions[]` per node alongside the standard fields, otherwise the inspector / card slot hosts have nothing to render until the next per-node fetch. The decoration is a single bulk `port.contributions.listForPaths(...)` round-trip after `scans.load()`. Bulk `/api/nodes` and single `/api/nodes/:pathB64` already embed via the route-level decorator; `/api/scan` joined the family explicitly.

Projection layer: `ui/src/services/collection-loader.ts:projectNode(api: INodeApi): INodeView` MUST copy `contributions` through. Forgetting to project drops the data silently — any new view-contribution-aware UI surface needs to verify the projection before debugging the host.

## Where the rest lives

| Concern | File |
|---|---|
| Design narrative | `ROADMAP.md` § "UI contribution system" |
| Decision table | Same section, "Decisions" subsection |
| Plan + findings | `/home/crystian/.claude/plans/jazzy-percolating-cloud.md` |
| Contract catalog (normative) | `spec/view-contracts.md` |
| Input-type catalog (normative) | `spec/input-types.md` |
| Kernel surface (normative) | `spec/architecture.md` § "View contribution system" |
| Persistence shape (normative) | `spec/db-schema.md` § `scan_contributions` |
| Author tutorial | `spec/plugin-author-guide.md` § "View contributions" |
| Slot catalog | `ui/src/app/slots/slot-config.ts` |
| Renderer catalog | `ui/src/app/contracts/contract-renderer-map.ts` |
| Storage table | `src/migrations/002_view_contributions.sql` |
| BFF envelope | `src/server/envelope.ts` (`contributionsRegistry` field) |
| Scaffolder | `src/cli/commands/plugins.ts` (`PluginsCreateCommand`) |
