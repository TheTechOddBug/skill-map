# Spec changelog

## 0.18.0

### Minor Changes

- 305e75a: Step 9.6.3 — built-in `bump` Action + sidecar write channel. Adds the deterministic `core/bump` Action and the new `ISidecarStore` port (with the `FilesystemSidecarStore` impl) that materialises Action-returned `{ kind: 'sidecar', path, changes }` payloads against on-disk `.sm` files. The Action stays pure — `invoke()` computes a deep-merge patch and returns it; the Store re-reads the on-disk sidecar, deep-merges (objects RECURSE; arrays REPLACE), revalidates the merged result against `sidecar.schema.json` + `annotations.schema.json`, and writes back inside a path-keyed critical section using the standard atomic `.tmp + rename` pattern.

  **Runtime contract extension.** `IAction` gains an optional `invoke<TInput, TReport>(input, ctx): IActionResult<TReport>` method (additive — actions that don't implement it keep working). `IActionResult` carries `report: TReport` plus an optional `writes?: TActionWrite[]` array; today `TActionWrite` is the discriminated union `{ kind: 'sidecar'; path; changes }`, with future write kinds (storage rows, plugin KV) landing additively. `IActionContext` introduces `{ node, nodeAbsolutePath, invoker, now }` so Actions can stamp `audit.lastBumpedBy` from a CLI-supplied `'cli'` (or `'plugin:<id>'`) value without doing any IO themselves.

  **`bump` Action behaviour matrix** (Decision #1 of the brief): stale node (or no sidecar yet) → patch increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, populates `audit.lastBumpedAt` + `lastBumpedBy` (and on first-time creation also `audit.createdAt` + `audit.createdBy`); fresh node without `force` → refusal (`{ ok: false, reason: 'fresh' }`, no writes); fresh node with `force: true` → silent no-op (`{ ok: true, noop: true }`, no writes — intended for the upcoming batch flow `sm bump --pending --staged`).

  **Spec.** `sidecar.schema.json` now formalises the `audit:` sub-shape (`lastBumpedAt` / `lastBumpedBy` / `bumpReason` / `createdAt` / `createdBy`, all optional at the property level, `additionalProperties: true`); the `bump` Action atomically fills `lastBumpedAt` + `lastBumpedBy` on every bump and `createdAt` + `createdBy` on first creation. The conformance fixture at `spec/conformance/fixtures/sidecar-example/agent-example.sm` now carries a populated audit block. New `spec/schemas/bump-report.schema.json` declares the deterministic report shape — distinct from `report-base.schema.json` which carries LLM-specific `confidence` + `safety` and is therefore wrong for deterministic Actions.

  **Greenfield + pre-1.0 versioning.** The `audit:` block formalisation is technically a breaking surface (a previously-permissive `additionalProperties: true` block now declares typed properties), but per the greenfield-no-versioning policy and the pre-1.0 versioning rule (every breaking change ships as a minor while the workspace is `0.Y.Z`), this lands as a minor on both `@skill-map/spec` and `@skill-map/cli`. No released consumer depended on the prior shape; the empty `audit: {}` documented in 9.6.2 is forward-compatible with the new declarations.

  Coverage matrix row 26 stays 🟡 partial (notes updated to mention the audit-block formalisation); row 28 lands as 🔴 missing — direct conformance case for `bump-report.schema.json` ships together with the `sm bump --json` CLI verb in Step 9.6.4. Implementation tests at `src/test/sidecar-store.test.ts` and `src/test/bump-action.test.ts` cover the runtime behaviour today.

- 79dfdea: Step 9.6 catalog curation. The annotation surface settled in Steps 9.6.1 → 9.6.7 went through a UX review on 2026-05-07; 16 fields with no clear value or that duplicated other surfaces were dropped from the curated catalog, and the per-bump rationale field `audit.bumpReason` was rolled back together with its CLI / BFF inputs.

  **Annotations dropped (16).** `spec/schemas/annotations.schema.json` no longer documents `provides`, `type`, `author`, `created`, `updated`, `category`, `keywords`, `icon`, `color`, `priority`, `readme`, `examplesUrl`, `github`, `homepage`, `linkedin`, `twitter`. The schema stays `additionalProperties: true`, so legacy / opaque keys still ride through; the built-in `unknown-field` rule warns on any of them as a typo. Greenfield, no migration: no released consumer depended on these in `annotations.*`.

  **Annotations kept (15).** `version`, `stability`, `supersedes`, `supersededBy`, `requires`, `conflictsWith`, `related`, `authors`, `license`, `source`, `sourceVersion`, `released`, `tags`, `hidden`, `docsUrl`. The load-bearing versioning + supersession block is unchanged.

  **`audit.bumpReason` rolled back.** Removed from `spec/schemas/sidecar.schema.json#/$defs/audit/properties`. CLI: `--reason` flag dropped from `sm bump`; `IBumpInput.reason` removed; `buildAudit` no longer emits the field. BFF: `reason` removed from the `POST /api/sidecar/bump` JSON body schema. Tests assert the audit block surfaces `lastBumpedAt` / `lastBumpedBy` only on a bump-without-reason path. The audit block stays `additionalProperties: true` so the field can ride opaquely if a legacy sidecar carries it; the schema just doesn't curate it anymore. R6's mitigation set drops the bumpReason reference — the contract is now "bump rewrites the file; narrative goes in the `.md` body, which is never touched".

  **deepMerge null-as-delete primitive retained.** The kernel's `FilesystemSidecarStore.deepMerge` still treats a `null` patch value as a delete sentinel. No current caller after the bumpReason rollback, but the primitive is architecturally sound for future Actions that need per-write erase semantics. JSDoc updated to flag this; the unit tests stay (renamed the example field name from `bumpReason` to a neutral placeholder).

  **Fixtures + conformance.** All `.sm` files in `fixtures/local-scope/` and `fixtures/demo-scope/` trimmed to the curated set; the kitchen-sink reference fixture trimmed to 15 annotations + the load-bearing supersession block (kept the `example-plugin:` namespace). Conformance fixture `spec/conformance/fixtures/sidecar-end-to-end/agents/stale.sm` trimmed (removed `type` + `author`) so the `unknown-field` rule's expected warning count matches the case file's `issuesCount: 2` assertion. Structural sample at `spec/conformance/fixtures/sidecar-example/agent-example.sm` trimmed to the curated catalog.

  **Spec docs.** `spec/architecture.md` `## Annotation system` section: catalog list updated, `audit.bumpReason` line dropped, bump-field-set stability clause rewritten to enumerate the four current audit fields with `additionalProperties: true` documented. `spec/cli-contract.md`: `--reason` removed from the two `sm bump` rows; the worked `.sm` round-trip example trailing line replaced; `POST /api/sidecar/bump` body shape no longer carries `reason`. `spec/conformance/coverage.md` row 27 updated. `spec/index.json` regenerated.

  **ROADMAP.md.** §Step 9.6 carries a `Catalog curation 2026-05-07` note enumerating the dropped + kept sets; R6's mitigation list drops the bumpReason mention; the abridged decisions and §Frontmatter standard catalog descriptors updated.

  **Out of scope.** UI display tiering (4-tier vendor/plugin layout, inspector sections) is a separate task delegated to app-agent later. Kernel `Node.author` denormalization stays untouched — `author` rides on `additionalProperties: true` for users who want to keep writing it informally; the read path persists the value but the field is no longer curated.

- 79dfdea: Step 9.6 catalog-curation follow-up (2026-05-07): remove the vestigial `Node.author` denormalisation end-to-end. The 9.6.2 migration sourced `Node.author` from `annotations.author`; the 2026-05-07 catalog curation dropped `author` from `annotations.schema.json`, leaving the column without a canonical source. The earlier curation changeset said `Node.author` would stay untouched; this follow-up reverses that — keeping a denorm path for an opaque `additionalProperties: true` rider was inconsistent with the curated catalog and added persistence + display surface for a field the schema no longer documents.

  **Spec.** `spec/schemas/node.schema.json` no longer documents the `author` property. `spec/architecture.md` § "Read path (denormalization)" lists two columns instead of three (`stability`, `version`). `spec/db-schema.md` § scan_nodes drops the `author` row. `spec/index.json` regenerated.

  **Kernel.** `Node.author` removed from the runtime type and `IScanNodesTable.author` removed from the SQLite schema. `applyAnnotationsOverlay` no longer reads `annotations['author']`; the cache-hit reset in `runScan` no longer clears `node.author`; `buildNode` no longer initialises the field. New migration `003_drop_node_author.sql` issues `ALTER TABLE scan_nodes DROP COLUMN author;` (SQLite 3.35+ — node:sqlite ships ≥ 3.45). `scan-persistence.ts` and `scan-load.ts` no longer write or read the column.

  **CLI.** `sm show` no longer renders an `author:` row in the node header. `SHOW_TEXTS.nodeFieldAuthor` removed. The built-in `validate-all` rule's `toNodeForSchema` no longer copies `author` over to the wire shape it validates against.

  **Tests.** `sidecar-reader.test.ts`, `storage.test.ts`, `node-enrichments.test.ts`, `server-query-adapter.test.ts` updated. The fresh-sidecar fixture in `sidecar-reader.test.ts` no longer writes an `author:` annotation (rides on `additionalProperties: true` if anyone keeps writing it informally; not a denorm-source anymore).

  **Greenfield.** No automatic salvage path. Pre-9.6.2 rows had the column reset to NULL by migration 002. Anyone who later wrote `author:` in their `.sm` keeps the value verbatim under `scan_nodes.annotations_json`; the `unknown-field` rule warns on the key as a typo guard.

  **Out of scope.** UI display tiering (4-tier vendor/plugin layout, inspector sections) remains a separate task; the UI's `INodeApi.author` optional field is not consumed by any service / view, and the BFF will simply never produce it after this change. Rip-out lands with the inspector tiering pass.

- 670eaa4: Catalog refinement: drop `released` from the curated annotation catalog. The catalog now stands at **14 fields**.

  **Rationale.** `released` (lifecycle "officially released") was redundant with `audit.lastBumpedAt` (activity timestamp written by every `bump`) for this project's flow — the spec doesn't distinguish official release from bump, so a separate lifecycle field added confusion without unique semantics. Activity timestamp now lives exclusively in the reserved `audit:` block.

  **Spec.** `spec/schemas/annotations.schema.json` removes the `released` property; description updated to "load-bearing 14 fields" and clarifies that the activity timestamp lives in `audit.lastBumpedAt`. `spec/architecture.md` listing updated. `spec/index.json` regenerated.

  **Fixtures.** `fixtures/local-scope/.claude/agents/kitchen-sink.sm` drops the `released:` line (only fixture that carried it). Hashes unaffected — `for.bodyHash` and `for.frontmatterHash` are over the `.md`, not the `.sm`.

  **UI.** Card `daysAgo` (`ui/src/app/components/node-card/node-card.ts`) and inspector `headerDays` (`ui/src/app/views/inspector-view/inspector-view.ts`) both switch to reading `sidecar.root.audit.lastBumpedAt` — the canonical activity timestamp now flowing on the wire after R15. Annotations panel drops the `released` row from the lifecycle section (`ILifecycleSection.released` field, parsing, render, and the `texts.fields.released` strings in both `inspector-view.texts.ts` and `annotations-panel.texts.ts`).

  **Backward compatibility.** `additionalProperties: true` stays — sidecars carrying `released:` continue to validate (the field rides through as an unknown opt-in key). The built-in `unknown-field` rule will warn on it post-curation, matching the pattern for the 16 fields dropped in the 2026-05-07 catalog curation.

  Greenfield-permitted breaking surface (no released consumers depend on the prior shape) shipping as a `@skill-map/spec` minor per the pre-1.0 rule.

- d12f7d2: Two new built-in Providers — `gemini` and the vendor-neutral `agent-skills` — plus a tighter `IProvider.classify()` contract so multiple Providers can scan the same roots without colliding.

  **`gemini`**

  - Walks Google's Gemini CLI on-disk conventions: `.gemini/agents/*.md` → `agent`, `.gemini/skills/<name>/SKILL.md` → `skill`, `.gemini/**/*.md` and `GEMINI.md` → `markdown` (the format-named generic fallback).
  - Per-kind frontmatter schemas absorb Google's documented contracts verbatim:
    - `agent.schema.json` — 7 vendor-specific fields (`kind: local|remote`, `tools`, `mcpServers`, `model`, `temperature`, `max_turns`, `timeout_mins`) per https://geminicli.com/docs/core/subagents/. `name` + `description` come from spec base.
    - `skill.schema.json` — thin `allOf` extension of base; Google's documented Skill format requires only `name` + `description`.
    - `markdown.schema.json` — fallback, base only.
  - UI: Gemini purple + Google blue palette; `pi-sparkles` icon for agents.
  - Conformance: `basic-scan` case + `minimal-gemini` fixture (agent + skill + GEMINI.md).
  - Bundle granularity: `bundle` (the Provider is the bundle's only extension today; future Gemini-namespaced extractors land here).

  **`agent-skills`**

  - Vendor-neutral Provider that owns the open-standard path `.agents/skills/<name>/SKILL.md` jointly adopted by Anthropic, OpenAI (Codex), and Google (Gemini). Single kind: `skill`. Reclaims the path so vendor-specific Providers don't have to — the day a Codex Provider lands, the spec's `provider-ambiguous` rule fires zero times because the open-standard path already has a home.
  - UI: deliberately neutral slate (`#64748b` / `#94a3b8`) so the kind reads as "vendor-agnostic" at a glance.
  - Conformance: `basic-scan` case + `minimal-agent-skills` fixture.

  **`IProvider.classify()` returns `string | null`**

  - Old contract: `classify(path, fm): string` — must return a kind name. Old Claude returned `'markdown'` for non-`.claude/` paths; with one Provider this was fine, with multiple Providers it doubles up the same path (SQLite UNIQUE on `scan_nodes.path` violation).
  - New contract: `classify(...) → string | null`. `null` means "not my file"; the orchestrator skips it. Each Provider claims its own conventions and disclaims the rest.
  - Claude: claims `.claude/{agents,commands,skills}/`, `.claude/**/*.md` (catch-all under `.claude/`), `notes/**/*.md`, and `CLAUDE.md`. Disclaims everything else.
  - Gemini: claims `.gemini/{agents,skills}/`, `.gemini/**/*.md`, and `GEMINI.md`. Disclaims everything else.
  - agent-skills: claims `.agents/skills/<name>/SKILL.md` only.

  **Per-Provider node painting (consumer-side fix from Phase A)**

  - `node-card` now binds `[style.--accent]="providerAccent()"` so a node sourced from a non-primary Provider paints with its own Provider's color (e.g. a Gemini-sourced `agent` renders in `#9b72cb` even when Claude is the primary contributor to the `agent` kind). Primary Providers fall through to the existing `--sm-kind-<kind>` CSS var without an inline override.
  - `KindRegistryService.providersOf(kind)` returns the per-Provider sub-map; `node-card.providerAccent()` reads `entry.providers[node.provider]?.color`.

  **Conformance fixture migration**

  - All Claude conformance fixtures (`minimal-claude`, `rename-high-{before,after}`, `orphan-{before,after}`) move from project-relative `agents/` / `commands/` / `skills/` paths to `.claude/agents/` / `.claude/commands/` / `.claude/skills/` so the Claude Provider's strict `classify()` claims them.
  - `spec/conformance/fixtures/sidecar-end-to-end/agents/` → `.claude/agents/`. The matching `sidecar-end-to-end.json` case asserts the new paths.
  - `spec/conformance/cases/plugin-missing-ui-rejected.json` updated to assert all 3 built-in providers in the result (was 1).
  - `spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/provider.js` now declares the `markdown` kind to mirror Claude's catalog.
  - The bad-provider fixture is unchanged in intent — still rejects manifests missing `ui` — but uses the `markdown` kind to align with the Provider's current catalog.

  **Tests**

  - 8 new Gemini provider tests, 6 new agent-skills tests, 2 new node-card per-Provider painting tests. The bulk of the existing tests update to the new fixture paths; built-in modes / pluginId tests now allow the `gemini` and `agent-skills` pluginIds; the cross-provider count assertions in `plugin-runtime-branches.test.ts` (3 providers when no toggles) pick up the two new bundles.
  - Total: 1098 cli tests + 307 ui tests, all green.

  **Backward compatibility**

  Greenfield (`feedback_greenfield_no_versioning.md`): the `classify()` signature change is breaking for any plugin Provider in the wild — no released consumer holds a Provider implementation today. Stays minor pre-1.0 per `versioning.md` § Pre-1.0. Existing local DBs rescan to pick up the new kind layout (no migration ships).

- e17ff6a: Per-user favorites. The UI gains a subtle heart button on every node card (stacked under the chevron in the actions cluster) plus a "Favorites only" toggle in the filter-bar that hides while the user has zero favorites. State persists across `sm scan` and `sm db reset` because favorites live in a new `state_node_favorites` table (zone `state_`).

  **Spec.** New table in `spec/db-schema.md`: `state_node_favorites(node_path PRIMARY KEY, favorited_at INTEGER NOT NULL)`. Listed in the rename heuristic's FK migration set so renaming a favorited file preserves the mark. New optional `Node.isFavorite: boolean` field in `spec/schemas/node.schema.json` — decorated by the BFF on every `/api/nodes` and `/api/nodes/:pathB64` response; consumers that don't recognise it MUST ignore it.

  **BFF.** Two new endpoints, both idempotent:

  - `PUT /api/favorites/:pathB64` — 204 on success, 404 when the path is not in the persisted scan.
  - `DELETE /api/favorites/:pathB64` — 204 always (un-favoriting an already-unmarked path is a no-op).

  The `/api/nodes` route loads the favorites set once per request via a tiny `SELECT node_path FROM state_node_favorites` query and decorates each emitted node with `isFavorite` by `Set` membership in memory — no SQL JOIN against `scan_nodes`. Cost is `O(favorites)` per request (typical projects pin a handful of nodes).

  **Storage.** New `port.favorites.{ set, unset, listPaths }` namespace on `StoragePort`. `migrateNodeFks` (rename heuristic) updates `state_node_favorites.node_path` alongside the other `state_*` tables; `findStrandedStateOrphans` scans it too. New `IMigrateNodeFksReport.nodeFavorites` counter; `sm orphans reconcile` summary line includes the count.

  **Migration `005_node_favorites.sql`** creates the table. No backfill — fresh installs and existing scopes alike start with zero favorites.

  **UI.** New `<sm-node-card>` `[isFavorite]` input + `(favoriteToggle)` output (path + new value). The graph view wires the output to `CollectionLoaderService.toggleFavorite(path, value)` which (a) flips the local store optimistically, (b) fires the BFF call, (c) rolls back on failure. The filter-bar's "Favorites only" toggle is gated by a `hasAnyFavorites` computed signal so the row stays uncluttered for first-time users; the toggle stays visible if the filter is currently active so the user can disable it after un-favoriting the last node.

  **Out of scope (deliberate).**

  - No CLI verb (`sm fav`). Favoriting is a visual / personal preference; the CLI surface stays focused on lifecycle verbs.
  - No WebSocket broadcast on favorite toggle. Multi-tab sync (`favorite.set` / `favorite.unset` events) can land later if the use case surfaces.
  - Demo (`StaticDataSource`) rejects favorite mutations with `code: 'demo-readonly'` — the optimistic flip rolls back, surfacing the read-only stance to the user.

  Tests: `src/test/favorites-storage.test.ts` (CRUD + rename heuristic + collision report — 6 cases), `src/test/server-favorites-endpoint.test.ts` (PUT/DELETE happy paths, 404, idempotency, isFavorite decoration on the list and single-node routes — 9 cases). UI: 5 new cases in `node-card.spec.ts` and 4 in `collection-loader.spec.ts`.

- 864e373: Phase 0 of the multi-provider rollout: rename the Claude Provider's fallback kind `note` → `markdown`.

  The fallback kind classifies any markdown file under a Claude scope that does not match a more specific path (`.claude/agents/`, `.claude/commands/`, `.claude/skills/`). The previous name `note` overcommitted to a content role; the file is really just "generic markdown without a specific role". The new name reflects the _format_. Convention going forward: format-named kinds (`markdown`, future `toml`, future `json`) apply ONLY as the generic fallback. A file that IS a specific role (e.g. a Codex agent in TOML) classifies as `agent`, not `toml` — specific roles prevail over format naming.

  This rename is mechanical and pure. No behavior, validation, or persistence change beyond the kind identifier.

  **`@skill-map/spec`**

  - `schemas/extensions/provider.schema.json` description updated (the spec doesn't hardcode kind names; only prose mentions changed).
  - `schemas/node.schema.json` prose updated.
  - `schemas/summaries/note.schema.json` → `schemas/summaries/markdown.schema.json` (renamed file, `$id` updated, `title: SummaryNote` → `SummaryMarkdown`, prose updated).
  - `db-schema.md`, `README.md`, `conformance/coverage.md` — prose updates.
  - `spec/index.json` regenerated (new file path + hash, old entry removed).

  **`@skill-map/cli`**

  - `built-in-plugins/providers/claude/index.ts` — `kinds.note` → `kinds.markdown`. `defaultRefreshAction` `claude/summarize-note` → `claude/summarize-markdown`. `ui.label: 'Notes'` → `'Markdown'`. Color and icon unchanged. `classify()` fallback `'note'` → `'markdown'`.
  - `built-in-plugins/providers/claude/schemas/note.schema.json` → `markdown.schema.json` (renamed file, `$id` updated, `title: FrontmatterNote` → `FrontmatterMarkdown`).
  - `kernel/types.ts` — `NodeKind` union: `'note'` → `'markdown'`.
  - `built-in-plugins/formatters/ascii/index.ts` and `cli/commands/export.ts` — `KIND_ORDER` updated.
  - All hardcoded `'note'` test fixtures and assertions across `src/test/`, `src/built-in-plugins/`, and the Claude conformance suite (`basic-scan.json`, `coverage.md`) flipped to `'markdown'`.
  - Conformance fixture `spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/provider.js` (the negative-test fixture mirroring Claude shape) renamed alongside.

  **UI (`ui/`, private workspace, no version bump per AGENTS.md `ui/` policy)**

  - `models/node.ts` — `ISummaryNote` → `ISummaryMarkdown` with `kind: 'markdown'`. Union member updated.
  - `node-card.ts/.html`, `graph-layout.ts/.spec.ts`, `collection-loader.ts/.spec.ts`, `static-data-source.spec.ts`, `node-card.spec.ts`, `vendor-frontmatter.spec.ts`, `inspector-view.html` — kind literal + class binding renames.
  - CSS classes `.sm-gnode--note` → `.sm-gnode--markdown`, `.inspector__header--note` → `.inspector__header--markdown`. CSS variables `--sm-kind-note*` → `--sm-kind-markdown*` across `node-card.css`, `kind-palette.css`, `inspector-view.css`. The variables are runtime-injected from the Provider's `ui.color` value, so no static color value changed.
  - i18n comments in `i18n/node-card.texts.ts` updated.

  **Web (public site, `web/`)**

  - `app.js` color map and `STR` label map: `note` → `markdown`.
  - `index.html` demo SVG `data-type="note"` → `"markdown"`. Provider description prose dropped the legacy `hook` mention while we were there (out-of-date since spec 0.17.0; not a Phase 0 goal but cheap to fix in the same prose pass).
  - `i18n.json` key `graph.legend.note` → `graph.legend.markdown` with EN/ES values `Markdown`/`Markdown` (dev-facing audience; the technical kind name reads cleaner than the prose word "Note").

  **No data migration required.** Greenfield (per `feedback_greenfield_no_versioning.md`); existing local DBs rescan to pick up the new kind value. Historical CHANGELOG entries that reference `note` are intentionally left untouched — they document past behavior (precedent: the `.skill-mapignore` rename in spec 0.16.0).

  **Demo data.** `web/demo/data.meta.json` is a generated artifact (regenerates on next demo build); the source changes drive it.

  Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because both `@skill-map/spec` and `@skill-map/cli` are still 0.x and no released consumer mandates the prior kind name. The first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.

- c47c131: Closes review-queue item R4 (Step 9.6) — introduce a shared deterministic report base so the deterministic / probabilistic split is explicit at the schema level, symmetric with the existing `report-base.schema.json` (LLM-only `confidence` + `safety`).

  `spec/schemas/report-base-deterministic.schema.json` declares the universal shape every deterministic Action's report MUST extend: `ok` (boolean — did the Action complete its logical work?) plus action-specific keys via `additionalProperties: true`. `report-base.schema.json` (probabilistic) and `report-base-deterministic.schema.json` (deterministic) are the two endpoints of the report hierarchy; an Action's manifest `mode` field picks the side.

  `spec/schemas/bump-report.schema.json` migrates to extend the new base via `allOf` + relative `$ref` (per `context/spec.md` rule 7). The redundant inline declaration of `ok` is dropped — the base provides it. The bump-specific keys (`version`, `noop`, `reason`, `createdSidecar`) stay; `additionalProperties: true` mirrors the base so the report shape stays open across both layers.

  Coverage matrix: row 28 (`bump-report.schema.json`) notes updated to point at the new base; row 29 (`report-base-deterministic.schema.json`) lands as 🟡 partial — covered indirectly via every deterministic Action conformance case (e.g. the upcoming Step 9.6.4 `sm bump --json` case for row 28), flipping 🟢 when the first conformance case directly validates a deterministic report against this base.

  `spec/index.json` regenerated. No `@skill-map/cli` bump — the bump Action's runtime report shape (`IBumpReport` in `src/built-in-plugins/actions/bump/index.ts`) is unchanged. Greenfield + pre-1.0: breaking surface ships as a minor per the pre-1.0 versioning rule (no released consumers depended on the prior `bump-report.schema.json` shape).

- 305e75a: Step 9.6.1 — sidecar + annotation schemas. Closes the deferred portion of Decision #124 (where skill-map's own annotation fields live) by introducing two new schemas that lock the shape of the co-located YAML sidecars (`<basename>.sm`) the kernel will start reading in Step 9.6.2.

  `spec/schemas/sidecar.schema.json` declares the root shape: required `for` block (`path` + `bodyHash` + `frontmatterHash`, optional `resolvedAs` for ambiguous-classification overrides) plus reserved sibling blocks `annotations`, `settings`, `audit`. Schema is `additionalProperties: true` at every level so plugins write to their own `<plugin-id>:` namespace without coordination; the built-in `unknown-field` rule (Tier 1, always-on) warns on unrecognized root keys to catch typos.

  `spec/schemas/annotations.schema.json` lists 25 conventional annotation fields with full descriptions for editor autocomplete and IDE doc-on-hover. The load-bearing core covers versioning + supersession (`version`, `stability`, `supersedes`, `supersededBy`, `requires`, `conflictsWith`, `provides`, `related`); provenance and lifecycle dates (`type`, `author`, `authors`, `license`, `source`, `sourceVersion`, `created`, `updated`, `released`); taxonomy (`tags`, `category`, `keywords`); display (`icon`, `color`, `priority`, `hidden`); and docs (`docsUrl`). Every field is optional; an empty `annotations: {}` is valid. `version` is a single integer monotonic counter, orthogonal to `stability` — there is no major bump concept; the convention for breaking changes is to create a new node and supersede the old.

  Conformance fixture `spec/conformance/fixtures/sidecar-example/` ships a structural sample (one `.md` + matching `.sm`); coverage matrix gains rows 26 and 27 marked 🟠 deferred — direct end-to-end conformance cases land in Step 9.6.6 alongside plugin contributions.

  This changeset is greenfield-permitted breaking surface (no released consumers depend on the prior shape) but ships as a minor per the pre-1.0 versioning policy. No code changes — Step 9.6.2 (kernel reader + drift detection) is the next sub-step. The previous "annotation home — pending decision" section in ROADMAP is rewritten to describe the sidecar shape; Decision #125 carries the formal record.

- 305e75a: Step 9.6.6 (BFF half) — `GET /api/annotations/registered` over the Hono BFF. Read-only catalog of plugin-contributed annotation keys, surfaced so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime. The endpoint is a pure projection of `kernel.getRegisteredAnnotationKeys()` — populated once by `registerEnabledExtensions` after every plugin loads at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec.

  **Wire contract.** Method + path: `GET /api/annotations/registered`. No query params, no body, no auth (matches `/api/plugins`, `/api/config`). 200 envelope: `{ "schemaVersion": "1", "kind": "annotations.registered", "items": IRegisteredAnnotationKey[], "counts": { "total": <int> } }`. Item shape per `src/kernel/types/annotation-catalog.ts`: `{ pluginId, key, location: 'namespaced' | 'root', ownership: 'exclusive' | 'shared', schema: Record<string, unknown> }` — the inline JSON Schema as declared in the contributing plugin's manifest, not the AJV-compiled validator. Catalog is small (typically 0–50 entries) so no pagination, no filters, no caching headers; mutating the returned `items` array does not affect subsequent calls (kernel view stays frozen).

  **Composition.** `server/index.ts` now instantiates a kernel at boot (`createKernel()`), stamps `pluginRuntime.annotationContributions` onto it via `setRegisteredAnnotationKeys`, and threads the kernel through `IAppDeps.kernel` to the route factory. Routes that need the catalog read it off this kernel via closure — no shared mutable state, no DI container, factory only.

  **Refresh policy.** Same as the rest of the BFF's plugin surface — discovery happens once at `sm serve` boot. An operator that installs a new plugin restarts the server, matching the watcher's documented "loaded ONCE at boot" contract.

  **Spec contract.** Documented in `spec/cli-contract.md` §Sidecar bump → BFF endpoint subsection (sibling of `POST /api/sidecar/bump` from 9.6.5). The new `kind` discriminator (`annotations.registered`) is reserved at 9.6.6 and joins R7 alongside `sidecar.bumped` as the canonical `rest-envelope.schema.json#/properties/kind/enum` gap to close in one batch — same divergence stance as 9.6.5; closing the enum is part of the §Step 9.6 review-queue walk.

  Tests at `src/test/server-annotations-endpoint.test.ts`: empty catalog (real `createServer()` boot with `--no-plugins`), populated catalog with a `namespaced` + a `root + exclusive` contribution surfaced through `createApp` directly (bypasses the loader's `process.cwd()` resolution which `loadPluginRuntime` reads via `defaultRuntimeContext()`), and a mutation guard that asserts the second call still sees the original frozen view. 3 cases pass.

  UI half (autocomplete dropdown wired into the annotation editor) is post-Step-9.6 work and lands once the parent step's review queue walks to ✅.

- 305e75a: Step 9.6.5 (BFF half) — `POST /api/sidecar/bump` over the Hono BFF. The endpoint mirrors the `sm bump <node.path> [--force]` CLI verb 1:1: same built-in `core/bump` Action, same `FilesystemSidecarStore`, same fresh-vs-stale refusal semantics. The only differences from the CLI verb are the invoker label (`'ui'` vs `'cli'`) and the wire shape. Batch (`--pending`) stays CLI-only at 9.6.5 — surfacing it over REST needs a job-style progress channel and lands later.

  **Wire contract.** Request body: `{ "nodePath": <string, required>, "force"?: <boolean>, "reason"?: <string> }`. Successful (200) envelope: `{ "schemaVersion": "1", "kind": "sidecar.bumped", "value": { "nodePath", "version", "status": "fresh" }, "elapsedMs": <int> }`. Refusal (409) on fresh + no force: `{ "ok": false, "error": { "code": "sidecar-fresh", "message": <string>, "details": null } }`. 404 on unknown `nodePath`; 400 on malformed body. Force-on-fresh is a 200 silent no-op (per the Action spec) carrying the existing version, with no on-disk change. The BFF's global `app.onError` gains a new `'sidecar-fresh'` `TErrorCode` mapped from HTTP 409.

  **WS event — `sidecar.bumped`.** After every successful 200 bump that materialises a write, the BFF broadcasts `{ "type": "sidecar.bumped", "nodePath", "version", "status": "fresh" }` over `/ws` so all connected clients refresh in lockstep. Force-on-fresh no-op responses do **not** broadcast (decision: no-op = no event — nothing changed on disk, sending the event would tell every UI to refresh state that has not moved).

  **Spec contract.** Documented in `spec/cli-contract.md` §Sidecar bump → BFF endpoint subsection. Two new review-queue items surfaced in `ROADMAP.md` §Step 9.6: R7 (REST envelope `kind: 'sidecar.bumped'` is not in the canonical `rest-envelope.schema.json#/properties/kind/enum` — close before flipping 9.6.5 ✅) and R8 (force-on-fresh broadcast policy — keep no-op = no event, or always broadcast on a successful 200).

  Tests at `src/test/server-sidecar-endpoint.test.ts`: 200 stale path with broadcaster receipt assertion; 409 refusal with on-disk untouched + no broadcast; 200 force-on-fresh no-op with no broadcast; 404 unknown path; 400 missing `nodePath` / wrong type / malformed JSON; round-trip parity (the on-disk `.sm` after a UI-driven bump is byte-equal to what the CLI verb would produce). 8 cases pass.

  UI half (Angular components, e2e) is the next agent's task and will flip 9.6.5 to ✅.

- 305e75a: Step 9.6.4 — sidecar CLI verbs. Six new verbs split between `sm bump` (top-level, ROADMAP-named per Decision #125) and the `sm sidecar` sub-namespace (administrative helpers; the existing `sm refresh` from Step A.8 — enrichment-layer — stays untouched). Plus `sm hooks install pre-commit-bump` for the opt-in commit-time auto-bump.

  **`sm bump <node-path> [--force]`** — single-node mode. Wraps the built-in deterministic `core/bump` Action: refusal on a fresh node (`{ ok: false, reason: 'fresh' }`, exit 2) unless `--force`; with `--force` on a fresh node the verb is a silent no-op (exit 0, no stdout). On a stale or first-time node increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, stamps `audit.lastBumpedAt` + `lastBumpedBy: 'cli'` (and `audit.createdAt` + `createdBy: 'cli'` on first creation). `--json` emits the report shape declared by `bump-report.schema.json`.

  **`sm bump --pending [--staged] [--force]`** — batch mode. Walks every node whose sidecar overlay reports drift in `node.path` ASC order. `--json` envelope: `{ bumped, refused, skipped, errors[], elapsedMs }`. `--staged` runs `git add <sidecar-path>` after each successful bump (failures degrade to a stderr warning, batch keeps running); preflight enforces the spec error matrix — not in a git repo (no `.git/` parent) → exit 5; `git` binary missing on PATH → exit 2.

  **`sm sidecar refresh <node-path>`** — hash-only update. Refreshes `for.{bodyHash, frontmatterHash}` to match the live node WITHOUT bumping `annotations.version` and WITHOUT touching the audit block. Useful when a body change is editorial and the user doesn't want to spend a version increment. Distinct from the top-level `sm refresh` (enrichment-layer verb at Step A.8) — different storage, different concept; the sub-namespace prefix prevents the collision.

  **`sm sidecar prune [--dry-run]`** — delete orphan `.sm` files (sidecars whose accompanying `<basename>.md` is missing on disk). Different domain from `sm orphans` (which operates on the node graph via the rename heuristic). `--json` envelope: `{ deleted, wouldDelete, errors, items[], elapsedMs }`.

  **`sm sidecar annotate <node-path> [--force]`** — pure scaffolding. Writes a minimal `.sm` next to the `.md` with the `for:` block populated and `annotations: {}` empty, ready for editing. The `--from-frontmatter` legacy-import helper is deferred (no released consumer demands it).

  **`sm hooks install pre-commit-bump [--dry-run]`** — install (or chain into) a git pre-commit hook running `sm bump --pending --staged` so any staged drift in `.sm` sidecars auto-bumps before the commit lands. Idempotent: re-running detects the embedded skill-map marker and no-ops. When the repo already has a `pre-commit` hook, the verb appends the skill-map block rather than replacing it. `--dry-run` prints the planned content with `--- target: <path> ---` markers and writes nothing. Exit 5 if no `.git/` parent exists; exit 2 on write failures or unknown hook flavours.

  **Spec.** `cli-contract.md` §Actions gains a "Sidecar bump (Step 9.6.4)" subsection documenting all six verbs verbatim, the `--staged` git-error matrix, and the explicit `.sm` round-trip contract: **"`.sm` files are managed artifacts; comments and key order are not preserved on round-trip. Author commentary belongs in the markdown body or in a separate documentation file, not inside `.sm`."** R6 stays open in the Step 9.6 review queue — the UI work in 9.6.5 may force a revisit before closing the whole step.

  **Tests.** New CLI test suites at `src/test/{bump-cli,sidecar-cli,hooks-cli}.test.ts` cover the refusal / first-time-creation / batch (with real git) / staged / dry-run / chained-hook / idempotent-reinstall / scaffold paths. File-based SQLite under `.tmp/<scope>/`, never `:memory:`. CLI reference regenerated.

- 305e75a: Step 9.6.6 — plugin annotation contributions + Tier-1 `unknown-field` rule. Closes the last sub-step of the Step 9.6 annotation system.

  **Manifest extension.** `spec/schemas/extensions/base.schema.json` gains an optional `annotationContributions` map keyed by annotation key. Each entry declares an inline JSON Schema for the value plus two policy fields: `location` (`'namespaced'` default, `'root'` opt-in) and `ownership` (`'shared'` default, `'exclusive'` opt-in). Defaults route a contribution into the plugin's `<plugin-id>:` block at the sidecar root; `location: 'root'` lifts it to a top-level reserved key alongside `for` / `annotations` / `settings` / `audit` and REQUIRES `ownership: 'exclusive'`.

  **Loader validation.** `kernel/adapters/plugin-loader.ts` rejects two single-plugin invariants as `invalid-manifest`: `location: 'root'` with non-`exclusive` ownership, and inline `schema`s that fail to AJV-compile. After every plugin has loaded, the runtime composer (`core/runtime/plugin-runtime.ts:loadPluginRuntime`) walks the aggregated catalog and **hard-fails** when two plugins claim the same `(key, location: 'root', ownership: 'exclusive')` tuple — `loadPluginRuntime` throws a new `AnnotationContributionConflictError` and the kernel does NOT boot. Stricter than the per-plugin `invalid-manifest` path because annotation-namespace conflicts are non-recoverable: annotated `.sm` files would otherwise be non-deterministically routed.

  **Runtime catalog.** `Kernel` gains `getRegisteredAnnotationKeys(): readonly IRegisteredAnnotationKey[]`, populated once by `registerEnabledExtensions` after every plugin loads. Pure read; no side effects. Built-in catalog fields from `annotations.schema.json` are NOT included — this catalog is plugin-only. The BFF endpoint that wraps the catalog for UI autocomplete lands separately.

  **`core/unknown-field` rule.** New built-in Tier-1 typo guard (`severity: warn`). Walks parsed `.sm` sidecars and emits a warning for: (1) keys inside `annotations:` not in the curated catalog, (2) top-level keys outside the four reserved blocks that are not a registered plugin namespace nor a registered root contribution, (3) plugin-namespaced values that fail their contributing plugin's schema. The orchestrator threads parsed sidecar roots into the rule pass via `IRuleContext.sidecarRoots` plus the runtime catalog via `IRuleContext.annotationContributions`.

  **Conformance.** New end-to-end case `sidecar-end-to-end` with fixture `spec/conformance/fixtures/sidecar-end-to-end/`. Flips coverage rows 26 + 27 (`sidecar.schema.json` + `annotations.schema.json`) from 🟡 partial to 🟢 covered. Asserts a populated `Node.sidecar` overlay, `status: stale-*` drift, denormalised `annotations.version`, and both `annotation-stale` + `annotation-orphan` issues from the built-in core rules.

  **Side-fix.** `core/annotation-orphan` now emits `nodeIds: [<expectedMdRelative>]` instead of an empty array, closing the pre-existing `issue.schema.json#/properties/nodeIds/minItems: 1` violation latent until the conformance corpus exercised it.

  **Plugin author guide.** New section `## Annotation contributions` in `spec/plugin-author-guide.md` covers the manifest shape, namespacing default vs root opt-in, ownership rules, hard-fail collision behaviour, the Tier-1 typo guard, and the runtime catalog accessor with worked examples. The full guide rewrite for agent-first readability is deferred to a post-Step-9.6 follow-up.

- 305e75a: Step 9.6.2 — kernel sidecar reader + drift detection. The walker now reads `<basename>.sm` next to every `<basename>.md` it finds, validates against `spec/schemas/sidecar.schema.json` + `spec/schemas/annotations.schema.json` via the kernel AJV stack, and computes drift versus the live body / canonical-frontmatter hashes. Stale state surfaces through a new built-in Rule `core/annotation-stale` (`warn` severity); orphan `.sm` files (no matching `.md`) surface through `core/annotation-orphan` (`warn`). Schema-invalid or YAML-malformed sidecars produce an `invalid-sidecar` warning and the scan continues — drift detection is soft-mode, never blocking.

  **Storage extension.** Migration `002_sidecar_columns.sql` extends `scan_nodes` with three new columns: `sidecar_present` (INTEGER 0/1, default 0), `sidecar_status` (TEXT, NULL when absent or unparseable; one of `fresh` / `stale-body` / `stale-frontmatter` / `stale-both` otherwise), and `annotations_json` (TEXT, JSON-encoded `annotations:` block, NULL when absent or empty). The `Node` domain type gains a `sidecar` overlay that round-trips through `node.schema.json`; clients consume it as authoritative for the snapshot but never persist it across scans.

  **Breaking change — `Node.version` type flip.** The denormalised version column was a `TEXT` semver string sourced from `frontmatter.metadata.version`; it is now an `INTEGER` monotonic counter sourced from sidecar `annotations.version` (Decision #125 — single integer, orthogonal to `stability`, no major-bump concept). Pre-9.6.2 rows reset to NULL on migration — greenfield, no automatic semver→integer conversion. `node.schema.json#/properties/version` updated accordingly.

  **Source-of-truth shift for stability / version / author.** The three Node columns previously sourced from `frontmatter.metadata.*` / `frontmatter.author` now source from sidecar `annotations.{stability, version, author}`. Hard cut — the fallback through `pickMetadata` for these three fields is removed in `orchestrator.ts`. Other consumers of `metadata.*` (e.g. broken-ref's `metadata.related`) keep working; their migration lands in Step 9.6.4.

  Coverage matrix rows 26 + 27 (sidecar + annotations schemas) flip from 🟠 deferred to 🟡 partial — kernel reader is covered; full bump-end-to-end (scan → annotation queryable → drift detection → bump) still lands in Step 9.6.6. New tests under `src/test/sidecar-reader.test.ts` cover fresh / stale-body / stale-frontmatter / orphan / malformed-YAML / schema-invalid / unknown-key paths and a persistence round-trip through `scan_nodes`.

- 687823d: R15 closure (Step 9.6 review queue): extend `Node.sidecar` overlay with the full parsed `.sm` root.

  **Spec.** `spec/schemas/node.schema.json#/$defs/sidecarOverlay` gains an optional `root` property (`type: ['object', 'null']`, `additionalProperties: true`). It carries the entire parsed YAML payload of the matching `.sm` sidecar — every reserved block (`for`, `annotations`, `settings`, `audit`) plus any opt-in `<plugin-id>:` namespace. NULL when no sidecar accompanies the node, or when the sidecar exists but failed to parse / validate. The existing top-level `annotations` field stays — `root.annotations` duplicates it by design so pre-R15 consumers reading `sidecar.annotations` keep working unchanged. `spec/index.json` regenerated.

  **Kernel.** `ISidecarOverlay` (in `src/kernel/types.ts`) gains `root?: Record<string, unknown> | null`. The orchestrator's `resolveAndApplySidecar` site stamps `root: result.parsed.raw` (the full root that `parseSidecar()` already builds for the rule pass — no extra YAML reads). On parse failure the overlay ships `{ present: true, status: null, annotations: null, root: null }`; on absent sidecar `{ present: false }` (root absent).

  **Persistence.** Additive sibling column `scan_nodes.sidecar_root_json` (migration `004_sidecar_root_json.sql`) stores the JSON-encoded root alongside the existing `annotations_json`. Option (b) per the R15 brief — no rewrite of the existing `annotations_json` read path. `scan-persistence.ts` writes the column; `scan-load.ts` rehydrates `sidecar.root` from it.

  **BFF.** No route changes: `/api/nodes`, `/api/nodes/:pathB64`, and `/api/graph` are pass-through serializers — the new field flows through automatically once the kernel populates it.

  **UI wire model.** `ISidecarOverlayApi` (in `ui/src/models/api.ts`) gains `root?: Record<string, unknown> | null`. The internal `ISidecarOverlay` (in `ui/src/models/node.ts`) declared the field forward-compat-ready since the inspector-tiering pass; the `projectNode` mapper spreads `api.sidecar` as-is so the field propagates into `INodeView.sidecar.root` unchanged. The WS `sidecar.bumped` patcher (`CollectionLoaderService.patchSidecarFromBump`) preserves `root` across the bump-driven re-render so the inspector audit / debug / plugin-contributions panels stay populated after a bump.

  **Tests.** `src/test/sidecar-reader.test.ts`: fresh-sidecar case asserts `sidecar.root.for.{path,bodyHash}` and `sidecar.root.annotations.{stability,version}`; absent-sidecar case asserts `sidecar.root` is null/absent; persistence round-trip case adds the new `sidecar_root_json` column to the selected projection and asserts the persisted JSON rehydrates correctly. `src/test/server-endpoints.test.ts`: fixture now plants a `.sm` co-located with `architect.md` (pinned to baseline hashes for `status: fresh`); new test case `R15 — surfaces sidecar.root with the full parsed .sm payload` asserts `item.sidecar.root.for.path === target` and `item.sidecar.root.audit.lastBumpedBy === 'cli'` on the `/api/nodes/:pathB64` response.

  **Backward compatibility.** Pre-R15 consumers reading `sidecar.annotations` keep working unchanged — the field is preserved, just duplicates `root.annotations`. New consumers reading structured sub-fields (`root.for.*`, `root.audit.*`, plugin namespaces) light up automatically once their BFF / persistence layer ships this minor.

- 305e75a: Step 9.6.7 — wire-shape cleanup. Closes two §Step 9.6 review-queue items in one batch (R7 + R9) so the BFF's REST and WS surfaces match the canonical contracts every other route already follows.

  **R7 — REST envelope `kind` enum gap (`sidecar.bumped` + `annotations.registered`).** `spec/schemas/api/rest-envelope.schema.json` grew from four `oneOf` variants to six. `'sidecar.bumped'` (action-result variant: `value` + `elapsedMs`, no `filters` / `counts` / `kindRegistry`) covers `POST /api/sidecar/bump`. `'annotations.registered'` (catalog variant: `items` + `counts.total` only, no `filters` / `kindRegistry` / `returned`) covers `GET /api/annotations/registered`. The list variant re-imposes `counts.required: ['total', 'returned']` via per-variant override so its tally shape stays strict. `elapsedMs` is now a top-level optional integer property, present only on action-result envelopes.

  **R9 — WS event shape asymmetry.** `src/server/routes/sidecar.ts` now wraps the `sidecar.bumped` payload in the canonical `IWsEventEnvelope` shape `{ type, timestamp, data: { nodePath, version, status } }` (matches every kernel→broadcaster bridge — `scan.*`, `watcher.*`). `timestamp` serialises as an ISO 8601 string via `new Date().toISOString()`, matching the kernel orchestrator's `makeEvent`. The prior flat shape (`{ type, nodePath, version, status }`) forced the UI to accept two shapes in `isWsEvent`; that relaxation is now obsolete (the UI half lands in a follow-up `ui/` PR).

  **Tests.** `src/test/server-sidecar-endpoint.test.ts` and `src/test/server-annotations-endpoint.test.ts` each gain an AJV-compile + validate pass against `rest-envelope.schema.json` over the live 200 responses, so any future drift in the route or in the schema fails immediately. The sidecar test's broadcaster-receipt assertion now checks the canonical envelope (timestamp ISO regex, `data.{nodePath,version,status}`, no flat siblings).

  **Spec doc.** `spec/cli-contract.md` BFF subsections (`POST /api/sidecar/bump`, `GET /api/annotations/registered`) updated — both `kind` values are now part of the canonical enum, the WS event documents the wrapped envelope. `spec/index.json` regenerated.

  No new dependencies; AJV is already on the path (`Ajv2020` from `ajv/dist/2020.js`, used by the unknown-field rule). No CLI-verb surface changes.

- 1019d5f: Pluggable kernel walker + parser registry. Provider manifests gain a declarative `read: { extensions, parser }` field; the kernel owns the file walker and a closed registry of built-in parsers. The Claude Provider drops its hand-rolled `walk()` (~70 lines of fs walking + frontmatter parsing) and becomes pure metadata + classification.

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

## 0.17.0

### Minor Changes

- 77579b3: Add a `sm db browser` sub-command that opens the project's SQLite DB in DB Browser for SQLite (sqlitebrowser GUI). Read-only by default; pass `--rw` to enable writes. Replaces the previous `scripts/open-sqlite-browser.js` standalone script.

  The root `npm run sqlite` shortcut now invokes the project-built CLI binary (`node src/bin/sm.js db browser`) instead of the standalone script. This guarantees the locally compiled CLI is used, not whichever `sm` resolves on PATH (a globally installed `@skill-map/cli` would otherwise shadow the in-development version).

  Spec: `cli-contract.md` documents the new sub-command in the verb table and the §Database section.

- 696008a: Add a `--no-ui` flag to `sm serve`. With it, the BFF stops serving the Angular bundle (stale or otherwise) and the root `/` renders an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Used by the root `bff:dev` shortcut so iterating on the BFF alongside the Angular dev server doesn't surface a stale UI by accident.

  Mutually exclusive with `--ui-dist <path>` (rejected with exit 2). Combining `--no-ui` with the default `--open` emits a non-fatal stderr warning suggesting `--no-open` (the auto-opened tab would land on the placeholder rather than the live UI). `/api/*` and `/ws` remain fully functional; only the static SPA is suppressed.

  Spec impact: `spec/cli-contract.md` documents the new flag in the `sm serve` signature and the §Server flags table, including the mutual-exclusion + warning rules.

- bd5e360: Trim `frontmatter/base.schema.json` to the truly universal contract: `name` + `description` are the only required fields, every node on every Provider, and `additionalProperties: true` lets vendor-specific keys flow through silently.

  The previous base inadvertently curated a Claude-flavored shape (`tools`, `allowedTools`, full `metadata` block with `version` required, etc.). skill-map AGGREGATES vendor specs, it does not curate them — so per-vendor frontmatter shapes belong in the Provider that emits the kind. The Anthropic-specific catalog now lives entirely under `src/built-in-plugins/providers/claude/schemas/` and absorbs Anthropic's documented frontmatter verbatim (see the matching `@skill-map/cli` changeset).

  The future home for skill-map-only annotation fields (provenance, cross-vendor metadata, source URL, supersedes/supersededBy) is a deferred decision — sidecar file vs in-frontmatter block — tracked separately. Existing files that carry `metadata: { version, ... }` continue to validate without any change because of `additionalProperties: true`; nothing breaks at the consumer edge.

  Decision #55 (full metadata block in the universal base) is superseded by this change.

  Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because `@skill-map/spec` is still 0.x and Decision #55 had not reached any released consumer that mandates the prior shape. Stays minor; the first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.

## 0.16.0

### Minor Changes

- c981430: Rename the project ignore file from `.skill-mapignore` to `.skillmapignore` (no dash).

  Rationale: drop the dash for consistency with `.gitignore` / `.npmignore` / `.dockerignore` and friends — those tools use a contiguous lowercase token, and adopting the same shape removes the visual stutter when listing dotfiles. The rename also avoids confusion between the public artifact and the package id `@skill-map/*` which uses a dash by convention.

  Breaking change pre-1.0:

  - `sm init` now scaffolds `.skillmapignore` instead of `.skill-mapignore`. Existing projects must `mv .skill-mapignore .skillmapignore` manually — no compat reader (greenfield rule, see `feedback_greenfield_no_versioning.md`).
  - The bundled defaults asset moved from `src/config/defaults/skill-mapignore` to `src/config/defaults/skillmapignore`.
  - `sm serve` and `sm watch` now watch `.skillmapignore` (not `.skill-mapignore`) for live filter rebuilds.
  - Spec and JSON Schema (`spec/cli-contract.md` § `sm init`, `spec/schemas/project-config.schema.json` § `ignore`) updated; `spec/index.json` regenerated.
  - All in-repo fixtures, docs (ROADMAP, context/\*, AGENTS.md, web/app.js), tests, and skills (sm-tutorial, foblex-flow indirectly) updated in the same commit.

  Historical CHANGELOG entries that reference `.skill-mapignore` are intentionally left untouched — they document past behaviour.

## 0.15.0

### Minor Changes

- d7e8dd9: Rename the tester onboarding verb and its companion Claude Code skill from `sm-guide` to `sm-tutorial` across spec, CLI, bundled materialised payload, runtime state file, and report file. Breaking change to the public CLI surface (`sm guide` is gone — no compat shim); pre-1.0 so it ships as a minor bump per the project's pre-1.0 policy (no major while a workspace stays in `0.Y.Z`).

  Spec: `spec/cli-contract.md` — the `sm guide` verb section is renamed to `sm tutorial`. Same shape, same exit codes, same `--force` semantics — only the identifier flips. Materialised file becomes `<cwd>/sm-tutorial.md`; integrity block in `spec/index.json` regenerated.

  CLI (`@skill-map/cli`): `sm guide` → `sm tutorial`; `src/cli/commands/guide.ts` → `tutorial.ts` (`GuideCommand` → `TutorialCommand`, `SM_GUIDE_FILENAME` → `SM_TUTORIAL_FILENAME`); `src/cli/i18n/guide.texts.ts` → `tutorial.texts.ts` (`GUIDE_TEXTS` → `TUTORIAL_TEXTS`, all string templates updated to mention `sm-tutorial.md` and `@sm-tutorial.md`); `src/tsup.config.ts` build step `copyGuideSkill()` → `copyTutorialSkill()` writing the bundled payload to `dist/cli/tutorial/sm-tutorial.md` instead of `dist/cli/guide/sm-guide.md`. Test file `src/test/guide-cli.test.ts` → `tutorial-cli.test.ts` with updated regex assertions and SKILL.md byte-match anchor pointing at `.claude/skills/sm-tutorial/SKILL.md`.

  Skill: `.claude/skills/sm-guide/` → `.claude/skills/sm-tutorial/`. Frontmatter `name: sm-guide` → `sm-tutorial`. Triggers list updated (`"tutorial", "sm-tutorial", "tutorial me", "start the tutorial"`). Internal whitelist updated (`sm-tutorial.md`, `tutorial-state.yml`, `sm-tutorial-report.md`). Runtime state file renamed `guide-state.yml` → `tutorial-state.yml` (top-level YAML key `guide:` → `tutorial:`). Report file renamed `sm-guide-report.md` → `sm-tutorial-report.md`. Colloquial Spanish "guía" inside tester-facing prose stays where it reads naturally — only identifiers (path names, command names, frontmatter, technical references) flip to `tutorial`.

  ROADMAP: setup-and-state verb table updated to `sm tutorial [--force]`.

  No backwards-compat alias is shipped: the tester base for this verb is tiny and a clean break is safer than maintaining two names.

## 0.14.1

### Patch Changes

- 34d57db: Doc-only fix to remove a misleading reading of "built-in kinds" in the Node schema and one test, plus a small batch of internal CLI refactors and tightened null checks. No external surface change.

  Spec / docs:

  - `spec/schemas/node.schema.json` — the top-level `description` previously read "built-in kinds today are skill, agent, command, hook, note", which suggested those kinds were a kernel-level concept. They are not — the kernel treats `kind` as an open string, and the five names are emitted by the **built-in Claude Provider**. Re-worded to attribute the catalog to the Claude Provider, matching the wording already used on the `kind` field, in `spec/README.md`, in `src/kernel/types.ts`, and in `src/kernel/adapters/sqlite/schema.ts`.
  - `src/test/extractor-applicable-kinds.test.ts` — three comments tightened from "built-in kind" to "built-in Claude Provider kind" for consistency.

  Internal CLI refactors (no behaviour change):

  - `src/cli/commands/config.ts` — extracted an `isPlainObject` predicate (replaces the duplicated `!!v && typeof v === 'object' && !Array.isArray(v)` check inside `enumerateConfigPaths`) and a `safeGetAtPath` helper that wraps `getAtPath` + `ForbiddenSegmentError` handling so each read verb's `run()` no longer repeats the try/catch + instanceof shape.
  - `src/cli/commands/db.ts` — pulled the SQL number serialiser into `formatSqlNumber` (NaN / ±Infinity collapse to NULL) so `formatSqlValue` reads as a flat dispatcher.
  - `src/cli/util/parse-error.ts` — moved the verb-scoped error formatting (incl. the missing-positionals special case) into a `formatVerbScopedError` helper so the top-level dispatcher in `formatParseError` stays flat. Removed the now-stale "dispatcher pattern" eslint-disable comment.
  - `src/kernel/adapters/sqlite/scan-load.ts` — tightened `parseJsonObject` / `parseJsonArray` null checks from `s == null` to `s === null || s === undefined` to remove the implicit-coercion pattern flagged by lint.

  No contract change (no field/type/required edits). `spec/index.json` regenerated.

## 0.14.0

### Minor Changes

- 8f2a66d: Bare `sm` defaults to `sm serve` instead of printing help

  `sm` invoked with no arguments now starts the Web UI server when a
  `.skill-map/` project exists in the current working directory
  (equivalent to `sm serve`). When no project is found, it prints a
  one-line hint pointing to `sm init` and `sm --help` on stderr and
  exits with code `2`. `sm --help` and `sm -h` continue to print
  top-level help — help is now reserved for explicit flags.

  **Spec change** (`spec/cli-contract.md` §Binary): the prior wording —
  _"`sm`, `sm --help`, `sm -h` MUST all print top-level help"_ — is
  replaced by two separate clauses. Help invocation requires `--help` or
  `-h`; bare invocation routes to the server with the hint-and-exit
  fallback when no project exists.

  **CLI change** (`src/cli/entry.ts`): empty argv is intercepted before
  Clipanion sees it. If `defaultProjectDbPath(cwd)` exists, the args
  are rewritten to `['serve']`. Otherwise the hint is printed via the
  `tx()` i18n shim and the process exits `2`. `RootHelpCommand` no
  longer carries `Command.Default`; it remains the handler for `--help`
  and `-h` only.

  **Why pre-1.0 minor instead of major**: `spec/` and `src/` are both
  in `0.Y.Z`. Per `spec/versioning.md` §Pre-1.0, breaking changes ship
  as minor bumps until the deliberate 1.0 stabilization. The conformance
  suite required no updates (no case asserted bare-sm = help).

## 0.13.1

### Patch Changes

- 103fc1a: Doc revision pass — greenfield framing across READMEs, spec prose, ROADMAP, AGENTS, web, and workspace landing pages.

  Pure documentation changes; no normative schema or code changes.

  `@skill-map/spec`:

  - `architecture.md` — terse rewrite of §Provider · `kinds` catalog (now lists three required fields: `schema`, `defaultRefreshAction`, `ui`); new §Provider · `ui` presentation section documenting the label / color / colorDark / emoji / icon contract; §Stability section updated for the six extension kinds + Hook trigger set.
  - `plugin-author-guide.md` — Provider section gains the `ui` block documentation alongside `schema` and `defaultRefreshAction`; example manifest carries both icon variants (`pi` + `svg`); migration notes stripped under greenfield framing.
  - `cli-contract.md` — §Server documents the `kindRegistry` envelope field on every payload-bearing variant (sentinel envelopes — health/scan/graph — exempt).
  - `conformance/coverage.md` — row 18 (`extensions/provider.schema.json`) flipped 🔴 → 🟡, points at the new `plugin-missing-ui-rejected` case; new §Stability section.
  - `conformance/README.md` — drop "(Phase 5 / A.13 of spec 0.8.0)" historical phase markers.
  - `db-schema.md`, `plugin-author-guide.md` — fix `pisar` typo (Spanish leaked into English) → "are simply overwritten".
  - `CHANGELOG.md` — aggressive sweep: 2114 → 77 lines (96% reduction). Every release gets a 1–3 line greenfield summary. Drops the `Files touched`, `Migration for consumers`, `Out of scope`, `Why`, and per-step decision sub-sections. Drops commit-hash prefixes and `Pre-1.0 minor per versioning.md` boilerplate from every entry. The `[Unreleased]` section preserves the three in-flight Step 14 entries.
  - `conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/{plugin.json,provider.js}` — recovered (lost in the merge from `main` due to `.gitignore` masking gitignored-but-tracked files; `git add -f` brings them back into the index).

  `@skill-map/cli`:

  - `src/README.md` — Status section greenfield (terse: pre-1.0, what's next, what's after); usage examples expanded with `sm serve` + monorepo dev scripts.
  - `src/built-in-plugins/README.md` — drop the contradictory "empty on purpose" framing; document the actual built-in inventory (Claude Provider + Extractors + Rules + Formatter + `validate-all`).

  `@skill-map/testkit`:

  - `testkit/README.md` — rewrite end-to-end against the actual exported helper names (`runExtractorOnFixture` instead of the long-renamed `runDetectorOnFixture`); align example with the `extract(ctx) → void` Extractor shape and the `enabled` plugin status enum.

  Plus `ui/` README rewrite, root README + ES mirror Status / badge bumps + `sm serve` mention + Star History embed, AGENTS.md greenfield BFF section, CONTRIBUTING.md refresh, ROADMAP.md greenfield sweep (`Earlier prose` blocks stripped, decision log reframed without rename history, 14.6+ content preserved), web copy revision (How-it-works section), examples/hello-world rewritten to the Extractor model with passing tests, and the spec/index.json regeneration that goes with it.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## [Unreleased]

### Minor

- **Provider-driven kind presentation + `kindRegistry` envelope.** The Provider extension surface gains a required `kinds[*].ui` block (`label`, `color`, optional `colorDark`, optional `emoji`, optional discriminated icon `{ kind: 'pi', id }` or `{ kind: 'svg', path }`). Every payload-bearing REST envelope variant embeds a required `kindRegistry` field; sentinel envelopes (`health`, `scan`, `graph`) stay exempt. New conformance case `plugin-missing-ui-rejected` locks the loader's behaviour against drop-in Providers that omit the `ui` block.

- **`/api/nodes/:pathB64?include=body` body opt-in.** The single-node detail endpoint accepts `?include=body` to add `item.body: string | null` (read from disk on demand; `null` when the source file is missing or unreadable). Single-node response shape is `{ schemaVersion, kind: 'node', item, links: { incoming, outgoing }, issues }`. The body reader refuses absolute paths and any relative path that resolves outside the scope root.

- **`/ws` WebSocket protocol + watcher contract.** `### Server` documents the wire envelope (delegated to `job-events.md` §Common envelope), the event catalog (`scan.started` / `scan.progress` / `scan.completed` plus `extractor.completed` / `rule.completed` / `extension.error` plus the BFF-internal advisories `watcher.started` / `watcher.error`), connection lifecycle, the backpressure rule (4 MiB `bufferedAmount` → close 1009 + unregister), and the loopback-only assumption. `sm serve --no-watcher` flag added.

## 0.12.0

### Minor

- **`sm serve` + Hono BFF skeleton.** New `### Server` subsection in `cli-contract.md`. Endpoints at this bump: `GET /api/health` (real), `ALL /api/*` (structured 404 stub), `GET /ws` (no-op upgrade — closes with code 1000 + reason `'no broadcaster yet'`), static handler + SPA fallback. Loopback-only through v0.6.0; boot resilient to a missing DB (`/api/health` reports `db: 'missing'`). `sm serve` flag set: `--port` (default 4242), `--host` (default 127.0.0.1), `--scope`, `--db`, `--no-built-ins`, `--no-plugins`, `--open` / `--no-open`, `--dev-cors`, `--ui-dist`.

## 0.11.0

### Minor

- **Job artifacts move into the database (content-addressed).** New `state_job_contents(content_hash PK, content, created_at)`; `state_jobs.file_path` removed (rendered content fetched via join). `state_executions.report_path` → `state_executions.report_json` (parsed-JSON-on-read). `Job.filePath` removed; `ExecutionRecord.reportPath` → `ExecutionRecord.report` (parsed JSON / null). `RunnerPort.run(jobContent, options)` returns `{ report, ... }` — path-based reporting is no longer part of the port contract. `sm job preview` reads from the DB; `sm job claim --json` returns `{ id, nonce, content }`; `sm record --report <path-or-dash>` accepts a file path or stdin; `sm job prune --orphan-files` removed (the verb auto-collects orphan content rows). `sm doctor` integrity checks updated. Event payload renames: `job.spawning.data.jobFilePath` → `contentHash`; `job.callback.received.data.reportPath` and `job.completed.data.reportPath` → `executionId`. The `job-file-missing` failure-reason enum is preserved with shifted semantics: it now flags a missing `state_job_contents` row (DB-corruption-only state).

## 0.10.0

### Minor

- **`Node.kind` opens to any Provider-declared string.** `node.schema.json#/properties/kind` becomes `{ type: 'string', minLength: 1 }`; the `CHECK in (...)` SQL constraints on `scan_nodes.kind` and `state_summaries.kind` drop; `extensions/action.schema.json#/.../filter/kind` widens to a string array. Providers declare their own kind catalog through the `kinds` map; the spec no longer enumerates a closed set.

## 0.7.0

### Minor

- **Execution modes lifted to a first-class architectural property.** `architecture.md` gains §Execution modes defining the per-kind capability matrix: Extractor / Rule / Action / Hook are dual-mode (declared in manifest); Provider and Formatter are deterministic-only (boundary-positioned). Extractor / Rule schemas gain optional `mode` (default `deterministic`); Action's `mode` enum becomes `deterministic` / `probabilistic`; Provider / Formatter forbid the field.

## 0.6.1

### Patch

- **Config folder rename** — `.skill-map.json` (single project-root file) → `.skill-map/settings.json` inside the canonical `.skill-map/` scope folder, with a sibling `.skill-map/settings.local.json` for per-machine overrides.

## 0.6.0

### Minor

- **Persisted scan-result metadata.** New `scan_meta` table backs `loadScanResult` so `scope` / `roots` / `scannedAt` / `scannedBy` / `adapters` / `stats.{filesWalked,filesSkipped,durationMs}` are real values instead of synthesised on read.

## 0.5.0

### Minor

- **`spec/index.json` integrity sweep.** Reconciles `index.json` with the manifest changes documented in v0.3.0 but never written to the file. No prose / schema changes.

## 0.4.0

### Minor

- **`--all` documented as targeted fan-out** in `cli-contract.md`. Valid only on verbs whose contract explicitly lists it.

## 0.3.0

### Minor

- **`--all` promoted to a normative universal flag** in `cli-contract.md §Global flags`. Any verb that accepts a target identifier (`-n <node.path>`, `<job.id>`, `<plugin.id>`) MUST accept `--all` as "apply to every eligible target matching the verb's preconditions". Mutually exclusive with a positional target on the same invocation. Verbs where fan-out is nonsensical (`sm record`, `sm init`, `sm version`, `sm help`, `sm config get/set/reset/show`, `sm db *`, `sm serve`) MUST reject `--all` with exit `2`.

## 0.2.0

### Minor

- **`@skill-map/spec` published on npm.** First public release of the spec package.

## 0.1.0

### Minor

- **Initial public spec bootstrap.** Ships the JSON Schemas (draft 2020-12) for `Node` / `Link` / `Issue` / `ScanResult` / `ExecutionRecord` / `ProjectConfig` / `PluginsRegistry` / `Job` / `ReportBase` / `ConformanceCase` / `HistoryStats` plus the per-kind extension schemas (Provider / Extractor / Rule / Action / Formatter / Hook). Prose normative contracts: `cli-contract.md`, `architecture.md`, `db-schema.md`, `job-lifecycle.md`, `job-events.md`, `prompt-preamble.md`, `plugin-kv-api.md`. Conformance case `kernel-empty-boot` exercises the boot invariant (kernel boots and returns an empty `ScanResult` with zero registered extensions); `preamble-bitwise-match` is deferred to Step 10.
