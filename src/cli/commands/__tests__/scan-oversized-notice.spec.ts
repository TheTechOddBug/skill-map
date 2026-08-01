/**
 * `sm scan` file-size skip WARN (`maybePrintSkippedFilesNotice`).
 *
 * Drives a real `ScanCommand.execute()` against a temp project that
 * carries one under-limit `.md` and one over-limit `.md`, with a
 * `.skill-map/settings.json` pinning `scan.maxFileSizeBytes` low. Asserts
 * the walker skipped the big file and the command surfaced the WARN on
 * stderr (NOT stdout): a yellow glyph, the skipped path + human size,
 * and the `scan.maxFileSizeBytes` / `.skillmapignore` hint.
 *
 * Per AGENTS.md the scratch project lives under `.tmp/` and the DB uses a
 * file path (no `:memory:`, per feedback_sqlite_in_memory_workaround).
 */

import { describe, it, before, after } from 'node:test';
import { ok } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { BaseContext } from 'clipanion';

import { ScanCommand } from '../scan.js';

let tmpRoot: string;
let counter = 0;
const originalCwd = process.cwd();

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

before(() => {
  const projectTmp = resolve(originalCwd, '.tmp');
  mkdirSync(projectTmp, { recursive: true });
  tmpRoot = mkdtempSync(join(projectTmp, 'scan-oversized-'));
});

after(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface ICapture {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; }, isTTY: false },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; }, isTTY: false },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

function makeScanCmd(cap: ICapture): ScanCommand {
  const cmd = new ScanCommand();
  cmd.context = cap.context;
  cmd.roots = [];
  cmd.noBuiltIns = false;
  cmd.noPlugins = true;
  cmd.noTokens = true;
  cmd.dryRun = false;
  cmd.changed = false;
  cmd.allowEmpty = false;
  cmd.strict = false;
  cmd.watch = false;
  cmd.yes = true;
  cmd.maxScan = undefined;
  cmd.maxNodes = undefined;
  cmd.json = false;
  cmd.quiet = false;
  cmd.noColor = true;
  return cmd;
}

describe('sm scan, file-size skip notice', () => {
  it('warns on stderr listing the skipped file when one exceeds scan.maxFileSizeBytes', async () => {
    const fixture = freshFixture('warn');
    // A Claude agent under the limit, plus an oversized command.
    writeFileSync(
      join(mkdirP(fixture, '.claude/agents'), 'small.md'),
      ['---', 'name: small', 'description: ok', '---', 'tiny'].join('\n'),
    );
    writeFileSync(
      join(mkdirP(fixture, '.claude/commands'), 'huge.md'),
      ['---', 'name: huge', 'description: big', '---', 'X'.repeat(4096)].join('\n'),
    );
    // Pin a small limit via project settings.
    writeFileSync(
      join(mkdirP(fixture, '.skill-map'), 'settings.json'),
      JSON.stringify({ schemaVersion: 1, scan: { maxFileSizeBytes: 1024 } }),
    );
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeScanCmd(cap);
    await cmd.execute();

    const err = cap.stderr();
    ok(/over the size limit \(scan\.maxFileSizeBytes\)/.test(err), err);
    ok(err.includes('.claude/commands/huge.md'), err);
    // Human size formatting is present (some unit suffix).
    ok(/\((\d+(\.\d+)?\s(B|KiB|MiB))\)/.test(err), err);
    ok(/\.skillmapignore/.test(err), err);
    // The notice must NOT leak onto stdout (the machine payload stream).
    ok(!/over the size limit/.test(cap.stdout()), cap.stdout());
  });

  it('stays silent when no file exceeds the limit', async () => {
    const fixture = freshFixture('quiet');
    writeFileSync(
      join(mkdirP(fixture, '.claude/agents'), 'a.md'),
      ['---', 'name: a', 'description: ok', '---', 'tiny'].join('\n'),
    );
    writeFileSync(
      join(mkdirP(fixture, '.skill-map'), 'settings.json'),
      JSON.stringify({ schemaVersion: 1, scan: { maxFileSizeBytes: 1048576 } }),
    );
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeScanCmd(cap);
    await cmd.execute();

    ok(!/over the size limit/.test(cap.stderr()), cap.stderr());
  });
});

function mkdirP(root: string, rel: string): string {
  const abs = join(root, rel);
  mkdirSync(abs, { recursive: true });
  return abs;
}
