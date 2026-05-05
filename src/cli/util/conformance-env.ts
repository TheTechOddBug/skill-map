/**
 * `readConformanceKillSwitches()` — read the conformance kill-switch
 * env vars (`SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}`) and
 * return the bag the scan composer consumes.
 *
 * The conformance runner injects these env vars on the child `sm scan`
 * process per `setup.disableAll*` toggle in
 * `conformance-case.schema.json`. Reading them lives at the CLI
 * adapter boundary so `core/` stays free of `process.env` reads —
 * downstream consumers (the BFF, the watcher runtime) get an explicit
 * `IConformanceKillSwitches` value instead of an environment-driven
 * side channel.
 *
 * Truthy = literal `'1'`. Anything else (absent, `'0'`, `'true'`,
 * whitespace) is treated as off so the runner injecting `'1'` is
 * unambiguous and a stray export of the variable in a developer shell
 * does not silently disable production scans.
 */

import type { IConformanceKillSwitches } from '../../core/runtime/plugin-runtime.js';

const ENV_DISABLE_PROVIDERS = 'SKILL_MAP_DISABLE_ALL_PROVIDERS';
const ENV_DISABLE_EXTRACTORS = 'SKILL_MAP_DISABLE_ALL_EXTRACTORS';
const ENV_DISABLE_RULES = 'SKILL_MAP_DISABLE_ALL_RULES';

export function readConformanceKillSwitches(
  env: NodeJS.ProcessEnv = process.env,
): IConformanceKillSwitches {
  return {
    providers: env[ENV_DISABLE_PROVIDERS] === '1',
    extractors: env[ENV_DISABLE_EXTRACTORS] === '1',
    rules: env[ENV_DISABLE_RULES] === '1',
  };
}
