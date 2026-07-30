# context/scripts.md, package scripts and workspaces

Conventions for package scripts in the skill-map monorepo. Same authority level as `AGENTS.md`. Required reading when touching `package.json` (root or workspace) or any `scripts/*` invoked from a package script.

## Naming pattern

`component:action` for every root-level shortcut: `bff:dev`, `cli:build`, `ui:dev`, `ui:build`, `e2e:dev`, `web:dev`, `web:build`, `demo:dev`, `demo:build`, `release:changeset`, `release:version`, `release:publish`. **No exceptions** for new root scripts.

## What lives in root, what lives in a workspace

**Root exposes only**:

- Daily shortcuts `component:dev` and `component:build` per component. "Daily" = something a dev uses several times per session. If it's sporadic (analyze, coverage, etc.), it doesn't belong here.
- Cross-workspace orchestrators: `lint`, `lint:fix`, `validate`.
- Release tooling: `release:changeset`, `release:version`, `release:publish`.
- Cross-workspace combos that no single workspace covers on its own: `demo:build` (UI + scripts + fixtures), `demo:dev`.

**Everything else lives in its workspace**: typecheck, test, test:ci, test:coverage, lint, build, secondary dev modes, bundle-analyze, watch builds, clean. Invoke with `pnpm --filter <name> <script>` or by entering the workspace.

## The `validate` contract

Each workspace exposes its own self-contained `validate` decomposed into two phases, `validate:compile` for the static checks (typecheck, lint, build, spec-check, reference-check) and `validate:test` for the test suites. The local `validate` stays as their composition (`validate:compile && validate:test`) for standalone use.

Root orchestrates the two phases globally: **every workspace's compile phase runs first, then every workspace's test phase**. Fast-fail on any compile error across any workspace before paying the test-suite wait.

| Workspace | `validate:compile` | `validate:test` |
|---|---|---|
| `@skill-map/spec` | `spec:check` (index + coverage) + `pin:check` |, |
| `@skill-map/cli` | `typecheck` + `lint` + `build` + `built-ins:check` | `test:ci` |
| `ui` | `build` | `test:ci` |
| `@skill-map/web` | `build` |, |
| `skill-map-e2e` |, | `test:ci` (with `prevalidate:test` that prepares demo + browsers) |

Root scripts:

```json
"validate": "pnpm validate:compile && pnpm validate:test",
"validate:compile": "pnpm --filter @skill-map/spec validate:compile && pnpm --filter @skill-map/cli validate:compile && pnpm --filter ui validate:compile && pnpm --filter @skill-map/web validate:compile",
"validate:test": "pnpm --filter @skill-map/cli validate:test && pnpm --filter ui validate:test && pnpm --filter skill-map-e2e validate:test"
```

CI runs `pnpm validate`, same composition.

### Consumer workspaces and `prevalidate:test`

When a workspace depends on external artifacts to validate (e.g. e2e needs `web/demo/` built + Playwright browsers), use the `prevalidate:test` lifecycle hook on the test phase to self-prepare. Example in `e2e/package.json`:

```json
"prevalidate:test": "pnpm install:browsers && pnpm --filter @skill-map/web demo:build",
"validate": "pnpm validate:test",
"validate:test": "pnpm test:ci"
```

(Note: the hook used to be `prevalidate` on the top-level `validate` target before the compile/test split, under the new phased orchestration the test phase invokes `validate:test` directly across workspaces, so the hook moved to `prevalidate:test`.)

## Special cases (intentional asymmetries)

- **BFF** is not a workspace (it lives embedded in `src/server/` and ships as part of the CLI). But `bff:dev` exists at root because iterating on the BFF has its own mental identity.
- **Demo** is a cross-workspace artifact (built UI + scripts + fixtures), not a workspace. Its root shortcuts reflect the artifact's reality.
- **`fix:*`** is the fixture dev-scope bring-up family (`component:action`, component `fix` = fixtures): `fix:claude`, `fix:demo`. Each brings up BFF + UI in parallel against `fixtures/<scope>` (two Windows Terminal panes via `scripts/start.sh`: `bff:dev` left, `ui:dev` right). The fixture is threaded to the BFF pane via the `SM_FIXTURE` env var (`bff:dev` resolves `fixtures/${SM_FIXTURE:-claude}`); the UI pane is fixture-agnostic (Angular HMR proxies the API to the BFF). Both panes run from source (BFF via `tsx`, UI via `ng serve`), so `start.sh` regenerates only `src/plugins/built-ins.ts` (`build-built-ins`), no `dist` build, and there is NO pre-scan: the BFF's watcher does the initial scan itself (`runInitialBatch`), so a `prebff:dev` pre-scan would just double the boot scan + its warnings. `bff:scan` stays as a standalone manual scan. The former `prestart: cli:build` hook was retired. Adding a fixture under `fixtures/` is a one-line `fix:<name>` alias.
- **`start`** is the cross-platform-agnostic entry the `fix:*` family aliases: `pnpm start` ≡ `pnpm fix:claude` ≡ `scripts/start.sh claude`. The former "pending redesign" (bring up BFF + UI in parallel) landed as the `fix:*` family above.
- **`perf:*`** is the performance-fixture family (`component:action`, component `perf` = the synthetic benchmark corpus): `perf:gen` builds `fixtures/perf/` via `scripts/gen-perf-fixture.js`, `perf:scan` regenerates it when missing, drops the DB, and runs a cold `sm scan` over it (the CLI reports `durationMs` itself, so no external timer). `fix:perf` joins the `fix:*` family and brings up BFF + UI against the same fixture. The corpus is **generated, never committed**: 1000 markdown nodes (300 skills, 200 agents, 242 commands, 256 docs, 2 root files; the docs bucket sits at exactly the design-default render cap, so scoping the map to `docs/` exercises the cap boundary) wired into ~4000 resolvable references, plus a `.mcp.json` for 3 virtual MCP nodes, so a scan exercises walker + parser + extractors + resolver + persistence at scale with **0 issues** (a clean baseline; noise would drown the signal). The generator is deterministic (seeded mulberry32), so the same `--seed` / `--count` always emit a byte-identical tree and two runs are comparable. Flags: `--count`, `--refs`, `--seed`, `--out`, `--if-missing`. `fixtures/perf/` and `fixtures/perf-*/` are gitignored, and a rebuild refuses to wipe any directory that lacks the generator's own `.perf-fixture` marker. The fixture's root agent-instructions file is `README.md`, **never `CLAUDE.md`**: a generated `CLAUDE.md` inside the repo gets loaded as real project context by any Claude Code session that touches the tree.
- **`build`** is a retained bare word (a deliberate exception to `component:action`, blessed by the owner): the full publishable build, `pnpm --filter ui build && pnpm --filter @skill-map/cli build`. UI first so the CLI's tsup `onSuccess` embeds the freshly built UI bundle into `dist/ui/` (same order as `release.yml`). Kept bare because `build` is the npm-standard lifecycle name a contributor reaches for by reflex; the per-workspace pieces stay as `cli:build` / `ui:build`. The distinction matters: `cli:build` alone builds only the CLI (the UI bundle is soft-skipped if `ui/dist/` is absent), whereas `build` guarantees both are fresh.

## Anti-patterns

- ❌ **Root scripts that delegate to a single specific workspace.** Skews the monorepo and breaks symmetry. If it only applies to one workspace, it lives in the workspace. Exception: genuine cross-workspace combos like `demo:build`.
- ❌ **Scripts duplicated with the orchestrator.** Root `validate` covers lint + test + build + typecheck per workspace; a redundant root `lint` alongside `validate` is noise. Keeping `lint`/`lint:fix` at root is justified only as a quick-iteration shortcut (not orchestration).
- ❌ **Root package scripts that invoke a workspace's own `.js`.** If the `.js` belongs to the workspace, the script that invokes it lives in the workspace. Root only invokes via `pnpm --filter <name> <script>` (not via `node workspace/scripts/foo.js`).
- ❌ **Aliases that break `component:action`.** `web` (no action), `site:build` (made-up "site" component), `smoke:demo` (action first), all removed or renamed. Do not reintroduce them. (`start` and `build` are the only retained bare words, both npm-standard lifecycle names a contributor reaches for by reflex, documented under Special cases. Do NOT add further bare words.)

## Policy for scripts in root `scripts/`

A `.js` in root `scripts/` is justified only if **it is genuinely cross-workspace** (CI invokes it directly, or ≥2 workspaces use it). If it belongs to a workspace, move it inside and expose it via that workspace's package script.

**Current state** (pending migration):

| Script | Natural home |
|---|---|
| `build-spec-index.js`, `sync-spec-pin.js`, `check-coverage.js` | `spec/` |
| `dev-serve.js` | `src/` (CLI) |
| `dev-server.js`, `build-site.js`, `build-demo-dataset.js`, `patch-demo-mode.js`, `serve-demo.js` | `web/` (site + demo) |
| `open-sqlite-browser.js` | disappears when `sqlite` migrates to a CLI sub-command |
| `check-changeset.js` | cross-cutting utility (CI-only); stays at root |

`check-coverage.js` also depends on cwd (uses `resolve('spec/...')` without an anchor), migrating it fixes that.

## Railway deploy with paths filter

The public site (`skill-map.ai`) runs on Railway via Docker. The standard GitHub ↔ Railway integration deploys on every push to `main`, which generates unnecessary deploys when the commit doesn't touch what the site exposes (changes to `src/`, `e2e/`, etc. don't alter the deployed output).

The policy: **deploy only when something the site actually publishes changes**. Implemented in `.github/workflows/deploy-web.yml` with a GitHub Actions `paths:` filter. If no file in the filter changes, the workflow doesn't fire and Railway receives nothing.

### Paths that trigger a deploy

| Path | Reason |
|---|---|
| `web/package.json` | bump of `@skill-map/web` |
| `spec/package.json` | bump of `@skill-map/spec` (the site serves these schemas at `/spec/v1/`) |
| `Dockerfile` | deploy recipe |
| `Caddyfile` | server config |

Changes outside that list (everything in-flight under `web/`, `ui/`, `spec/`, `fixtures/`, `src/`, `e2e/`, `context/`, etc.) do **not** trigger a deploy on merge to `main`. They ride along the next "chore: version packages" PR that consumes pending changesets and bumps `web/package.json` / `spec/package.json`, at that point the deploy fires once with the new version baked into the footer.

### Why a narrow filter

A broad filter (e.g. `web/**`) caused **two deploys per change**: one on the feature merge (with the old version still in the footer) and another when the bot's "chore: version packages" PR bumped `web/package.json`. Anchoring the filter to the bump file means each deploy corresponds to a released version, and the double-fire is gone.

### Accepted edge cases

- In-flight changes to landing, UI, schemas, fixtures, etc. are not visible at `skill-map.ai` until the next release. Use `pnpm web:dev` locally to preview.
- Changes to root `package.json` / `pnpm-lock.yaml` do not trigger a deploy. If a new root-level dep changes the Docker build behavior, the next bump captures it (deps adjustments to a workspace come with a changeset that bumps that workspace, which falls under the filter).

### One-time manual setup

All under GitHub repo Settings → Secrets and variables → Actions:

1. **Secrets** tab → New repository secret `RAILWAY_API_TOKEN` with an account-level Account Token from Railway (Account Settings → Tokens).
2. **Secrets** tab → New repository secret `RAILWAY_PROJECT_ID` with the project UUID (Railway dashboard → Project → Settings).
3. **Variables** tab → New repository variable `RAILWAY_SERVICE` with the service UUID (the value the `-s` flag expects).
4. In the Railway dashboard, **disconnect the GitHub ↔ Railway integration** (otherwise there's a double path: Railway's auto-deploy + the workflow). The workflow is the only official deploy path.

Inside the workflow, `railway link -p <project> -s <service> --environment production` runs before `railway up -s <service> -m "v<version>"`. The `-m` flag attaches the version as the deploy message visible in the Railway dashboard.

### How to modify the filter

When the deploy gains or loses a dependency on a new path, update the `paths:` block in `.github/workflows/deploy-web.yml` and the table above. Keep them in sync.

### Site versioning

`@skill-map/web` (private workspace) is versioned separately from spec and CLI. The version is the deploy tag:

- **GitHub Actions** shows the dynamic job name (`v0.1.0`) read from `web/package.json` at runtime.
- **Changeset rule**: any PR that touches `web/` must declare a changeset that bumps `@skill-map/web` (same as spec, cli). `ui/` is exempt, it ships bundled inside the CLI, so user-visible UI changes ride along the CLI changeset.

### Versions in the landing footer

Three tags in the footer, with two distinct policies depending on what each version represents:

| Tag | Source | Policy | Reason |
|---|---|---|---|
| `spec v…` | `spec/package.json` | **build-time** (`{{SPEC_VERSION}}` placeholder) | The site serves the schemas itself at `/spec/v1/`. The version shown in the footer MUST match what the site delivers, otherwise it would be misleading. |
| `web v…` | `web/package.json` | **build-time** (`{{WEB_VERSION}}` placeholder) | This is the site's own version. Build-time is trivially correct. |
| `cli v…` | `https://registry.npmjs.org/@skill-map/cli/latest` | **runtime fetch** (`web/app.js`) | The site does NOT serve the CLI (it's installed via `npm i -g @skill-map/cli`). The footer reports "the latest published on npm", not something the site delivers. Build-time would go stale between deploys. If the fetch fails (offline, npm down), the `cli v…` placeholder stays in place. |

**To add a new build-time version**: add it to `versions = {…}` in `web/scripts/build-site.js`, add the `replaceAll('{{X_VERSION}}', versions.x)`, and put the span in the HTML footer.

**To add a new runtime version** (e.g. another package published to npm): copy the `app.js` snippet with another `data-x-version` selector.

## Git hooks

`.githooks/pre-commit` runs the `validate` of the `@skill-map/spec` workspace when the commit touches `spec/` (silent otherwise). Catches the case where a file under `spec/` is modified and regenerating `spec/index.json` is forgotten, the sha256 integrity would be out of date and CI would fail on another branch.

The hook hooks itself in automatically: the root `package.json` `prepare` script runs `git config core.hooksPath .githooks` every time someone runs `pnpm install`. No manual setup per contributor. The script is guarded with `[ -d .git ]` so `pnpm install --frozen-lockfile` inside Docker (where the `.git/` directory isn't copied into the build context) silently no-ops instead of failing on a missing `git` binary.

To add other checks to the hook, add the matching branch in `.githooks/pre-commit` following the existing pattern.

## When to add / move / remove

- **Add a root script**: only if it's a daily `component:action` shortcut for a component that already has a workspace, or if it's a genuine cross-workspace orchestrator. When in doubt, it goes in the workspace.
- **Add a workspace script**: free, following the package-script convention (`build`, `dev`, `test`, `test:ci`, `lint`, `validate`).
- **Move a script from root to a workspace**: update every reference (CI, docs, other scripts), run `pnpm validate` before committing.
- **Remove a script**: same, and verify it doesn't break `release.yml` (release scripts are invoked by name from the Changesets action).
