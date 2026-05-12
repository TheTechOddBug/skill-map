/**
 * `sm db dump` — pure-node SQL dump to stdout. No external `sqlite3`
 * binary required: walks the schema via `node:sqlite` and emits a
 * loadable `.dump`-style script. Read-only.
 */

import { DatabaseSync } from 'node:sqlite';

import { Command, Option } from 'clipanion';

import { ansiFor } from '../../util/ansi.js';
import { tx } from '../../../kernel/util/tx.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';
import { requireDbOrExit, resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { formatErrorMessage } from '../../../kernel/util/format-error.js';
import { SmCommand } from '../../util/sm-command.js';
import { SAFE_SQL_IDENTIFIER_RE } from './shared.js';

export class DbDumpCommand extends SmCommand {
  static override paths = [['db', 'dump']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'SQL dump to stdout.',
    details:
      'Read-only. Pure node:sqlite — no external `sqlite3` binary required. Use --tables <names...> to limit the dump to specific tables.',
  });

  tables = Option.Array('--tables', { required: false });

  protected async run(): Promise<number> {
    const path = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(path, this.context.stderr);
    if (exit !== null) return exit;

    const stderr = this.context.stderr as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
    const errGlyph = ansi.red('✕');

    if (this.tables && this.tables.length > 0) {
      for (const t of this.tables) {
        if (!SAFE_SQL_IDENTIFIER_RE.test(t)) {
          this.printer!.error(
            tx(DB_TEXTS.dumpInvalidTable, {
              glyph: errGlyph,
              table: t,
              hint: ansi.dim(DB_TEXTS.dumpInvalidTableHint),
            }),
          );
          return ExitCode.Error;
        }
      }
    }

    try {
      dumpDatabaseToStream(path, this.context.stdout, this.tables ?? null);
      return ExitCode.Ok;
    } catch (err) {
      this.printer!.error(
        tx(DB_TEXTS.dumpFailure, { glyph: errGlyph, message: formatErrorMessage(err) }),
      );
      return ExitCode.Error;
    }
  }
}

/**
 * Pure-node SQL dump. Equivalent (for the subset we care about) to the
 * sqlite3 CLI's `.dump` meta-command, but uses `node:sqlite` directly
 * so we have zero dependency on a system binary. Output format matches
 * what sqlite3's `.dump` produces closely enough to be loadable via
 * `sqlite3 newdb < dump.sql` or `cat dump.sql | sqlite3 newdb`:
 *
 *   - `PRAGMA foreign_keys=OFF;` first (avoids ordering issues on load)
 *   - `BEGIN TRANSACTION;` … `COMMIT;` envelope
 *   - All schema objects (`table`, `index`, `trigger`, `view`) in
 *     `rootpage` order — same as sqlite3's `.dump`. Internal tables
 *     (`sqlite_*`) are skipped.
 *   - For each user table, one `INSERT INTO "table" VALUES(…);` per row.
 *
 * `tables` filters BOTH the schema-object pass and the data pass to
 * the named tables. Identifiers are validated against
 * `SAFE_SQL_IDENTIFIER_RE` upstream so the literal interpolation in
 * the data query is safe.
 */
function dumpDatabaseToStream(
  dbPath: string,
  out: NodeJS.WritableStream,
  tables: string[] | null,
): void {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    out.write('PRAGMA foreign_keys=OFF;\n');
    out.write('BEGIN TRANSACTION;\n');

    const objects = listSchemaObjects(db, tables);

    // First pass: schema. Tables come before indices/triggers/views by
    // rootpage order, so a downstream `sqlite3 newdb < dump.sql` can
    // execute statements in declared order without dependency surprises.
    for (const obj of objects) {
      if (!obj.sql) continue; // sqlite_sequence has null sql, skip
      out.write(`${obj.sql};\n`);
    }

    // Second pass: data. Tables only.
    for (const obj of objects) {
      if (obj.type !== 'table') continue;
      writeTableData(db, out, obj.name);
    }

    out.write('COMMIT;\n');
  } finally {
    db.close();
  }
}

interface ISchemaObject {
  type: string;
  name: string;
  sql: string | null;
}

function listSchemaObjects(db: DatabaseSync, tables: string[] | null): ISchemaObject[] {
  const baseQuery =
    "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%'";
  if (tables === null || tables.length === 0) {
    return db.prepare(`${baseQuery} ORDER BY rootpage`).all() as unknown as ISchemaObject[];
  }
  // Filter applies to BOTH the table itself AND any index/trigger
  // attached to it — we look up `tbl_name` for non-table objects.
  const placeholders = tables.map(() => '?').join(',');
  const sql = `${baseQuery} AND (name IN (${placeholders}) OR tbl_name IN (${placeholders})) ORDER BY rootpage`;
  return db.prepare(sql).all(...tables, ...tables) as unknown as ISchemaObject[];
}

function writeTableData(db: DatabaseSync, out: NodeJS.WritableStream, tableName: string): void {
  // Identifier already vetted by SAFE_SQL_IDENTIFIER_RE (alphanumeric +
  // underscore, must start with letter / underscore). Quote anyway so a
  // future relaxation of the validator doesn't open an injection path.
  const quoted = `"${tableName.replace(/"/g, '""')}"`;
  for (const row of db.prepare(`SELECT * FROM ${quoted}`).iterate()) {
    const values = Object.values(row as Record<string, unknown>).map(formatSqlValue).join(',');
    out.write(`INSERT INTO ${quoted} VALUES(${values});\n`);
  }
}

/** Number → SQL literal. NaN / ±Infinity collapse to NULL (sqlite has no
 *  literal for either). */
function formatSqlNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : 'NULL';
}

/** SQL literal serialiser. Mirrors sqlite3 `.dump`'s formatting. */
function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return formatSqlNumber(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  // Strings — single-quote, escape internal single quotes by doubling.
  return `'${String(value).replace(/'/g, "''")}'`;
}
