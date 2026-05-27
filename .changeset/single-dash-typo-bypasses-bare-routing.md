---
"@skill-map/cli": patch
---

Fix `sm -version` / `sm -help` (and any single-dash long-form typo) printing the no-project hint when run from a directory without `.skill-map/`. The bare-invocation router now bypasses serve-routing for single-dash long forms so Clipanion's parser always surfaces the proper unknown-option diagnostic with the `Did you mean '--foo'?` suggestion, regardless of project state. Double-dash flags (`--max-nodes`, etc.) still route through serve as before, and the no-project hint still fires for `sm --max-nodes 5` outside a project. The CI test job was the trigger: `src/cli/__tests__/cli-parse-errors.spec.ts` ran from a fresh checkout (no DB) and the two single-dash typo cases hit the no-project hint path instead of the parse-error path.

## User-facing

`sm -version` and `sm -help` now suggest `--version` / `--help` consistently, even from a directory with no skill-map project.
