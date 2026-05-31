# Plugin author guide

How to ship a third-party `skill-map` plugin: directory layout, manifest fields, the six extension kinds, storage choice, version compatibility, dual-mode posture, and how to unit-test the result against the kernel's public types.

This guide is **descriptive prose, not the normative contract**. The normative pieces live in the JSON Schemas under [`schemas/`](./schemas/) and in [`architecture.md`](./architecture.md); every claim here is cross-linked to its source. When this guide disagrees with a schema, the schema wins; when it disagrees with `architecture.md` on system behaviour, `architecture.md` wins. To keep the guide thin, the deep per-system contracts (extension semantics, the resolver phase, the persistence sweeps, the isolation model) are NOT restated here, follow the links.

> **Status.** Pre-1.0 (`spec` is in `0.y.z`). The author surface is still settling; breaking changes ship as **minor** bumps per [`versioning.md`](./versioning.md) until the first `1.0.0`. The shape documented here matches the manifest schemas as of the structure-as-truth refactor (the kernel derives `id` / `kind` / the Provider kind catalog from disk, so they are no longer manifest fields).

---

## Quick start

```text
my-plugin/
├── plugin.json                          ← plugin metadata (required)
└── extractors/                          ← one folder per extension kind
    └── my-extractor/
        ├── index.js                     ← extension entry (required)
        ├── text.ts                      ← user-facing strings (optional)
        └── my-extractor.test.ts         ← tests live next to the code (optional)
```

The kernel auto-discovers extensions by walking
`<plugin-dir>/<kind>s/<name>/index.{js,mjs,ts}` for each known kind
(`providers`, `extractors`, `analyzers`, `actions`, `formatters`,
`hooks`). **The folder layout IS the source of truth**: the plugin id comes from the
top-level dir, the kind from the subfolder name, the extension id from the
extension folder name. The manifest does NOT declare an
`extensions[]` array, and an extension file does NOT declare its own `id` or `kind`
(a manifest carrying either is rejected as `invalid-manifest`).

**Co-located files convention**: any siblings of `index.{js,mjs,ts}`
that the kernel does NOT recognise as an entry point are author
files. Two names are blessed by convention:

- **`text.ts`** holds the extension's externalised user-facing
  strings. One per extension; imported by `index.ts` as `./text.js`.
  Plain TS module, no schema, no codegen.
- **`<extension-name>.test.ts`** (or `.test.mjs` / `.test.js`) is
  the colocated test suite, picked up by the workspace's test glob
  (`plugins/**/*.test.ts`).

Both are optional. The kernel ignores everything that isn't
`index.{js,mjs,ts}`, so future per-extension fixtures or schemas can
live in the same folder without manifest plumbing.

```jsonc
// my-plugin/plugin.json
{
  "version": "1.0.0",
  "specCompat": "^0.40.0",
  "catalogCompat": "^1.0.0",
  "description": "Example plugin."
}
```

```javascript
// my-plugin/extractors/my-extractor/index.js
export default {
  // id, kind, version, pluginId are NOT declared here:
  //   - id / kind come from the folder path
  //   - version / pluginId are injected by the loader
  description: 'Emits a reference per something.md mention.',
  scope: 'body',
  extract(ctx) {
    // ctx.node, ctx.body, ctx.frontmatter, ctx.emitLink, ctx.enrichNode, ctx.emitContribution
    // Output flows through the callbacks; the method returns void.
    ctx.emitLink({
      source: ctx.node.path,
      target: 'something.md',
      kind: 'references',
      confidence: 'high',
      sources: ['my-extractor'],
    });
  },
};
```

> **Note.** External (user-authored) plugins MUST declare `version` per extension; the AJV check rejects manifests missing it. The example omits it only because the loader injects it for the reference impl's built-ins. For your own plugin, add `version: '1.0.0'` to the export.

Drop the directory under `<cwd>/.skill-map/plugins/` and
`sm plugins list` picks it up. A folder/kind mismatch (e.g. an extractor placed
under `analyzers/`) surfaces as `invalid-manifest`.

---

## Discovery

The kernel scans one root: `<cwd>/.skill-map/plugins/`, committed-with-the-repo plugins. There is no implicit user-level discovery (see [`cli-contract.md` §Scope is always project-local](./cli-contract.md)): plugins live with the project that uses them.

A plugin is any direct child directory of that root containing a `plugin.json`. Nested directories are not searched recursively. Pass `--plugin-dir <path>` to replace the default root with a custom directory (mostly for testing, or for loading a plugin set the operator explicitly opts into).

After every change to the `plugins/` folder, run `sm plugins list` to see each plugin's load status. The seven statuses are documented under [Diagnostics](#diagnostics).

### Plugin id uniqueness

The plugin `id` is the **directory name** (`<root>/<id>/plugin.json`), not a manifest field, and is **globally unique** across every active discovery root. The kernel enforces this in two places:

1. **Directory name IS the id.** A manifest carrying an `id` key is rejected as `invalid-manifest`. Same-root collisions are impossible by construction (a filesystem cannot host two siblings with the same name).
2. **Cross-root id collisions are blocked, both sides.** If two plugins from different roots (project + `--plugin-dir`) share a directory name, **both** receive status `id-collision`. There is no precedence rule, neither loads its extensions; the user renames one and reruns.

`sm plugins list` shows the conflict; `sm plugins doctor` exits `1` whenever any `id-collision` is present.

### Qualified extension ids

Every extension is identified in the registry, and in any cross-extension reference, by its **qualified id** `<plugin-id>/<extension-id>`. The plugin id (the directory name) is therefore also the **namespace** for every extension the plugin ships.

Concrete examples for the reference impl's built-in extensions:

| Extension | Short id (folder name) | Qualified id (in the registry) |
|---|---|---|
| Claude Provider | `claude` | `claude/claude` |
| Annotations extractor | `annotations` | `core/annotations` |
| Slash-command extractor | `slash-command` | `claude/slash-command` |
| At-directive extractor | `at-directive` | `claude/at-directive` |
| Markdown-link extractor | `markdown-link` | `core/markdown-link` |
| External-URL counter | `external-url-counter` | `core/external-url-counter` |
| Reference-broken analyzer | `reference-broken` | `core/reference-broken` |
| ASCII formatter | `ascii` | `core/ascii` |

Built-ins split between two namespaces:

- **`core/`**, kernel-internal primitives, platform-agnostic: every built-in analyzer, the ASCII formatter, the cross-vendor extractors (`annotations`, `markdown-link`, `external-url-counter`), the universal `markdown` Provider fallback, and the `update-check` hook.
- **`claude/`**, the Claude Code Provider plugin: the Provider plus the Claude-flavoured extractors (`slash-command`, `at-directive`). Other vendor plugins (`antigravity`, `openai`, `agent-skills`) follow the same shape (Provider only).

### Extension id shape

The convention applied to every built-in extension id is **`<domain>-<detail>`** (general to specific): the leftmost segment names the entity the extension reasons about (`node`, `link`, `annotation`, `reference`, `name`, ...), the rest narrows the behaviour. Examples: `annotation-orphan`, `link-counter`, `node-stability`, `name-reserved`, `reference-broken`. Even Actions live under their entity domain (`node-bump`, `node-supersede`) rather than verb-style ids, so the catalog reads as a structured list.

Authors are not required to follow this, but it makes `sm plugins list` self-grouping. In the extension file, declare only the short id-bearing **folder name**, not a prefixed id; the loader composes `<plugin-id>/<short-id>` from `plugin.json` (the directory name) and the extension folder. Any other cross-extension reference (`precondition.analyzerIds`, ...) uses the qualified id of the target.

### Toggle model

Every extension is independently toggle-able by its qualified id `<plugin>/<ext-id>` (e.g. `claude/at-directive`, `core/node-superseded`). The **plugin row is a presentational grouping**, not the granular toggle target: the user sees a row per plugin in `sm plugins list` and the Settings UI, with each extension listed underneath with its own enabled / disabled state.

Two id shapes resolve at the toggle surface:

- **Qualified id** (`<plugin>/<ext-id>`): flips exactly that extension. No prompt.
- **Bare plugin id** (`claude`, `core`): the **bundle (aggregate) macro form**, fans the toggle across every extension inside the plugin.
  - Single-extension plugin (`openai`, `antigravity`, `agent-skills`): applies directly, no prompt.
  - Multi-extension plugin (`claude`, `core`): requires `--yes` OR an interactive TTY confirm. CI / pipe contexts must pass `--yes`.

`--all` is the cascade variant: it expands to every extension in every discovered plugin and applies the same `--yes` / TTY-confirm gate.

Resolution order per id: DB override (`config_plugins`) > `settings.json#/plugins/<id>/enabled` > installed default (`true`). Persisted toggle keys are always qualified `<plugin>/<ext>` ids (the bundle macro path expands at write time).

There is no `granularity` manifest field; per-extension toggling is the only model.

### Extractor / Analyzer / Action `precondition`, narrow the pipeline

An Extractor, Analyzer, or Action MAY declare an optional `precondition` block. When declared, the kernel runs the extension **only** against nodes that satisfy every declared sub-filter, fail-fast (no context built, no method call) so it wastes zero CPU on nodes it cannot process. The shape is shared across the three kinds:

```ts
precondition?: {
  kind?: string[];       // qualified `<plugin>/<kindName>` ids
  provider?: string[];   // plugin ids
  analyzerIds?: string[]; // Action only: which analyzers' findings this action resolves (Modelo B)
};
```

| `precondition` | Behaviour |
|---|---|
| Absent (`undefined`) | **Default.** Runs on every kind the loaded Providers emit. |
| `{ kind: ['claude/skill'] }` | Runs only on skill nodes from the Claude provider. |
| `{ kind: ['claude/skill', 'agent-skills/skill'] }` | Runs on skills from either provider. |
| `{ provider: ['claude'] }` | Coarser: runs on every kind the `claude` plugin declares. |
| `{ kind: ['claude/skill'], provider: ['claude'] }` | Both filters apply (AND). |

Prefer `precondition.kind` over `precondition.provider` when the filter is really about the kind. There is no wildcard syntax, omitting the field IS the wildcard.

**Unknown qualified kinds are non-blocking.** A `precondition.kind` naming a kind no installed Provider declares (typo, missing Provider plugin) still loads with status `enabled`; `sm plugins doctor` surfaces an informational `precondition-kind-unknown` warning without promoting its exit code, the matching Provider may arrive later.

Use case, a deterministic frontmatter-tag extractor that only makes sense for skills:

```javascript
export default {
  version: '1.0.0',
  description: 'Lifts the `tags:` frontmatter array into `references` links for skill nodes.',
  scope: 'frontmatter',
  precondition: { kind: ['claude/skill'] },
  extract(ctx) {
    const tags = Array.isArray(ctx.frontmatter.tags) ? ctx.frontmatter.tags : [];
    for (const t of tags) {
      ctx.emitLink({
        source: ctx.node.path,
        target: t,
        kind: 'references',
        confidence: 'high',
        sources: ['tag-extractor'],
      });
    }
  },
};
```

> **Why no `mode` field on Extractors?** Extractors are deterministic-only; they sit on `sm scan`'s synchronous loop, which must stay fast and reproducible. If you need an LLM to infer something about a node, write a probabilistic **Action** and let the user dispatch it as a job. See [`architecture.md` §Execution modes](./architecture.md#execution-modes).

### Module top-level side effects survive load timeouts

The plugin loader wraps every `import()` in an `AbortController`-backed timeout (5s in the reference impl). When it fires, the loader marks the plugin `load-error` and proceeds.

**Node cannot cancel an in-flight `import()`**: once the runtime evaluates the module, every top-level line WILL run, even after the loader gave up. That includes a top-level `setInterval`, a top-level `fetch`, or a top-level filesystem write.

The contract is therefore: **do NOT do work at module top level**. Place every side effect inside an extension's lifecycle method (`extract`, `on`, `run`, ...) so it runs under the loop the kernel actually drives, and only when the load succeeded. A failed compat check does not protect you, the loader imports the module before checking `specCompat`. If you need module-level state (e.g. a compiled regex), memoise it lazily inside the lifecycle method.

---

## Manifest

Required fields (normative shape in [`schemas/plugins-registry.schema.json#/$defs/PluginManifest`](./schemas/plugins-registry.schema.json)):

| Field | Type | Notes |
|---|---|---|
| `version` | semver | Plugin version, independent of `specCompat`. |
| `specCompat` | semver range | Spec versions this plugin is compatible with. Checked via `semver.satisfies(specVersion, this)` at load. |
| `catalogCompat` | semver range | **Required.** Range against the view-slots + input-types catalog, which evolves on its own cadence independent of `specCompat`. |
| `description` | string | Short description shown in `sm plugins list` and the UI. English-only. |

Optional fields: `storage` (`{ mode: 'kv' }` or `{ mode: 'dedicated', tables, migrations }`), `author`, `license` (SPDX), `homepage`, `repository`.

**Structure-as-truth.** The plugin id is the directory name, NOT a manifest field; a manifest carrying `id` is rejected. The manifest does NOT list extensions, the kernel discovers each by walking `<plugin-dir>/<kind>s/<name>/index.{js,mjs,ts}`. A Provider's kind catalog lives on disk at `<plugin>/kinds/<kindName>/{schema.json, kind.json}` (see [The six extension kinds → Providers](#providers)).

### `specCompat` strategy

Pre-`v1.0.0`, narrow ranges are the defensive default: minor bumps MAY carry breaking changes per [`versioning.md`](./versioning.md), so a plugin spanning minor boundaries can load and then crash at first use against a changed schema. Pin to the minor you tested (`"^0.40.0"` resolves any `0.40.x`; `">=0.40.0 <0.41.0"` is the explicit form). After the spec hits v1.0.0, `"^1.0.0"` is the recommended range for most plugins.

---

## The six extension kinds

The kernel knows six categories. Each has a JSON Schema under [`schemas/extensions/`](./schemas/extensions/); the kernel validates every manifest against the schema for its declared kind at load time. The full per-kind behavioural contract lives in [`architecture.md` §Extension kinds](./architecture.md#extension-kinds), this section is the author-facing summary plus one minimal example per kind.

| Kind | Method | Receives | Returns | Mode |
|---|---|---|---|---|
| `provider` | `walk` / `classify` | filesystem roots, candidate path | `{ kind, provider } \| null` | deterministic only |
| `extractor` | `extract(ctx)` | one node + body + frontmatter + callbacks | `void` (via `ctx.emitLink` / `ctx.enrichNode` / `ctx.emitContribution` / `ctx.store`) | deterministic only |
| `analyzer` | `evaluate(ctx)` | full graph | `Issue[]` | dual-mode |
| `action` | `run(ctx)` | one or more nodes | report / rendered prompt | dual-mode |
| `formatter` | `format(ctx)` | full graph | `string` | deterministic only |
| `hook` | `on(ctx)` | a curated lifecycle event payload | `void` (side effects) | **deterministic only** |

The runtime instance you `export default` includes both the manifest fields (`version`, `description`, plus kind-specific metadata) AND the runtime method. The kernel strips function-typed properties before AJV-validating the manifest, so the method lives alongside metadata.

### Extractors

Pure single-node analysis. **Never** read another node, the graph, or the database, cross-node reasoning is for analyzers. Manifest fields beyond the base: `scope` (`'frontmatter'` | `'body'` | `'both'`), optional `precondition`, optional `ui` (view contributions). Spec at [`schemas/extensions/extractor.schema.json`](./schemas/extensions/extractor.schema.json).

`extract(ctx) → void`. Output flows through callbacks the kernel binds onto `ctx`:

- **`ctx.emitLink(link)`**, append a `Link`. The kernel validates `link.kind` against the **global closed enum** (`invokes`, `references`, `mentions`, `supersedes`); off-enum kinds drop as `extension.error`. Confidence is declared per emit (default `'medium'`). URL-shaped targets are partitioned into `node.externalRefsCount` and never persisted. (There is no per-extractor `emitsLinkKinds` allowlist anymore.)
- **`ctx.enrichNode(partial)`**, merge kernel-curated properties onto the node's enrichment layer (persisted into `node_enrichments`). **Strictly separate from the author frontmatter**, which is immutable from any Extractor. Use it for inferred facts (computed titles, summaries) the author did not write.
- **`ctx.emitContribution(id, payload)`**, view contributions (see [View contributions](#view-contributions)).
- **`ctx.store`**, plugin-scoped persistence, present only when `plugin.json` declares `storage.mode`. See [`plugin-kv-api.md`](./plugin-kv-api.md).

You can read `ctx.node.sidecar.*` freely: the per-`(node, extractor)` cache hashes the sidecar `annotations` block alongside the body, so a `.sm`-only edit invalidates the cached run automatically.

> **Pick a syntax that doesn't collide with built-ins.** `core/at-directive` claims `@`, `core/slash-command` claims `/`, both with LLM-aligned semantics (and both strip fenced code blocks + inline backticks before matching). A new extractor matching one of those prefixes will fire on the same input and, if it emits a different `target` shape, raises a `trigger-collision`. The example below uses a wikilink-style `[[ref:<name>]]` pattern to side-step this. See [`architecture.md` §Extractor · trigger normalization](./architecture.md#extractor--trigger-normalization) for the normalization pipeline.

```javascript
export default {
  version: '1.0.0',
  description: 'Extracts [[ref:<name>]] tokens from the body.',
  scope: 'body',
  extract(ctx) {
    for (const m of ctx.body.matchAll(/\[\[ref:([a-z0-9-]+)\]\]/gi)) {
      ctx.emitLink({
        source: ctx.node.path,
        target: m[1],
        kind: 'references',
        confidence: 'medium',
        sources: ['ref-extractor'],
        trigger: { originalTrigger: m[0], normalizedTrigger: m[0].toLowerCase() },
      });
    }
  },
};
```

### Analyzers

Cross-node reasoning over the merged graph; runs after every Provider and extractor. Dual-mode (`mode: 'deterministic'` default, `'probabilistic'` opt-in). Deterministic analyzers run synchronously inside `sm scan` / `sm check`; probabilistic ones dispatch as jobs and NEVER participate in the deterministic scan pipeline. Optional `precondition` and `ui`. Spec at [`schemas/extensions/analyzer.schema.json`](./schemas/extensions/analyzer.schema.json).

The analyzer↔action relationship is declared from the **Action** side via `precondition.analyzerIds` (Modelo B); there is no `recommendedActions` field on the Analyzer.

```javascript
export default {
  version: '1.0.0',
  description: 'Flags skill nodes with zero inbound links.',
  evaluate(ctx) {
    const inbound = new Map();
    for (const link of ctx.links) {
      inbound.set(link.target, (inbound.get(link.target) ?? 0) + 1);
    }
    return ctx.nodes
      .filter((n) => n.kind === 'skill' && (inbound.get(n.path) ?? 0) === 0)
      .map((n) => ({
        analyzerId: 'orphan-skill',
        severity: 'info',
        message: `Skill ${n.path} has no inbound references.`,
        nodeIds: [n.path],
      }));
  },
};
```

> Until the job subsystem ships (Step 10), probabilistic analyzers are skipped silently by `sm scan`; `sm check --include-prob` loads them, lists them on stderr, and the `--async` companion is a reserved no-op.

### Formatters

Graph-to-string serializers, invoked by `sm graph --format <name>`. The format **name** comes from the formatter's folder name; the manifest declares `contentType` (MIME hint). Output **MUST** be byte-deterministic for the same input graph (the snapshot suite relies on it). Spec at [`schemas/extensions/formatter.schema.json`](./schemas/extensions/formatter.schema.json).

```javascript
// formatters/csv/index.js  → sm graph --format csv
export default {
  version: '1.0.0',
  description: 'Serializes links as CSV.',
  contentType: 'text/csv',
  format(ctx) {
    const rows = ['source,target,kind,confidence'];
    for (const link of ctx.links) {
      rows.push([link.source, link.target, link.kind, link.confidence].join(','));
    }
    return rows.join('\n');
  },
};
```

### Hooks

Declarative subscribers to a curated set of kernel lifecycle events. **Deterministic-only**: a hook reacts to events and cannot mutate the pipeline, block emission, or alter outputs. Errors are caught by the dispatcher (logged as `extension.error` with `kind: 'hook-error'`) and NEVER block the main flow. LLM-dependent reactions are modeled as a deterministic Hook that enqueues a probabilistic Action via `ctx.queue('<plugin>/<action>', payload)`. Spec at [`schemas/extensions/hook.schema.json`](./schemas/extensions/hook.schema.json); trigger semantics at [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set).

The ten hookable triggers (any other event yields `invalid-manifest`): eight pipeline-driven, `scan.started`, `scan.completed`, `extractor.completed`, `analyzer.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`, plus two CLI-process-driven, `boot` (before verb routing) and `shutdown` (after the verb's exit code resolves).

```javascript
export default {
  version: '1.0.0',
  description: 'Posts to Slack when a scan completes with issues.',
  triggers: ['scan.completed'],
  // Optional: filter narrows fan-out over the event payload (top-level fields only).
  // filter: { ... }
  async on(ctx) {
    const stats = ctx.event.data?.stats;
    if (!stats || stats.issuesCount === 0) return;
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `skill-map scan finished with ${stats.issuesCount} issue(s) in ${stats.durationMs} ms.`,
      }),
    });
  },
};
```

> **Filter narrows fan-out, not the trigger enum.** `filter` is a runtime predicate over the payload; it does not extend the hookable set. Declaring a non-curated trigger (e.g. `scan.progress`) is rejected at load regardless of any filter.

### Providers

Recognise a platform and declare a kind catalog. The catalog lives **on disk** (structure-as-truth): each kind under `<plugin>/kinds/<kindName>/` ships exactly two files, `schema.json` (the kind's frontmatter JSON Schema, MUST extend [`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) via `allOf` + `$ref`) and `kind.json` (per-kind metadata, today `{ ui: { label, color, colorDark?, emoji?, icon? } }`, validated against [`provider-kind.schema.json`](./schemas/extensions/provider-kind.schema.json)). The kernel derives the supported kind set from the `kinds/` directory listing; there is no inline `kinds` map and no `defaultRefreshAction` field.

The Provider manifest itself declares a top-level `presentation` block (its own identity in the lens dropdown / topbar / per-card chip, distinct from its kinds' `ui`), plus optional `detect`, `roots`, `gatedByActiveLens`, `read`, and `resolverRules`. The walker hardcodes the paths it scans within the project (`.claude/`, `.codex/`, ...); the kernel never extends the scan into `$HOME`. Spec at [`schemas/extensions/provider.schema.json`](./schemas/extensions/provider.schema.json); full behaviour (dispatch order, the universal markdown fallback, resolution / reservedNames / identifiers) in [`architecture.md` §Extension kinds](./architecture.md#extension-kinds).

```text
my-provider/
├── plugin.json
├── providers/my-provider/index.{ts,js}   ← walk / classify
└── kinds/
    ├── skill/{schema.json, kind.json}
    └── command/{schema.json, kind.json}
```

### Actions

Operate on one or more nodes. Dual-mode (`mode` optional, default `'deterministic'`). Files-by-convention: every Action carries `<action-dir>/report.schema.json`; probabilistic Actions additionally carry `<action-dir>/prompt.md`. Probabilistic estimates go in `probExpectedDurationSeconds` (drives job TTL). Optional `precondition` (including `analyzerIds`, the Modelo B link). These ship later in the v1.x line as bundled built-ins; until Step 10 lands the job subsystem, test them with a live kernel via `sm scan` against a fixture rather than in unit tests. Spec at [`schemas/extensions/action.schema.json`](./schemas/extensions/action.schema.json).

---

## Frontmatter validation, three-tier model

The kernel validates frontmatter on a graduated dial; tighter is opt-in. The policy lives in **analyzers**, not the JSON Schemas, the schemas stay shape-only ([`base.schema.json`](./schemas/frontmatter/base.schema.json) declares `additionalProperties: true`) so authors extend their own nodes without forking the spec. Per-kind schemas live with the **Provider** that emits the kind.

| Tier | Mechanism | Behaviour on unknown / non-conforming fields |
|---|---|---|
| **0, Default permissive** | `additionalProperties: true` on `base` and every per-kind schema. | Field passes silently, persists in `node.frontmatter`, available to every extension. |
| **1, Built-in `unknown-field` analyzer** | Deterministic, always active. | Emits a `warn` Issue for every key outside the documented catalog. |
| **2, Strict mode** | `scan.strict: true` in settings, or `--strict` on `sm scan`. | Promotes all frontmatter warnings to `error`; `sm check` then exits `1`. CI fails. |

Tier 1 is normative: the kernel ships the analyzer out of the box. To keep an unknown key quietly, either move it under `metadata.*` (the base schema permits free-form keys there) or accept the persistent `warn`.

### Why no "schema-extender" plugin kind

To make custom frontmatter keys first-class, write a deterministic **Analyzer** that reads the keys from `node.frontmatter` (Tier 0 already exposes them), validates them against your domain shape, and emits Issues. A "schema-extender" kind would force every consumer to re-resolve the active schema set per scan; an analyzer-driven approach keeps the parser one-pass and the validation surface composable. If the check must be CI-blocking, the analyzer emits at `severity: 'error'` directly (`--strict` / `scan.strict` apply only to the kernel's own frontmatter warnings).

---

## Storage

A plugin that persists state declares `storage` in its manifest. Two modes, both documented in full at [`plugin-kv-api.md`](./plugin-kv-api.md).

### Mode A, KV

```jsonc
{ "storage": { "mode": "kv" } }
```

Backed by the kernel-owned `state_plugin_kvs` table. `ctx.store` exposes `get` / `set` / `list` / `delete`. No migrations, ready immediately. Pick KV when state is a small map (< ~1 MB, simple key lookup or prefix list). 90% of plugins fit.

### Mode B, Dedicated

```jsonc
{
  "storage": {
    "mode": "dedicated",
    "tables": ["plugin_my_plugin_items"],
    "migrations": ["./migrations/001_init.sql"]
  }
}
```

The plugin owns SQL tables prefixed `plugin_<normalizedId>_*`. Migrations live under `<plugin-dir>/migrations/NNN_<name>.sql` and apply through `sm db migrate`. Pick Dedicated when you need indexes, joins, or relational shape. The kernel enforces the namespace prefix at three layers (discovery, apply, post-commit catalog sweep) and forbids transaction / pragma statements in migration files, see [`plugin-kv-api.md`](./plugin-kv-api.md) and [`db-schema.md`](./db-schema.md) for the normative rules.

### Opt-in write validation

`emitLink` and `enrichNode` are always validated by the kernel against `link.schema.json` / `node.schema.json`. `ctx.store` writes are permissive by default (the author owns the table layout). To validate your own writes, declare JSON Schemas in the manifest:

- **Mode A**: `storage.schema` (single value-shape) validates every `ctx.store.set(key, value)`.
- **Mode B**: `storage.schemas` (sparse map, table → schema path) validates `ctx.store.write(table, row)` for the named tables; tables absent from the map accept any shape.

A schema file missing / unparseable / AJV-rejected at load flips the plugin to `load-error`. A write violating its declared schema throws synchronously, naming the plugin, table, and AJV errors. Skip validation for free-form payloads (cache rows, counters) where it is friction with no payoff.

---

## Execution modes

Analyzer and Action declare `mode` (optional, default `'deterministic'`); Provider / Extractor / Formatter / Hook are deterministic-only by spec and MUST NOT declare it.

A `probabilistic` Analyzer / Action receives `ctx.runner` (a `RunnerPort`) and dispatches its work to the configured LLM runner; it runs ONLY as a queued job (`sm job submit <kind>:<id>`), never in `sm scan`. The full per-kind capability matrix lives in [`architecture.md` §Execution modes](./architecture.md#execution-modes).

---

## Annotation contribution

> Plugins that want to write a first-class field into a node's co-located `.sm` sidecar declare it via the optional `annotation` block on their extension manifest. The kernel validates it at load time, surfaces the runtime catalog via `kernel.getRegisteredAnnotationKeys()` (consumed by the BFF / UI for autocomplete), and treats two plugins claiming the same root-exclusive key as a fatal startup error. Normative contract: [`architecture.md` §Annotation system → Plugin contributions](./architecture.md#plugin-contributions).

### Manifest shape

`annotation` is a **single** declaration per extension; **the contributed key is the extension's id** (its folder name). An extension that needs several keys splits into several extensions, one per key. The block declares an inline JSON Schema for the value plus two policy fields:

```js
// my-plugin/extractors/last-reviewed-at/index.js  → contributes key `last-reviewed-at`
export default {
  version: '1.0.0',
  description: 'Records the last review timestamp on each node.',
  scope: 'frontmatter',
  annotation: {
    schema: { type: 'string', format: 'date-time' },
    // location defaults to 'namespaced', ownership to 'shared'
  },
  // ...extract(ctx) writes the value through the kernel's sidecar path...
};
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `schema` | inline JSON Schema (object) | required | Validates the value written under this key. Compiled with AJV at load. |
| `location` | `'namespaced'` \| `'root'` | `'namespaced'` | Where the key lands in the sidecar. |
| `ownership` | `'shared'` \| `'exclusive'` | `'shared'` | Conflict policy. REQUIRED to be `'exclusive'` when `location: 'root'`. |

The `schema` is **inline** (an object literal in the manifest), not a `$ref` to a file.

### Namespacing default vs root opt-in

By default a contribution lands inside the plugin's `<plugin-id>:` block at the sidecar root, so two plugins can contribute the same extension-id key without colliding:

```yaml
# .claude/agents/architect.sm
identity:
  path: .claude/agents/architect.md
  bodyHash: ...
  frontmatterHash: ...
annotations:
  version: 3
reviewer:                       # plugin 'reviewer', extension 'last-reviewed-at'
  last-reviewed-at: 2026-05-06T10:00:00Z
auditor:                        # plugin 'auditor', same key, different namespace, no conflict
  last-reviewed-at: 2026-05-05T18:30:00Z
```

A top-level (root) key requires `location: 'root'` AND `ownership: 'exclusive'`. The pair travels together: `.sm` writes deep-merge per the `SidecarStore` contract, so a shared root key would route non-deterministically. Use root sparingly, each root contribution reserves that name across the whole installed-plugin surface.

```js
// compliance-plugin/analyzers/compliance/index.js  → contributes root key `compliance`
export default {
  version: '1.0.0',
  description: 'Stamps a compliance block on audited nodes.',
  annotation: {
    schema: {
      type: 'object',
      required: ['audit'],
      properties: {
        audit: { type: 'string' },
        dueAt: { type: 'string', format: 'date-time' },
      },
    },
    location: 'root',
    ownership: 'exclusive',
  },
};
```

### Ownership and collision behaviour

- **`shared`** (default): multiple plugins MAY write the same key; each gets its own namespaced block, last-write-wins per `(plugin, key)` in `FilesystemSidecarStore.applyPatch`.
- **`exclusive`**: only this plugin may write the key. The kernel rejects any other plugin claiming the same `(key, location: 'root')` tuple. `exclusive` + `namespaced` is permitted but redundant (the namespace already isolates).

Two plugins claiming the same `(key, location: 'root', ownership: 'exclusive')` tuple is a **fatal startup error**: `loadPluginRuntime` throws `AnnotationContributionConflictError`, the host exits non-zero, the kernel does NOT boot. This is the only fatal path on the plugin-load surface (every other failure is per-plugin and the kernel keeps booting on the survivors), because otherwise annotated `.sm` files would become non-deterministically routed.

### Typo guard and runtime catalog

The built-in `core/annotation-field-unknown` Analyzer walks every parsed `.sm` and emits a `warn` issue per truly-unknown key (a key outside the curated `annotations:` catalog, outside the reserved blocks, and not matching any registered plugin namespace or root contribution; or a value failing the owning plugin's declared schema). It never blocks a scan.

The runtime catalog is reachable via `kernel.getRegisteredAnnotationKeys()` (each entry `{ pluginId, key, location, ownership, schema }`); built-in catalog fields from `annotations.schema.json` are NOT included. The BFF surfaces it through `GET /api/annotations/registered` for autocomplete.

---

## View contributions

> Lets plugins surface per-node data in the UI **without shipping any UI code**. You pick a **slot** by name from a closed kernel catalog; the slot fixes both the renderer and the payload shape. You declare per-node emissions in the extension manifest's `ui` map and emit payloads at scan time via `ctx.emitContribution(...)`. Normative contract: [`architecture.md` §View contribution system](./architecture.md#view-contribution-system).

### What you NEVER write

- HTML, CSS, JavaScript, or Angular components.
- JSON Schema for your contributions or your settings.
- The renderer component that draws your contribution.

You DO write: the `slot` name, optional presentation tuning per contribution, and the per-node payload your `extract(ctx)` / `evaluate(ctx)` emits.

### Manifest shape

Inside an extractor or analyzer manifest, declare a `ui` map (sibling of `annotation` / `settings`). Each key is your local contribution id; the value picks a slot. (The runtime catalog keeps the historical name `viewContributions`; only the manifest field is `ui`.)

```jsonc
{
  "ui": {
    "breakdown": {
      "slot": "inspector.body.panel.breakdown",
      "label": "Keyword hits",
      "emptyText": "No matches."
    },
    "total": {
      "slot": "card.footer.left",
      "icon": "🔍",
      "label": "kw",
      "emitWhenEmpty": false
    }
  }
}
```

Field reference (full schema in [`schemas/view-slots.schema.json`](./schemas/view-slots.schema.json) at `$defs/IViewContribution`):

| Field | Required | Notes |
|---|---|---|
| `slot` | yes | One of the 14 catalog names (see below). Unknown name → `invalid-manifest` at load. |
| `label` | no | Short human-readable label. English-only. |
| `tooltip` | no | Hover tooltip on the chip / panel header. |
| `icon` | no, but required for counter slots and `card.title.right` | Prefix-discriminated string (see below). |
| `emptyText` | no | Text shown when payload is empty AND `emitWhenEmpty: true`. |
| `emitWhenEmpty` | no, default `false` | When `false`, the kernel drops empty payloads silently. |
| `priority` | no | Ordering hint when multiple contributions share a slot. |

#### Icon string forms

Prefix-discriminated by the UI resolver:

```jsonc
{ "icon": "🔍" }                            // emoji, renders as text
{ "icon": "pi-search" }                     // PrimeIcons, equivalent to "pi pi-search"
{ "icon": "pi pi-search" }                  // PrimeIcons, full class string
{ "icon": "fa-solid fa-magnifying-glass" }  // FontAwesome, explicit family
{ "icon": "fa-regular fa-star" }            // FontAwesome, outlined variant
{ "icon": "fa-brands fa-github" }           // FontAwesome, brand glyph
{ "icon": "fa-magnifying-glass" }           // FontAwesome shorthand → fa-solid
```

A bare name without a prefix (`"search"`) is rejected at load. Emoji is the cross-platform safe choice; PrimeIcons covers generic UI glyphs; FontAwesome Free's `regular` set is limited.

### Slot catalog (closed, 14 slots)

The kernel ships exactly these 14 slots. Each fixes a renderer + a payload shape; the **per-slot semantics, edge cases, and exact payload schemas are the canonical reference in [`view-slots.md`](./view-slots.md)** (and [`schemas/view-slots.schema.json`](./schemas/view-slots.schema.json) at `$defs/payloads/<slot>`). Read those before emitting. Adding a slot requires a spec / UI / scaffolder round-trip.

| Slot | Renderer |
|---|---|
| `card.title.right` | icon marker (icon required) |
| `card.subtitle.left` | counter chip (icon required) |
| `card.footer.left` | counter chip (icon required) |
| `card.footer.right` | counter chip (icon required) |
| `graph.node.alert` | graph corner badge (reserved, see `view-slots.md`) |
| `inspector.header.badge.counter` | counter chip (icon required) |
| `inspector.header.badge.tag` | tag chip |
| `inspector.body.panel.breakdown` | bar chart panel |
| `inspector.body.panel.records` | table panel |
| `inspector.body.panel.tree` | tree panel |
| `inspector.body.panel.key-values` | definition list panel |
| `inspector.body.panel.link-list` | clickable list panel |
| `inspector.body.panel.markdown` | sanitized markdown panel |
| `topbar.nav.start` | scope chip |

### Chip vs Issue

For analyzers, a per-node card surfaces a finding through two independent channels: the `Issue` returned by `evaluate(ctx)` feeds the aggregated stats and the scan / check exit code; a view contribution to a card slot is **purely presentational** (its `severity` controls only the chip's own colour, never the count, never the exit code). The colour rule, when a chip may paint `warn` / `danger`, and the reserved status of `graph.node.alert` are documented in [`view-slots.md` §Chip vs Issue](./view-slots.md). Breaking the colour rule produces visually misleading cards and is caught in code review, not by the schema.

### Emit path

```ts
// Extractor (per-node walk): nodePath is implicit (ctx.node.path)
ctx.emitContribution('breakdown', { entries: [...] });
ctx.emitContribution('total', { value: total });

// Analyzer (post-merge graph): explicit nodePath, the analyzer sees every node at once
ctx.emitContribution(nodePath, 'breakdown', { ... });
```

The first id argument is the **manifest `ui` key**, NOT the slot name; the kernel composes the qualified id from your plugin id, extension id, and the key, and looks up the declared slot to validate the payload against `view-slots.schema.json#/$defs/payloads/<slot>`. Off-shape payloads emit an `extension.error` and drop silently, same posture as `emitLink`. For `topbar.nav.start`, analyzers use `ctx.emitScopeContribution(id, payload)` (reserved in the spec; the runtime callback lands when the first scope-level adopter arrives).

To surface the same data in two surfaces, declare two contributions (one per slot) and emit twice, there is no broadcast.

---

## Settings

User-configurable settings live on each extension's manifest in `settings: Record<string, ISettingDeclaration>` (sibling of `ui` / `annotation`). Each entry picks an `input-type` from a closed catalog; you NEVER write JSON Schema for settings. Plugin-level settings are not supported, the field is per-extension.

```jsonc
{
  "settings": {
    "keywords": {
      "type": "string-list",
      "label": "Keywords to track",
      "default": ["TODO", "FIXME"],
      "min": 1
    },
    "caseSensitive": {
      "type": "boolean-flag",
      "label": "Case-sensitive matching",
      "default": false
    }
  }
}
```

The ten input-types: `string-list`, `single-string`, `boolean-flag`, `integer`, `enum-pick`, `enum-multipick`, `path-glob`, `regex`, `secret`, `key-value-list`. The per-type parameters and runtime value shapes are the canonical reference in [`input-types.md`](./input-types.md) (schema at [`schemas/input-types.schema.json`](./schemas/input-types.schema.json) at `$defs/Setting_<TypeName>`).

The kernel exposes resolved settings via `ctx.settings.<settingId>`. Settings are read once at extension invocation; **changing a setting requires `sm scan` to re-emit** affected contributions (the UI surfaces a "settings changed, rescan needed" indicator).

### Catalog version

The slot + input-type catalog evolves on its own cadence. `catalogCompat` (required in the manifest) is the semver range you tested against, independent of `specCompat`. A mismatch surfaces as `incompatible-catalog`; resolution is `sm plugins upgrade <id>`, which runs registered migrations from the kernel's closed registry. When auto-migration is impossible (a slot you used was removed), the upgrade verb fails loud and your manifest needs a manual edit.

---

## Testing your plugin

Extensions are plain ESM modules with one entry point per kind; their inputs are well-typed context objects from `@skill-map/cli`. Unit-test without a kernel or DB: build a fake `ctx` literal, call the entry point, assert on what it captured.

```javascript
import { test } from 'node:test';
import { strictEqual } from 'node:assert';

import extractor from '../extractors/my-extractor/index.js';

test('emits one reference per [[ref:<name>]] token', async () => {
  const links = [];
  await extractor.extract({
    node: { path: 'a.md', kind: 'skill', provider: 'claude' },
    body: 'Talk to [[ref:architect]] or [[ref:sre]].',
    frontmatter: {},
    settings: {},
    emitLink: (link) => links.push(link),
    enrichNode: () => {},
    emitContribution: () => {},
  });
  strictEqual(links.length, 2);
  strictEqual(links[0].target, 'architect');
});
```

Analyzers take a `ctx` with `nodes`, `links`, and (if you assert on view contributions) an `emitContribution` spy, and return the issue array. Formatters take `{ nodes, links, issues }` and return a string. For probabilistic Actions, shape a fake `ctx.runner` that records the calls your test cares about. The public TypeScript types (`IExtractor`, `IAnalyzer`, `IFormatter`, the matching `*Context` types, `Node`, `Link`, `Issue`, ...) are re-exported from `@skill-map/cli`.

---

## Diagnostics

`sm plugins list` shows every discovered plugin with one of **seven** statuses. This is the first thing to check when a plugin doesn't behave.

| Status | Meaning | Common cause |
|---|---|---|
| `loaded` | manifest valid, compat satisfied, every extension imported and validated. | (none) |
| `disabled` | user toggled it off. Manifest parsed; extensions not imported; `scan_contributions` rows purged eagerly (UI chips disappear); KV / dedicated state preserved. | Intentional. |
| `incompatible-spec` | `semver.satisfies` failed against the installed spec. | Built against an older / newer spec. |
| `incompatible-catalog` | `catalogCompat` failed against the installed view-slots + input-types catalog. | Slot / input-type catalog moved; run `sm plugins upgrade <id>`. |
| `invalid-manifest` | `plugin.json` missing / unparseable / AJV-fails, OR the manifest carries `id` / `kind`, OR an extension declares an unknown `slot`. | Typo, missing required field, wrong shape. |
| `load-error` | manifest passed but an extension module failed to import or its export failed validation. | Wrong `kind` folder, runtime import error, bad storage schema. |
| `id-collision` | two plugins from different roots share a directory name. Both collided plugins get this status; no precedence. | Rename one and rerun. |

`sm plugins doctor` runs the full load pass and exits `1` if any plugin is in a non-`loaded` / non-`disabled` state. Wire it into CI.

---

## Scaffolder

Hand-writing the manifest is supported (the spec is the source of truth) but discouraged. Run:

```sh
sm plugins create <kind> <plugin-id>
```

`<kind>` (the first positional, required) is one of the six extension kinds (`provider`, `extractor`, `analyzer`, `action`, `formatter`, `hook`). The scaffolder emits a loader-clean plugin directory: a lean `plugin.json`, a per-kind extension stub at `<kind>s/<id>-<kind>/index.js` (plus any sibling files the kind needs, e.g. an action's `report.schema.json`, or a provider skeleton you extend with a `kinds/` folder), and a `README.md`. The extractor stub pre-fills one setting (`string-list`) and one view contribution (slot `card.footer.left`), both pulled from the generated catalog so they cannot drift. Browse the closed catalogs with `sm plugins slots list` (the scaffolder does not walk them interactively). Companion verbs:

- `sm plugins doctor`, surfaces `incompatible-catalog`, `invalid-manifest`, deprecated-slot usage.
- `sm plugins upgrade <id>`, applies catalog migrations.
- `sm plugins slots list`, prints the catalog (slots + input-types), flags deprecated entries.

### Watch out for

- **Pick exactly one slot per contribution.** Same data in two surfaces = two contributions, emit twice.
- **Don't write JSON Schema** for settings (use `type`) or view contributions (use `slot`).
- **Don't mutate payloads after emission**, the kernel validates and serializes at emit time.
- **Don't emit HTML.** `inspector.body.panel.markdown` accepts a sanitized allow-list; `[innerHTML]` bindings are lint-banned in the UI (see [`context/view-slots.md`](../context/view-slots.md)).
- **Don't read another plugin's contributions**, the BFF rejects cross-plugin reads at the route level.

---

## See also

- [`architecture.md`](./architecture.md), normative extension contract, ports, execution modes, annotation + view contribution systems.
- [`view-slots.md`](./view-slots.md), canonical per-slot catalog reference.
- [`input-types.md`](./input-types.md), canonical per-input-type catalog reference.
- [`plugin-kv-api.md`](./plugin-kv-api.md), `ctx.store` contract (Storage Mode A + B).
- [`db-schema.md`](./db-schema.md), table catalog and migration rules (Mode B).
- [`schemas/plugins-registry.schema.json`](./schemas/plugins-registry.schema.json) and [`schemas/extensions/*.schema.json`](./schemas/extensions), normative manifest shapes.

---

## Stability

- Document status: **descriptive prose**, tracks the manifest schemas. It does not freeze an independent contract; the schemas under [`schemas/`](./schemas/) and [`versioning.md`](./versioning.md) own stability.
- The seven plugin statuses (`loaded` / `disabled` / `incompatible-spec` / `incompatible-catalog` / `invalid-manifest` / `load-error` / `id-collision`) are the current load-status surface.
- Structure-as-truth invariants (directory name IS the plugin id; kind from the folder; Provider kind catalog on disk) and the cross-root id-collision rule (both sides blocked, no precedence) are settled; relaxing any of them is a breaking change per [`versioning.md`](./versioning.md).
- The example code blocks track the public TypeScript surface of `@skill-map/cli`; bumping their imports follows the CLI's own semver.
