/**
 * Scope ignore file writer (`spec/cli-contract.md` §Scope ignore file):
 * the single module that keeps `<scopeRoot>/.skill-map/.gitignore` in
 * sync with `SCOPE_GITIGNORE_ENTRIES`.
 *
 * The ignore rules live INSIDE the directory they describe instead of
 * being appended to the project-root `.gitignore`. Three consequences,
 * all deliberate:
 *
 *   - The rules travel with the directory. A project initialised by an
 *     older CLI (whose entry list was shorter) is topped up on its next
 *     scan, no re-`init` required. That is the whole point: the previous
 *     design shipped the list once at `sm init` time, so every artifact
 *     added afterwards (the activity bridge, the operations log, the
 *     SQLite `-wal` / `-shm` sidecars) leaked into users' commits.
 *   - Skill-map stops editing a file it does not own.
 *   - The file is itself committed: it is the team's shared statement of
 *     what skill-map generates.
 *
 * Contract highlights the implementation must keep:
 *
 *   - NEVER FIGHTS THE OPERATOR: top-up is additive. An entry already
 *     present is left alone, and an entry explicitly re-included with a
 *     `!` negation (`!skill-map.db`, the supported way for a team to
 *     share the DB per `spec/db-schema.md`) is never re-added.
 *   - NO PROJECT, NO FILE: when `<scopeRoot>/.skill-map/` does not exist
 *     the write is skipped (this module never creates the scope
 *     directory as a side effect; the verbs that own provisioning do).
 *   - TOTAL: every filesystem error resolves to `'skipped'`. A failed
 *     ignore-file write must never fail the scan / install that
 *     triggered it.
 *
 * The write is synchronous (one short file) so any call site can use it
 * without threading a promise through a hot path.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { defaultScopeGitignorePath, SCOPE_GITIGNORE_ENTRIES } from './paths/db-path.js';

/**
 * What `ensureScopeGitignore` did. `'skipped'` covers both "no scope
 * directory" and "the write failed"; neither is actionable by callers,
 * which is why the outcome is reported rather than thrown.
 */
export type TScopeGitignoreOutcome = 'created' | 'updated' | 'unchanged' | 'skipped';

/** Header written above the entries when the file is created. */
const HEADER = [
  '# Managed by skill-map (spec/cli-contract.md, Scope ignore file).',
  '# Everything below is machine-generated and per-machine: it must not',
  '# travel via the shared repo. Missing entries are topped up on the',
  '# next scan, so to keep one of these files tracked (e.g. to share the',
  '# database with your team) re-include it with a negation instead of',
  '# deleting the line:',
  '#',
  '#   !skill-map.db',
  '#',
  '# settings.json and plugins/ are deliberately absent: those are yours.',
];

/**
 * Ensure `<scopeRoot>/.skill-map/.gitignore` exists and lists every
 * entry of `SCOPE_GITIGNORE_ENTRIES` the operator has not opted out of.
 *
 * Call from any verb that provisions or mutates the scope directory
 * (`sm init`, the scan persist step, `sm activity install`). Cheap and
 * idempotent: the common case is one `readFileSync` of a ~15-line file
 * and no write at all.
 */
export function ensureScopeGitignore(scopeRoot: string): TScopeGitignoreOutcome {
  const path = defaultScopeGitignorePath(scopeRoot);
  try {
    if (!existsSync(dirname(path))) return 'skipped';

    if (!existsSync(path)) {
      writeFileSync(path, `${[...HEADER, '', ...SCOPE_GITIGNORE_ENTRIES].join('\n')}\n`, 'utf8');
      return 'created';
    }

    const body = readFileSync(path, 'utf8');
    const missing = missingEntries(body);
    if (missing.length === 0) return 'unchanged';

    const prefix = body.length > 0 && !body.endsWith('\n') ? '\n' : '';
    writeFileSync(path, `${body}${prefix}${missing.join('\n')}\n`, 'utf8');
    return 'updated';
  } catch {
    // Total by contract: an unwritable scope directory (read-only mount,
    // permissions) must not fail the operation that called us.
    return 'skipped';
  }
}

/** What a live `ensureScopeGitignore` would change, without writing. */
export interface IScopeGitignorePreview {
  /** Absolute path of the scope ignore file. */
  path: string;
  /** Whether the file is already on disk. */
  exists: boolean;
  /**
   * Entries the live call would append. When `exists` is false this is
   * the full canonical list (the file would be created from scratch).
   */
  wouldAdd: readonly string[];
}

/**
 * Dry-run counterpart of `ensureScopeGitignore`, same parsing rules so
 * the preview tracks the real outcome. Consumed by `sm init --dry-run`.
 */
export function previewScopeGitignore(scopeRoot: string): IScopeGitignorePreview {
  const path = defaultScopeGitignorePath(scopeRoot);
  if (!existsSync(path)) return { path, exists: false, wouldAdd: SCOPE_GITIGNORE_ENTRIES };
  return { path, exists: true, wouldAdd: missingEntries(readFileSync(path, 'utf8')) };
}

/**
 * Which canonical entries `body` does not already account for. An entry
 * counts as accounted for when it appears verbatim OR as a `!` negation
 * (the operator's explicit opt-out); comment lines and blanks are
 * ignored, matching how the project-root append used to parse.
 */
function missingEntries(body: string): string[] {
  const present = new Set(
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
  return SCOPE_GITIGNORE_ENTRIES.filter(
    (entry) => !present.has(entry) && !present.has(`!${entry}`),
  );
}
