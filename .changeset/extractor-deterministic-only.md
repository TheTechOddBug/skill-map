---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Reduce the Extractor extension kind to **deterministic-only**. The `mode` field is removed from `extractor.schema.json`; `IExtractor` no longer carries `mode`; `IExtractorContext` no longer exposes `ctx.runner`. `Extractor` joins `Provider` and `Formatter` as an extension that sits on the deterministic scan path; LLM-driven enrichment of a node is now strictly an **Action** concern, queued through the job subsystem.

**Why.** A "probabilistic Extractor" never actually ran during `sm scan` — it always dispatched as a job — so the dual-mode declaration was nominal, not operational. The pipeline still carried the cost: `ctx.runner` injection, the `body_hash_at_enrichment` / `stale` / `is_probabilistic` columns, the schema branch, the orchestrator's `isProb` guard. Zero Extractors with `mode: 'probabilistic'` shipped in the repo. Reducing Extractor to deterministic-only collapses an awkward dual-mode into "Extractor = pure transform over a node body; if you want LLM, write an Action".

**Surface changes**

- `spec/schemas/extensions/extractor.schema.json` — `mode` removed.
- `spec/architecture.md` — capability matrix updated (Extractor → deterministic-only); `§Extractor · enrichment layer` rewritten; the stability note documents that pre-1.0 narrowing a kind from dual-mode to single-mode is permitted as a minor bump.
- `spec/plugin-author-guide.md` — probabilistic tag-inferrer example replaced with a deterministic frontmatter-tag example; six-categories table updated; `ctx.runner` mention removed for Extractors.
- `spec/db-schema.md` — `node_enrichments.{stale, body_hash_at_enrichment, is_probabilistic}` documented as **reserved-but-inert** (always `0` for Extractor writes); kept on the row for a future Action-issued probabilistic enrichment revision so the persistence contract does not need a migration when that revision lands.
- `spec/cli-contract.md` — `sm refresh <node>` and `sm refresh --stale` no longer reference the prob-stub state; `--stale` is a no-op in this revision.
- `src/kernel/extensions/extractor.ts`, `src/kernel/orchestrator.ts` — `mode` and `runner` removed; the orchestrator's enrichment record always sets `isProbabilistic: false`.
- `src/cli/commands/refresh.ts`, `src/cli/i18n/refresh.texts.ts` — prob-skip path removed; `Persisted N enrichment row(s)` replaces `Persisted N deterministic enrichment row(s)`.
- `src/built-in-plugins/extractors/*/index.ts` — five built-in extractors no longer declare `mode: 'deterministic'`.
- `src/migrations/001_initial.sql`, `src/kernel/adapters/sqlite/schema.ts` — comments updated; columns retained (greenfield, no migration; the row shape is forward-compatible with the future revision).
- `src/test/built-ins-modes.test.ts` — invariant flips: extractors must NOT declare `mode` (matching Provider / Formatter).
- `src/test/node-enrichments.test.ts` — Test (d) removed (prob-extractor body-change → stale-flag), `buildProbEnricher` helper removed; the merge contract test (e) keeps hand-built stale rows so the helper's filter behaviour stays pinned for the future revision.

**Pre-1.0 minor bump.** Per `spec/versioning.md` §Pre-1.0 and `AGENTS.md`, breaking changes ship as minors while a workspace is in `0.Y.Z`. No released consumer depended on Extractor `mode: 'probabilistic'` (zero in built-ins, fixtures, conformance, e2e); the future Action-issued enrichment revision opens a clean path for the same use case from inside the job lifecycle.

**Out of scope (deferred to Phase B / Step 11).** How a probabilistic Action writes data persistent to a node (enrichment, sidecar, etc.). Today an Action emits a `report_json` plus an optional `TActionWrite[]` array (`{ kind: 'sidecar' }` is the only variant); the future revision will extend the discriminated union with `{ kind: 'enrichment' }` so a probabilistic Action can populate `node_enrichments` directly. That change is independent of this one and lands when the first real probabilistic Action (skill-summarizer or equivalent) needs it.
