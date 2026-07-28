/**
 * The plugin import-trust store (audit C1).
 *
 * Trust answers one question: may this project-local drop-in plugin's
 * code be `import()`ed into the operator's process at all? It is the
 * single gate between a directory of attacker-authored JavaScript and
 * arbitrary code execution, so where it lives and how it is verified is
 * the security boundary itself.
 *
 * --- What travels, and what must not ------------------------------------
 *
 * A commit legitimately carries `.skill-map/settings.json`, the scope
 * `.gitignore`, and `.skill-map/plugins/` itself. Shipping plugin CODE is
 * fine and intended: a plugin sitting on disk without trust does nothing.
 * What must never travel with authority is the TRUST. The clone-and-scan
 * attack is exactly the pair, the code in `plugins/` plus a grant that
 * switches it on.
 *
 * The old design leaned on "the DB is gitignored, so a grant cannot
 * arrive in a clone". That is true of the DEFAULT behaviour and false as
 * a boundary: the ignore list lives in the attacker's own repo, so
 * `git add -f` ships whatever they like. The distinction this module
 * draws is therefore not "committed vs ignored", which is forgeable, but
 * "created on this machine vs created somewhere else", which is not: a
 * force-added file was created on the attacker's machine and its grant
 * cannot match the victim's scope anchor no matter how it arrived.
 *
 * --- Why the lock file and not the DB -----------------------------------
 *
 * Trust used to be a `config_plugins` row. That table lives in a database
 * the tool deliberately deletes and rebuilds on schema drift, which
 * pre-1.0 is roughly every minor release, so an operator's vetting
 * decision evaporated on a version bump and trained them to re-grant
 * reflexively. Reflexive re-granting is the one habit this gate cannot
 * survive. The lock is durable, so a grant is made once and meant.
 */

import { join } from 'node:path';

import {
  computeScopeGrant,
  readScopeAnchor,
  verifyScopeGrant,
  type TScopeAnchor,
} from '../util/scope-anchor.js';
import {
  readScopeLock,
  writeScopeLockEntry,
  type IScopeLockEntry,
} from '../util/scope-lock.js';
import { SKILL_MAP_DIR } from '../util/skill-map-paths.js';

/** Namespace inside the shared scope lock. */
const NAMESPACE = 'plugin-trust';

/**
 * Why a recorded grant was not honoured. Each maps to a DIFFERENT
 * operator message, because the causes and the remedies differ: telling
 * someone on a filesystem with no birth time to "re-grant" is useless
 * advice, they can do it a hundred times and it will never take.
 */
export type TTrustSkipReason =
  /** Recorded here, but minted against a different copy of the project. */
  | 'foreign-scope'
  /** The scope has no usable anchor (`/mnt/c`, `/proc`, exotic mounts). */
  | 'anchor-unusable';

export interface ITrustSkip {
  pluginId: string;
  reason: TTrustSkipReason;
}

export interface ILoadedTrust {
  /** Plugin ids whose grant verified. ONLY these may be imported. */
  trusted: Set<string>;
  /** Recorded-but-not-honoured grants, for the advisory. Never empty-shamed. */
  skipped: readonly ITrustSkip[];
  /** Carried so callers can explain the `anchor-unusable` case precisely. */
  anchor: TScopeAnchor;
}

/** The `.skill-map/` directory whose identity anchors every grant. */
function scopeDirFor(cwd: string): string {
  return join(cwd, SKILL_MAP_DIR);
}

/**
 * Load the verified trust set for a project.
 *
 * Never throws and never fails open: an unreadable lock, a corrupt
 * record, or an unusable anchor all yield an EMPTY trusted set. The
 * `skipped` list exists so the caller can tell the operator what was
 * ignored and why, which is the difference between a security control
 * and a silent malfunction.
 */
export function loadTrust(cwd: string): ILoadedTrust {
  const scopeDir = scopeDirFor(cwd);
  const anchor = readScopeAnchor(scopeDir);
  const records = readScopeLock(cwd, NAMESPACE);

  const trusted = new Set<string>();
  const skipped: ITrustSkip[] = [];

  for (const [pluginId, entry] of records) {
    if (verifyScopeGrant(anchor, NAMESPACE, pluginId, entry.grant, true)) {
      trusted.add(pluginId);
      continue;
    }
    skipped.push({
      pluginId,
      reason: anchor.kind === 'value' ? 'foreign-scope' : 'anchor-unusable',
    });
  }
  return { trusted, skipped, anchor };
}

/** Outcome of a grant attempt, so the verb can render a directed message. */
export type TGrantOutcome =
  | { ok: true }
  /**
   * The anchor cannot back a grant. Refuse rather than persisting a
   * record that could never verify: showing "trusted" for something that
   * will silently never load is the worst of the available failures.
   */
  | { ok: false; reason: 'anchor-unusable' };

/**
 * Grant trust to one plugin, on this machine, in this checkout.
 *
 * Per-plugin by construction. A store-wide stamp would be refreshed by
 * any legitimate write and would thereby bless every unrelated record
 * sitting beside it, which is precisely how the first cut of this design
 * was exploitable: clone a repo carrying `evil`, let the first scan
 * correctly ignore it, and watch the next `sm plugins trust legit`
 * validate it.
 */
export function grantTrust(cwd: string, pluginId: string, now = Date.now()): TGrantOutcome {
  const anchor = readScopeAnchor(scopeDirFor(cwd));
  const grant = computeScopeGrant(anchor, NAMESPACE, pluginId, true);
  if (grant === null) return { ok: false, reason: 'anchor-unusable' };
  const entry: IScopeLockEntry = { grant, grantedAt: now };
  writeScopeLockEntry(cwd, NAMESPACE, pluginId, entry);
  return { ok: true };
}

/**
 * Revoke trust. Removing the record is the whole operation: there is no
 * "trusted: false" state, because absence already means untrusted and a
 * second representation of the same fact could only ever disagree.
 */
export function revokeTrust(cwd: string, pluginId: string): void {
  writeScopeLockEntry(cwd, NAMESPACE, pluginId, null);
}

/**
 * Every plugin id with a record, verified or not. Feeds `sm plugins
 * list` / `doctor`, which must show a stale record rather than pretend
 * it is absent: it is the evidence of what the operator once vetted, and
 * deleting it silently would be editing their authorization history.
 */
export function listTrustRecords(cwd: string): string[] {
  return [...readScopeLock(cwd, NAMESPACE).keys()].sort();
}
