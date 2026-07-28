/**
 * The scope lock: `.skill-map/scope.lock.json`, the durable home for
 * authorizations the operator granted ON THIS MACHINE, in THIS checkout.
 *
 * Today that is plugin import trust (audit C1); the privileged
 * `PROJECT_LOCAL_ONLY_KEYS` grants (audit H1) join it as a second
 * namespace rather than getting a second file.
 *
 * --- Why a file and not the DB -----------------------------------------
 *
 * Trust used to live in `config_plugins`, inside a database the tool
 * deliberately deletes and rebuilds whenever the schema drifts, which
 * pre-1.0 is roughly every minor release. The storage rule says the DB
 * is machine output, regenerable and disposable; a human authorization
 * decision is neither, and losing it on a version bump trained operators
 * to re-grant reflexively, which is precisely the habit this gate
 * depends on them NOT having.
 *
 * The file is gitignored through `SCOPE_GITIGNORE_ENTRIES`, which
 * `ensureScopeGitignore` tops up additively on every scan, so existing
 * projects pick up the entry without an `sm init`.
 *
 * --- Security lives in the anchor, not in this file ---------------------
 *
 * Being gitignored protects nothing: the ignore list lives in the
 * attacker's own repo, so a hostile project can commit its own
 * `scope.lock.json` exactly as it can commit a DB. What it cannot do is
 * forge an entry that verifies, because each entry carries a grant
 * derived from the `.skill-map/` directory's inode and birth time, which
 * git does not transport (see `scope-anchor.ts`).
 *
 * Consequently this module NEVER decides trust. It reads and writes
 * records; the caller verifies each one against the live anchor. A
 * malformed file degrades to "no records", never to "everything is
 * granted".
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeJsonAtomic } from './atomic-write.js';
import { SKILL_MAP_DIR } from './skill-map-paths.js';

/** Filename under `.skill-map/`. Exported for `SCOPE_GITIGNORE_ENTRIES`. */
export const SCOPE_LOCK_FILENAME = 'scope.lock.json';

/** Shape version, so a future change is detected rather than guessed. */
const LOCK_VERSION = 1;

/**
 * One authorization. `grant` is the anchor-derived proof; an entry whose
 * grant does not verify is inert, which is why the record can be read
 * without being believed.
 */
export interface IScopeLockEntry {
  grant: string;
  /** Unix ms, operator-facing only (`sm plugins list`, `doctor`). */
  grantedAt: number;
}

/** `subject -> entry`, per namespace. */
export type TScopeLockRecords = Map<string, IScopeLockEntry>;

/** Absolute path of the lock for a project root. */
export function scopeLockPath(scopeRoot: string): string {
  return join(scopeRoot, SKILL_MAP_DIR, SCOPE_LOCK_FILENAME);
}

interface IPersistedLock {
  v?: unknown;
  namespaces?: unknown;
}

/**
 * Read one namespace's records. Returns an empty map when the file is
 * absent, unreadable, malformed, versioned differently, or shaped wrong.
 *
 * Every degradation points the same way: fewer authorizations, never
 * more. A corrupt lock must not be able to grant anything.
 */
export function readScopeLock(scopeRoot: string, namespace: string): TScopeLockRecords {
  const bucket = readNamespaceBucket(scopeLockPath(scopeRoot), namespace);
  const out: TScopeLockRecords = new Map();
  for (const [subject, raw] of Object.entries(bucket)) {
    const entry = coerceEntry(raw);
    // A corrupt record is not an ungranted one, but skipping it leaves
    // the subject unauthorized either way, which is the safe direction.
    if (entry !== null) out.set(subject, entry);
  }
  return out;
}

/** The raw records under one namespace, or `{}` for anything unreadable. */
function readNamespaceBucket(path: string, namespace: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const lock = parsed as IPersistedLock;
  if (lock.v !== LOCK_VERSION) return {};
  if (!isPlainObject(lock.namespaces)) return {};
  const bucket = (lock.namespaces as Record<string, unknown>)[namespace];
  return isPlainObject(bucket) ? (bucket as Record<string, unknown>) : {};
}

/** Validate one persisted record, or `null` when it is not usable. */
function coerceEntry(raw: unknown): IScopeLockEntry | null {
  if (!isPlainObject(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const grant = entry['grant'];
  if (typeof grant !== 'string' || grant.length === 0) return null;
  const grantedAt = typeof entry['grantedAt'] === 'number' ? entry['grantedAt'] : 0;
  return { grant, grantedAt };
}

function isPlainObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Set or clear ONE subject in ONE namespace, preserving every other
 * record in the file.
 *
 * The per-subject granularity is the security property, not ergonomics.
 * A writer that rewrote the whole namespace from its own partial view is
 * how one legitimate grant ends up blessing an attacker's records that
 * happen to sit beside it. Every write path must go through here.
 *
 * Pass `null` to remove. Writes through `writeJsonAtomic`, so the file
 * lands owner-only (`0o600`) and a crash cannot leave it half-written;
 * the rename replaces the FILE's inode, which is exactly why the anchor
 * is the containing directory and not this file.
 */
export function writeScopeLockEntry(
  scopeRoot: string,
  namespace: string,
  subject: string,
  entry: IScopeLockEntry | null,
): void {
  const path = scopeLockPath(scopeRoot);
  const existing = readWholeLock(path);
  const namespaces = existing.namespaces;
  const bucket = { ...(namespaces[namespace] ?? {}) };

  if (entry === null) {
    if (!(subject in bucket)) return;
    delete bucket[subject];
  } else {
    bucket[subject] = entry;
  }

  const next = {
    v: LOCK_VERSION,
    namespaces: { ...namespaces, [namespace]: bucket },
  };
  writeJsonAtomic(path, next);
}

/**
 * Whole-file read for the writer, preserving namespaces this caller does
 * not know about. Degrades to an empty document on anything unreadable:
 * a corrupt lock is replaced rather than merged into, since merging into
 * garbage would persist the garbage.
 */
function readWholeLock(path: string): { namespaces: Record<string, Record<string, unknown>> } {
  if (!existsSync(path)) return { namespaces: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as IPersistedLock;
    if (parsed?.v !== LOCK_VERSION) return { namespaces: {} };
    const ns = parsed.namespaces;
    if (!isPlainObject(ns)) return { namespaces: {} };
    return { namespaces: ns as Record<string, Record<string, unknown>> };
  } catch {
    return { namespaces: {} };
  }
}
