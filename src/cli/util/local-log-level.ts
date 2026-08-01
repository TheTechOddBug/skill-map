/**
 * Read `logLevel` out of `<cwd>/.skill-map/settings.local.json`.
 *
 * Why a direct read instead of the config loader: the log level is
 * resolved at process boot, before the layer system runs, and running
 * the whole loader (four layers, AJV compile, plugin settings
 * resolution) on every `sm` invocation to answer one string would be
 * paying for a cathedral to read a doorbell. This opens one file, in
 * one place, and never throws.
 *
 * Why `settings.local.json` and not the committed `settings.json`: a
 * log level is a preference of whoever is debugging right now, and the
 * committed layer is shared with the team. `logLevel` is a member of
 * `PROJECT_LOCAL_ONLY_KEYS`, so the loader strips it from the committed
 * layer with a warning anyway; reading only the local file here keeps
 * boot behaviour identical to what the loader would decide later.
 *
 * Returns the RAW string. Validation belongs to `resolveLogLevel`,
 * which warns on a typo and falls through instead of silently
 * disabling logging.
 */

import { readFileSync } from 'node:fs';

import { defaultLocalSettingsPath } from '../../core/paths/db-path.js';

export function projectLocalLogLevel(cwd: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(defaultLocalSettingsPath(cwd), 'utf8');
  } catch {
    // No project, no local file, or unreadable: not an error, the
    // operator simply has no standing preference here.
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { logLevel?: unknown };
    return typeof parsed.logLevel === 'string' ? parsed.logLevel : null;
  } catch {
    // A malformed local settings file is a real problem, but it is NOT
    // this function's to report: the config loader validates and
    // complains about the same file a moment later, with a far better
    // message than a boot-time helper could produce. Staying silent
    // here avoids a duplicate, worse-worded warning.
    return null;
  }
}
