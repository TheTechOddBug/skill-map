---
"@skill-map/cli": patch
---

Architect-audit follow-up: split `cli/commands/bump.ts` into a pure plan-computation half and a side-effect adapter half.

- **`cli/commands/bump-plan.ts` (new)** — `computeBumpPlan(nodes, { cwd, force })` returns an `IBumpPlan = { items: TBumpPlanItem[] }` without touching disk. Each item carries `status: 'bumped' | 'refused' | 'skipped' | 'error'` plus the writes / report / message the verb needs to render. Wraps the existing `bumpAction.invoke()` (already pure) and the `assertContained` path-guard. Now trivially unit-testable: 10 cases cover path traversal, fresh/stale outcomes, batch order, and mixed plans.
- **`cli/util/git.ts` (new)** — the three `spawnSync` git helpers (`isInsideGitRepo`, `ensureGitForStaged`, `stageSidecar`) used by `--staged`. Isolated so the only spawn site in the CLI lives in one place; +7 integration tests against real tempdir repos.
- **`cli/commands/bump.ts`** — composition root. The verb consumes the plan, applies writes via `FilesystemSidecarStore`, runs `git add` per item, renders. Split into smaller methods (`#validateFlagCombo`, `#preflightStaged`, `#executePending`, `#executePendingItem`, `#renderTerminalSingle`, `#applyBumpedSingle`, `#renderEmptyPending`, `#maybeStageWarn`) plus standalone `terminalOutcomeFor` / `buildBumpedOutcome` / `applyBumpWrites` helpers.

**Eslint complexity disables: 5 → 1** (the remaining one is `#renderPendingOutcome`, which fans out per-status rendering — legitimate flat branching that doesn't decompose further).

No behaviour change. The 15 existing `bump-cli.test.ts` / `bump-action.test.ts` cases pass unchanged; +17 new unit tests cover the extracted pieces.
