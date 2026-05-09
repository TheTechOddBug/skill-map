# View contracts

Closed catalog of view contracts. Plugin authors pick one of these by name in their extension manifest's `viewContributions` map; the kernel validates emit-time payloads against the per-contract payload schema. The kernel ships the catalog; the UI maps each contract to slots and renderers.

This doc is the **author-facing reference**. The normative shape lives in [`schemas/view-contracts.schema.json`](./schemas/view-contracts.schema.json):

- `$defs/ContractName` — closed enum of contract names
- `$defs/IViewContribution` — manifest-side declaration shape
- `$defs/Severity` — closed severity palette
- `$defs/IconString` — emoji-or-PrimeIcons string
- `$defs/payloads/<contract>` — per-contract payload schema (validated at `ctx.emitContribution(...)` time)

Architectural narrative is in [`architecture.md`](./architecture.md) §View contribution system. Tutorial walkthrough is in [`plugin-author-guide.md`](./plugin-author-guide.md) §View contributions.

## Catalog overview

| Contract | Surface in UI | Payload one-liner |
|---|---|---|
| [`node-counter`](#node-counter) | card chip + inspector header badge | one non-negative integer |
| [`node-tag`](#node-tag) | card chip + inspector header badge | a label + optional severity |
| [`node-breakdown`](#node-breakdown) | inspector body (chart-bar) | top-N labeled values |
| [`node-records`](#node-records) | inspector body (table) | rows × columns ≤ 50 × 6 |
| [`node-tree`](#node-tree) | inspector body (tree) | recursive label/children, depth ≤ 6, total ≤ 200 |
| [`node-key-values`](#node-key-values) | inspector body (definition list) | flat key/value pairs ≤ 50 |
| [`node-link-list`](#node-link-list) | inspector body (link list) | scope-relative paths ≤ 100 |
| [`node-markdown`](#node-markdown) | inspector body (markdown text) | sanitized markdown ≤ 4096 chars |
| [`node-alert`](#node-alert) | graph node corner badge | icon + optional severity / count |
| [`scope-stat`](#scope-stat) | topbar indicator | one value across the whole scope |

## Common conventions

**Severity palette** — closed enum: `info`, `warn`, `success`, `danger`. Used by `node-counter`, `node-tag`, `node-alert`, `scope-stat`. The UI maps each severity to a theme-aware tint; plugins do not pick raw colors.

**Icon string** — single string field. The UI discriminates: matches Unicode `\p{Extended_Pictographic}` → render as emoji text. Otherwise → resolve as PrimeIcons class id (without the `pi-` prefix; the UI prepends it). Unknown PrimeIcons names render no icon (silent fallback) plus a console warning.

**`emitWhenEmpty`** — manifest field on `IViewContribution`. When `false` (default), the kernel drops emissions whose payload is structurally empty so the slot stays silent. Per-contract definition of "empty" is in each section below.

**`label` and `tooltip`** — plain English strings, NOT internationalized. Per [`AGENTS.md`](../AGENTS.md): the project externalizes texts but does not internationalize.

---

## `node-counter`

**Use for**: a single non-negative integer per node — counts, totals, sums.

**Manifest declaration**:
```jsonc
{ "contract": "node-counter", "icon": "🔍", "label": "kw" }
```

**Payload shape**: `{ value: integer ≥ 0, label?: string ≤ 32, tooltip?: string ≤ 256, severity? }`

**Emit**:
```ts
ctx.emitContribution('myCounter', { value: 12 });
ctx.emitContribution('myCounter', { value: 0, severity: 'warn' }); // dropped if emitWhenEmpty=false
```

**Empty**: `value === 0`.

**Where it surfaces** (informative, UI may evolve): `card.footer.left` + `inspector.header.badge`. Same data renders in both slots.

---

## `node-tag`

**Use for**: a single qualitative tag per node — status labels, age, category.

**Manifest declaration**:
```jsonc
{ "contract": "node-tag", "icon": "🕐", "label": "age" }
```

**Payload shape**: `{ label: string (1-32), severity?, tooltip?: string ≤ 256 }`

**Emit**:
```ts
ctx.emitContribution('age', { label: '7d', severity: 'info' });
ctx.emitContribution('age', { label: '90d', severity: 'warn' });
```

**Empty**: `label === ''`.

**Where it surfaces** (informative): `card.footer.left` + `inspector.header.badge`.

---

## `node-breakdown`

**Use for**: a small number of labeled quantities per node — language stats, keyword breakdown, dependency totals.

**Manifest declaration**:
```jsonc
{ "contract": "node-breakdown", "label": "Code by language" }
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

**Where it surfaces** (informative): `inspector.body.panel` rendered as a horizontal bar chart.

---

## `node-records`

**Use for**: small tabular data per node — parsed CSV-like content, inventory lists.

**Manifest declaration**:
```jsonc
{ "contract": "node-records", "label": "Dependencies" }
```

**Payload shape**: `{ columns: ≤6 entries, rows: ≤50 entries }` where each `column` is `{ key, label }` and each row is a record from `column.key` to scalar (string ≤256, number, boolean, null).

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

**Where it surfaces** (informative): `inspector.body.panel` rendered as a compact table.

---

## `node-tree`

**Use for**: hierarchical data per node — heading outline, AST snapshot, file tree.

**Manifest declaration**:
```jsonc
{ "contract": "node-tree", "label": "Outline" }
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

**Where it surfaces** (informative): `inspector.body.panel` rendered as an indented tree.

---

## `node-key-values`

**Use for**: a flat record per node — parsed frontmatter, config dump, extracted metadata.

**Manifest declaration**:
```jsonc
{ "contract": "node-key-values", "label": "Frontmatter" }
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

**Where it surfaces** (informative): `inspector.body.panel` rendered as a definition list.

---

## `node-link-list`

**Use for**: a list of in-scope node paths per node — mentioned-in references, related nodes computed by the plugin.

**Manifest declaration**:
```jsonc
{ "contract": "node-link-list", "label": "Mentioned in" }
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

**Where it surfaces** (informative): `inspector.body.panel` rendered as a clickable list with optional kind tinting from `kindRegistry`.

---

## `node-markdown`

**Use for**: a short markdown text per node — LLM-generated summaries, formatted previews.

**Manifest declaration**:
```jsonc
{ "contract": "node-markdown", "label": "Generated summary" }
```

**Payload shape**: `{ markdown: string ≤ 4096 chars }`. The UI renders with a sanitized allow-list (paragraphs, headings up to H3, lists, inline code, fenced code, emphasis, strong, blockquote). HTML, scripts, embedded SVG, image tags, and link autodetection are stripped.

**Emit**:
```ts
ctx.emitContribution('summary', {
  markdown: 'This skill **wraps** the Foblex Flow library...',
});
```

**Empty**: `markdown.trim() === ''`.

**Where it surfaces** (informative): `inspector.body.panel` rendered as sanitized markdown.

---

## `node-alert`

**Use for**: a small visual decoration on the graph node — alert pin, status badge, count badge.

**Manifest declaration**:
```jsonc
{ "contract": "node-alert" }
```

**Payload shape**: `{ icon?, severity?, count?: 1-99, tooltip? }`. At least one of `icon`, `severity`, `count` is required.

**Emit**:
```ts
ctx.emitContribution('alert', { icon: '⚠', severity: 'warn' });
ctx.emitContribution('mentions-count', { count: 12 });
```

**Empty**: absence of `icon` AND `count`.

**Where it surfaces** (informative): `graph.node.alert` rendered as a corner badge. Hard cap 1 marker per node per plugin extension (slot config enforces).

---

## `scope-stat`

**Use for**: a single value summarizing the entire scope — total node count, last sync time, aggregate stat.

**Manifest declaration**:
```jsonc
{ "contract": "scope-stat", "icon": "📊", "label": "Total" }
```

**Payload shape**: `{ value: integer ≥ 0 OR string (1-64), label?, tooltip?, severity? }`.

**Emit** (rules only — extractors do not see `emitScopeContribution`):
```ts
// Inside IRule.evaluate(ctx):
ctx.emitScopeContribution('total', { value: ctx.nodes.length });
```

**Empty**: not applicable (this contract requires a value).

**Where it surfaces** (informative): `topbar.actions.indicator`.

---

## Stability

- The catalog of 10 contracts above is the v1 surface.
- Adding a new contract is a **catalog-minor bump**; renaming or removing one is a **catalog-major bump** and triggers `sm plugins upgrade` migration of dependent plugins.
- The `IViewContribution` six-field declaration shape is stable. Adding a new optional field is a minor bump; making a field required or removing one is a catalog-major bump.
- The slot mapping shown in the "Where it surfaces (informative)" notes is a UI decision and may evolve without a catalog version bump. Plugin authors do NOT depend on the mapping.
- The Severity enum and Icon string conventions are stable.
- Per-contract payload caps (max items, max length) are stable; relaxing them is additive (minor bump). Tightening them is breaking (catalog-major bump).
