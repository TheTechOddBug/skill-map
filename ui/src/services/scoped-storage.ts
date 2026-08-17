/**
 * Project-scoped `localStorage` keys (user decision 2026-08-17, after
 * sessions recorded in one project surfaced while serving another):
 * `localStorage` is per-ORIGIN, and every locally served project shares
 * `http://127.0.0.1:<port>`, so PROJECT STATE stored under a bare key
 * (the tape, node positions, map curation) followed the browser, not
 * the folder. Keys that hold project state are namespaced with a short
 * hash of the project root; keys that hold operator PREFERENCES (rail
 * width, sort modes, filters) deliberately stay bare, a preference
 * follows the operator across projects by design.
 *
 * The root travels in the `skill-map-scope` meta the BFF injects into
 * the served `index.html` (spec `cli-contract.md` §Serve), so the
 * namespace is known SYNCHRONOUSLY at module load, before any service
 * hydrates. No meta (the static demo bundle, the `ng serve` dev
 * harness, jsdom) falls back to the `default` namespace: those hosts
 * serve exactly one project per origin, so the collision the namespace
 * exists to prevent cannot happen there.
 *
 * DEBUG AFFORDANCE, nothing reads it programmatically: the
 * `sm.scopes` registry key maps each hash to the root it was minted
 * for (`{ "a3f9c2e1": "/home/x/project" }`), so a human inspecting
 * devtools can tell which project a suffixed key belongs to.
 */

/** Meta tag name the BFF stamps the resolved scope root into. */
export const SCOPE_META_NAME = 'skill-map-scope';

/** Hash → root registry (debug legibility only; see module doc). */
export const SCOPE_REGISTRY_KEY = 'sm.scopes';

/**
 * Layout version of the `sm.*` storage family, kept under
 * `sm.storage-version`. There is NO backward compatibility (user
 * decision 2026-08-17), but the blast radius is PER BUMP, not always
 * total (user refinement, same day): each version declares in
 * `VERSION_RESETS` what it invalidates when arriving from the version
 * right below, and the gate walks the chain step by step. An unknown
 * stored version (the unversioned pre-namespace era, or a step missing
 * from the table) falls back to the full wipe, misreading state is
 * worse than resetting it.
 */
export const STORAGE_SCHEMA_VERSION = 2;

/**
 * What each bump invalidates, coming from the version right below it:
 * `'all'` = the whole `sm.*` family; a list = those BASE keys (every
 * scoped `<base>.<hash>` variant included). Append-only by design; a
 * new breaking layout change adds `STORAGE_SCHEMA_VERSION + 1` here
 * with the narrowest honest set.
 */
const VERSION_RESETS: Readonly<Record<number, 'all' | readonly string[]>> = {
  // The namespace migration: every bare-era key is unreadable, and the
  // orphaned blobs (megabytes of tape) would sit on the origin quota.
  2: 'all',
};

/** Key holding the layout version (the one key the wipe re-stamps). */
export const STORAGE_VERSION_KEY = 'sm.storage-version';

/**
 * FNV-1a 32-bit over the root path, as 8 hex chars. Non-cryptographic
 * on purpose: the namespace separates a handful of local projects on
 * one machine, and it must be computable SYNCHRONOUSLY at module load
 * (`crypto.subtle` is async, so it cannot mint keys the services read
 * in their constructors).
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

let resolved: string | null = null;

/** The active namespace (memoized; see the module doc for the sources). */
export function scopeNamespace(): string {
  if (resolved !== null) return resolved;
  const root =
    typeof document === 'undefined'
      ? null
      : (document.querySelector(`meta[name="${SCOPE_META_NAME}"]`)?.getAttribute('content') ??
        null);
  ensureStorageVersion();
  if (root === null || root.length === 0) {
    resolved = 'default';
  } else {
    resolved = fnv1a(root);
    registerScope(resolved, root);
  }
  return resolved;
}

/** `<base>.<namespace>`, the storage spelling of one project-state key. */
export function scopedKey(base: string): string {
  return `${base}.${scopeNamespace()}`;
}

/** Test seam: forget the memos so a spec can vary the meta per case. */
export function resetScopeNamespaceForTest(): void {
  resolved = null;
  versionChecked = false;
}

function registerScope(hash: string, root: string): void {
  try {
    const raw = localStorage.getItem(SCOPE_REGISTRY_KEY);
    const registry = (raw === null ? {} : JSON.parse(raw)) as Record<string, string>;
    if (registry[hash] === root) return;
    registry[hash] = root;
    localStorage.setItem(SCOPE_REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // Storage unavailable / corrupt registry: the namespace still works,
    // only the debug directory is lost.
  }
}

let versionChecked = false;

/** The version gate (see `STORAGE_SCHEMA_VERSION` / `VERSION_RESETS`). */
function ensureStorageVersion(): void {
  if (versionChecked) return;
  versionChecked = true;
  try {
    const raw = localStorage.getItem(STORAGE_VERSION_KEY);
    const stored = raw === null ? null : Number.parseInt(raw, 10);
    if (stored === STORAGE_SCHEMA_VERSION) return;
    const resets = resetPlan(stored, STORAGE_SCHEMA_VERSION, VERSION_RESETS);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith('sm.')) continue;
      if (resets === 'all' || resets.some((base) => key === base || key.startsWith(`${base}.`))) {
        stale.push(key);
      }
    }
    for (const key of stale) localStorage.removeItem(key);
    localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_SCHEMA_VERSION));
  } catch {
    // Storage unavailable: nothing to version.
  }
}

/**
 * The combined reset for an upgrade from `stored` to `target`: the
 * union of every step's declaration, `'all'` if any step (or the
 * stored version itself) is unknown. Pure and exported for tests.
 */
export function resetPlan(
  stored: number | null,
  target: number,
  resets: Readonly<Record<number, 'all' | readonly string[]>>,
): 'all' | readonly string[] {
  if (stored === null || !Number.isInteger(stored) || stored < 1 || stored > target) return 'all';
  const combined: string[] = [];
  for (let step = stored + 1; step <= target; step++) {
    const declared = resets[step];
    if (declared === undefined || declared === 'all') return 'all';
    combined.push(...declared);
  }
  return combined;
}
