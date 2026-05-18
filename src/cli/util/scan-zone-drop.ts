/**
 * Atomic drop of the `scan_*` SQLite zone. Shared helper called from
 * two places that need the same behaviour:
 *
 *   - `sm db reset` (interactive verb), wraps the helper with prompts,
 *     dry-run preview, and printer output.
 *   - `sm config set activeProvider <id>` lens-switch side effect, the
 *     write to `<cwd>/.skill-map/settings.json` is paired with this
 *     drop so the persisted graph never reflects the wrong lens.
 *
 * Behaviour mirrors `sm db reset` (without `--state`): walk
 * `sqlite_master`, restrict to tables prefixed `scan_`, `DELETE FROM`
 * each inside one transaction. The defence-in-depth identifier check
 * (`assertSafeIdentifier`) is reused so a hostile plugin migration row
 * (validator hypothetically slips a bad name through) cannot reach the
 * `exec` interpolation. Returns the dropped table names so the CLI /
 * BFF can surface a precise success message.
 *
 * No prompt, no dry-run flag, no printer here. The interactive surface
 * lives on each verb's CLI wrapper.
 */

import { DatabaseSync } from 'node:sqlite';

import { assertSafeIdentifier } from '../commands/db/shared.js';

export interface IScanZoneDropResult {
  tableCount: number;
  droppedTables: readonly string[];
}

/**
 * Drop every `scan_*` table in the given SQLite database file.
 * Atomic: all deletes happen inside one `BEGIN ... COMMIT`. Throws
 * (caller catches and surfaces) when the file cannot be opened or a
 * table name fails the identifier safety check.
 */
export function dropScanZone(dbPath: string): IScanZoneDropResult {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'scan\\_%' ESCAPE '\\'",
      )
      .all() as Array<{ name: string }>;

    for (const r of rows) assertSafeIdentifier(r.name);

    if (rows.length === 0) {
      return { tableCount: 0, droppedTables: [] };
    }

    db.exec('BEGIN');
    for (const { name } of rows) {
      db.exec(`DELETE FROM "${name}"`);
    }
    db.exec('COMMIT');

    return {
      tableCount: rows.length,
      droppedTables: rows.map((r) => r.name),
    };
  } finally {
    db.close();
  }
}
