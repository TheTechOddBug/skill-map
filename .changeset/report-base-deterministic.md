---
"@skill-map/spec": minor
---

Closes review-queue item R4 (Step 9.6) — introduce a shared deterministic report base so the deterministic / probabilistic split is explicit at the schema level, symmetric with the existing `report-base.schema.json` (LLM-only `confidence` + `safety`).

`spec/schemas/report-base-deterministic.schema.json` declares the universal shape every deterministic Action's report MUST extend: `ok` (boolean — did the Action complete its logical work?) plus action-specific keys via `additionalProperties: true`. `report-base.schema.json` (probabilistic) and `report-base-deterministic.schema.json` (deterministic) are the two endpoints of the report hierarchy; an Action's manifest `mode` field picks the side.

`spec/schemas/bump-report.schema.json` migrates to extend the new base via `allOf` + relative `$ref` (per `context/spec.md` rule 7). The redundant inline declaration of `ok` is dropped — the base provides it. The bump-specific keys (`version`, `noop`, `reason`, `createdSidecar`) stay; `additionalProperties: true` mirrors the base so the report shape stays open across both layers.

Coverage matrix: row 28 (`bump-report.schema.json`) notes updated to point at the new base; row 29 (`report-base-deterministic.schema.json`) lands as 🟡 partial — covered indirectly via every deterministic Action conformance case (e.g. the upcoming Step 9.6.4 `sm bump --json` case for row 28), flipping 🟢 when the first conformance case directly validates a deterministic report against this base.

`spec/index.json` regenerated. No `@skill-map/cli` bump — the bump Action's runtime report shape (`IBumpReport` in `src/built-in-plugins/actions/bump/index.ts`) is unchanged. Greenfield + pre-1.0: breaking surface ships as a minor per the pre-1.0 versioning rule (no released consumers depended on the prior `bump-report.schema.json` shape).
