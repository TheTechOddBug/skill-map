/**
 * `sm init --force` greenfield reset contract. A `.skill-map/skill-map.db`
 * created by an older CLI version (pre-Phase-2, missing the
 * `occurrences_json` / `resolved_target` / `external_refs_json` columns)
 * MUST be wiped and re-provisioned at the current schema when the
 * operator passes `--force`. Without the wipe, `loadScanResult` against
 * the stale DB hits `JSON.parse(undefined)` on the missing columns and
 * the first auto-scan crashes with the cryptic
 * `Failed to read scan rows ("undefined" is not valid JSON)` envelope.
 *
 * This spec plants a stale DB by hand (older `scan_links` shape), runs
 * `sm init --force --no-scan`, and asserts the resulting DB carries the
 * current columns. The settings file is also asserted to have been
 * overwritten to the bare `{ schemaVersion: 1 }` shape so a prior
 * `activeProvider` choice does not survive the reset (the bootstrap
 * fires the lens-selection prompt again on the next scan).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import type { BaseContext } from 'clipanion';

import { InitCommand } from '../../cli/commands/init.js';
import type { SmCommand } from '../../cli/util/sm-command.js';

function captureContext(): { context: BaseContext } {
  const context = {
    stdin: process.stdin,
    stdout: { write: () => true },
    stderr: { write: () => true },
  } as unknown as BaseContext;
  return { context };
}

function applySmDefaults(cmd: SmCommand): void {
  cmd.json = false;
  cmd.quiet = true;
  cmd.noColor = true;
  cmd.verbose = 0;
}

function listColumns(dbPath: string, table: string): string[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.map((r) => r.name).sort();
  } finally {
    db.close();
  }
}

describe('sm init --force DB reset (greenfield posture)', () => {
  let tmpRoot: string;
  let counter = 0;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-init-force-'));
  });

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('replaces a stale pre-Phase-2 DB with one at the current schema', async () => {
    counter += 1;
    const cwd = join(tmpRoot, `stale-db-${counter}`);
    const skillMapDir = join(cwd, '.skill-map');
    mkdirSync(skillMapDir, { recursive: true });

    // Plant a stale DB whose `scan_links` table predates the Phase-2.A
    // additions. The schema below mirrors the columns the CLI shipped
    // BEFORE `occurrences_json` / `resolved_target` landed.
    const dbPath = join(skillMapDir, 'skill-map.db');
    {
      const db = new DatabaseSync(dbPath);
      try {
        db.exec(`
          CREATE TABLE scan_links (
            id INTEGER PRIMARY KEY,
            source_path TEXT NOT NULL,
            target_path TEXT NOT NULL,
            kind TEXT NOT NULL,
            confidence REAL NOT NULL,
            sources_json TEXT NOT NULL,
            original_trigger TEXT,
            normalized_trigger TEXT,
            location_line INTEGER,
            location_column INTEGER,
            location_offset INTEGER,
            raw TEXT
          );
          INSERT INTO scan_links (source_path, target_path, kind, confidence, sources_json)
          VALUES ('stale.md', 'gone.md', 'references', 0.5, '["markdown-link"]');
        `);
      } finally {
        db.close();
      }
    }

    // Also plant a settings.json carrying a non-default activeProvider
    // to verify --force overwrites it (and the next scan would re-fire
    // the bootstrap).
    const settingsPath = join(skillMapDir, 'settings.json');
    writeFileSync(
      settingsPath,
      JSON.stringify({ schemaVersion: 1, activeProvider: 'codex' }, null, 2) + '\n',
    );

    // Pre-condition: stale schema is missing the Phase-2 columns.
    const stalePreColumns = listColumns(dbPath, 'scan_links');
    assert.ok(!stalePreColumns.includes('occurrences_json'), 'pre-state must lack occurrences_json');
    assert.ok(!stalePreColumns.includes('resolved_target'), 'pre-state must lack resolved_target');

    const cwdBefore = process.cwd();
    process.chdir(cwd);
    try {
      const cap = captureContext();
      const cmd = new InitCommand();
      applySmDefaults(cmd);
      cmd.force = true;
      cmd.noScan = true; // skip the first scan to keep the test fast
      cmd.strict = false;
      cmd.dryRun = false;
      cmd.context = cap.context;
      const exit = await cmd.execute();
      assert.strictEqual(exit, 0, `unexpected exit ${exit}`);
    } finally {
      process.chdir(cwdBefore);
    }

    // Post-condition: the DB carries the current schema columns.
    const freshColumns = listColumns(dbPath, 'scan_links');
    assert.ok(freshColumns.includes('occurrences_json'), 'fresh DB must have occurrences_json');
    assert.ok(freshColumns.includes('resolved_target'), 'fresh DB must have resolved_target');

    // Post-condition: settings.json is back to the bare schema-only shape.
    const settingsAfter = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    assert.deepStrictEqual(settingsAfter, { schemaVersion: 1 }, 'settings must be reset to the bare shape');

    // Post-condition: the stale row planted above is gone (DB was wiped,
    // not migrated in place).
    {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const rows = db.prepare('SELECT COUNT(*) AS c FROM scan_links').all() as Array<{ c: number }>;
        assert.strictEqual(rows[0]!.c, 0, 'stale rows must not survive --force');
      } finally {
        db.close();
      }
    }
  });

  it('is a no-op against a fresh project (no prior DB, no message clutter)', async () => {
    counter += 1;
    const cwd = join(tmpRoot, `fresh-${counter}`);
    mkdirSync(cwd, { recursive: true });

    const cwdBefore = process.cwd();
    process.chdir(cwd);
    try {
      const cap = captureContext();
      const cmd = new InitCommand();
      applySmDefaults(cmd);
      cmd.force = true;
      cmd.noScan = true;
      cmd.strict = false;
      cmd.dryRun = false;
      cmd.context = cap.context;
      const exit = await cmd.execute();
      assert.strictEqual(exit, 0, `unexpected exit ${exit}`);
    } finally {
      process.chdir(cwdBefore);
    }

    const dbPath = join(cwd, '.skill-map', 'skill-map.db');
    const columns = listColumns(dbPath, 'scan_links');
    assert.ok(columns.includes('occurrences_json'), 'fresh DB must have occurrences_json');
  });
});
