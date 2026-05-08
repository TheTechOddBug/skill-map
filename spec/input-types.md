# Input-types for plugin settings

Closed catalog of input-types for the manifest-root `settings` map. Plugin authors pick a `type` by name; the kernel knows the value schema; the UI generates a form per declaration; the CLI's `sm plugins config <id>` exposes the same surface. Plugin authors NEVER write JSON Schema for settings — they pick a name and supply per-type parameters.

This doc is the **author-facing reference**. The normative shape lives in [`schemas/input-types.schema.json`](./schemas/input-types.schema.json):

- `$defs/InputTypeName` — closed enum of input-type names
- `$defs/ISettingDeclaration` — manifest-side declaration shape (discriminated by `type`)
- `$defs/Setting_<TypeName>` — per-type declaration schema with parameters

The `settings` field on `IPluginManifest` lives in [`schemas/plugins-registry.schema.json`](./schemas/plugins-registry.schema.json) at `$defs/PluginManifest`. Tutorial walkthrough is in [`plugin-author-guide.md`](./plugin-author-guide.md) §View contributions → "Settings".

## Catalog overview

| Type | Value at runtime | Use for |
|---|---|---|
| [`string-list`](#string-list) | `string[]` | keyword lists, ignore patterns, allow-lists |
| [`single-string`](#single-string) | `string` | URLs, names, identifiers |
| [`boolean-flag`](#boolean-flag) | `boolean` | on/off toggles |
| [`integer`](#integer) | `number` (always integer) | counts, thresholds, limits |
| [`enum-pick`](#enum-pick) | `string` | pick one from a closed set |
| [`enum-multipick`](#enum-multipick) | `string[]` | pick zero or more |
| [`path-glob`](#path-glob) | `string` or `string[]` | file path patterns |
| [`regex`](#regex) | `string` | ECMAScript regex body |
| [`secret`](#secret) | `string` | tokens, passwords, API keys |
| [`key-value-list`](#key-value-list) | `Array<{ key, value }>` | custom maps, alias dictionaries |

## Common conventions

**Required fields**: every declaration requires `type` and `label`. `description` is optional. Other parameters are per-type.

**Default values**: most types accept a `default` parameter. The kernel uses it when the user has not yet configured the setting.

**Validation**: the kernel validates the resolved value against the per-type value schema at extractor invocation. Validation failure surfaces as `invalid-settings` plugin status.

**English-only labels**: per [`AGENTS.md`](../AGENTS.md), the project externalizes texts but does not internationalize. Use English `label` and `description` strings.

**Settings are read-once**: extractors receive `ctx.settings.<settingId>` at invocation. Changing a setting requires `sm scan` to re-emit affected contributions.

---

## `string-list`

**Use for**: arrays of free-form strings — keyword lists, file extensions, tag allow-lists.

**Declaration**:
```jsonc
{
  "type": "string-list",
  "label": "Keywords to track",
  "description": "Words counted across each node's body.",
  "default": ["TODO", "FIXME"],
  "min": 1,
  "max": 50,
  "itemMaxLength": 64
}
```

**Parameters**: `label` (required), `description?`, `default?: string[]`, `min?` (item count), `max?` (item count), `itemMaxLength?` (default 256).

**Value type**: `string[]`.

**UI**: tag input (PrimeNG `<p-chips>` or equivalent).

---

## `single-string`

**Use for**: a single text value — URLs, names, identifiers.

**Declaration**:
```jsonc
{
  "type": "single-string",
  "label": "Base URL",
  "default": "https://example.com",
  "minLength": 1,
  "maxLength": 256,
  "pattern": "^https?://"
}
```

**Parameters**: `label` (required), `description?`, `default?: string`, `minLength?`, `maxLength?`, `pattern?` (ECMAScript regex, no flags).

**Value type**: `string`.

**UI**: text input.

---

## `boolean-flag`

**Use for**: on/off toggles.

**Declaration**:
```jsonc
{
  "type": "boolean-flag",
  "label": "Case-sensitive matching",
  "default": false
}
```

**Parameters**: `label` (required), `description?`, `default?: boolean` (default `false`).

**Value type**: `boolean`.

**UI**: PrimeNG `<p-toggleswitch>`.

---

## `integer`

**Use for**: integer values with optional bounds — counts, thresholds, retry limits.

**Declaration**:
```jsonc
{
  "type": "integer",
  "label": "Max retries",
  "default": 3,
  "min": 0,
  "max": 10,
  "step": 1
}
```

**Parameters**: `label` (required), `description?`, `default?: integer`, `min?`, `max?`, `step?` (default 1).

**Value type**: `number` (always integer).

**UI**: PrimeNG `<p-inputnumber>` with spinner.

---

## `enum-pick`

**Use for**: pick one from a closed set.

**Declaration**:
```jsonc
{
  "type": "enum-pick",
  "label": "Output format",
  "options": [
    { "value": "json",     "label": "JSON" },
    { "value": "markdown", "label": "Markdown" },
    { "value": "ascii",    "label": "ASCII tree" }
  ],
  "default": "markdown"
}
```

**Parameters**: `label` (required), `description?`, `options: Array<{ value, label }>` (required, ≥ 2 entries), `default?: string`.

**Value type**: `string` (the picked option's `value`).

**UI**: PrimeNG `<p-select>` (≤ 7 options) or `<p-radiobutton>` group (≤ 4 options).

---

## `enum-multipick`

**Use for**: pick zero or more from a closed set.

**Declaration**:
```jsonc
{
  "type": "enum-multipick",
  "label": "Severities to surface",
  "options": [
    { "value": "info",    "label": "Info" },
    { "value": "warn",    "label": "Warning" },
    { "value": "danger",  "label": "Danger" }
  ],
  "default": ["warn", "danger"],
  "min": 1
}
```

**Parameters**: `label` (required), `description?`, `options: Array<{ value, label }>` (required, ≥ 2 entries), `default?: string[]`, `min?`, `max?`.

**Value type**: `string[]`.

**UI**: PrimeNG `<p-multiselect>` or checkbox group.

---

## `path-glob`

**Use for**: glob patterns — ignore lists, allow-lists, scope filters.

**Declaration**:
```jsonc
{
  "type": "path-glob",
  "label": "Ignore patterns",
  "default": "**/.git/**",
  "multiple": true
}
```

**Parameters**: `label` (required), `description?`, `default?: string`, `multiple?: boolean` (default `false`).

**Value type**: `string` (when `multiple: false`) or `string[]` (when `multiple: true`).

**UI**: text input (single) or tag input (multiple), validated against the project's installed glob library at form submit.

---

## `regex`

**Use for**: ECMAScript regex patterns — match rules, parsing patterns.

**Declaration**:
```jsonc
{
  "type": "regex",
  "label": "Match pattern",
  "default": "\\bTODO\\b",
  "flags": "gi"
}
```

**Parameters**: `label` (required), `description?`, `default?: string`, `flags?: string` (subset of `gimsuy`, default `''`).

**Value type**: `string` (the regex body, no `/` delimiters).

**UI**: text input. Compilation tested at form submit and at extractor invocation; failure → `invalid-settings`.

---

## `secret`

**Use for**: sensitive strings — API tokens, passwords, signing keys.

**Declaration**:
```jsonc
{
  "type": "secret",
  "label": "GitHub API token",
  "envVar": "GITHUB_TOKEN"
}
```

**Parameters**: `label` (required), `description?`, `envVar?` (uppercase ASCII identifier — kernel reads from process env first if set, lets CI inject without writing to disk).

**Value type**: `string`.

**UI**: `<input type="password">` with reveal toggle.

**Storage**: encrypted at rest (kernel-managed key in `state_secrets`). Logged as `<redacted>` in CLI output. Triggers an `audit.secret-read` event on every read.

---

## `key-value-list`

**Use for**: editable mapping of strings to strings — custom translations, alias maps, header overrides.

**Declaration**:
```jsonc
{
  "type": "key-value-list",
  "label": "Header overrides",
  "keyLabel": "Header",
  "valueLabel": "Value",
  "default": [
    { "key": "Authorization", "value": "Bearer ${GITHUB_TOKEN}" }
  ],
  "min": 0,
  "max": 20
}
```

**Parameters**: `label` (required), `description?`, `keyLabel?` (default `"Key"`), `valueLabel?` (default `"Value"`), `default?: Array<{ key, value }>`, `min?`, `max?`.

**Value type**: `Array<{ key: string, value: string }>`.

**UI**: small editable table.

---

## Stability

- The catalog of 10 input-types is the v1 surface.
- Adding a new input-type is a **catalog-minor bump**; renaming or removing one is a **catalog-major bump** and triggers `sm plugins upgrade` migration.
- The `ISettingDeclaration` discriminated-union shape is stable. Adding a new optional parameter to an existing type is a minor bump; making a parameter required or removing one is a catalog-major bump.
- Value-type promises (the "Value type" entry per type above) are stable. Changing the runtime value type for an existing input-type is a catalog-major bump.
- The `secret` storage and audit-event behaviors are stable; the encryption scheme is internal and may change without a manifest-visible bump.
