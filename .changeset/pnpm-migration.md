---
"@skill-map/cli": patch
"@skill-map/spec": patch
"@skill-map/testkit": patch
"@skill-map/web": patch
---

Migrate the monorepo's package manager from npm to pnpm 11.

**Motivation**: the 2025 wave of npm supply-chain attacks (Shai-Hulud worm, Qix / chalk-debug compromise, s1ngularity / Nx, axios / Glassworm) all rode on the default-on `postinstall` script behavior plus npm's flat hoisted `node_modules`. pnpm 11 ships the inverse defaults: install scripts are blocked unless explicitly allowlisted, transitive dependencies are confined to per-package symlinks, a 24-hour `minimumReleaseAge` rejects freshly published versions, and `blockExoticSubdeps` rejects git / tarball sources sneaking in through patch bumps.

**What changed**:

- `pnpm-workspace.yaml` replaces the root `workspaces` array. `.npmrc` pins the supply-chain hardening flags (`save-exact`, `strict-dep-builds`, `minimum-release-age`, `block-exotic-subdeps`). `packageManager: pnpm@11.1.1` activates pnpm via corepack on every Node 24 install.
- Every package script across the 7 workspaces moves from `npm run X --workspace=Y` to `pnpm --filter Y X`. The `bff:dev`, `demo:build`, `validate:*`, `release:*` chains follow the same pattern.
- `Dockerfile` swaps `npm ci` for `pnpm install --frozen-lockfile`, activates pnpm via corepack inside the Alpine image, and copies `pnpm-lock.yaml` + `pnpm-workspace.yaml` + `.npmrc`.
- All three GitHub Actions workflows (`ci.yml`, `release.yml`, `deploy-web.yml`) gain a `pnpm/action-setup@v4` step and feed `cache: 'pnpm'` to `actions/setup-node`. The smoke-install job still uses `npm i -g` to verify the published tarball through the path a real end user takes.
- `examples/hello-world` and `testkit` workspace deps switch from the loose `"*"` range (which pnpm resolved against the registry) to `workspace:*` so the local source is always linked.
- Two phantom dependencies that npm's flat hoist had been hiding surfaced and got fixed: `src/scripts/build-reference.js` now spawns from the `src/` workspace so it finds the locally-declared `tsx`; `e2e/live-bff/server.ts` passes an absolute `file://` URL for the tsx loader since the spawn cwd is a fixture tempdir.
- `ui/angular.json` rewrites the `styles` paths from `../node_modules/X` (root-flat assumption) to `node_modules/X` (workspace-local under pnpm).
- The pre-commit hook, dev-reset script, contributor docs (`AGENTS.md`, `CONTRIBUTING.md`, `context/scripts.md`, `context/lint.md`, `context/spec.md`, both READMEs, `ROADMAP.md`) all reflect the new commands.

No user-observable change. End users still install with `npm i -g @skill-map/cli`; the CLI surface, BFF responses, and UI are byte-identical with the previous release.
