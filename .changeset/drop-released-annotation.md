---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Catalog refinement: drop `released` from the curated annotation catalog. The catalog now stands at **14 fields**.

**Rationale.** `released` (lifecycle "officially released") was redundant with `audit.lastBumpedAt` (activity timestamp written by every `bump`) for this project's flow — the spec doesn't distinguish official release from bump, so a separate lifecycle field added confusion without unique semantics. Activity timestamp now lives exclusively in the reserved `audit:` block.

**Spec.** `spec/schemas/annotations.schema.json` removes the `released` property; description updated to "load-bearing 14 fields" and clarifies that the activity timestamp lives in `audit.lastBumpedAt`. `spec/architecture.md` listing updated. `spec/index.json` regenerated.

**Fixtures.** `fixtures/local-scope/.claude/agents/kitchen-sink.sm` drops the `released:` line (only fixture that carried it). Hashes unaffected — `for.bodyHash` and `for.frontmatterHash` are over the `.md`, not the `.sm`.

**UI.** Card `daysAgo` (`ui/src/app/components/node-card/node-card.ts`) and inspector `headerDays` (`ui/src/app/views/inspector-view/inspector-view.ts`) both switch to reading `sidecar.root.audit.lastBumpedAt` — the canonical activity timestamp now flowing on the wire after R15. Annotations panel drops the `released` row from the lifecycle section (`ILifecycleSection.released` field, parsing, render, and the `texts.fields.released` strings in both `inspector-view.texts.ts` and `annotations-panel.texts.ts`).

**Backward compatibility.** `additionalProperties: true` stays — sidecars carrying `released:` continue to validate (the field rides through as an unknown opt-in key). The built-in `unknown-field` rule will warn on it post-curation, matching the pattern for the 16 fields dropped in the 2026-05-07 catalog curation.

Greenfield-permitted breaking surface (no released consumers depend on the prior shape) shipping as a `@skill-map/spec` minor per the pre-1.0 rule.
