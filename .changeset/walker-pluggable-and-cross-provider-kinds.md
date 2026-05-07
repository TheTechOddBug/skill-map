---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Pluggable kernel walker + parser registry. Provider manifests gain a declarative `read: { extensions, parser }` field; the kernel owns the file walker and a closed registry of built-in parsers. The Claude Provider drops its hand-rolled `walk()` (~70 lines of fs walking + frontmatter parsing) and becomes pure metadata + classification.

Cross-provider kind sharing via a restructured `kindRegistry`: when two Providers declare the same kind name (e.g. `agent` for both Claude and a future Gemini Provider), every contribution is kept. Per-node painting can pick the matching Provider's color — the data shape supports it without forcing a kernel-side rename of every shared kind.

**`@skill-map/spec`**

- `extensions/provider.schema.json` — new optional `read` field. Validates `extensions: string[]` (each starting with a dot, matching `^\.[a-z0-9]+$`) and `parser: string`. Defaults at the call site (`{ extensions: ['.md'], parser: 'frontmatter-yaml' }`); not silently injected at manifest load. Precedence: when a Provider also declares the runtime `walk()` field, `walk()` wins and `read` is ignored — the runtime field is the escape hatch for non-standard discovery.
- `api/rest-envelope.schema.json` — `kindRegistry.additionalProperties` restructured. Old shape `{ providerId, label, color, ... }` becomes `{ primaryProviderId, providers: { <providerId>: { label, color, colorDark, emoji, icon } } }`. The primary drives the kind's visible label / color / icon and the `--sm-kind-<kind>` CSS var; secondary contributors live under `providers` so per-node painting can pick the matching Provider's contribution.
- `index.json` regenerated.

**`@skill-map/cli` — kernel walker + parser registry**

- New `src/kernel/scan/walk-content.ts` — `walkContent(roots, options)` async generator. Owns the audit-cleared defences (M7 symlink skip, TOCTOU stat re-check, ignore filter integration, bundled-defaults fallback) so every Provider that uses `read` inherits them.
- New `src/kernel/scan/parsers/{types,frontmatter-yaml,plain,index}.ts` — closed registry. Built-ins: `frontmatter-yaml` (YAML frontmatter inside `--- … ---` fences, prototype-pollution-safe, `js-yaml` `JSON_SCHEMA` pinned), `plain` (entire body, empty frontmatter — for files carrying no frontmatter convention). `getParser(id)` resolves by id; `registerParser` is kernel-internal (not re-exported from `src/kernel/index.ts`) and rejects collisions with frozen built-in ids.
- `IProvider` extended: optional `read?: IProviderReadConfig`, `walk` becomes optional. `resolveProviderWalk(provider)` returns `provider.walk` when defined, else closes over `walkContent` with `provider.read ?? defaults`. The orchestrator at `kernel/orchestrator.ts:1035` flips to `resolveProviderWalk(provider)(...)` — single-line edit.
- `built-in-plugins/providers/claude/index.ts` migrates to declarative form. Drops `walk()`, `walkMarkdown`, `splitFrontmatter`, `FRONTMATTER_RE`, `FORBIDDEN_FRONTMATTER_KEYS`, plus the `fs/promises`, `path`, `js-yaml`, and `IIgnoreFilter` imports. Adds `read: { extensions: ['.md'], parser: 'frontmatter-yaml' }`. File shrinks from 270 to 158 lines. Behaviour identical (the audit-cleared defences live in the kernel walker / parser).
- Tests for `frontmatter-yaml.test.ts`, `plain.test.ts`, `parsers/index.test.ts`, `walk-content.test.ts` — 28 new cases covering happy paths, malformed input, prototype-pollution strip, registry resolution + freeze semantics, M7 symlink skip, TOCTOU re-check, custom extensions, default-applied path. Existing `claude.test.ts` and `pollution-defence.test.ts` migrate to `resolveProviderWalk(claudeProvider)(...)`.

**`@skill-map/cli` — kindRegistry refactor**

- `src/server/kind-registry.ts` rewrites `buildKindRegistry`: per kind, first Provider in iteration order populates `primaryProviderId` and seeds `providers`; later Providers append to `providers[provider.id]` without overwriting the primary. The kernel separately surfaces `provider-ambiguous` issues for files matched by multiple Providers; the registry stays coherent during the conflict window.
- `src/server/envelope.ts` types updated to match the wire shape (`IKindRegistryEntry` carries `primaryProviderId` + `providers`; new `IKindRegistryProviderUi` for the per-Provider sub-entry).
- New `src/server/kind-registry.test.ts` — 4 cases covering single-provider entries, cross-provider sharing, ordering, and the empty case. The `test:ci` glob picks up `server/**/*.test.ts` going forward (was kernel + built-in-plugins + test/ only).

**UI (`ui/`, private workspace)**

- `models/api.ts` adds `IKindRegistryProviderUiApi` and reshapes `IKindRegistryEntryApi` to match the new wire shape.
- `services/kind-registry.ts` — ingest now flattens the primary Provider's visuals onto the entry so existing `lookup` / `labelOf` / `colorOf` / `iconOf` keep working unchanged. New `providersOf(name)` returns the full per-Provider map for surfaces that paint per-Provider. `applyCssVars` keeps emitting `--sm-kind-<kind>` from the primary — every static CSS reference (`node-card.css`, `kind-palette.css`, `inspector-view.css`) survives without changes.
- 3 spec files updated to construct the new wire shape in fixtures (`kind-registry.spec.ts`, `graph-view.spec.ts`, `list-view.spec.ts`, `filter-url-sync.spec.ts`); `kind-registry.spec.ts` adds 2 new cases for cross-provider sharing and CSS-var derivation.

**Demo dataset (`web/scripts/build-demo-dataset.js`)**

- The hardcoded `DEMO_KIND_REGISTRY` is updated to the new shape and regenerated as part of `web:build`. The legacy `hook` entry (already obsolete since spec 0.17.0) is dropped to keep the demo aligned with the active built-in catalog.

**Known limitation (deferred to Phase B).** With shared kind names possible, a node sourced from a non-primary Provider currently renders in the primary's color — the data shape (`entry.providers[node.provider]`) supports per-Provider painting, but the consumer-side fix (node-card / inspector reading `node.provider` to pick the matching color) ships in Phase B alongside the new Providers, when shared kind names are actually produced. During this release window no Provider produces shared kind names, so the tradeoff has zero user-visible impact.

**Backward compatibility.** Greenfield (`feedback_greenfield_no_versioning.md`): no released consumer holds the prior `kindRegistry` shape or relies on a Provider's hand-rolled `walk()`. Stays minor pre-1.0 per `versioning.md` § Pre-1.0.
