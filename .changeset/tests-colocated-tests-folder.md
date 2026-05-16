---
'@skill-map/cli': minor
'@skill-map/testkit': minor
---

Adopt the convention that every test file lives in a `__tests__/`
folder next to its SUT and uses the `.spec.ts` suffix. The legacy
central `src/test/` and `testkit/test/` directories are gone:
the 145 specs under `src/` were moved to colocated `__tests__/`
folders, end-to-end cross-module flows landed under
`src/__tests__/integration/`, and the 5 testkit specs moved to
`testkit/src/__tests__/`. Same convention `makius-base/api` and
the `cli-ruler` agent enforce, now wired into this repo.

`src/package.json` and `testkit/package.json` test scripts switch
from the legacy `test/**/*.test.ts` glob set to
`**/__tests__/**/*.spec.ts` patterns; `src/tsconfig.json` and
`testkit/tsconfig.json` drop the now-empty `test/**/*` include;
`src/node.config.json` and `src/.c8rc.json` coverage exclusions
flip from `**/*.test.ts` to `**/*.spec.ts` plus `**/__tests__/**`.
`context/kernel.md` documents the rule, `context/bff.md` points
to the new server test locations.

Pure internal refactor: no public API change, no behavioural
change to the published CLI or testkit. Test history is
preserved end-to-end through `git mv`.
