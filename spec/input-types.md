# Input-types for plugin settings

Closed catalog of input-types for the per-extension `settings` map (plugin-level settings are not supported; the map lives on each extension's manifest). Plugin authors pick a `type` by name; the kernel knows the value schema; the UI generates a form per declaration; the CLI's `sm plugins config <id>` exposes the same surface. Authors NEVER write JSON Schema for settings, they pick a name and supply per-type parameters.

This doc is the **author-facing reference**. The normative shape lives in [`schemas/input-types.schema.json`](./schemas/input-types.schema.json):

- `$defs/InputTypeName`, closed enum of input-type names
- `$defs/ISettingDeclaration`, manifest-side declaration shape (discriminated by `type`)
- `$defs/Setting_<TypeName>`, per-type declaration schema with parameters

The `settings` field lives on the extension manifest base, [`schemas/extensions/base.schema.json`](./schemas/extensions/base.schema.json) at `#/properties/settings`. Tutorial walkthrough is in [`plugin-author-guide.md`](./plugin-author-guide.md) §View contributions → "Settings".

## Catalog overview

| Type | Value at runtime | Use for |
|---|---|---|
| [`string-list`](#string-list) | `string[]` | keyword lists, ignore patterns, allow-lists |
| [`single-string`](#single-string) | `string` | URLs, names, identifiers |
| [`boolean-flag`](#boolean-flag) | `boolean` | on/off toggles |
| [`integer`](#integer) | `number` (always integer) | counts, thresholds, limits |
| [`number`](#number) | `number` (decimal) | thresholds, ratios, confidence floors |
| [`enum-pick`](#enum-pick) | `string` | pick one from a closed set |
| [`enum-multipick`](#enum-multipick) | `string[]` | pick zero or more |
| [`path-glob`](#path-glob) | `string` or `string[]` | file path patterns |
| [`regex`](#regex) | `string` | ECMAScript regex body |
| [`secret`](#secret) | `string` | tokens, passwords, API keys |
| [`key-value-list`](#key-value-list) | `Array<{ key, value }>` | custom maps, alias dictionaries |
| [`match-list`](#match-list) | `Array<{ type, value }>` | ignore lists, suppression rules mixing exact values, regexes, and globs |

## Common conventions

**Required fields**: every declaration requires `type` and `label`. `description` is optional. Other parameters are per-type.

**Default values**: most types accept a `default` parameter, used when the user has not yet configured the setting.

**Validation**: the kernel's settings resolver takes the manifest `default`, overlays the operator's merged config value, and validates the result against the per-type value rules while composing the enabled extensions. A value that fails **falls back to the declared default and emits a warning**; it never aborts the scan and never changes the plugin's load status (there is no `invalid-settings` status). The CLI writer rejects a bad value earlier, at write time, so the fallback is the last line of defence for a hand-edited settings file.

**CLI coercion**: `sm plugins config <plugin>/<ext> <settingId> <value>` receives the value as a shell string and coerces it to the declared type before validating and writing (`integer` / `number` parsed numerically, `boolean-flag` from `true` / `false`, `string-list` / `enum-multipick` / `key-value-list` / `match-list` parsed as JSON). A value that cannot be coerced or fails validation is rejected at write time with a typed error, not deferred to the next scan.

**English-only labels**: per [`AGENTS.md`](../AGENTS.md), externalized texts, not internationalized. Use English `label` and `description` strings.

**Settings are read-once**: extractors receive `ctx.settings.<settingId>` at invocation. Changing a setting requires `sm scan` to re-emit affected contributions.

---

## `string-list`

**Use for**: arrays of free-form strings, keyword lists, file extensions, tag allow-lists.

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

**UI**: tag input (a multi-value chips control; the reference UI uses PrimeNG AutoComplete in multiple/no-typeahead mode, since PrimeNG retired its Chips component, any equivalent `string[]` tag input conforms).

---

## `single-string`

**Use for**: a single text value, URLs, names, identifiers.

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

**Use for**: integer values with optional bounds, counts, thresholds, retry limits.

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

## `number`

**Use for**: decimal numbers with optional bounds, thresholds (`0.3`), ratios, confidence floors.

**Declaration**:
```jsonc
{
  "type": "number",
  "label": "Confidence floor",
  "default": 0.5,
  "min": 0,
  "max": 1,
  "step": 0.05
}
```

**Parameters**: `label` (required), `description?`, `default?: number`, `min?`, `max?`, `step?` (default 1, must be > 0).

**Value type**: `number` (whole or fractional; use [`integer`](#integer) when the value must be a whole number). `NaN` / `Infinity` rejected.

**UI**: PrimeNG `<p-inputnumber>` with `mode="decimal"`.

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

**Use for**: glob patterns, ignore lists, allow-lists, scope filters.

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

**UI**: text input (single) or tag input (multiple), validated against the installed glob library at form submit.

---

## `regex`

**Use for**: ECMAScript regex patterns, match analyzers, parsing patterns.

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

**UI**: text input. Compilation tested at form submit (rejected at write time) and again at extension invocation, where a pattern that fails to compile falls back to the declared default with a warning.

---

## `secret`

**Use for**: sensitive strings, API tokens, passwords, signing keys.

**Declaration**:
```jsonc
{
  "type": "secret",
  "label": "GitHub API token",
  "envVar": "GITHUB_TOKEN"
}
```

**Parameters**: `label` (required), `description?`, `envVar?` (uppercase ASCII identifier). Resolution order when `envVar` is declared: a NON-EMPTY process-environment value under that name wins over any stored value; empty or unset falls through to the stored project-local value; neither present leaves the setting unset (`ctx.settings` omits the key). Lets CI inject a token without writing it to disk.

**Value type**: `string`.

**UI**: `<input type="password">` with reveal toggle.

**Storage**: project-local `settings.local.json` (gitignored), never the committed `settings.json`. The protection is that the value never travels via the shared repo, NOT encryption, it is plain text on the local machine. The kernel routes any `secret`-typed setting to the project-local layer automatically (the dynamic equivalent of `PROJECT_LOCAL_ONLY_KEYS`, destination follows the declared type, not a fixed key list). Logged as `<redacted>` in CLI output.

---

## `key-value-list`

**Use for**: editable mapping of strings to strings, custom translations, alias maps, header overrides.

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

## `match-list`

**Use for**: ignore lists and suppression rules where one list mixes exact values, regex patterns, and gitignore-style globs (e.g. reference targets an analyzer must skip).

**Declaration**:
```jsonc
{
  "type": "match-list",
  "label": "Ignored references",
  "description": "Reference targets never reported as broken.",
  "default": []
}
```

**Parameters**: `label` (required), `description?`, `default?: Array<{ type, value }>`.

**Value type**: `Array<{ type: 'literal' | 'regex' | 'glob', value: string }>`. Each entry's `value` is a single line of at most 256 characters with no ASCII control or DEL characters.

**Matching semantics** (against the candidate string the consuming extension tests, verbatim):
- `literal`: exact equality, case-sensitive.
- `regex`: ECMAScript pattern body (no `/` delimiters, no flags), unanchored `RegExp.test`; anchor with `^` / `$` when exactness is wanted. Compiled at form submit and again at extension invocation, like [`regex`](#regex).
- `glob`: gitignore-style pattern matched by the implementation's ignore engine, the same semantics as `.skillmapignore` (`docs/x/` matches the whole subtree, `*.draft.md` matches at any depth). No compile concept, like [`path-glob`](#path-glob).

**UI**: list editor. Per-entry kind selector (`literal` default) plus value input to add; existing entries render as removable rows with a kind chip. An uncompilable regex entry is rejected inline at the input, before any write.

---

## Stability

- The catalog of 12 input-types is the v1 surface (`match-list` added post-1.0 as a catalog-minor).
- Adding a new input-type is a **catalog-minor bump**; renaming or removing one is a **catalog-major bump** and triggers `sm plugins upgrade` migration.
- The `ISettingDeclaration` discriminated-union shape is stable. Adding a new optional parameter to an existing type is a minor bump; making a parameter required or removing one is a catalog-major bump.
- Value-type promises (the "Value type" entry per type above) are stable. Changing the runtime value type for an existing input-type is a catalog-major bump.
- The `secret` storage behavior (project-local `settings.local.json`, gitignored, plain text) is stable; secret values are never written to the committed layer. No encryption-at-rest in v1: the contract is "does not travel via the repo", not "encrypted on disk".
