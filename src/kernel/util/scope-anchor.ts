/**
 * Scope anchor: the machine-local fingerprint of a project's
 * `.skill-map/` directory, and the per-subject grants derived from it.
 *
 * --- Why this exists ---------------------------------------------------
 *
 * Two security controls, plugin import trust and the privileged
 * `PROJECT_LOCAL_ONLY_KEYS`, persist inside `.skill-map/`, which the
 * clone-and-scan threat model declares hostile: a repo author can commit
 * `skill-map.db` or `settings.local.json` (the `.gitignore` that would
 * exclude them lives in the attacker's own repo, so `git add -f` ships
 * them anyway) and hand a victim a pre-granted trust row or a
 * pre-enabled `scan.followExternalSymlinks`.
 *
 * Content cannot solve this: anything the attacker can write, the
 * attacker knows. Filesystem METADATA can, because git does not carry
 * it. When a victim clones, their filesystem assigns the `.skill-map/`
 * directory an inode and a creation timestamp that a remote attacker,
 * who never sees the victim's machine and gets exactly one attempt,
 * cannot predict.
 *
 * **This is unpredictability, not secrecy.** It blocks the clone-borne
 * attack, but it is not authentication: anyone with local read access to
 * `.skill-map/` can compute a valid grant. That is acceptable (local
 * read implies local write implies editing the plugin directly), with
 * one residual: a disclosed grant is replayable against THAT checkout,
 * because `git pull` does not recreate the directory. Therefore never
 * render an anchor or a grant in CLI output, telemetry, support bundles
 * or the UI.
 *
 * --- Grants are per SUBJECT, never per store ---------------------------
 *
 * The load-bearing decision. A single stamp covering a whole store is
 * exploitable, because any legitimate write refreshes it and thereby
 * blesses every unrelated row that happened to be sitting in the same
 * store:
 *
 *   1. Victim clones a repo whose committed DB carries `evil → trusted`.
 *      The stamp does not match, so the first scan correctly ignores it.
 *   2. That scan (or one `sm plugins trust some-legit-plugin`) rewrites
 *      the store-wide stamp with the victim's own anchor.
 *   3. `evil` was never removed. It now verifies. Second scan executes it.
 *
 * Binding each grant to its own subject kills that chain structurally:
 * granting `legit` mints a value for `legit` alone, and `evil` stays
 * unverifiable no matter how many legitimate writes happen around it.
 * The same property lets `writeConfigValue`'s whole-file read-modify-write
 * stay exactly as it is: it will faithfully copy an attacker's privileged
 * key back to disk, and that key will still never verify.
 *
 * --- What is compared, and what is not ---------------------------------
 *
 * `ino` + `birthtimeNs`. Deliberately NOT `dev`: it is an anonymous
 * block-device number allocated at MOUNT time for 9p, overlayfs, NFS,
 * tmpfs and virtiofs, so it reshuffles on every container or WSL
 * restart. Comparing it would revoke grants on a routine restart, which
 * trains operators to re-grant reflexively, and reflexive re-granting is
 * the exact habit this gate depends on them not having. It buys almost
 * nothing against a remote attacker (a small guessable integer), so it
 * is carried for diagnostics only.
 *
 * --- Platform behaviour (verified against libuv v1.x) ------------------
 *
 *   - Linux with `statx`: real nanosecond birth time (`STATX_BTIME`).
 *   - macOS: real, from `st_birthtimespec`.
 *   - Windows: real, `ino` from `FileId.QuadPart` and birth time from
 *     `CreationTime`; directories behave exactly like files. (The "ino is
 *     always 0 on Windows" reports are from the 2011 `node-v0.x` archive
 *     and were fixed long ago.)
 *   - 9p / drvfs mounts (`/mnt/c` under WSL), `/proc`, `/sys`: birth time
 *     is identically `0` for every directory, and the inode numbers there
 *     are structured and consecutive rather than entropic.
 *
 * A zero birth time therefore means the anchor is UNUSABLE, and the
 * answer is to fail closed. There is deliberately no `ino`-only
 * fallback: it would be weakest exactly where it engaged, and a
 * committed `.skill-map` symlink pointing at `/proc` would select it on
 * demand. Failing closed on `/mnt/c` matches the repo's existing stance
 * that the cross-filesystem boundary is unsupported.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';

/** Namespaces keep a subject in one feature from colliding with another. */
export type TScopeGrantNamespace = 'plugin-trust' | 'local-config';

/**
 * A live read of the scope directory.
 *
 * `absent`: missing, unreadable, or not a directory.
 * `unusable`: present, but the filesystem reports no real birth time.
 * Both are non-permissive; only `value` can mint or verify a grant.
 */
export type TScopeAnchor =
  | { kind: 'absent' }
  | { kind: 'unusable'; reason: 'no-birthtime' }
  | { kind: 'value'; ino: bigint; birthtimeNs: bigint; dev: bigint };

const GRANT_PREFIX = 'skill-map/scope-grant/v1';

/**
 * Read the anchor for a scope directory. Total: never throws, so a
 * hostile or broken filesystem degrades to a refusal rather than an
 * exception that some caller might swallow into a permissive default.
 */
export function readScopeAnchor(skillMapDir: string): TScopeAnchor {
  let s;
  try {
    s = statSync(skillMapDir, { bigint: true });
  } catch {
    return { kind: 'absent' };
  }
  if (!s.isDirectory()) return { kind: 'absent' };
  if (s.birthtimeNs === 0n) return { kind: 'unusable', reason: 'no-birthtime' };
  return { kind: 'value', ino: s.ino, birthtimeNs: s.birthtimeNs, dev: s.dev };
}

/**
 * Mint the grant for one subject, or `null` when the anchor cannot back
 * one. A `null` return is the caller's signal to REFUSE the write:
 * persisting a grant that can never verify would show the operator a
 * "trusted" state that silently does nothing.
 *
 * `value` binds the grant to the granted content, so editing a key on
 * disk after the fact invalidates that key alone. It must be a scalar or
 * an array of scalars (every member of `PROJECT_LOCAL_ONLY_KEYS` is),
 * which makes `JSON.stringify` canonical; an object would not serialise
 * deterministically and is refused.
 */
export function computeScopeGrant(
  anchor: TScopeAnchor,
  namespace: TScopeGrantNamespace,
  subject: string,
  value?: unknown,
): string | null {
  if (anchor.kind !== 'value') return null;
  if (!isCanonicalValue(value)) return null;
  // Length-framed: without it, (subject "a", value "bc") and
  // (subject "ab", value "c") would hash identically.
  const parts = [
    GRANT_PREFIX,
    namespace,
    anchor.ino.toString(),
    anchor.birthtimeNs.toString(),
    subject,
    JSON.stringify(value ?? null),
  ];
  const preimage = parts.map((p) => `${p.length}:${p}`).join('');
  return createHash('sha256').update(preimage, 'utf8').digest('hex');
}

/**
 * Verify a recorded grant. False for every non-`value` anchor, for a
 * missing record, and for a mismatch.
 *
 * A MISSING record is refused as firmly as a wrong one. State written
 * before this mechanism existed and state from an attacker who simply
 * omits the grant are the same shape from in here, so grandfathering
 * "no grant" would hand the attacker a one-line bypass. The cost is that
 * existing operators re-grant once; that is the deliberate trade.
 */
export function verifyScopeGrant(
  anchor: TScopeAnchor,
  namespace: TScopeGrantNamespace,
  subject: string,
  recorded: string | null | undefined,
  value?: unknown,
): boolean {
  if (recorded === null || recorded === undefined || recorded === '') return false;
  const expected = computeScopeGrant(anchor, namespace, subject, value);
  return expected !== null && expected === recorded;
}

/** Scalars, `null`/`undefined`, and arrays of scalars serialise canonically. */
function isCanonicalValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(value)) return value.every((v) => isCanonicalValue(v) && !Array.isArray(v));
  return false;
}
