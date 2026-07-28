/**
 * Grants for the privileged `PROJECT_LOCAL_ONLY_KEYS` (audit H1).
 *
 * `.skill-map/settings.local.json` is the ONLY config layer exempt from
 * the privileged-key strip, because it is the legitimate home for
 * per-checkout settings. The exemption assumed the file cannot arrive
 * from elsewhere: it is gitignored, so it "never travels". That holds
 * for the default behaviour and fails as a boundary, since the ignore
 * list lives in the repo author's own tree and `git add -f` ships
 * whatever they like.
 *
 * A hostile repo could therefore hand a victim:
 *
 *   - `scan.followExternalSymlinks: true`, turning the symlink
 *     containment gate off and reading arbitrary out-of-tree files into
 *     the graph;
 *   - `scan.referencePaths: ["~/"]`, walking the operator's home;
 *   - `mcp.server.enabled`, `allowEditSmFiles`,
 *     `activity.captureConversations`, all switched on without consent.
 *
 * Each privileged key now carries its own grant, anchored to the
 * `.skill-map/` directory (see `../util/scope-anchor.ts`). A key whose
 * grant does not verify is stripped exactly as it already is from the
 * committed `settings.json`, so the file degrades to an ordinary,
 * unprivileged layer instead of being rejected wholesale.
 *
 * --- Why per KEY, and why the writer needs no defending ---------------
 *
 * `writeConfigValue` does a whole-file read-modify-write: it reads the
 * raw document off disk, sets one key, and writes it all back. With a
 * single file-wide stamp, any write would have re-blessed every
 * attacker key sitting in that document, and the trigger surface is
 * enormous and innocuous, dismissing the tutorial banner, flipping a
 * `ui.*` toggle, saving a plugin secret.
 *
 * Because a grant covers exactly one key AND its value, none of those
 * writes mint anything for a key they did not touch. The attacker's key
 * is faithfully copied back to disk and remains just as inert as before.
 * The safe behaviour is the default behaviour, rather than a purge step
 * a future contributor could delete without any test noticing.
 *
 * Binding the VALUE matters too: it means editing a granted key on disk
 * invalidates that key alone, rather than inheriting the consent given
 * for a different value.
 */

import {
  computeScopeGrant,
  readScopeAnchor,
  verifyScopeGrant,
  type TScopeAnchor,
} from '../util/scope-anchor.js';
import {
  readScopeLock,
  writeScopeLockEntry,
} from '../util/scope-lock.js';
import { SKILL_MAP_DIR } from '../util/skill-map-paths.js';
import { join } from 'node:path';

/** Namespace inside the shared scope lock. */
const NAMESPACE = 'local-config';

/** The `.skill-map/` directory whose identity anchors every grant. */
function scopeDirFor(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR);
}

/**
 * True when `key` carries a grant, minted in THIS checkout, for exactly
 * this `value`. False for a missing grant, a foreign one, a value that
 * has since been edited, and for any scope with no usable anchor.
 */
export function isLocalKeyGranted(scopeRoot: string, key: string, value: unknown): boolean {
  const anchor = readScopeAnchor(scopeDirFor(scopeRoot));
  const record = readScopeLock(scopeRoot, NAMESPACE).get(key);
  return verifyScopeGrant(anchor, NAMESPACE, key, record?.grant ?? null, value);
}

/** The anchor, so callers can tell "foreign grant" from "no anchor at all". */
export function localKeyAnchor(scopeRoot: string): TScopeAnchor {
  return readScopeAnchor(scopeDirFor(scopeRoot));
}

/**
 * Record consent for one privileged key at one value. Returns `false`
 * when the anchor cannot back a grant, which the caller must surface
 * rather than swallow: writing the key without a grant would leave the
 * operator believing a setting is active while the loader ignores it.
 */
export function grantLocalKey(
  scopeRoot: string,
  key: string,
  value: unknown,
  now = Date.now(),
): boolean {
  const anchor = readScopeAnchor(scopeDirFor(scopeRoot));
  const grant = computeScopeGrant(anchor, NAMESPACE, key, value);
  if (grant === null) return false;
  writeScopeLockEntry(scopeRoot, NAMESPACE, key, { grant, grantedAt: now });
  return true;
}

/** Drop a key's grant, paired with removing the key itself. */
export function revokeLocalKey(scopeRoot: string, key: string): void {
  writeScopeLockEntry(scopeRoot, NAMESPACE, key, null);
}
