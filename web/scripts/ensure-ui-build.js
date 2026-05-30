#!/usr/bin/env node
/**
 * `web/scripts/ensure-ui-build.js`: build the Angular UI only when its dist is
 * absent, then let `demo:build` copy + patch it.
 *
 * Why this guard exists: `demo:build` copies `ui/dist/ui/browser/` into
 * `web/demo/`. It used to run `pnpm --filter ui build` UNCONDITIONALLY first,
 * but `demo:build` is invoked twice in a full `pnpm validate` (once via
 * `web validate:compile`, once via `e2e prevalidate:test`) and the `ui`
 * workspace ALSO builds itself in `ui validate:compile`, so the UI compiled up
 * to three times per validate. Now the UI is built once, by `ui
 * validate:compile` (which runs first in the compile phase), or by this guard
 * when the dist is missing, and every downstream `demo:build` reuses it.
 *
 * Presence-only check (no staleness heuristic): inside `validate` the dist is
 * always fresh because `ui validate:compile` runs before `web` and `e2e`. For a
 * standalone `pnpm --filter @skill-map/web build` on a clean tree the dist is
 * absent, so it builds once. If you edit UI source and rebuild ONLY the site,
 * rebuild the UI yourself first (`pnpm --filter ui build`) so the copy is not
 * stale; the production Docker build starts clean, so it always rebuilds.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const uiIndex = resolve(repoRoot, 'ui', 'dist', 'ui', 'browser', 'index.html');

if (existsSync(uiIndex)) {
  process.stdout.write('[ensure-ui-build] ui/dist present, reusing it (skip build)\n');
  process.exit(0);
}

process.stdout.write('[ensure-ui-build] ui/dist missing, building ui once\n');
const result = spawnSync('pnpm', ['--filter', 'ui', 'build'], {
  stdio: 'inherit',
  cwd: repoRoot,
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
