/**
 * `core/scope-gitignore.ts`, the scope ignore file writer
 * (`spec/cli-contract.md` §Scope ignore file).
 *
 * The contract worth pinning: it self-heals a short list written by an
 * older CLI, it never fights an operator who opted an entry out with a
 * `!` negation, and it never creates the scope directory as a side
 * effect.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SCOPE_GITIGNORE_ENTRIES } from '../paths/db-path.js';
import { ensureScopeGitignore, previewScopeGitignore } from '../scope-gitignore.js';

/** A scope root with a provisioned (empty) `.skill-map/` directory. */
function freshScope(): string {
  const root = mkdtempSync(join(tmpdir(), 'sm-scope-gitignore-'));
  mkdirSync(join(root, '.skill-map'));
  return root;
}

/** The ignore file's meaningful lines (comments and blanks dropped). */
function entriesOf(root: string): string[] {
  return readFileSync(join(root, '.skill-map', '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

describe('ensureScopeGitignore', () => {
  it('creates the file with every canonical entry', () => {
    const root = freshScope();
    assert.equal(ensureScopeGitignore(root), 'created');
    assert.deepEqual(entriesOf(root), [...SCOPE_GITIGNORE_ENTRIES]);
  });

  it('is idempotent on a current file', () => {
    const root = freshScope();
    ensureScopeGitignore(root);
    const before = readFileSync(join(root, '.skill-map', '.gitignore'), 'utf8');
    assert.equal(ensureScopeGitignore(root), 'unchanged');
    assert.equal(readFileSync(join(root, '.skill-map', '.gitignore'), 'utf8'), before);
  });

  // The regression this whole mechanism exists for: a project
  // bootstrapped by a CLI whose entry list predated the activity bridge,
  // the operations log and the SQLite sidecars.
  it('tops up a short list written by an older CLI', () => {
    const root = freshScope();
    writeFileSync(
      join(root, '.skill-map', '.gitignore'),
      'settings.local.json\nskill-map.db\nserve.json\nbackups/\n',
    );
    assert.equal(ensureScopeGitignore(root), 'updated');
    const entries = entriesOf(root);
    assert.ok(entries.includes('activity/'));
    assert.ok(entries.includes('operations.log*'));
    assert.ok(entries.includes('skill-map.db-wal'));
    assert.ok(entries.includes('skill-map.db-shm'));
    // Existing lines survive exactly once.
    assert.equal(entries.filter((e) => e === 'skill-map.db').length, 1);
  });

  it('honours a `!` negation instead of re-adding the entry', () => {
    const root = freshScope();
    // A team sharing the DB re-includes it (`spec/db-schema.md`).
    writeFileSync(join(root, '.skill-map', '.gitignore'), '!skill-map.db\n');
    ensureScopeGitignore(root);
    const entries = entriesOf(root);
    assert.ok(entries.includes('!skill-map.db'));
    assert.ok(!entries.includes('skill-map.db'), 'must not fight the operator opt-out');
    // The other entries still land.
    assert.ok(entries.includes('activity/'));
  });

  it('appends cleanly to a file with no trailing newline', () => {
    const root = freshScope();
    writeFileSync(join(root, '.skill-map', '.gitignore'), 'settings.local.json');
    ensureScopeGitignore(root);
    assert.ok(entriesOf(root).includes('settings.local.json'));
    assert.ok(entriesOf(root).includes('skill-map.db'));
  });

  it('skips silently when there is no scope directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'sm-scope-gitignore-bare-'));
    assert.equal(ensureScopeGitignore(root), 'skipped');
    assert.equal(existsSync(join(root, '.skill-map')), false);
  });
});

describe('previewScopeGitignore', () => {
  it('reports the full list when the file is absent', () => {
    const root = freshScope();
    const preview = previewScopeGitignore(root);
    assert.equal(preview.exists, false);
    assert.deepEqual([...preview.wouldAdd], [...SCOPE_GITIGNORE_ENTRIES]);
  });

  it('reports only the delta, and writes nothing', () => {
    const root = freshScope();
    writeFileSync(
      join(root, '.skill-map', '.gitignore'),
      'settings.local.json\nskill-map.db\nserve.json\nbackups/\n',
    );
    const preview = previewScopeGitignore(root);
    assert.equal(preview.exists, true);
    assert.deepEqual(
      [...preview.wouldAdd],
      [
        'skill-map.db-wal',
        'skill-map.db-shm',
        'scope.lock.json',
        'operations.log*',
        'activity/',
        'sessions/',
      ],
    );
    assert.deepEqual(entriesOf(root), [
      'settings.local.json',
      'skill-map.db',
      'serve.json',
      'backups/',
    ]);
  });
});
