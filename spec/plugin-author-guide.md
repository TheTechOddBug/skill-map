# Plugin author guide

How to ship a third-party `skill-map` plugin: directory layout, manifest fields, the six extension kinds, storage, version compatibility, dual-mode posture, and how to unit-test the result against the kernel's public types.

*In a hurry? The [Plugin quickstart](./plugin-quickstart.md) gets a working plugin in three steps; this guide is the full contract.*

This guide is **descriptive prose, not the normative contract**. The normative pieces live in the JSON Schemas under [`schemas/`](./schemas/) and in [`architecture.md`](./architecture.md); every claim here is cross-linked. When this guide disagrees with a schema, the schema wins; on system behaviour, `architecture.md` wins. Deep per-system contracts (extension semantics, resolver phase, persistence sweeps, isolation model) are NOT restated here, follow the links.

> **Status.** Pre-1.0 (`spec` is in `0.y.z`). The author surface is still settling; breaking changes ship as **minor** bumps per [`versioning.md`](./versioning.md) until the first `1.0.0`. The shape here matches the manifest schemas as of the structure-as-truth refactor (the kernel derives `id` / `kind` / the Provider kind catalog from disk, so they are no longer manifest fields).

---

## Plugin lifecycle at a glance

Every plugin is one or more of **six extension kinds**. Five of them form one continuous **deterministic flow** (the scan: fast, reproducible, offline), each step following the arrow into the next. **Hook** is the sixth: it sits to the side and reacts to events. Two of the five, **Action** and **Analyzer**, can additionally run in a **probabilistic** mode (an async LLM job), but they stay part of the deterministic flow.

```text
THE DETERMINISTIC FLOW   ( the scan: fast · reproducible · offline )
═══════════════════════════════════════════════════════════════════

  files on disk
        │
        ▼
  ┌────────────┐
  │  PROVIDER  │  decides what counts as a node, and under which lens
  └─────┬──────┘  e.g.  .claude/skills/foo/SKILL.md  →  a Claude skill
        ▼
  ┌────────────┐
  │ EXTRACTOR  │  reads one node and pulls out its references and signals
  └─────┬──────┘  e.g.  an @architect mention  →  a link to that agent
        ▼
  ┌────────────┐
  │  ANALYZER  │  looks across the whole graph and flags problems
  └─────┬──────┘  e.g.  a link to a missing file  →  an Issue
        ▼
  ┌────────────┐
  │   ACTION   │  acts on a node (still on the deterministic flow); can
  └─────┬──────┘  also run as an LLM job.  e.g.  Bump · Summarize (LLM)
        ▼
  ┌────────────┐
  │ FORMATTER  │  turns the finished graph into an output format
  └────────────┘  e.g.  the whole graph  →  an ASCII tree   ( sm graph )


  Off to the side, reacting to the whole lifecycle (never blocks it):

  ┌────────────┐
  │    HOOK    │  watches events and reacts with a side effect
  └────────────┘  e.g.  after a scan finishes  →  notify Slack
                  fires on:  boot · scan · extractor/analyzer/action · job · shutdown
```

Full per-kind contract, methods, modes, and one example each, lives in [The six extension kinds](#the-six-extension-kinds) below and in [`architecture.md` §Extension kinds](./architecture.md#extension-kinds).

---

## Discovery

The kernel scans one root: `<cwd>/.skill-map/plugins/`, committed-with-the-repo plugins. There is no implicit user-level discovery (see [`cli-contract.md` §Scope is always project-local](./cli-contract.md)): plugins live with the project that uses them.

A plugin is any direct child directory of that root containing a `plugin.json`. Nested directories are not searched recursively. Pass `--plugin-dir <path>` to replace the default root with a custom directory (mostly for testing, or a plugin set the operator opts into).

**Import trust.** A project-local plugin is discovered (manifest parsed, listed by `sm plugins list`) but its code is NOT imported by the runtime verbs (`sm scan`, `sm serve`, ...) until the operator trusts it locally with `sm plugins trust <id>` (or the per-plugin Trust control in the Settings UI), which writes a per-plugin grant into the scope lock (`.skill-map/scope.lock.json`). This is a security boundary, and a SEPARATE axis from enable/disable (the operational toggle, which lives in the config layers): a plugin runs only when it is both enabled and trusted. Cloning a repo and scanning it must not auto-execute the repo's plugins, so no committed file can grant import trust. A shipped scope lock does not either: each grant is anchored to the `.skill-map/` directory's filesystem identity, which git does not transport, so a grant made on another machine never verifies here (`sm plugins trust <id>`, or `sm plugins trust --all`, which lists what it is about to trust and confirms). Authors developing a plugin trust it once locally; `--plugin-dir` is not gated. See [`architecture.md` §Locality](./architecture.md).

After every change to `plugins/`, run `sm plugins list` to see each plugin's load status. The seven statuses are documented under [Diagnostics](#diagnostics).

### Plugin id uniqueness

The plugin `id` is the **directory name** (`<root>/<id>/plugin.json`), not a manifest field, and is **globally unique** across every active discovery root. The kernel enforces this in two places:

1. **Directory name IS the id.** A manifest carrying an `id` key is rejected as `invalid-manifest`. Same-root collisions are impossible by construction (a filesystem cannot host two siblings with the same name).
2. **Cross-root id collisions are blocked, both sides.** If two plugins from different roots (project + `--plugin-dir`) share a directory name, **both** receive status `id-collision`. No precedence rule, neither loads its extensions; the user renames one and reruns.

`sm plugins list` shows the conflict; `sm plugins doctor` exits `1` whenever any `id-collision` is present.

### Qualified extension ids

Every extension is identified in the registry, and in any cross-extension reference, by its **qualified id** `<plugin-id>/<extension-id>`. The plugin id (the directory name) is therefore also the **namespace** for every extension the plugin ships.

Examples from the reference impl's built-in extensions:

| Extension | Short id (folder name) | Qualified id (in the registry) |
|---|---|---|
| Claude Provider | `claude` | `claude/claude` |
| Annotations extractor | `annotations` | `core/annotations` |
| Slash-command extractor | `slash-command` | `claude/slash-command` |
| At-directive extractor | `at-directive` | `claude/at-directive` |
| Markdown-link extractor | `markdown-link` | `core/markdown-link` |
| Backtick-path extractor | `backtick-path` | `core/backtick-path` |
| External-URL counter | `external-url-counter` | `core/external-url-counter` |
| Reference-broken analyzer | `reference-broken` | `core/reference-broken` |
| Mermaid formatter | `mermaid` | `core/mermaid` |

Built-ins split between two namespaces:

- **`core/`**, kernel-internal primitives, platform-agnostic: every built-in analyzer, every built-in formatter, the cross-vendor extractors (`annotations`, `markdown-link`, `backtick-path`, `external-url-counter`), the universal `markdown` Provider fallback, and the `update-check` hook.
- **`claude/`**, the Claude Code Provider plugin: the Provider plus the Claude-flavoured extractors (`slash-command`, `at-directive`). **`codex/`** ships the Provider plus its OWN grammar extractors (`dollar-skill` for `$skill` invocation, `at-file` for `@`-file references), because Codex's invocation grammar differs from Claude's (`/` is a built-in command, `@` is a file picker). The other vendor plugins (`antigravity`, `agent-skills`) are Provider-only: Antigravity reuses claude's `/command` parser via its precondition list (it shares the `/`-invoke grammar), and the neutral `agent-skills` lens relies on the universal `core/` extractors only.

### Extension id shape

The convention on every built-in extension id is **`<domain>-<detail>`** (general to specific): the leftmost segment names the entity the extension reasons about (`node`, `link`, `annotation`, `reference`, `name`, ...), the rest narrows the behaviour. Examples: `annotation-orphan`, `link-counter`, `node-stability`, `name-reserved`, `reference-broken`. Even Actions live under their entity domain (`node-bump`, `node-set-tags`) rather than verb-style ids, so the catalog reads as a structured list.

Authors are not required to follow this, but it makes `sm plugins list` self-grouping. In the extension file, declare only the short id-bearing **folder name**, not a prefixed id; the loader composes `<plugin-id>/<short-id>` from `plugin.json` (the directory name) and the extension folder. Any cross-extension reference (`precondition.analyzerIds`, ...) uses the qualified id of the target.

### Toggle model

Every extension is independently toggle-able by its qualified id `<plugin>/<ext-id>` (e.g. `claude/at-directive`, `core/reference-broken`); this is the only model (no `granularity` manifest field). The **plugin row is a presentational grouping**, not the granular toggle target: `sm plugins list` and the Settings UI show a row per plugin, each extension listed underneath with its own enabled / disabled state.

Two id shapes resolve at the toggle surface:

- **Qualified id** (`<plugin>/<ext-id>`): flips exactly that extension. No prompt.
- **Bare plugin id** (`claude`, `core`): the **bundle (aggregate) macro form**, fans the toggle across every extension inside the plugin.
  - Single-extension plugin (`codex`, `antigravity`, `agent-skills`): applies directly, no prompt.
  - Multi-extension plugin (`claude`, `core`): requires `--yes` OR an interactive TTY confirm. CI / pipe contexts must pass `--yes`.

`--all` is the cascade variant: expands to every extension in every discovered plugin under the same `--yes` / TTY-confirm gate.

Resolution order per id (the operational ENABLE axis): per-extension config (`plugins.<id>.extensions.<ext>.enabled`) > plugin-level config (`plugins.<id>.enabled`) > installed default, resolved through the config layers (`settings.local.json` over `settings.json`). The installed default is `true` for ordinary extensions and `false` for extensions declaring `stability: 'experimental'` or `stability: 'deprecated'` (they ship disabled until the operator opts in; see [Extension manifests](#extension-manifests)). Enable no longer reads from the DB, and trust no longer lives there either: the per-plugin import-trust grant is a scope-lock record (the security axis, see Import trust above). Persisted enable keys are written per qualified `<plugin>/<ext>` (the bundle macro expands at write time).

#### Paired extensions (pair toggle)

A fixer Action and the Analyzer(s) named in its `precondition.analyzerIds` form a **pair** ([Modelo B](./architecture.md#analyzer--action-relationship-modelo-b)), and the toggle surface keeps pairs coherent so a pair never ends up half-armed (a fixer without the analyzer that feeds it, or an analyzer whose fix affordance silently vanished):

- **Enable is symmetric and eager**: enabling a fixer also enables every analyzer it references; enabling an analyzer also enables every fixer that references it.
- **Disable is reference-counted over the edges**: disabling an analyzer also disables each fixer referencing it UNLESS that fixer still references another enabled analyzer; disabling a fixer also disables each referenced analyzer UNLESS another enabled fixer still references it.

Scope and mechanics: only **direct edges** participate (no transitive closure across the pair graph); edges to deterministic analyzers (e.g. `core/ai-name-action` -> `core/name-mismatch`) participate exactly like probabilistic finder edges; companions never re-prompt (the bundle-macro confirm covers only the ids the user named; companions are reported as informational `pair toggle:` lines); locked companions are skipped silently (the bulk lock posture); a companion already in the requested set or already in the target state is a no-op, so repeated invocations and macro forms are stable. Companion writes land in the same config layer as the request (`--local` included) and companion disables run the full disable side effects (contributions purge, queued-job cancellation, `job.cancelled` push). Extensions without pairing edges are fully independent. An `analyzerIds` entry that resolves to no known analyzer contributes no edge (same posture as findings injection's benign-race handling).

### Extractor / Analyzer / Action `precondition`, narrow the pipeline

An Extractor, Analyzer, or Action MAY declare an optional `precondition` block. When declared, the kernel runs the extension **only** against nodes that satisfy every declared sub-filter, fail-fast (no context built, no method call), wasting zero CPU on nodes it cannot process. The shape is shared across the three kinds:

```ts
precondition?: {
  kind?: string[];       // qualified `<plugin>/<kindName>` ids
  provider?: string[];   // plugin ids
  analyzerIds?: string[]; // Action only: which analyzers' findings this action resolves (Modelo B)
  frontmatterMissing?: string[]; // Action only: applies only while the node's frontmatter is missing one of these fields
};
```

| `precondition` | Behaviour |
|---|---|
| Absent (`undefined`) | **Default.** Runs on every kind the loaded Providers emit. |
| `{ kind: ['claude/skill'] }` | Runs only on skill nodes from the Claude provider. |
| `{ kind: ['claude/skill', 'agent-skills/skill'] }` | Runs on skills from either provider. |
| `{ provider: ['claude'] }` | Coarser: runs on every kind the `claude` plugin declares. |
| `{ kind: ['claude/skill'], provider: ['claude'] }` | Both filters apply (AND). |
| `{ frontmatterMissing: ['name', 'description'] }` | Action only. Applies only while the node's frontmatter lacks at least one listed field (no block, absent field, or empty-string value; non-string values count as present). ANDs with the other filters. |

Prefer `precondition.kind` over `precondition.provider` when the filter is really about the kind. There is no wildcard syntax, omitting the field IS the wildcard.

**Unknown qualified kinds are non-blocking.** A `precondition.kind` naming a kind no installed Provider declares (typo, missing Provider plugin) still loads with status `enabled`; `sm plugins doctor` surfaces an informational `precondition-kind-unknown` warning without promoting its exit code, the matching Provider may arrive later.

**Dangling `analyzerIds` are non-blocking too.** A `precondition.analyzerIds` entry naming an analyzer no loaded plugin declares (typo, missing analyzer plugin) still loads with status `enabled`; `sm plugins doctor` surfaces an informational `recommended-action-missing` warning without promoting its exit code. Resolution is cross-plugin (an Action in plugin A may legitimately name an analyzer in plugin B) and the optional `:<sub-id>` suffix is stripped before matching, so `core/reference-broken:missing-file` resolves against `core/reference-broken`.

Use case, a deterministic frontmatter-tag extractor that only makes sense for skills.

```javascript
export default {
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

The plugin loader wraps every `import()` in an `AbortController`-backed timeout (5s in the reference impl). On fire, the loader marks the plugin `load-error` and proceeds.

**Node cannot cancel an in-flight `import()`**: once the runtime evaluates the module, every top-level line WILL run, even after the loader gave up (a top-level `setInterval`, `fetch`, filesystem write).

The contract is therefore: **do NOT do work at module top level**. Place every side effect inside an extension's lifecycle method (`extract`, `on`, `run`, ...) so it runs under the loop the kernel drives, and only when the load succeeded. A failed compat check does not protect you, the loader imports the module before checking `specCompat`. For module-level state (e.g. a compiled regex), memoise it lazily inside the lifecycle method.

---

## Manifest

Required fields (normative shape in [`schemas/plugins-registry.schema.json#/$defs/PluginManifest`](./schemas/plugins-registry.schema.json)):

| Field | Type | Notes |
|---|---|---|
| `version` | semver | Plugin version, independent of `specCompat`. |
| `specCompat` | semver range | Spec versions this plugin is compatible with. Checked via `semver.satisfies(specVersion, this)` at load. |
| `catalogCompat` | semver range | **Required.** Range against the view-slots + input-types catalog, which evolves on its own cadence independent of `specCompat`. |
| `description` | string | Short description shown in `sm plugins list` and the UI. English-only. |

Optional fields: `storage` (`{ mode: 'kv' }`), `author`, `license` (SPDX), `homepage`, `repository`.

**Structure-as-truth.** The plugin id is the directory name, NOT a manifest field; a manifest carrying `id` is rejected. The plugin manifest does NOT list extensions, the kernel discovers each by walking `<plugin-dir>/<kind>s/<name>/index.{js,mjs,ts}`. A Provider's kind catalog lives on disk at `<plugin>/kinds/<kindName>/{schema.json, kind.json}` (see [Providers](#providers)).

**Every extension ships an `extension.json`.** Sibling of its `index.{js,mjs,ts}`, at `<plugin>/<kind>s/<name>/extension.json`, carrying `version` and `description` (required) plus the optional `stability` and `defaultEnabled`. Normative shape in [`schemas/extensions/extension-manifest.schema.json`](./schemas/extensions/extension-manifest.schema.json). A missing, unparseable or invalid file rejects the plugin as `invalid-manifest`; `sm plugins upgrade [<id>]` generates it for a plugin authored before this existed.

These four fields live on disk rather than in the module because **the kernel decides whether your extension may run before it runs anything**. Whether an extension is enabled depends on `stability` / `defaultEnabled`, so reading them out of the module would mean executing the module to learn whether executing it was allowed. An extension the operator disabled, or one shipping `stability: 'experimental'` that nobody opted into, never has its module body evaluated at all. Declaring any of the four in the module is `invalid-manifest`, exactly like declaring `id` or `kind`.

A practical consequence for authors: **each extension entry must be independently importable.** Skipping a disabled extension skips only its own entry module, so an extension that relied on side effects from a sibling's top-level code will break. Shared setup belongs in a module both import, not in one entry point.

**Files by convention.** Siblings of `index.{js,mjs,ts}` that the kernel does not recognise as an entry point are author files. Two names are blessed: **`text.ts`** holds the extension's externalised user-facing strings (one per extension, imported by `index.ts` as `./text.js`; plain TS, no schema, no codegen), and **`<extension-name>.test.ts`** (or `.test.mjs` / `.test.js`) is the colocated test suite, picked up by the workspace test glob (`plugins/**/*.test.ts`). Both optional. Beyond `extension.json` and the per-kind convention files (`report.schema.json`, `prompt.md`), the kernel ignores everything that is not `index.{js,mjs,ts}`, so further per-extension fixtures live in the same folder without manifest plumbing.

**Module type (`package.json`).** A plugin whose extensions are `.js` files written as ES modules (`export default …`, `import`) MUST ship a `package.json` at its ROOT (sibling of `plugin.json`) declaring `{ "type": "module" }`, so Node treats those `.js` files as ESM regardless of the host project's own module type. Without it, `import()`-ing an extension emits Node's `MODULE_TYPELESS_PACKAGE_JSON` warning and reparses on every load (a perf cost). `sm plugins create` emits this file automatically (`{ "private": true, "type": "module" }`, minimal by design, the plugin's identity lives in `plugin.json`); `sm plugins upgrade [<id>]` backfills it on plugins scaffolded before this was emitted (and adds a missing `type` to an existing `package.json` without clobbering a non-module one). Authors using `.mjs` extensions do not need it (`.mjs` is always ESM); a `.ts` source is compiled by the author's own toolchain before it ships.

### `specCompat` strategy

Pre-`v1.0.0`, narrow ranges are the defensive default: minor bumps MAY carry breaking changes per [`versioning.md`](./versioning.md), so a plugin spanning minor boundaries can load then crash at first use against a changed schema. Pin to the minor you tested (`"^0.40.0"` resolves any `0.40.x`; `">=0.40.0 <0.41.0"` is the explicit form). After v1.0.0, `"^1.0.0"` is recommended for most plugins.

---

## The six extension kinds

The kernel knows six categories. Each has a JSON Schema under [`schemas/extensions/`](./schemas/extensions/); the kernel validates every manifest against the schema for its declared kind at load time. The full per-kind behavioural contract lives in [`architecture.md` §Extension kinds](./architecture.md#extension-kinds); this section is the author-facing summary plus one example per kind.

| Kind | Method | Receives | Returns | Mode |
|---|---|---|---|---|
| `provider` | `walk` / `classify` | filesystem roots, candidate path | `{ kind, provider } \| null` | deterministic only |
| `extractor` | `extract(ctx)` | one node + body + frontmatter + callbacks | `void` (via `ctx.emitLink` / `ctx.enrichNode` / `ctx.emitContribution` / `ctx.store`) | deterministic only |
| `analyzer` | `evaluate(ctx)` (deterministic only; a probabilistic finder has no method, it ships `prompt.md` + `report.schema.json`) | full graph (deterministic) / rendered job content (probabilistic) | `Issue[]` (deterministic) / findings report → `state_findings` (probabilistic) | dual-mode |
| `action` | `invoke(input, ctx)` + optional `project(ctx)` | `invoke`: one node + input; `project`: full graph + `emitContribution` | `invoke`: report / rendered prompt; `project`: `void` (its own view contributions) | `invoke`: dual-mode; `project`: deterministic |
| `formatter` | `format(ctx)` | full graph | `string` | deterministic only |
| `hook` | `on(ctx)` | a curated lifecycle event payload | `void` (side effects) | **deterministic only** |

An extension is TWO files. The declarative half is `extension.json` (`version`, `description`, optional `stability` / `defaultEnabled`), read from disk before anything runs. The behavioural half is the runtime instance you `export default`, carrying the kind-specific metadata (`mode`, `phase`, `precondition`, `ui`, `settings`, `triggers`, ...) AND the runtime method. The kernel strips function-typed properties before AJV-validating that export, so the method lives beside its metadata; it then merges the `extension.json` fields onto the instance, so at runtime `ext.version` and `ext.description` read exactly as before.

Base fields the MODULE may declare, shared by every kind (normative shape in [`schemas/extensions/base.schema.json`](./schemas/extensions/base.schema.json)): the optional `order`, `annotation`, `settings`. The four that moved to `extension.json` are rejected here.

`stability` (`'experimental' | 'beta' | 'stable' | 'deprecated'`, default `stable`) is a lifecycle label: the non-default values render as a badge next to the extension in `sm plugins list <id>` / `sm plugins show` and the Settings plugins panel. Presentation-only for `beta` and `stable`, but `experimental` and `deprecated` additionally flip the extension's installed default to DISABLED: **its module is never imported** (it does not run, does not register, toggle shows off) until the operator opts in via `sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `settings.local.json` enable override. The opt-in wins over the installed default, so a `deprecated` extension can be kept running during a migration. A stable extension omits the field; declaring `stability: 'stable'` is valid but renders nothing.

An extension that is declared but not imported (disabled, or belonging to a plugin you have not trusted) is still LISTED: `sm plugins list <id>` shows its id, kind, version and stability, read from `extension.json` without executing anything. That is what makes reviewing a project-local plugin before granting it trust actually possible.

### Extractors

Pure single-node analysis. **Never** read another node, the graph, or the database, cross-node reasoning is for analyzers. Manifest fields beyond the base: `scope` (`'frontmatter'` | `'body'` | `'both'`), optional `precondition`, optional `ui` (view contributions). Spec at [`schemas/extensions/extractor.schema.json`](./schemas/extensions/extractor.schema.json).

`extract(ctx) → void`. Output flows through callbacks the kernel binds onto `ctx`:

- **`ctx.emitLink(link)`**, append a `Link`. The kernel validates `link.kind` against the **global closed enum** (`invokes`, `references`, `mentions`, `points`); off-enum kinds drop as `extension.error`. Confidence is declared per emit (default `'medium'`). URL-shaped targets are partitioned into `node.externalRefsCount` and never persisted. (No per-extractor `emitsLinkKinds` allowlist anymore.)
- **`ctx.enrichNode(partial)`**, merge kernel-curated properties onto the node's enrichment layer (persisted into `node_enrichments`). **Strictly separate from the author frontmatter**, which is immutable from any Extractor. Use it for inferred facts (computed titles, summaries) the author did not write.
- **`ctx.emitContribution(id, payload)`**, view contributions (see [View contributions](#view-contributions)).
- **`ctx.store`**, plugin-scoped persistence, present only when `plugin.json` declares `storage`. See [`plugin-kv-api.md`](./plugin-kv-api.md).
- **`ctx.log`**, the diagnostic channel (see [Logging](#logging)). Present on every extension context, not just the Extractor's.

You can read `ctx.node.sidecar.*` freely: the per-`(node, extractor)` cache hashes the sidecar `annotations` block alongside the body, so a `.sm`-only edit invalidates the cached run automatically.

> **Pick a syntax that doesn't collide with built-ins.** `claude/at-directive` claims `@`, `core/slash-command` claims `/`, both with LLM-aligned semantics (and both strip fenced code blocks, inline backticks, and raw HTML before matching). Four built-ins deliberately invert that strip and match ONLY inside code regions: `core/backtick-path` (relative `.md` paths, `points` edges), `claude/backtick-mention` (bare `@handle` mentions), `core/backtick-slash` (`/command` invocations), and `codex/backtick-dollar` (`$skill` invocations), the trigger three resolution-gated (see `architecture.md` §Extractor · code-region triggers), so none can overlap the prose-side extractors. A new extractor matching one of those prefixes fires on the same input and emits a competing link; when both resolve to the same node that surfaces as `reference-redundant` (`name-collision` is reserved for two nodes claiming the same resolvable name, `error` when both declare it via `frontmatter.name`, `warn` when one node's declared name matches another's filename / dirname handle, never for overlapping invocation forms). The example below uses a wikilink-style `[[ref:<name>]]` pattern to side-step the overlap. See [`architecture.md` §Extractor · trigger normalization](./architecture.md#extractor--trigger-normalization) for the normalization pipeline.

```javascript
export default {
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

A **probabilistic analyzer** (a finder: it JUDGES nodes, emitting findings like `contradiction`, `redundancy`, `low-quality`) shares the Action queue verbatim and has NO `evaluate()`; the processing agent does the reasoning. It ships files-by-convention, exactly like a probabilistic Action: `<analyzer-dir>/prompt.md` (the judging prompt) plus `<analyzer-dir>/report.schema.json` extending the canonical findings envelope ([`schemas/findings/report.schema.json`](./schemas/findings/report.schema.json)) via `$ref`, and declares `probExpectedDurationSeconds` for the TTL. Queue it with `sm jobs submit <plugin>/<id> -n <node>` (or `--all`); `sm record` validates the report and writes the `findings[]` rows to `state_findings`, read back via `sm findings`. Findings are advisory by construction: they never alter exit codes. A fixer Action names the finder in `precondition.analyzerIds` (Modelo B) to surface as its recommended fix.

The analyzer↔action relationship is declared from the **Action** side via `precondition.analyzerIds` (Modelo B); no `recommendedActions` field on the Analyzer.

```javascript
export default {
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

> `sm check` stays deterministic-only, full stop: probabilistic analyzers never contribute to it (the transitional `--include-prob` / `--async` stubs were retired when the findings pipeline landed). Their surface is the queue (`sm jobs submit`) on the way in and `sm findings` on the way out.

### Score-phase analyzers

An analyzer that declares `phase: 'score'` runs in the kernel's write-capable phase, BEFORE every read-only (`detect` / `aggregate`) analyzer. It is the only place a plugin may adjust link confidence. Declare the phase in the manifest and call `ctx.adjustConfidence(link, op)` from `evaluate` (the callback is present ONLY in the `score` phase; guard for `undefined` so the same code is inert outside it):

```javascript
// analyzers/demote-mentions/index.js → phase: 'score'
export default {
  phase: 'score',
  evaluate(ctx) {
    for (const link of ctx.links) {
      if (link.kind === 'mentions') {
        ctx.adjustConfidence?.(link, { kind: 'delta', value: -0.3 });
        ctx.adjustConfidence?.(link, { kind: 'floor', value: 0.2 });
      }
    }
    return []; // a scorer emits no issues; its output is the confidence ops
  },
};
```

The `op` is one of four kinds:

| `op.kind` | Effect | Direction |
|---|---|---|
| `set`   | Hard override to `value`. | replaces |
| `delta` | Add `value` (may be negative). | additive |
| `floor` | Raise to at least `value`. | raises only |
| `ceil`  | Lower to at most `value`. | lowers only |

`link` MUST be one of `ctx.links` (matched by object identity). The kernel seeds a **1.0 baseline** on every link, then **folds** every op contributed to that link (across all scorers) into the final `link.confidence`, deterministically and order-independently: from the 1.0 baseline it applies `set` (last in canonical order wins), then sums `delta`, then `floor` (raise), then `ceil` (cap), and clamps to `[0,1]` once at the end (so a `-0.4` then `+0.4` round-trips to the base instead of clipping mid-fold). Across scorers the ops sort by `(pluginId, extensionId)`, so two scans always produce the same value and adjustment ordering. Each applied op is attributed to your plugin / extension and persisted to the `scan_link_scores` audit table (the "why is this link at X?" trail).

The kernel **dogfoods this exact API** through two built-in score-phase detectors, each co-locating its penalty `delta` with the finding it reports: `core/name-reserved` (reserved → `delta -0.9` → 0.1, alongside its warns) and `core/reference-broken` (broken → `delta -0.75` → 0.25, alongside its errors). A clean-resolved link keeps the 1.0 baseline (no built-in op). The pattern to copy: **detect, report, AND score in one `phase: 'score'` evaluate**, so disabling a rule drops both effects together (no report, no confidence move, the link falls back to baseline). Your scorer composes ON TOP of that baseline: same phase, same links, ops folded with the built-ins'. To subtract, use a negative `delta`; to RAISE, a positive `delta` or a `floor`; to cap, a `ceil`. See [`architecture.md` §Analyzer phases](./architecture.md#analyzer-phases) for the normative fold semantics.

### Formatters

Graph-to-string serializers, invoked by `sm graph --format <name>`. The format **name** comes from the formatter's folder name; the manifest declares `contentType` (MIME hint). Output **MUST** be byte-deterministic for the same input graph (the snapshot suite relies on it). Spec at [`schemas/extensions/formatter.schema.json`](./schemas/extensions/formatter.schema.json).

```javascript
// formatters/csv/index.js  → sm graph --format csv
export default {
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

Declarative subscribers to a curated set of kernel lifecycle events. **Deterministic-only**: a hook reacts to events and cannot mutate the pipeline, block emission, or alter outputs. Errors are caught by the dispatcher (logged as `extension.error` with `kind: 'hook-error'`) and NEVER block the main flow. LLM-dependent reactions are modeled as a deterministic Hook that enqueues a probabilistic Action via `ctx.queue('<plugin>/<action>', payload)`. Spec at [`schemas/extensions/hook.schema.json`](./schemas/extensions/hook.schema.json); triggers at [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set).

The nine hookable triggers (any other yields `invalid-manifest`): seven pipeline-driven, `scan.started`, `scan.completed`, `extractor.completed`, `analyzer.completed`, `action.completed`, `job.completed`, `job.failed`, plus two CLI-process-driven, `boot` (before verb routing) and `shutdown` (after the verb's exit code resolves).

```javascript
export default {
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

Recognise a platform and declare a kind catalog. The catalog lives **on disk** (structure-as-truth): each kind under `<plugin>/kinds/<kindName>/` ships exactly two files, `schema.json` (the kind's frontmatter JSON Schema, MUST extend [`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) via `allOf` + `$ref`) and `kind.json` (per-kind metadata: the required `{ ui: { label, color, colorDark?, emoji?, icon? } }` block plus the optional name-resolution keys `identifiers` and `identifierMismatch`, validated against [`provider-kind.schema.json`](./schemas/extensions/provider-kind.schema.json)). Declare `identifiers` (a priority-ordered subset of `frontmatter.name` / `filename-basename` / `dirname`) so `invokes` / reference links naming a node of this kind resolve to it, exactly like a built-in kind (see [`architecture.md` §Provider · kind identifiers](./architecture.md#provider--kind-identifiers)); omit it and the kind stays reachable by path only. The kernel derives the supported kind set from the `kinds/` directory listing; no inline `kinds` map and no `defaultRefreshAction` field.

The Provider manifest declares a top-level `presentation` block (its own identity in the lens dropdown / topbar / per-card chip, distinct from its kinds' `ui`), plus optional `detect`, `roots`, `gatedByActiveLens`, `read`, and `resolverRules`. The walker hardcodes the paths it scans within the project (`.claude/`, `.codex/`, ...); the kernel never extends the scan into `$HOME`. Spec at [`schemas/extensions/provider.schema.json`](./schemas/extensions/provider.schema.json); full behaviour (dispatch order, the universal markdown fallback, resolution / reservedNames / identifiers) in [`architecture.md` §Extension kinds](./architecture.md#extension-kinds).

**Live activity (optional).** A Provider may also declare an `activity` capability so the running vendor tool lights up the live map (agent spawns, skill invocations, session events). It is a provider-owned sub-object, NOT a separate extension kind: an `install` descriptor (where the provider runtime's hook config lives, e.g. `plugin-file` writing to `.<vendor>/plugin/skill-map-activity.js`, or `json-hooks` merging into a hooks file) plus a `mapEvent(raw)` that maps ONE raw hook payload into node-attributable signals, and (for `plugin-file`) a `pluginHooksSource`. `sm activity install <provider>` writes the hook to the provider's declared `install.configPath`; ingested events log through `sm serve --log-level info`. The install path is the vendor's OWN territory, so it can differ from the classification `roots` (a clone lens classifying `.<vendorclone>/` may still need to install where the real vendor binary reads). Full contract, install kinds, the bridge, privacy rules, and per-provider signal notes: [`provider-activity.md`](./provider-activity.md).

```text
my-provider/
├── plugin.json
├── providers/my-provider/index.{ts,js}   ← walk / classify
└── kinds/
    ├── skill/{schema.json, kind.json}
    └── command/{schema.json, kind.json}
```

### Actions

Operate on one or more nodes. Dual-mode (`mode` optional, default `'deterministic'`). Files-by-convention: every Action carries `<action-dir>/report.schema.json`; probabilistic Actions additionally carry `<action-dir>/prompt.md`. Probabilistic estimates go in `probExpectedDurationSeconds` (drives job TTL). Optional `precondition` (including `analyzerIds`, the Modelo B link). Spec at [`schemas/extensions/action.schema.json`](./schemas/extensions/action.schema.json).

An Action whose `invoke()` returns a sidecar write (`writes: [{ kind: 'sidecar', ... }]`) MUST declare the capability on its manifest as `writes: ['sidecar']`. Consumers gate on the declaration without invoking: when a project sets `allowSidecarWriters: false`, the scan composer drops every Action declaring `sidecar` (so its `inspector.action.button` never renders) and the sidecar store refuses the write. Omit the field for read-only / report-only Actions.

An Action has two independent surfaces:

- **`invoke(input, ctx)`**, the on-demand executor the user triggers (deterministic in-process code; a probabilistic Action has NO `invoke`, its rendered prompt is processed by an external agent via `sm jobs claim` + `sm record`). Unit-test deterministic ones by calling `invoke(input, ctx)` with a fake context; probabilistic ones are tested through the queue (submit, then record a report against the schema).
- **`project(ctx)`** (optional), a deterministic, side-effect-free, scan-time method with read-only graph access (`ctx.nodes`, `ctx.links`) plus `ctx.emitContribution(nodePath, ref, payload)`. Use it to self-project the Action's own UI affordance, typically an `inspector.action.button` declared in the manifest `ui` map (see [View contributions](#view-contributions)), computing the per-node `enabled` / prompt `options` from the live graph. It stays deterministic even when `invoke` is probabilistic, and runs every scan (same cost as an analyzer's emit). This is how built-in buttons like Set stability / Bump are produced: the dispatching Action owns its button, no separate "projector" analyzer. Unit-test it by calling `project(ctx)` with a fake `{ nodes, links, emitContribution }` and asserting the captured payload.

---

## Frontmatter validation, three-tier model

The kernel validates frontmatter on a graduated dial; tighter is opt-in. The policy lives in **analyzers**, not the JSON Schemas: schemas stay shape-only ([`base.schema.json`](./schemas/frontmatter/base.schema.json) declares `additionalProperties: true`) so authors extend their own nodes without forking the spec. Per-kind schemas live with the **Provider** that emits the kind.

| Tier | Mechanism | Behaviour on unknown / non-conforming fields |
|---|---|---|
| **0, Default permissive** | `additionalProperties: true` on `base` and every per-kind schema. | Field passes silently, persists in `node.frontmatter`, available to every extension. |
| **1, Built-in `unknown-field` analyzer** | Deterministic, always active. | Emits a `warn` Issue for every key outside the documented catalog. |
| **2, Strict mode** | `scan.strict: true` in settings, or `--strict` on `sm scan`. | Promotes all frontmatter warnings to `error`; `sm check` then exits `1`. CI fails. |

Tier 1 is normative: the kernel ships the analyzer out of the box. To keep an unknown key quietly, either move it under `metadata.*` (the base schema permits free-form keys there) or accept the persistent `warn`.

### Why no "schema-extender" plugin kind

To make custom frontmatter keys first-class, write a deterministic **Analyzer** that reads the keys from `node.frontmatter` (Tier 0 exposes them), validates against your domain shape, and emits Issues. A "schema-extender" kind would force every consumer to re-resolve the active schema set per scan; the analyzer-driven approach keeps the parser one-pass and the validation surface composable. For a CI-blocking check, the analyzer emits at `severity: 'error'` directly (`--strict` / `scan.strict` apply only to the kernel's own frontmatter warnings).

---

## Storage

A plugin that persists state declares `storage` in its manifest:

```jsonc
{ "storage": { "mode": "kv" } }
```

Backed by the kernel-owned `state_plugin_kvs` table. `ctx.store` exposes `get` / `set` / `list` / `delete`, scoped to your plugin and optionally to a node. No migrations, ready immediately. Documented in full at [`plugin-kv-api.md`](./plugin-kv-api.md).

`kv` is the only mode: a plugin never owns tables in the project database. Data that needs relational shape (indexes, joins, a cache with TTL) lives outside skill-map's database, under your own control.

## Logging

Every extension context carries `ctx.log`, with one method per level: `trace`, `debug`, `info`, `warn`, `error`. Each takes a single message string.

```javascript
ctx.log.debug(`matched ${hits.length} refs in ${ctx.node.path}`);
ctx.log.warn('token missing, skipping remote verification');
```

**Never write to stdout from an extension.** `console.log` lands on stdout, which carries the machine-readable payload of every `--json` invocation (`cli-contract.md` §Machine-readable output rules), so one stray line corrupts the output an operator is piping into `jq`. `ctx.log` is stderr-bound by construction, which is the whole reason to prefer it.

Three properties the kernel guarantees at this boundary:

- **Level.** The CLI boots at `warn`, so `info` / `debug` / `trace` stay silent until the operator asks (`--log debug`, `--log trace`, or `--log-level`). Log freely at the low levels; a chatty extension costs a normal run nothing.
- **Sanitisation.** Messages are stripped of ANSI escapes and control bytes before they reach the terminal. Do not bother colouring your own output, the escapes will not survive.
- **Attribution.** Every line is prefixed with your qualified extension id (`[<plugin>/<extension>]`), including the lines of a multi-line message. An extension cannot emit a line that reads as kernel output.

**In a hot loop, guard first.** The argument to `ctx.log.trace(...)` is evaluated before anything can drop it, so an unguarded template inside a loop over the graph is built on every scan even at the default level. `ctx.log.enabled(level)` answers whether the line would actually be emitted:

```javascript
const tracing = ctx.log.enabled('trace');
for (const link of ctx.links) {
  if (tracing) ctx.log.trace(`${link.source} -> ${link.target}: ${verdict}`);
}
```

A one-shot line (a summary, an error path) never needs the guard; reading it costs more than running it. The built-in `core/reference-broken` uses exactly this shape to say WHICH of its three drop reasons fired for a broken edge, which is the answer to nearly every "this is a false positive" report.

`ctx.log` grants no capability an extension did not already have (a loaded extension runs in-process), so it is not a privilege boundary. What it is NOT auditing for you: **secrets**. A message you log is a message the operator sees and may paste into an issue. Never log a resolved `secret` setting, an Authorization header, or a raw remote response that might embed one.

### Opt-in write validation

`emitLink` and `enrichNode` are always validated by the kernel against `link.schema.json` / `node.schema.json`. `ctx.store` writes are permissive by default (the author owns the value shape). To validate your own writes, declare `storage.schema`, a JSON Schema path relative to the plugin root, and every `ctx.store.set(key, value)` is checked against it.

A schema file missing / unparseable / AJV-rejected at load flips the plugin to `load-error`. A write violating the declared schema throws synchronously, naming the plugin, key, and AJV errors. Skip validation for free-form payloads (cache rows, counters), friction with no payoff.

---

## Execution modes

Analyzer and Action declare `mode` (optional, default `'deterministic'`); Provider / Extractor / Formatter / Hook are deterministic-only by spec and MUST NOT declare it.

A `probabilistic` Analyzer / Action never receives an LLM handle: its contribution is the prompt (`prompt.md`) plus the report contract (`report.schema.json`), rendered into a queued job (`sm jobs submit`) that an external agent processes via `sm jobs claim` + `sm record`; it never runs in `sm scan`. The full per-kind capability matrix lives in [`architecture.md` §Execution modes](./architecture.md#execution-modes).

---

## Annotation contribution

> A plugin that writes a first-class field into a node's co-located `.sm` sidecar declares it via the optional `annotation` block on its extension manifest. The kernel validates it at load time, surfaces the runtime catalog via `kernel.getRegisteredAnnotationKeys()` (consumed by the BFF / UI for autocomplete), and treats two plugins claiming the same root-exclusive key as a fatal startup error. Normative contract: [`architecture.md` §Annotation system → Plugin contributions](./architecture.md#plugin-contributions).

### Manifest shape

`annotation` is a **single** declaration per extension; **the contributed key is the extension's id** (its folder name). An extension needing several keys splits into several extensions, one per key. The block declares an inline JSON Schema for the value plus two policy fields:

```js
// my-plugin/extractors/last-reviewed-at/index.js  → contributes key `last-reviewed-at`
export default {
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

A top-level (root) key requires `location: 'root'` AND `ownership: 'exclusive'`. The pair travels together: `.sm` writes deep-merge per the `SidecarStore` contract, so a shared root key would route non-deterministically. Use root sparingly; each root contribution reserves that name across the whole installed-plugin surface.

```js
// compliance-plugin/analyzers/compliance/index.js  → contributes root key `compliance`
export default {
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

Two plugins claiming the same `(key, location: 'root', ownership: 'exclusive')` tuple is a **fatal startup error**: `loadPluginRuntime` throws `AnnotationContributionConflictError`, the host exits non-zero, the kernel does NOT boot. This is the only fatal path on the plugin-load surface (every other failure is per-plugin and the kernel keeps booting on the survivors), because otherwise annotated `.sm` files route non-deterministically.

### Typo guard and runtime catalog

The built-in `core/annotation-field-unknown` Analyzer walks every parsed `.sm` and emits a `warn` issue per truly-unknown key (a key outside the curated `annotations:` catalog, outside the reserved blocks, and not matching any registered plugin namespace or root contribution; or a value failing the owning plugin's declared schema). It never blocks a scan.

The runtime catalog is reachable via `kernel.getRegisteredAnnotationKeys()` (each entry `{ pluginId, key, location, ownership, schema }`); built-in catalog fields from `annotations.schema.json` are NOT included. The BFF surfaces it through `GET /api/annotations/registered` for autocomplete.

---

## View contributions

> Lets plugins surface per-node data in the UI **without shipping any UI code**. You pick a **slot** by name from a closed kernel catalog; the slot fixes both renderer and payload shape. You declare per-node emissions in the extension manifest's `ui` map and emit payloads at scan time via `ctx.emitContribution(...)`. Normative contract: [`architecture.md` §View contribution system](./architecture.md#view-contribution-system).

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

In TypeScript, declare each contribution as a module-level const with `satisfies IViewContribution` and build `ui` by shorthand. Emit by passing the SAME object by reference (see [Emit path](#emit-path)) for a typed payload:

```ts
import type { IViewContribution } from '@skill-map/cli';

const breakdown = {
  slot: 'inspector.body.panel.breakdown', label: 'Keyword hits', emptyText: 'No matches.',
} satisfies IViewContribution;
const total = {
  slot: 'card.footer.left', icon: '🔍', label: 'kw', emitWhenEmpty: false,
} satisfies IViewContribution;

export default {
  // ...
  ui: { breakdown, total },
  // ...
};
```

The `ui` **key** (kebab-case per the manifest schema) is the contribution id; the const's variable name is incidental, since the kernel matches an emission to its declaration by object identity, not by name. Plain `.js` plugins use the same shape without `satisfies` (runtime check, not compile-time).

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

### Slot catalog (closed, 19 slots)

The kernel ships exactly these 19 slots. Each fixes a renderer + a payload shape; the **per-slot semantics, edge cases, and exact payload schemas are the canonical reference in [`view-slots.md`](./view-slots.md)** (and [`schemas/view-slots.schema.json`](./schemas/view-slots.schema.json) at `$defs/payloads/<slot>`). Read those before emitting. Adding a slot needs a spec / UI / scaffolder round-trip.

| Slot | Renderer |
|---|---|
| `card.title.right` | icon marker (icon required) |
| `card.subtitle.left` | counter chip (icon required) |
| `card.footer.left` | counter chip (icon required) |
| `card.footer.right` | counter chip (icon required) |
| `graph.node.alert` | graph corner badge (reserved, see `view-slots.md`) |
| `inspector.header.badge` | unified header badge (icon and/or label and/or count) |
| `inspector.action.button` | action button (dispatches an Action, see `view-slots.md`) |
| `inspector.surface.version` | version surface (header chip + card label) |
| `inspector.surface.stability` | stability surface (header chip + card badge) |
| `inspector.surface.tags` | tag-row surface (editor + card chips) |
| `inspector.surface.summary` | header summarize affordance |
| `inspector.surface.auto-tag` | tag-row sparkles affordance |
| `inspector.body.panel.breakdown` | bar chart panel |
| `inspector.body.panel.records` | table panel |
| `inspector.body.panel.tree` | tree panel |
| `inspector.body.panel.key-values` | definition list panel |
| `inspector.body.panel.link-list` | clickable list panel |
| `inspector.body.panel.markdown` | sanitized markdown panel |
| `topbar.nav.start` | scope chip |

### Inspector grouping and `order`

The six `inspector.body.panel.*` contributions are not rendered in a shared drawer. The inspector groups them **one collapsible section per plugin**, titled by the plugin id (host-applied from the trusted contribution `pluginId`, never the payload) and **collapsed by default**. A plugin's bricks only land in its own section; it cannot contribute into another plugin's space.

Two optional, inspector-only `order` hints (both `number`, default `100`) control layout:

| Field | Where | Effect |
|---|---|---|
| `order` | `plugin.json` (plugin level) | Sorts the plugin sections, ASC, tie-break by plugin id. |
| `order` | extension manifest (extension level) | Sorts the bricks inside a plugin's section, ASC, tie-break by the contribution `priority` then qualified id. |

`order` is purely presentational and never affects execution order (analyzer `phase` + registration order govern that). It only applies to the inspector body sections; `priority` still governs ordering within the card / header / action slots.

### Chip vs Issue

For analyzers, a per-node card surfaces a finding through two independent channels: the `Issue` returned by `evaluate(ctx)` feeds the aggregated stats and the scan / check exit code; a view contribution to a card slot is **purely presentational** (its `severity` controls only the chip's own colour, never the count, never the exit code). The colour rule (when a chip may paint `warn` / `danger`) is documented in [`view-slots.md`](./view-slots.md) §Common conventions, and the reserved status of `graph.node.alert` in that document's §`graph.node.alert`. Breaking it produces misleading cards and is caught in code review, not by the schema.

### Emit path

```ts
// Extractor (per-node walk): nodePath is implicit (ctx.node.path)
ctx.emitContribution(breakdown, { bars: [...] });
ctx.emitContribution(total, { value });

// Analyzer (post-merge graph): explicit nodePath, the analyzer sees every node at once
ctx.emitContribution(nodePath, breakdown, { bars: [...] });
```

Pass the contribution **object you declared in `ui`, by reference** (the `const` above), not a string id. The kernel recovers the contribution id (the `ui` key) by object identity and looks up the declared slot to validate the payload against `view-slots.schema.json#/$defs/payloads/<slot>`. The payload argument is typed from `ref.slot` (`SlotPayload<C['slot']>`), so a wrong-shape payload is a **compile error** in TypeScript. At runtime, a ref not among your declared `ui` objects (a spread copy, an inline literal) or an off-shape payload emits an `extension.error` and drops, same posture as `emitLink`. For `topbar.nav.start`, analyzers use `ctx.emitScopeContribution(ref, payload)` (reserved in the spec; the runtime callback lands when the first scope-level adopter arrives).

To surface the same data in two surfaces, declare two contributions (one per slot) and emit twice; no broadcast.

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

The eleven input-types: `string-list`, `single-string`, `boolean-flag`, `integer`, `number`, `enum-pick`, `enum-multipick`, `path-glob`, `regex`, `secret`, `key-value-list`. The per-type parameters and runtime value shapes are the canonical reference in [`input-types.md`](./input-types.md) (schema at [`schemas/input-types.schema.json`](./schemas/input-types.schema.json) at `$defs/Setting_<TypeName>`).

The kernel exposes resolved settings via `ctx.settings.<settingId>`. Settings are read once at extension invocation; **changing a setting requires `sm scan` to re-emit** affected contributions (the UI surfaces a "settings changed, rescan needed" indicator).

### Setting values and the operator

The manifest declares the *shape* (label, type, default); the **operator** supplies the *values*. Non-`secret` values live in the project config under `plugins.<pluginId>.extensions.<extId>.settings.<settingId>` (the extension id is the leaf folder name, not the qualified `<plugin>/<ext>` id, the plugin is already the parent key), so a team can commit them in `settings.json` or keep a per-checkout override in `settings.local.json`. The settings resolver builds the runtime `ctx.settings` object from each declared setting's `default`, overlaying the merged config value, validating against the input-type's value schema; a value failing validation drops back to the default with a warning (the scan never crashes on bad settings). `project-config.schema.json` keeps the `settings` object permissive (`additionalProperties: true`); per-type validation is the resolver's job, since the static schema cannot know which type a given `settingId` picked.

`secret` settings are the exception on WHERE they land: the kernel forces them into project-local `settings.local.json` (gitignored), never the committed `settings.json`, so a token never travels via the shared repo. There is **no encryption** (the value is plain text on the local machine); the only protection is "does not leave the checkout". An optional `envVar` lets CI inject the value without writing it to disk. See `input-types.schema.json#/$defs/Setting_Secret`.

The operator reads and writes values through the CLI (UI form is the parallel surface):

```text
sm plugins config <plugin>/<ext>                      # table: declared setting · effective value · source layer
sm plugins config <plugin>/<ext> <settingId> <value>  # validate against the input-type, then write
sm plugins config <plugin>/<ext> <settingId> --reset  # remove the override (falls back to the manifest default)
```

A write lands in `settings.json` by default (or `settings.local.json` when the layering routes it per-checkout); the command prints a "re-scan to apply" footer because settings are read once per scan.

### Catalog version

The slot + input-type catalog evolves on its own cadence. `catalogCompat` (required in the manifest) is the semver range you tested against, independent of `specCompat`. A mismatch surfaces as `incompatible-catalog`; resolution is `sm plugins upgrade <id>`, which runs registered migrations from the kernel's closed registry. When auto-migration is impossible (a slot you used was removed), the upgrade verb fails loud and the manifest needs a manual edit.

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

Analyzers take a `ctx` with `nodes`, `links`, and (if you assert on view contributions) an `emitContribution` spy, returning the issue array. Formatters take `{ nodes, links, issues }` and return a string. For probabilistic extensions (Actions AND finder Analyzers), test the queue round-trip: submit against a fixture node, then `sm record` a handcrafted report and assert it validates against your `report.schema.json`; for a finder, additionally assert the rows land in `state_findings` (`sm findings --json`). The public TypeScript types (`IExtractor`, `IAnalyzer`, `IFormatter`, the matching `*Context` types, `Node`, `Link`, `Issue`, ...) re-export from `@skill-map/cli`.

---

## Diagnostics

`sm plugins list` shows every discovered plugin with one of **seven** statuses. First thing to check when a plugin doesn't behave.

| Status | Meaning | Common cause |
|---|---|---|
| `loaded` | manifest valid, compat satisfied, every extension imported and validated. | (none) |
| `disabled` | user toggled it off. Manifest parsed; extensions not imported; `scan_contributions` rows purged eagerly (UI chips disappear); KV state preserved. | Intentional. |
| `incompatible-spec` | `semver.satisfies` failed against the installed spec. | Built against an older / newer spec. |
| `incompatible-catalog` | `catalogCompat` failed against the installed view-slots + input-types catalog. | Slot / input-type catalog moved; run `sm plugins upgrade <id>`. |
| `invalid-manifest` | `plugin.json` missing / unparseable / AJV-fails, OR the manifest carries `id` / `kind`, OR an extension declares an unknown `slot`. | Typo, missing required field, wrong shape. |
| `load-error` | manifest passed but an extension module failed to import or its export failed validation. | Wrong `kind` folder, runtime import error, bad storage schema. |
| `id-collision` | two plugins from different roots share a directory name. Both collided plugins get this status; no precedence. | Rename one and rerun. |

`sm plugins doctor` runs the full load pass and exits `1` if any plugin is in a non-`loaded` / non-`disabled` state. Wire it into CI.

Beyond load status, `sm plugins doctor` also reports **runtime contribution errors from the last scan**: view contributions rejected at emit time (an undeclared ref, or a payload that fails the slot's schema) are persisted per scan and surfaced in a "Runtime contribution errors (last scan)" section grouped by plugin, and any present promote the exit code to `1`. A plugin can be `loaded` (clean manifest) yet still have runtime rejections: a healthy `list` status does not mean your chips rendered. The same errors appear per-plugin in the Settings plugin panel (a warning badge plus a collapsible diagnostics list). Re-run `sm scan` after a fix to clear.

---

## Scaffolder

Hand-writing the manifest is supported (the spec is the source of truth) but discouraged. Run:

```sh
sm plugins create <kind> <plugin-id>
```

`<kind>` (the first positional, required) is one of the six extension kinds (`provider`, `extractor`, `analyzer`, `action`, `formatter`, `hook`). The scaffolder emits a loader-clean plugin directory: a lean `plugin.json`, a per-kind extension stub at `<kind>s/<id>-<kind>/index.js` (plus any sibling files the kind needs, e.g. an action's `report.schema.json`, or a provider skeleton you extend with a `kinds/` folder), and a `README.md`. The extractor stub pre-fills one setting (`string-list`) and one view contribution (slot `card.footer.left`), both pulled from the generated catalog so they cannot drift. Browse the closed catalogs with `sm plugins slots list` (the scaffolder does not walk them interactively). Companion verbs:

- `sm plugins doctor`, surfaces `incompatible-catalog`, `invalid-manifest`, deprecated-slot usage.
- `sm plugins upgrade <id>`, applies catalog migrations.
- `sm plugins slots list`, prints the closed catalog (slots + input-types), `--json` for the machine-readable form.

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
- [`plugin-kv-api.md`](./plugin-kv-api.md), the `ctx.store` storage contract.
- [`db-schema.md`](./db-schema.md), table catalog and migration rules.
- [`schemas/plugins-registry.schema.json`](./schemas/plugins-registry.schema.json) and [`schemas/extensions/*.schema.json`](./schemas/extensions), normative manifest shapes.

---

## Stability

- Document status: **descriptive prose**, tracks the manifest schemas. It does not freeze an independent contract; the schemas under [`schemas/`](./schemas/) and [`versioning.md`](./versioning.md) own stability.
- The seven plugin statuses (`loaded` / `disabled` / `incompatible-spec` / `incompatible-catalog` / `invalid-manifest` / `load-error` / `id-collision`) are the current load-status surface.
- Structure-as-truth invariants (directory name IS the plugin id; kind from the folder; Provider kind catalog on disk) and the cross-root id-collision rule (both sides blocked, no precedence) are settled; relaxing any of them is a breaking change per [`versioning.md`](./versioning.md).
- The example code blocks track the public TypeScript surface of `@skill-map/cli`; bumping their imports follows the CLI's own semver.
