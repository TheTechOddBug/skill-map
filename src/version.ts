/**
 * Single source of truth for the package's runtime version + binary
 * naming constants. Lives at `src/version.ts` (not under `cli/`) so
 * non-CLI surfaces (`server/health.ts`, future BFF endpoints, kernel
 * doctor reports) can pull the version without crossing into CLI
 * territory.
 */

import pkg from './package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
export const BINARY_NAME = 'sm';
export const BINARY_LABEL = 'skill-map';
