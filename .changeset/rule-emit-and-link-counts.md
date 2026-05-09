---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Complete the `IRuleContext.emitContribution` runtime channel and add `core/link-counts` built-in rule.

The view-contribution surface had a half-implemented seam: any extension's manifest could declare `viewContributions`, the catalog (`kernel.getRegisteredViewContributions()`) recognised Rule declarations, but `IRuleContext` had no `emitContribution` callback so a Rule's `evaluate()` had no way to actually emit. Extending `IRuleContext` with `emitContribution(nodePath, contributionId, payload)` completes the seam.

The first adopter is `core/link-counts` — a built-in Rule that emits two `node-counter` contributions per node (`linksOut`, `linksIn`) based on the post-merge graph. The data lives on `node.linksOutCount` / `node.linksInCount` already; the Rule projects it into the view contribution system so slot-aware UI surfaces (graph cards, inspector chips) render the counts uniformly with any plugin contribution. Skips emit when count is 0 to avoid empty panels.

External URL counts (`core/external-url-counter`) keep their existing extractor-emit path; this change adds a sibling Rule, not a refactor.

**Surface changes**

- `src/kernel/extensions/rule.ts` — `IRuleContext.emitContribution(nodePath, contributionId, payload)` added.
- `src/kernel/orchestrator.ts` — `runRules()` builds a per-rule emission buffer with the same validator + persist semantics as the Extractor path; `RunScanOptions` adds `viewContributions?` (parallel to `annotationContributions?`). The `readDeclaredContributions` helper is generalised from `IExtractor` to any extension that carries `viewContributions` (structural typing).
- `src/built-in-plugins/rules/link-counts/index.ts` — new built-in.
- `src/built-in-plugins/built-ins.ts` — `linkCountsRule` registered under `core` bundle; built-in count rises from 21 to 22 (and rules from 10 to 11).
- `spec/architecture.md` § View contribution system → Emit path — Rule-emit signature documented alongside the Extractor signature; both routed to the same `scan_contributions` rows. The reserved `emitScopeContribution` for scope-stat is noted as still pending.

**Tests**

- `src/built-in-plugins/rules/link-counts/link-counts.test.ts` — unit tests for the rule's evaluate logic + integration test that runs the orchestrator end-to-end and asserts the persisted contribution rows.
- `src/test/built-ins-modes.test.ts` — total built-ins count bumped 21 → 22.
- `src/test/plugin-runtime-branches.test.ts` — composed.rules.length asserts bumped 10 → 11; rule id list updated.
- `src/built-in-plugins/rules/rules.test.ts`, `src/built-in-plugins/rules/validate-all/validate-all.test.ts`, `src/test/unknown-field-rule.test.ts` — test contexts now supply a noop `emitContribution` (required field on the new `IRuleContext`).

**Persistence**: no SQL migration. The `scan_contributions` table is agnostic to the emitting kind; Rule emissions land in the same rows as Extractor emissions. The orphan sweep + catalog sweep semantics keep working unchanged.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
