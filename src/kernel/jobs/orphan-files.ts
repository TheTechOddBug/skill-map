/**
 * Orphan job-file detector. Pairs with
 * `kernel/adapters/sqlite/jobs.ts:selectReferencedJobFilePaths` to find
 * MD files in `<scope>/.skill-map/jobs/` that no `state_jobs.filePath`
 * references, `sm job prune --orphan-files` consumes the result.
 *
 * The split keeps the storage layer FS-free: the SQLite adapter (or any
 * future adapter) returns the *referenced* set; this helper performs
 * the directory walk and computes the set difference. A second adapter
 * (Postgres, in-memory test harness) inherits no `node:fs` dependency.
 *
 * Walk shape: shallow, job files live directly under
 * `.skill-map/jobs/` per `spec/job-lifecycle.md`, no subdirectories.
 * Symlinks are NOT followed. If `jobsDir` does not exist or is not a
 * directory, returns an empty list (a fresh scope with no jobs ever
 * submitted is a valid no-op).
 */

import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join, resolve } from 'node:path';

export interface IOrphanFilesResult {
  /** Absolute paths of MD files in `jobsDir` that have no matching DB row. */
  orphanFilePaths: string[];
  /** Count of `state_jobs.filePath` values currently referenced (echoed for the JSON output). */
  referencedCount: number;
}

/**
 * Walk `jobsDir` and return every `*.md` whose absolute path is not in
 * `referencedPaths`. Caller obtains `referencedPaths` from
 * `port.jobs.listReferencedFilePaths()`.
 */
export function findOrphanJobFiles(
  jobsDir: string,
  referencedPaths: Set<string>,
): IOrphanFilesResult {
  let entries: Dirent[];
  try {
    const stat = statSync(jobsDir);
    if (!stat.isDirectory()) {
      return { orphanFilePaths: [], referencedCount: referencedPaths.size };
    }
    entries = readdirSync(jobsDir, { withFileTypes: true });
  } catch {
    // ENOENT / permission errors → no orphans we can see.
    return { orphanFilePaths: [], referencedCount: referencedPaths.size };
  }

  const orphans: string[] = [];
  for (const entry of entries) {
    // Audit M3: skip symlinks (parity with `kernel/scan/walk-content.ts`
    // and `core/runtime/reference-paths-walker.ts`). A symlink named
    // `evil.md → ~/.ssh/id_rsa` would otherwise land in the orphan set
    // and `sm job prune --orphan-files` would unlink the symlink.
    if (entry.isSymbolicLink()) continue;
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith('.md')) continue;
    const abs = resolve(join(jobsDir, name));
    if (!referencedPaths.has(abs)) orphans.push(abs);
  }
  orphans.sort();
  return { orphanFilePaths: orphans, referencedCount: referencedPaths.size };
}
