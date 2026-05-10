---
"@skill-map/cli": patch
---

Add the `core/job-orphan-file` built-in rule. Surfaces orphan MD files under `.skill-map/jobs/` (no matching `state_jobs.filePath` row) as `warn` issues during `sm scan`. Mirrors the `core/annotation-orphan` model: detection runs OUTSIDE the rule and the rule only projects.

- New `src/built-in-plugins/rules/job-orphan-file/index.ts` — declarative rule registered in the `core` bundle (next to `core/annotation-orphan` for thematic affinity). Severity `warn`, deterministic mode. The rule body is a 12-line `for` over `ctx.orphanJobFiles` projecting each path as an issue with `nodeIds: [path]`, `data.filePath: path`, and a message that suggests `sm job prune --orphan-files`.
- New `src/built-in-plugins/i18n/job-orphan-file.texts.ts` — single template, `{{filePath}}` placeholder.
- `src/kernel/extensions/rule.ts` — `IRuleContext` gains optional `orphanJobFiles?: readonly string[]`. Additive; legacy callers that omit it leave the new rule a no-op.
- `src/kernel/orchestrator.ts` — `RunScanOptions.orphanJobFiles?` threads through `runScanInternal` → `runRules` → per-rule `evaluate({ ..., orphanJobFiles })`. When the option is absent or empty the array passed to rules is `[]`.
- `src/core/runtime/scan-runner.ts` — the persist branch precomputes orphans inside its existing `withSqlite` scope: `findOrphanJobFiles(jobsDir, await adapter.jobs.listReferencedFilePaths()).orphanFilePaths` lands on `runScanWith(prior, priorRuns, orphanJobFiles)` and onward to `runOptions.orphanJobFiles`. The ephemeral / dry-run branch passes `[]` (no DB → nothing to compare against). `defaultProjectJobsDir` is resolved once via `defaultProjectJobsDir(ctx)`. The runner always sets `runOptions.orphanJobFiles` (possibly `[]`) to keep the wiring uniform.
- The same `findOrphanJobFiles` helper still backs `sm job prune --orphan-files` (the action that deletes the files). Detection (rule) and action (CLI verb) stay in sync because both consume the exact helper; no logic duplication, no double-emission risk — the rule reports, the CLI verb prunes.
- `src/built-in-plugins/README.md` — adds the new rule row.
- `src/test/job-orphan-file-rule.test.ts` — unit tests over the rule's pure projection (absent / empty input, multi-orphan emission, order preservation, determinism). Three pre-existing test bumps reflect the new built-in count: `src/test/built-ins-modes.test.ts` (`listBuiltIns().length`: 22 → 23), `src/test/plugin-runtime-branches.test.ts` (rule-bucket count: 11 → 12, plus the post-`core/superseded`-disable list).

Pre-1.0 patch: every change is additive and the new rule is a built-in inside the existing `core` bundle (no new schemas, no contract changes; `IRuleContext` only grows an optional field).

## User-facing

**`sm scan` now flags orphan job files.** A new built-in rule, `core/job-orphan-file`, scans `.skill-map/jobs/` for MD files that no `state_jobs` row references and reports each as a `warn` issue. This is detection only — to actually delete the files, run `sm job prune --orphan-files` (unchanged). Useful when the DB was wiped manually but the file tree is still around (or vice versa, recovered DB but the runner crashed mid-render and the file never made it into the row).
