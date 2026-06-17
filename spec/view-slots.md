# View slots

Closed catalog of view slots. Plugin authors pick ONE slot by name in their extension manifest's `ui` map; the kernel validates emit-time payloads against the slot's payload schema. The slot fixes both the renderer and the payload shape, there is no separate "contract" to learn.

This doc is the **author-facing reference**. The normative shape lives in [`schemas/view-slots.schema.json`](./schemas/view-slots.schema.json):

- `$defs/SlotName`, closed enum of slot names
- `$defs/IViewContribution`, manifest-side declaration shape
- `$defs/Severity`, closed severity palette
- `$defs/IconString`, emoji-or-PrimeIcons string
- `$defs/payloads/<slot>`, per-slot payload schema (validated at `ctx.emitContribution(...)` time)

Architectural narrative is in [`architecture.md`](./architecture.md) §View contribution system. Tutorial walkthrough is in [`plugin-author-guide.md`](./plugin-author-guide.md) §View contributions.

## Catalog overview

| Slot | Renderer | Payload one-liner |
|---|---|---|
| [`card.title.right`](#cardtitleright) | icon marker | one icon + optional severity |
| [`card.subtitle.left`](#cardsubtitleleft) | counter chip | one non-negative integer |
| [`card.footer.left`](#cardfooterleft) | counter chip | one non-negative integer |
| [`card.footer.right`](#cardfooterright) | counter chip | one non-negative integer |
| [`graph.node.alert`](#graphnodealert) | corner badge | icon + optional severity / count |
| [`inspector.header.badge`](#inspectorheaderbadge) | badge | icon and/or label and/or count, optional severity |
| [`inspector.action.button`](#inspectoractionbutton) | action button | actionId + label + enabled gate |
| [`inspector.body.panel.breakdown`](#inspectorbodypanelbreakdown) | bar chart | top-N labeled values |
| [`inspector.body.panel.records`](#inspectorbodypanelrecords) | table | rows × columns ≤ 50 × 6 |
| [`inspector.body.panel.tree`](#inspectorbodypaneltree) | indented tree | recursive label/children, depth ≤ 6, total ≤ 200 |
| [`inspector.body.panel.key-values`](#inspectorbodypanelkey-values) | definition list | flat key/value pairs ≤ 50 |
| [`inspector.body.panel.link-list`](#inspectorbodypanellink-list) | clickable list | scope-relative paths ≤ 100 |
| [`inspector.body.panel.markdown`](#inspectorbodypanelmarkdown) | sanitized markdown | text ≤ 4096 chars |
| [`topbar.nav.start`](#topbarnavstart) | scope chip | one value across the whole scope |

## Common conventions

**Severity palette**, closed enum: `info`, `warn`, `success`, `danger`. Used by counter / tag / alert / scope-stat slots. The UI maps each severity to a theme-aware tint; plugins do not pick raw colors.

**Icon string**, single string field, prefix-discriminated by the UI. Four valid shapes:

1. **Emoji**, any value starting with a non-ASCII-letter codepoint (`'🔍'`, `'👨‍💻'`) renders as text. The first character signals the branch; ZWJ sequences and variation selectors work transparently.
2. **PrimeIcons**, `'pi-search'` or `'pi pi-search'` (both accepted) → `<i class="pi pi-search">`.
3. **FontAwesome explicit family**, `'fa-solid fa-star'` / `'fa-regular fa-star'` / `'fa-brands fa-github'` → pass-through, class emitted as-is.
4. **FontAwesome shorthand**, `'fa-star'` (no family token) → defaults to `<i class="fa-solid fa-star">`.

Bare class names without a `pi-` / `fa-` prefix (e.g. `'star-fill'`) are **rejected at manifest load** (invalid-manifest, AJV pattern). Unknown PrimeIcons / FontAwesome names render no icon (silent fallback) plus a console warning.

**`emitWhenEmpty`**, manifest field on `IViewContribution`. When `false` (default), the kernel drops emissions whose payload is structurally empty. Per-slot definition of "empty" is in each section below.

**`label` and `tooltip`**, plain English strings, NOT internationalized. Per [`AGENTS.md`](../AGENTS.md): externalized texts, not internationalized.

**Slot picks ONE place**, a contribution renders exclusively in the slot the author declared. For the same data in multiple surfaces, declare multiple `ui` entries (one per slot). Intentional: one source of truth per surface, no surprise duplication.

**Inspector body grouping**, the six `inspector.body.panel.*` slots do not share one drawer. The inspector renders **one collapsible section per plugin** (titled by the trusted `pluginId`, collapsed by default), grouping that plugin's body-panel bricks; a plugin's contributions never land in another plugin's section. Section order follows the plugin-level `order` field in `plugin.json` (default 100, tie-break by plugin id); brick order within a section follows the extension-level `order` field (default 100, tie-break by the contribution `priority` then qualified id). Both `order` fields are optional and inspector-only, they never affect execution order.

---

## `card.title.right`

**Use for**: a small per-node marker next to the card title, language flag, "has audio", "has draft", platform glyph. One icon, optional color tint, optional tooltip. No counts, no labels (use a counter or tag slot).

**Manifest declaration**:
```jsonc
{ "slot": "card.title.right", "icon": "🎙", "label": "podcast" }
```

`icon` is required at the manifest level; the payload's optional `icon` overrides it per node to vary the glyph.

**Payload shape**: `{ icon?, severity?, tooltip? }`. All fields optional, when `icon` is absent the manifest icon wins.

**Emit**:
```ts
ctx.emitContribution('language', { icon: '🇪🇸' });
ctx.emitContribution('has-audio', { severity: 'success' });
```

**Empty**: never, the manifest icon is always available as fallback.

**Where it renders**: after the node title, before the actions cluster. Cap `maxItems: 2`; overflow folds into `+N`.

---

## `card.subtitle.left`

**Use for**: a single non-negative integer in the card subtitle row, counts above the body but below the title.

**Manifest declaration**:
```jsonc
{ "slot": "card.subtitle.left", "icon": "🔍", "label": "kw" }
```

`icon` is required at the manifest level (the chip needs a leading glyph).

**Payload shape**: `{ value: integer ≥ 0, severity?, tooltip? }`.

**Emit**:
```ts
ctx.emitContribution('myCounter', { value: 12 });
```

**Empty**: `value === 0`.

**Where it renders**: card subtitle row, left-aligned. Cap `maxItems: 3`, priority-ordered.

---

## `card.footer.left`

**Use for**: a single non-negative integer in the card footer left cluster (`@-mentions`, `/-invocations`, etc.).

**Manifest declaration**:
```jsonc
{ "slot": "card.footer.left", "icon": "@", "label": "mentions" }
```

`icon` is required.

**Payload shape**: `{ value: integer ≥ 0, severity?, tooltip? }`.

**Emit**:
```ts
ctx.emitContribution('mentionsCount', { value: 3 });
```

**Empty**: `value === 0`.

**Where it renders**: card footer, left side of the stats cluster. Cap `maxItems: 5`, priority-ordered.

---

## `card.footer.right`

**Use for**: a single non-negative integer in the card footer right cluster (URL counters, external-ref totals, etc.).

**Manifest declaration**:
```jsonc
{ "slot": "card.footer.right", "icon": "🔗", "label": "urls" }
```

`icon` is required.

**Payload shape**: `{ value: integer ≥ 0, severity?, tooltip? }`.

**Emit**:
```ts
ctx.emitContribution('urlsCount', { value: 7 });
```

**Empty**: `value === 0`.

**Where it renders**: card footer, right side of the stats cluster. Cap `maxItems: 5`, priority-ordered.

---

## `graph.node.alert`

**Use for**: a small visual decoration on the graph node, alert pin, status badge, count badge.

**Manifest declaration**:
```jsonc
{ "slot": "graph.node.alert" }
```

**Payload shape**: `{ icon?, severity?, count?: 1-99, tooltip? }`. At least one of `icon`, `severity`, `count` is required.

**Emit**:
```ts
ctx.emitContribution('alert', { icon: '⚠', severity: 'warn' });
ctx.emitContribution('mentions-count', { count: 12 });
```

**Empty**: absence of `icon` AND `count`.

**Where it renders**: corner badge on the graph node card. Hard cap 1 marker per node per plugin extension (slot config enforces).

---

## `inspector.header.badge`

**Use for**: a unified header badge surfaced when the inspector is open. One slot covers every header chip shape, a counter-style badge (icon + count), a tag-style badge (label + severity), or the stale clock (icon + tooltip). Replaces the retired `inspector.header.badge.counter` and `inspector.header.badge.tag` sub-slots; pick this slot and set whichever fields the badge needs.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.header.badge", "label": "keywords" }
```

No manifest field required beyond `slot` (the payload supplies the visible content). The manifest `label` stays metadata (docs / plugin-doctor / aria-label).

**Payload shape**: `{ icon?, label? (1-32), count?: integer ≥ 0, severity?, tooltip? }`. At least one of `icon`, `label`, `count` is required (`anyOf`).

**Emit**:
```ts
ctx.emitContribution('keywords', { count: 12, icon: '🔍' });
ctx.emitContribution('age', { label: '7d', severity: 'info' });
ctx.emitContribution('stale', { icon: 'pi-clock', tooltip: 'Sidecar drift' });
```

**Empty**: absence of `icon` AND `label` AND `count`.

**Where it renders**: inspector header badge cluster. Multi-cardinality (a plugin extension may emit several), priority-ordered, modeled on `card.footer.left`.

---

## `inspector.action.button`

**Use for**: an actionable button in the inspector that dispatches a kernel Action against the open node (bump button is the first adopter). Always emitted; its `enabled` flag carries the dynamic condition (e.g. `isStale` for bump) so a disabled button stays visible with its `disabledReason`.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.action.button" }
```

The manifest declares only `{ slot }`. The per-node payload carries the action id, label, and dynamic `enabled` flag; the kernel re-emits the row every scan so the button refreshes.

**Payload shape**: `{ actionId, label (1-48), enabled, icon?, severity?, disabledReason? (≤128), input?, prompt?, confirm? }`. Required: `actionId` (qualified `<plugin>/<action>`, pattern-checked), `label`, and `enabled` (boolean). `disabledReason` is the tooltip shown when `enabled` is false. `input`, `prompt`, and `confirm` are **reserved for parametrized actions** (Steps 2+, see below) and carry no behaviour today.

**Emit**:
```ts
ctx.emitContribution(nodePath, 'bump', {
  actionId: 'core/node-bump',
  label: 'Bump version',
  icon: 'pi-arrow-up',
  enabled: isStale,
  disabledReason: 'Sidecar is already up to date.',
});
```

**Dispatch**: a click sends `POST /api/actions/:id` with the qualified `actionId`; the kernel resolves the Action in its registry (unknown id → 404), runs it against the open node, and answers an `action.applied` envelope (`{ value: { actionId, nodePath, report }, elapsedMs }`). `.sm`-writing actions still pass through the write-consent gate (see [`architecture.md`](./architecture.md) §Annotation system → Write consent).

**Reserved fields** (no effect yet, declared so the contract is stable before the parametrized-action steps land):

- `input` (Step 2+), a static object merged into the dispatch body for actions needing a fixed parameter but no user prompt.
- `prompt` (Step 3+), an `_ActionPrompt` declaring an input-type control the UI collects before dispatching (enum pick, single string, etc.), keyed into the dispatch `input` body under `paramKey`.
- `confirm`, requires an extra confirm step before dispatch (destructive actions).

**Empty**: not applicable. `emitWhenEmpty` does not apply (a button is always meaningful), and the `enabled` flag (not absence) carries the "nothing to do" state.

**Where it renders**: inspector body, action cluster.

---

## `inspector.body.panel.breakdown`

**Use for**: a small number of labeled quantities per node, language stats, keyword breakdown, dependency totals.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.breakdown", "label": "Code by language" }
```

**Payload shape**: `{ bars: Array<{ label, value: integer ≥ 0, tooltip? }> }` (max 20 bars; pre-truncate before emit).

**Emit**:
```ts
ctx.emitContribution('codestats', {
  bars: [
    { label: 'ts', value: 142 },
    { label: 'sh', value: 23 },
  ],
});
```

**Empty**: `bars.length === 0`.

**Where it renders**: inspector body, horizontal bar chart.

---

## `inspector.body.panel.records`

**Use for**: small tabular data per node, parsed CSV-like content, inventory lists.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.records", "label": "Dependencies" }
```

**Payload shape**: `{ columns: ≤6, rows: ≤50 }` where each `column` is `{ key, label }` and each row maps `column.key` to a scalar (string ≤256, number, boolean, null).

**Emit**:
```ts
ctx.emitContribution('deps', {
  columns: [
    { key: 'name',    label: 'Package' },
    { key: 'version', label: 'Version' },
  ],
  rows: [
    { name: 'foo', version: '^1.2.0' },
    { name: 'bar', version: '~3.0.0' },
  ],
});
```

**Empty**: `rows.length === 0`.

**Where it renders**: inspector body, compact table.

---

## `inspector.body.panel.tree`

**Use for**: hierarchical data per node, heading outline, AST snapshot, file tree.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.tree", "label": "Outline" }
```

**Payload shape**: recursive `{ label, marker?, tooltip?, children?: TreeNode[] }`. Hard caps: max depth 6, max 200 total nodes per tree (validator enforces).

**Emit**:
```ts
ctx.emitContribution('outline', {
  label: 'Skill map',
  children: [
    { label: 'Overview' },
    {
      label: 'Setup',
      children: [{ label: 'Install' }],
    },
  ],
});
```

**Empty**: root has no `children`.

**Where it renders**: inspector body, indented tree.

---

## `inspector.body.panel.key-values`

**Use for**: a flat record per node, parsed frontmatter, config dump, extracted metadata.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.key-values", "label": "Frontmatter" }
```

**Payload shape**: `{ pairs: Array<{ key (1-64), value: scalar (string ≤512, number, boolean, null), tooltip? }> }` (max 50 pairs).

**Emit**:
```ts
ctx.emitContribution('parsed', {
  pairs: [
    { key: 'description', value: 'Test harness for skill loaders' },
    { key: 'allowed-tools', value: 'Bash, Read, Grep' },
  ],
});
```

**Empty**: `pairs.length === 0`.

**Where it renders**: inspector body, definition list.

---

## `inspector.body.panel.link-list`

**Use for**: a list of in-scope node paths per node, mentioned-in references, related nodes computed by the plugin.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.link-list", "label": "Mentioned in" }
```

**Payload shape**: `{ links: Array<{ path (1-512), label?, kind? }> }` (max 100 links). `path` is scope-relative; the UI resolves to a clickable link via `Router.navigate`, never as raw `[href]`.

**Emit**:
```ts
ctx.emitContribution('mentions', {
  links: [
    { path: './skills/foo.md', label: 'foo skill' },
    { path: './api.md' },
  ],
});
```

**Empty**: `links.length === 0`.

**Where it renders**: inspector body, clickable list with optional kind tinting from `kindRegistry`.

---

## `inspector.body.panel.markdown`

**Use for**: a short markdown text per node, LLM-generated summaries, formatted previews.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.markdown", "label": "Generated summary" }
```

**Payload shape**: `{ markdown: string ≤ 4096 chars }`. Rendered with a sanitized allow-list (paragraphs, headings up to H3, lists, inline code, fenced code, emphasis, strong, blockquote). HTML, scripts, embedded SVG, image tags, and link autodetection are stripped.

**Emit**:
```ts
ctx.emitContribution('summary', {
  markdown: 'This skill **wraps** the Foblex Flow library...',
});
```

**Empty**: `markdown.trim() === ''`.

**Where it renders**: inspector body, sanitized markdown.

---

## `topbar.nav.start`

**Use for**: a single value summarizing the entire scope, total node count, last sync time, aggregate stat. Renders at the start of the topbar nav (left edge).

**Manifest declaration**:
```jsonc
{ "slot": "topbar.nav.start", "icon": "📊", "label": "Total" }
```

**Payload shape**: `{ value: integer ≥ 0 OR string (1-64), label?, tooltip?, severity? }`.

**Emit** (analyzers only, extractors do not see `emitScopeContribution`):
```ts
// Inside IAnalyzer.evaluate(ctx):
ctx.emitScopeContribution('total', { value: ctx.nodes.length });
```

> **Status, pending.** The `emitScopeContribution(contributionId, payload)` runtime callback is **reserved in the spec but not yet implemented**: today's `IAnalyzerContext` does not expose it. It lands when the first scope-level adopter arrives (see `architecture.md` §View contribution system → Emit path). A plugin declaring a `topbar.nav.start` contribution loads fine, but emissions are deferred until the kernel adds the analyzer-side callback.

**Empty**: not applicable (this slot requires a value).

**Where it renders**: topbar, right of the actions cluster.

---

## Stability

- The catalog of 14 slots above is the v1 surface, including the unified `inspector.header.badge` and the `inspector.action.button` dispatch slot.
- Adding a new slot is a **catalog-minor bump**; renaming or removing one is a **catalog-major bump** and triggers `sm plugins upgrade` migration of dependent plugins. Folding the two header sub-slots into `inspector.header.badge` was such a removal.
- The `inspector.action.button` reserved fields (`input`, `prompt`, `confirm`) are declared but inert; wiring them in the parametrized-action steps is additive (minor bump). The `_ActionPrompt` payload shape is reserved for the same steps.
- The `IViewContribution` seven-field declaration shape (`slot`, `label?`, `tooltip?`, `icon?`, `emptyText?`, `emitWhenEmpty?`, `priority?`) is stable. Adding a new optional field is a minor bump; making a field required or removing one is a catalog-major bump.
- Slots are spec-level (the kernel and spec own the catalog). UI implementation may rearrange visual placement WITHOUT renaming a slot, the slot id is the public handle.
- The Severity enum and Icon string conventions are stable.
- Per-slot payload caps (max items, max length) are stable; relaxing them is additive (minor bump). Tightening them is breaking (catalog-major bump).
