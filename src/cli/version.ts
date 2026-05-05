/**
 * CLI-side re-export of the package version + binary naming constants.
 * The implementation lives at `src/version.ts` so non-CLI consumers
 * (`server/health.ts`, kernel doctor) can read it without crossing
 * into `cli/`. This re-export keeps the historical
 * `from '../version.js'` import path under `cli/commands/*` working.
 */

export { VERSION, BINARY_NAME, BINARY_LABEL } from '../version.js';
