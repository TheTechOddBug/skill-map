# View slots

Closed catalog of view slots. Plugin authors pick ONE slot by name in their extension manifest's `viewContributions` map; the kernel validates emit-time payloads against the slot's payload schema. The kernel ships the catalog; the slot fixes both the renderer and the payload shape — there is no separate notion of a "contract" the author has to learn.

This doc is the **author-facing reference**. The normative shape lives in [`schemas/view-slots.schema.json`](./schemas/view-slots.schema.json):

- `$defs/SlotName` — closed enum of slot names
- `$defs/IViewContribution` — manifest-side declaration shape
- `$defs/Severity` — closed severity palette
- `$defs/IconString` — emoji-or-PrimeIcons string
- `$defs/payloads/<slot>` — per-slot payload schema (validated at `ctx.emitContribution(...)` time)

Architectural narrative is in [`architecture.md`](./architecture.md) §View contribution system. Tutorial walkthrough is in [`plugin-author-guide.md`](./plugin-author-guide.md) §View contributions.

## Catalog overview

| Slot | Renderer | Payload one-liner |
|---|---|---|
| [`card.title.right`](#cardtitleright) | icon marker | one icon + optional severity |
| [`card.subtitle.left`](#cardsubtitleleft) | counter chip | one non-negative integer |
| [`card.footer.left`](#cardfooterleft) | counter chip | one non-negative integer |
| [`card.footer.right`](#cardfooterright) | counter chip | one non-negative integer |
| [`graph.node.alert`](#graphnodealert) | corner badge | icon + optional severity / count |
| [`inspector.header.badge.counter`](#inspectorheaderbadgecounter) | counter chip | one non-negative integer |
| [`inspector.header.badge.tag`](#inspectorheaderbadgetag) | tag chip | a label + optional severity |
| [`inspector.body.panel.breakdown`](#inspectorbodypanelbreakdown) | bar chart | top-N labeled values |
| [`inspector.body.panel.records`](#inspectorbodypanelrecords) | table | rows × columns ≤ 50 × 6 |
| [`inspector.body.panel.tree`](#inspectorbodypaneltree) | indented tree | recursive label/children, depth ≤ 6, total ≤ 200 |
| [`inspector.body.panel.key-values`](#inspectorbodypanelkey-values) | definition list | flat key/value pairs ≤ 50 |
| [`inspector.body.panel.link-list`](#inspectorbodypanellink-list) | clickable list | scope-relative paths ≤ 100 |
| [`inspector.body.panel.markdown`](#inspectorbodypanelmarkdown) | sanitized markdown | text ≤ 4096 chars |
| [`topbar.actions.indicator`](#topbaractionsindicator) | scope chip | one value across the whole scope |

## Common conventions

**Severity palette** — closed enum: `info`, `warn`, `success`, `danger`. Used by counter / tag / alert / scope-stat slots. The UI maps each severity to a theme-aware tint; plugins do not pick raw colors.

**Icon string** — single string field. The UI discriminates: matches Unicode `\p{Extended_Pictographic}` → render as emoji text. Otherwise → resolve as PrimeIcons class id (without the `pi-` prefix; the UI prepends it). Unknown PrimeIcons names render no icon (silent fallback) plus a console warning.

**`emitWhenEmpty`** — manifest field on `IViewContribution`. When `false` (default), the kernel drops emissions whose payload is structurally empty so the slot stays silent. Per-slot definition of "empty" is in each section below.

**`label` and `tooltip`** — plain English strings, NOT internationalized. Per [`AGENTS.md`](../AGENTS.md): the project externalizes texts but does not internationalize.

**Slot picks ONE place** — unlike the previous (pre-2026-05) "contract" abstraction, a contribution is rendered exclusively in the slot the author declared. If you want the same data in multiple surfaces, declare multiple `viewContributions` entries (one per slot). The reason is intentional: one source of truth per surface, no surprise duplication.

---

## `card.title.right`

**Use for**: a small per-node marker next to the card title — language flag, "has audio", "has draft", platform glyph. One icon, optional color tint, optional tooltip. No counts, no labels (use a counter or tag slot for those).

**Manifest declaration**:
```jsonc
{ "slot": "card.title.right", "icon": "🎙", "label": "podcast" }
```

`icon` is required at the manifest level for this slot; the payload's optional `icon` overrides it per node when a plugin needs to vary the glyph.

**Payload shape**: `{ icon?, severity?, tooltip? }`. All fields optional — when `icon` is absent the manifest icon wins.

**Emit**:
```ts
ctx.emitContribution('language', { icon: '🇪🇸' });
ctx.emitContribution('has-audio', { severity: 'success' });
```

**Empty**: never — the manifest icon is always available as fallback.

**Where it renders**: immediately after the node title and before the actions cluster. Slot caps at `maxItems: 2`; overflow folds into `+N`.

---

## `card.subtitle.left`

**Use for**: a single non-negative integer surfaced in the card subtitle row — counts that belong above the body but below the title.

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

**Empty**: `value === 0` (dropped if `emitWhenEmpty` is false).

**Where it renders**: card subtitle row, left-aligned. Cap `maxItems: 3`, priority-ordered.

---

## `card.footer.left`

**Use for**: a single non-negative integer surfaced in the card footer left cluster (`@-mentions`, `/-invocations`, etc.).

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

**Use for**: a single non-negative integer surfaced in the card footer right cluster (URL counters, external-ref totals, etc.).

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

**Use for**: a small visual decoration on the graph node — alert pin, status badge, count badge.

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

## `inspector.header.badge.counter`

**Use for**: a single non-negative integer surfaced as a header badge when the inspector is open.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.header.badge.counter", "icon": "🔍", "label": "kw" }
```

`icon` is required.

**Payload shape**: `{ value: integer ≥ 0, severity?, tooltip? }`.

**Emit**:
```ts
ctx.emitContribution('myCounter', { value: 12 });
```

**Empty**: `value === 0`.

**Where it renders**: inspector header, alongside other badges. Cap `maxItems: 4`, alphabetical.

---

## `inspector.header.badge.tag`

**Use for**: a single qualitative tag surfaced as a header badge when the inspector is open.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.header.badge.tag", "label": "age" }
```

**Payload shape**: `{ label: string (1-32), severity?, tooltip? }`.

**Emit**:
```ts
ctx.emitContribution('age', { label: '7d', severity: 'info' });
```

**Empty**: `label === ''`.

**Where it renders**: inspector header, alongside other badges. Cap `maxItems: 4`, alphabetical.

---

## `inspector.body.panel.breakdown`

**Use for**: a small number of labeled quantities per node — language stats, keyword breakdown, dependency totals.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.breakdown", "label": "Code by language" }
```

**Payload shape**: `{ entries: Array<{ label, value: integer ≥ 0, tooltip? }> }` (max 20 entries; pre-truncate before emit).

**Emit**:
```ts
ctx.emitContribution('codestats', {
  entries: [
    { label: 'ts', value: 142 },
    { label: 'sh', value: 23 },
  ],
});
```

**Empty**: `entries.length === 0`.

**Where it renders**: inspector body, horizontal bar chart.

---

## `inspector.body.panel.records`

**Use for**: small tabular data per node — parsed CSV-like content, inventory lists.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.records", "label": "Dependencies" }
```

**Payload shape**: `{ columns: ≤6 entries, rows: ≤50 entries }` where each `column` is `{ key, label }` and each row maps `column.key` to a scalar (string ≤256, number, boolean, null).

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

**Use for**: hierarchical data per node — heading outline, AST snapshot, file tree.

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

**Use for**: a flat record per node — parsed frontmatter, config dump, extracted metadata.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.key-values", "label": "Frontmatter" }
```

**Payload shape**: `{ entries: Array<{ key (1-64), value: scalar (string ≤512, number, boolean, null), tooltip? }> }` (max 50 entries).

**Emit**:
```ts
ctx.emitContribution('parsed', {
  entries: [
    { key: 'description', value: 'Test harness for skill loaders' },
    { key: 'allowed-tools', value: 'Bash, Read, Grep' },
  ],
});
```

**Empty**: `entries.length === 0`.

**Where it renders**: inspector body, definition list.

---

## `inspector.body.panel.link-list`

**Use for**: a list of in-scope node paths per node — mentioned-in references, related nodes computed by the plugin.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.link-list", "label": "Mentioned in" }
```

**Payload shape**: `{ entries: Array<{ path (1-512), label?, kind? }> }` (max 100 entries). `path` is scope-relative; the UI resolves to a clickable link via `Router.navigate` — never as raw `[href]`.

**Emit**:
```ts
ctx.emitContribution('mentions', {
  entries: [
    { path: './skills/foo.md', label: 'foo skill' },
    { path: './api.md' },
  ],
});
```

**Empty**: `entries.length === 0`.

**Where it renders**: inspector body, clickable list with optional kind tinting from `kindRegistry`.

---

## `inspector.body.panel.markdown`

**Use for**: a short markdown text per node — LLM-generated summaries, formatted previews.

**Manifest declaration**:
```jsonc
{ "slot": "inspector.body.panel.markdown", "label": "Generated summary" }
```

**Payload shape**: `{ markdown: string ≤ 4096 chars }`. The UI renders with a sanitized allow-list (paragraphs, headings up to H3, lists, inline code, fenced code, emphasis, strong, blockquote). HTML, scripts, embedded SVG, image tags, and link autodetection are stripped.

**Emit**:
```ts
ctx.emitContribution('summary', {
  markdown: 'This skill **wraps** the Foblex Flow library...',
});
```

**Empty**: `markdown.trim() === ''`.

**Where it renders**: inspector body, sanitized markdown.

---

## `topbar.actions.indicator`

**Use for**: a single value summarizing the entire scope — total node count, last sync time, aggregate stat.

**Manifest declaration**:
```jsonc
{ "slot": "topbar.actions.indicator", "icon": "📊", "label": "Total" }
```

**Payload shape**: `{ value: integer ≥ 0 OR string (1-64), label?, tooltip?, severity? }`.

**Emit** (analyzers only — extractors do not see `emitScopeContribution`):
```ts
// Inside IAnalyzer.evaluate(ctx):
ctx.emitScopeContribution('total', { value: ctx.nodes.length });
```

**Empty**: not applicable (this slot requires a value).

**Where it renders**: topbar, right of the actions cluster.

---

## Stability

- The catalog of 15 slots above is the v1 surface.
- Adding a new slot is a **catalog-minor bump**; renaming or removing one is a **catalog-major bump** and triggers `sm plugins upgrade` migration of dependent plugins.
- The `IViewContribution` six-field declaration shape is stable. Adding a new optional field is a minor bump; making a field required or removing one is a catalog-major bump.
- Slots are now spec-level (the kernel and the spec own the catalog). UI implementation may rearrange visual placement WITHOUT renaming a slot — the slot id is the public handle, the visual surface beneath it can evolve.
- The Severity enum and Icon string conventions are stable.
- Per-slot payload caps (max items, max length) are stable; relaxing them is additive (minor bump). Tightening them is breaking (catalog-major bump).
