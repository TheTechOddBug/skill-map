/**
 * `warnOversizedFiles` (`server/watcher.ts`): the `sm serve` console
 * notice for files skipped over `scan.maxFileSizeBytes`.
 *
 * The shape under test is the LIST: one `     - path (size)` row per
 * file, the same rows `sm scan` / `sm watch` print through the shared
 * `formatOversizedFileRows`. The serve pane used to join the files with
 * commas into a single line, which is exactly where the UI banner's
 * "see the full list in the console" sent the operator when more than
 * six files were skipped: a 10-file wall on one line (found live with a
 * 10-file repro; the scan.texts.ts comment even promised the three
 * surfaces shared the row formatter while serve had drifted off it).
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { LoggerPort } from '../../kernel/ports/logger.js';
import { configureLogger, resetLogger } from '../../kernel/util/logger.js';
import type { ScanResult } from '../../kernel/types.js';
import { warnOversizedFiles } from '../watcher.js';

function captureWarnLogger(buffer: string[]): LoggerPort {
  return {
    trace() {},
    debug() {},
    info() {},
    warn(message) {
      buffer.push(message);
    },
    error() {},
  };
}

/** Minimal ScanResult carrying only what the notice reads. */
function scanWith(oversized: { path: string; bytes: number }[]): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    providers: [],
    nodes: [],
    links: [],
    issues: [],
    oversizedFiles: oversized,
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
      filesOversized: oversized.length,
    },
  };
}

const MB = 1024 * 1024;

describe('serve oversized-files notice', () => {
  afterEach(() => {
    resetLogger();
  });

  it('renders one row per file, never a comma-joined line', () => {
    const warnings: string[] = [];
    configureLogger(captureWarnLogger(warnings));

    warnOversizedFiles(
      scanWith([
        { path: 'changelogs/a.md', bytes: 3.4 * MB },
        { path: 'changelogs/b.md', bytes: 3.5 * MB },
        { path: 'changelogs/c.md', bytes: 3.6 * MB },
      ]),
    );

    assert.equal(warnings.length, 1);
    const message = warnings[0]!;
    const lines = message.split('\n');
    // Header with count + plural noun, then one row per file, then the
    // escape-route hint. 3 files -> 5 lines.
    assert.equal(lines.length, 5, message);
    assert.match(lines[0]!, /skipped 3 files over the size limit \(scan\.maxFileSizeBytes\):$/);
    assert.equal(lines[1], '     - changelogs/a.md (3.4 MiB)');
    assert.equal(lines[2], '     - changelogs/b.md (3.5 MiB)');
    assert.equal(lines[3], '     - changelogs/c.md (3.6 MiB)');
    assert.match(lines[4]!, /Raise scan\.maxFileSizeBytes .* \.skillmapignore/);
    // The regression: no row ever rides another row's line.
    assert.ok(!message.includes('), '), 'rows joined with commas');
  });

  it('uses the singular noun for one file', () => {
    const warnings: string[] = [];
    configureLogger(captureWarnLogger(warnings));

    warnOversizedFiles(scanWith([{ path: 'CHANGELOG.md', bytes: 3.6 * MB }]));

    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /skipped 1 file over the size limit/);
    assert.ok(warnings[0]!.includes('     - CHANGELOG.md (3.6 MiB)'));
  });

  it('stays silent when nothing was skipped', () => {
    const warnings: string[] = [];
    configureLogger(captureWarnLogger(warnings));

    warnOversizedFiles(scanWith([]));

    assert.equal(warnings.length, 0);
  });
});
