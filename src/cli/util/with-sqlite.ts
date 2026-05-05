/**
 * Re-export shim — the `withSqlite` / `tryWithSqlite` helpers were moved
 * to `core/sqlite/with-sqlite.ts` so the BFF can consume them without
 * crossing the CLI boundary. Historic CLI imports keep working verbatim
 * through this file.
 */

export { tryWithSqlite, withSqlite } from '../../core/sqlite/with-sqlite.js';
