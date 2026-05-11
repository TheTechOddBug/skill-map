---
"@skill-map/cli": patch
"@skill-map/testkit": patch
---

Refactor `npm run validate` orchestration: every compilation-stage check across every workspace runs FIRST, then every test suite runs LAST. Fast-fail on typecheck / lint / build / spec-check / reference-check without paying the test-suite wait.

**Root `package.json`.** `validate` is now `validate:compile && validate:test`:
- `validate:compile` runs `validate:compile` in `spec, src, testkit, ui, web` (every workspace that has compile-stage checks).
- `validate:test` runs `validate:test` in `src, testkit, ui, e2e, examples/hello-world` (every workspace that has tests).

**Per-workspace.** Each workspace now exposes `validate:compile` and/or `validate:test`. `validate` stays as the composition (`validate:compile && validate:test`) for standalone use:
- `spec`: compile = `spec:check && pin:check`.
- `src` (`@skill-map/cli`): compile = `typecheck && lint && build && reference:check`; test = `test:ci`.
- `testkit` (`@skill-map/testkit`): compile = `typecheck && build`; test = `test:ci`.
- `ui`: compile = `build`; test = `test:ci`.
- `web`: compile = `build`.
- `e2e`: test = `test:ci` (with `prevalidate:test` hook for `install:browsers && demo:build`).
- `examples/hello-world`: test = `test:ci`.

**Cleanups.** Removed two redundancies that the new ordering exposed:
- `src/test:ci` and `testkit/test:ci` no longer carry an inline `tsc --noEmit` (the compile phase already ran `typecheck`).
- `src/pretest:ci` (which ran `tsup`) removed: the compile phase already ran `build`. Standalone `npm run test:ci` callers run `npm run build` first when needed.

The visible change for plugin authors / contributors: `npm run validate` fails on the first compile error across ANY workspace before any test suite starts. Before: a workspace-internal compile error in `testkit` had to wait for `src`'s 40-second test suite first.
