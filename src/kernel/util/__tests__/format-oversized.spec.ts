/**
 * `kernel/util/format-oversized`, the shared formatter behind the
 * "skipped oversized file" warning rows the CLI and server surfaces emit.
 * Pure unit test: no I/O, no DB, no process, just the
 * `(path, bytes)` -> string mapping.
 *
 * The block rows must match the byte-for-byte shape the surfaces previously
 * built inline from the per-surface catalog templates
 * (`     - path (size)\n`), and the bare pair must match the
 * `path (size)` atom the log line joins with `, `.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  formatOversizedFilePair,
  formatOversizedFileRows,
} from '../format-oversized.js';

describe('formatOversizedFilePair', () => {
  it('renders the bare `path (humanSize)` atom', () => {
    assert.equal(
      formatOversizedFilePair({ path: '.claude/commands/huge.md', bytes: 4096 }),
      '.claude/commands/huge.md (4 KiB)',
    );
  });

  it('renders sub-KiB sizes in exact bytes', () => {
    assert.equal(
      formatOversizedFilePair({ path: 'docs/a.md', bytes: 512 }),
      'docs/a.md (512 B)',
    );
  });

  it('sanitises the disk-sourced path (audit finding, 2026-08-01)', () => {
    // Under clone-and-scan the filename is attacker-authored, and all
    // three surfaces write this atom to a terminal. The screen-clear
    // below reached the operator on `sm scan` and on every `sm watch`
    // batch while sanitisation was a caller obligation.
    assert.equal(
      formatOversizedFilePair({ path: 'evil\x1B[2J\x1B[1;31mPWNED\x1B[0m.md', bytes: 4096 }),
      'evilPWNED.md (4 KiB)',
    );
  });
});

describe('formatOversizedFileRows', () => {
  it('returns an empty array for an empty list', () => {
    assert.deepEqual(formatOversizedFileRows([]), []);
  });

  it('renders a single file as one indented WARN-block row', () => {
    const rows = formatOversizedFileRows([
      { path: '.claude/commands/huge.md', bytes: 1572864 },
    ]);
    assert.deepEqual(rows, ['     - .claude/commands/huge.md (1.5 MiB)\n']);
  });

  it('renders one row per file in input order', () => {
    const rows = formatOversizedFileRows([
      { path: 'docs/big-1.md', bytes: 1048576 },
      { path: 'docs/big-2.md', bytes: 2097152 },
      { path: 'docs/small.md', bytes: 512 },
    ]);
    assert.deepEqual(rows, [
      '     - docs/big-1.md (1 MiB)\n',
      '     - docs/big-2.md (2 MiB)\n',
      '     - docs/small.md (512 B)\n',
    ]);
  });

  it('builds a row from the shared pair atom (prefix + newline framing only)', () => {
    const file = { path: 'a/b.md', bytes: 4096 };
    assert.equal(
      formatOversizedFileRows([file])[0],
      `     - ${formatOversizedFilePair(file)}\n`,
    );
  });
});
