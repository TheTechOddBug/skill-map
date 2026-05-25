/**
 * Detect whether the running `@skill-map/cli` is a local development
 * checkout or a published install. The result threads into the CLI
 * banner / `sm --version` chip and the BFF's `/api/health` payload so
 * the SPA can mark its topbar with a `dev` badge, at a glance the
 * operator knows "I'm hitting my repo checkout, not the npm-installed
 * `sm` that ships to users".
 *
 * Detection strategy: this module's own filesystem location.
 * `import.meta.url` resolves to the on-disk path of the compiled
 * helper. A published install always lives under
 * `<somewhere>/node_modules/@skill-map/cli/dist/...`, so a path
 * segment of `<sep>node_modules<sep>` is the smoking gun. A repo
 * checkout (the dev mode this helper exists to surface) compiles
 * straight into `src/dist/...` and never carries that segment, even
 * though the workspace itself has a `node_modules/` sibling, the
 * helper's own path doesn't traverse it. `pnpm link` from another
 * project also stays "dev" because the link's target is still the
 * checkout, not a path inside the consumer's `node_modules`.
 *
 * Result is captured once per process (the helper's location never
 * changes mid-flight) so every caller reads the same flag without
 * paying the `import.meta.url` parse repeatedly.
 */

import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_PATH = fileURLToPath(import.meta.url);
const NODE_MODULES_SEGMENT = `${sep}node_modules${sep}`;
const IS_DEV_BUILD = !SELF_PATH.includes(NODE_MODULES_SEGMENT);

/**
 * `true` when the running CLI was loaded from a local checkout (the
 * helper module's own path has no `node_modules` segment). Stable
 * across calls within a single process.
 */
export function isDevBuild(): boolean {
  return IS_DEV_BUILD;
}
