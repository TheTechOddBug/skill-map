---
'@skill-map/spec': minor
'@skill-map/cli': minor
'@skill-map/testkit': minor
---

Simplify plugin manifest fields beyond the file-layout refactor. The
previous `structure-as-truth-plugins` changeset moved bundle / kind /
id discovery onto the filesystem; this one extends the same principle
into the manifest schemas themselves so the only fields that survive
are the ones the kernel cannot derive from disk.

**Plugin manifest (`plugin.json`):**

- Drop `id` (the directory name is the id; AJV rejects manifests that
  declare it).
- `description` and `catalogCompat` are now required (were optional).
- `granularity` is now optional with a default of `'extension'` (was
  required). Most plugins drop the field entirely.
- Drop `settings` at the plugin level; settings move to the extension
  manifests that actually consume them.

**Extension base (every kind):**

- Drop `id`, `kind`, `stability`, `preconditions` (free-form). The
  loader injects `id` / `kind` / `pluginId` from the folder layout;
  the other two were display-only and free-form respectively, and
  the kernel never consumed them.
- `description` is now required.
- Rename `annotationContributions` (map) to `annotation` (singular):
  one extension contributes at most one annotation key, and the key
  is the extension's folder name. Use multiple extensions to
  contribute multiple keys.
- Rename `viewContributions` to `ui` on the manifest. The
  runtime-aggregated catalog (`Kernel.getRegisteredViewContributions()`,
  `IPluginRuntimeBundle.viewContributions`) keeps its name.
- Add `settings: Record<id, ISettingDeclaration>` (moved from the
  plugin manifest).

**Provider:**

- Drop the inline `kinds` map. The kind catalog now lives under
  `<plugin>/kinds/<kindName>/` with two files per kind:
  `schema.json` (frontmatter schema) and `kind.json` carrying the
  `{ ui }` block. The loader walks the directory and projects each
  entry into the runtime `kinds` descriptor.
- New schema `extensions/provider-kind.schema.json` validates the
  `kind.json` shape.
- Drop `defaultRefreshAction`. The UI's `🧠 prob` refresh button is
  retired; a replacement UX is TBD.
- `roots` is enforcement-grade: a Provider with declared `roots`
  only sees files matching at least one glob; a Provider without
  `roots` acts as the fallback for files unmatched by any other
  Provider. Supported patterns: `prefix/**` (deep), `prefix/*`
  (shallow), exact path. Two Providers whose roots both match the
  same file produce `provider-ambiguous` (already in spec) and the
  file stays unclassified.

**Extractor:**

- Drop `emitsLinkKinds` (the global closed enum of link kinds is the
  contract; off-enum emissions drop with `extension.error`).
- Drop `defaultConfidence` (declare confidence per-emit on
  `ctx.emitLink({ ..., confidence })`).
- Drop `applicableKinds` (array). Use `precondition.kind` instead with
  qualified ids like `'claude/agent'`. The same `precondition` shape
  is shared with Analyzer and Action.

**Analyzer:**

- Drop `emitsAnalyzerIds` (the qualified extension id is the default
  `analyzer_id`).
- Drop `defaultSeverity` (declare severity per-emit on
  `ctx.emitIssue({ ..., severity })`).
- Drop `consumes`, `configurable`, `recommendedActions`. The
  analyzer↔action relationship is now declared from the Action side
  via `precondition.analyzerIds` (Modelo B): one Action says "I
  resolve these analyzer findings", instead of one Analyzer saying
  "these actions help".
- Add `precondition: { kind?, provider? }` (same shape as Extractor).

**Action:**

- Drop `reportSchemaRef` and `promptTemplateRef`. The kernel now
  resolves these by convention from the action folder:
  `<action-dir>/report.schema.json` (always required) and
  `<action-dir>/prompt.md` (required when `mode='probabilistic'`,
  forbidden when `mode='deterministic'`).
- Drop `expectedTools`, `fanOutPolicy`, `precondition.stability`,
  `precondition.custom`.
- Add `precondition.analyzerIds` (Modelo B).
- Rename `expectedDurationSeconds` to `probExpectedDurationSeconds`
  to mark it as probabilistic-only via the `prob*` prefix convention.
- `mode` is now optional with default `'deterministic'` (was
  required).

**Formatter:**

- Drop `formatId` (comes from the folder name; the loader injects it
  into the runtime instance).
- Drop `supportsFilter` (every formatter supports `--filter`).

**Hook:**

- Drop `mode`. Hooks are deterministic-only; LLM-dependent reactions
  are modeled as a deterministic hook that enqueues a probabilistic
  Action via `ctx.queue('<plugin>/<action>', payload)`.

**Loader changes (`src/kernel/adapters/plugin-loader/`):**

- The exported manifest is stripped of any `id` / `kind` / `pluginId`
  / `kinds` / `formatId` keys before AJV validation; the loader
  injects the canonical values from the folder layout. Legacy
  manifests that still inline these fields load cleanly.
- New `discoverProviderKinds(...)` reads `<plugin>/kinds/<k>/{schema.json,
  kind.json}` and merges the result into the runtime Provider
  instance. Failure modes: missing or unparseable `schema.json`
  → `load-error`; missing, unparseable, or AJV-invalid `kind.json`
  → `invalid-manifest`.
- New `validateActionFileConventions(...)` enforces the
  `report.schema.json` / `prompt.md` conventions.
- New `matchesAnyRoot(...)` powers Provider `roots` enforcement
  inside `processRawNode`.

**Spec docs:**

- `architecture.md` §Extension kinds table, §Provider · `kinds`
  catalog, §View contribution system updated.
- `plugin-author-guide.md` §Manifest section rewritten (id from
  folder; description/catalogCompat required), §Extractor section
  reworked around `precondition.kind`, drop guidance for
  `emitsLinkKinds` / `defaultConfidence`.
- `view-slots.md` references `ui` map.

**Built-ins migration:**

- `core/bump/report.schema.json` and `core/mark-superseded/report.schema.json`
  added (file conventions).
- `core/tools-count` extractor uses
  `precondition: { kind: ['claude/agent'] }`.
- All built-in extensions drop `stability`, `preconditions`,
  `emitsLinkKinds`, `defaultConfidence`, `emitsAnalyzerIds`,
  `defaultSeverity`, `consumes`, `configurable`, `recommendedActions`,
  `defaultRefreshAction`, `formatId` (formatter), `supportsFilter`,
  `mode` (hook).
- `scripts/generate-built-ins.js` updated: `id` from bundle folder,
  `granularity ?? 'extension'`, `toExtensionRow` drops the retired
  display fields.

**Testkit:**

- `makeExtractorContext` populates `settings: {}` so test fixtures
  satisfy the new required field on `IExtractorContext`.

## User-facing

**Plugin manifests are smaller.** `plugin.json` drops `id`; every extension declares only `version` + `description` plus kind-specific fields. View contributions move to `ui:`. Provider kinds live under `kinds/<kindName>/`. Run `sm plugins doctor` after upgrading.
