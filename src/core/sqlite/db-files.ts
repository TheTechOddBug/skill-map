/**
 * Unlink a SQLite DB file together with its WAL sidecars (`-wal` /
 * `-shm`). The single helper both `sm db reset --hard` and the pre-1.0
 * schema-drift rebuild (`db-drift-reset.ts`) route through, so the set
 * of files that constitute "the database on disk" is defined once.
 *
 * Lives under `core/sqlite/` so the CLI (`cli/commands/db/reset.ts`)
 * and the runtime (scan-runner / watcher, via `db-drift-reset.ts`)
 * reach it without crossing a workspace boundary. `:memory:` is a
 * no-op, there is nothing on disk to remove.
 */

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

const DB_FILE_SUFFIXES = ['', '-wal', '-shm'] as const;

/**
 * Remove the DB file and its `-wal` / `-shm` companions if present.
 * Missing files are skipped silently (idempotent). No-op for
 * `:memory:`.
 */
export async function removeDbFiles(dbPath: string): Promise<void> {
  if (dbPath === ':memory:') return;
  for (const suffix of DB_FILE_SUFFIXES) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) await rm(p);
  }
}
