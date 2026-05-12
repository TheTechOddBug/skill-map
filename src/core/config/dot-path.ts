/**
 * Dot-path traversal helpers for `.skill-map/settings.json` shaped trees.
 *
 * Promoted from `src/cli/commands/config.ts` so both the CLI verbs
 * (`sm config get/set/reset/show`) and the `core/config/helper`
 * read/write API can share one implementation. Behavior is unchanged
 * from the previous inline definitions; the prototype-pollution
 * defenses (forbidden `__proto__` / `constructor` / `prototype`
 * segments) are preserved verbatim, `assertSafeSegments` is the
 * single guard every walker funnels through.
 *
 * Lives under `src/core/config/` because both `cli/` and `server/`
 * (BFF) import the helpers; `core/**` is the canonical home for
 * runtime-shared utilities. The module reads no `process.env` /
 * `process.cwd()`, every input is an explicit parameter, so the
 * kernel-boundary lint rule (`src/eslint.config.js:233`) holds.
 */

/**
 * Path segments that, if walked, would mutate the prototype chain of the
 * current process or the resulting object. Rejected uniformly across
 * every reader / writer so a hostile dot-path argument cannot coerce a
 * walker into prototype pollution.
 */
export const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export class ForbiddenSegmentError extends Error {
  constructor(public readonly segment: string, public readonly key: string) {
    super(`forbidden config key segment "${segment}" in "${key}"`);
  }
}

/** Throw `ForbiddenSegmentError` if any segment is on the forbidden list. */
export function assertSafeSegments(segments: string[], key: string): void {
  for (const seg of segments) {
    if (FORBIDDEN_SEGMENTS.has(seg)) throw new ForbiddenSegmentError(seg, key);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Resolve a dot-path against an object tree. Returns `undefined` when
 * any segment is missing or when the parent is not a plain object.
 * Throws `ForbiddenSegmentError` when the path includes a prototype-
 * pollution segment.
 */
export function getAtPath(obj: unknown, dotPath: string): unknown {
  const segments = dotPath.split('.').filter(Boolean);
  assertSafeSegments(segments, dotPath);
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[seg];
      continue;
    }
    return undefined;
  }
  return cur;
}

/**
 * Mutate `obj` so that `dotPath` resolves to `value`. Creates
 * intermediate plain-object containers on the way down; replaces any
 * non-object intermediate (array / scalar) with a fresh object so the
 * write always succeeds. No-op when `dotPath` is empty.
 */
export function setAtPath(
  obj: Record<string, unknown>,
  dotPath: string,
  value: unknown,
): void {
  const segments = dotPath.split('.').filter(Boolean);
  assertSafeSegments(segments, dotPath);
  if (segments.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const next = cur[seg];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segments[segments.length - 1]!] = value;
}

/**
 * Remove the leaf at `dotPath`. Returns `true` when the leaf existed
 * and was removed, `false` when the path was already absent. Walks
 * back up after the delete and prunes any empty parent objects so the
 * persisted JSON stays tidy (no `{ "a": { "b": {} } }` skeletons).
 */
export function deleteAtPath(obj: Record<string, unknown>, dotPath: string): boolean {
  const segments = dotPath.split('.').filter(Boolean);
  assertSafeSegments(segments, dotPath);
  if (segments.length === 0) return false;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cur[segments[i]!];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
    cur = next as Record<string, unknown>;
  }
  const last = segments[segments.length - 1]!;
  if (!(last in cur)) return false;
  delete cur[last];
  pruneEmptyAncestors(obj, segments.slice(0, -1));
  return true;
}

function pruneEmptyAncestors(root: Record<string, unknown>, parents: string[]): void {
  while (parents.length > 0) {
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parents.length - 1; i++) {
      cur = cur[parents[i]!] as Record<string, unknown>;
    }
    const tail = parents[parents.length - 1]!;
    const child = cur[tail];
    if (
      child
      && typeof child === 'object'
      && !Array.isArray(child)
      && Object.keys(child).length === 0
    ) {
      delete cur[tail];
      parents.pop();
    } else {
      break;
    }
  }
}

/**
 * Walk the object tree and collect every dot-path that resolves to a
 * leaf (anything that is not a plain object). Used to power "Did you
 * mean?" suggestion lists when a verb / API call receives an unknown
 * key. The catalog is sourced from a live merged config (rather than
 * from the JSON Schema) so suggestions stay aligned with what
 * `sm config list` would print.
 */
export function enumerateConfigPaths(obj: unknown, prefix = ''): string[] {
  if (!isPlainObject(obj)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      out.push(...enumerateConfigPaths(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}
