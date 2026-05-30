# skill-map e2e

End-to-end / smoke tests for skill-map. Private workspace, never published to npm.

## What lives here

- `playwright.config.ts`, two Chromium-only projects:
  - **`smoke`**, runs against the static demo bundle at `web/demo/`. Default in CI; the `webServer` block boots `../web/scripts/serve-demo.js` automatically. The static server can also be invoked manually via `npm run demo:serve --workspace=@skill-map/web`.
  - **`live-bff`**, runs against a real `sm serve` spawned by the harness in `live-bff/`. Opt-in (R10 closure from the §Step 9.6 review queue).
- `smoke/`, Playwright specs for the static demo path. Asserts the bundle never calls `/api/` and the two views render.
- `live-bff/`, harness + specs for the live-BFF path:
  - `fixture.ts`, materialises a kernel scope under `<repoRoot>/.tmp/e2e-live-bff-<ts>/` (a single agent `.md` + a `.sm` with a deliberately stale `for.bodyHash`).
  - `server.ts`, picks a free port, spawns `sm serve --no-open --port <free>` in one-shot mode (no `--watch`; see AGENTS.md §Operating rules, Agent execution), polls `/api/health` until 200.
  - `global-setup.ts` / `global-teardown.ts`, Playwright lifecycle hooks. Stash the dynamic base URL on `process.env.LIVE_BFF_URL`. Tear the kernel down + remove the tempdir on exit.
  - `specs/`, the live-only test directory. `bump.spec.ts` is the happy-path bump flow today.

## First-time setup

Browsers are NOT vendored with the npm install, they live outside `node_modules`. After the first `npm install` from the repo root, install Chromium:

```bash
npm run install:browsers --workspace=skill-map-e2e
```

That downloads ~150 MB into `~/.cache/ms-playwright/` and is a one-shot per machine.

## Running locally

### Static demo (default, what `npm run validate` runs)

```bash
# Full smoke (build + browser install + tests):
npm run validate --workspace=skill-map-e2e

# Or, if web/demo/ is already built and chromium is installed:
npm run test:smoke --workspace=skill-map-e2e
```

### Live-BFF mode (opt-in, R10 closure)

The live-BFF project boots a real `sm serve` against a fresh fixture
tempdir and asserts on real `/api/*` + WS traffic.

Prerequisites (the harness does NOT auto-build these):

```bash
# Build the UI bundle the BFF will serve.
npm run ui:build
# tsx is the runtime the harness uses to launch `src/cli/entry.ts`, the
# repo's root install already pulls it in transitively.
```

Then run only the live-BFF project:

```bash
npm run test:live-bff --workspace=skill-map-e2e
# Or directly:
npx playwright test --project=live-bff
```

To run a subset by title:

```bash
npx playwright test --project=live-bff --grep "bump"
```

The harness writes a fixture tempdir under `<repoRoot>/.tmp/e2e-live-bff-<ts>/`
and removes it during globalTeardown. A killed test run may leave the
tempdir behind; safe to delete manually.

## What the static smoke proves

- The demo bundle boots without console errors under `MODE === 'demo'`.
- The bundle never fetches `/api/...`, a regression activating the live-mode `RestDataSource` in the demo build is caught here.
- The two views (graph, list) render and route correctly.

## What the live-BFF smoke proves

- The bump happy path end-to-end: stale fixture → click bump → WS event arrives → stale badge clears + version increments. Closes R10 (originally deferred at Step 9.6.7).

## Run via root validate

`npm run validate` from the repo root invokes this workspace's `validate` script, which runs `prevalidate` first (`install:browsers` + `npm --prefix .. run demo:build`) and then the `smoke` project only. CI does NOT require the live-BFF infra by default, wire it into a follow-up step if probabilistic-flow tests need it.
