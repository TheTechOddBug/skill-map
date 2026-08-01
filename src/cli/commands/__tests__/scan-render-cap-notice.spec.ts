/**
 * `sm scan` map render-cap advisory (`maybePrintRenderCapNotice`).
 *
 * Drives a real `ScanCommand.execute()` against a temp project whose node
 * count exceeds the effective render cap. Asserts the command surfaces an
 * INFO advisory on stderr (NOT stdout): a cyan glyph, the corpus node
 * count, the effective cap, the lever source (`scan.maxNodes` vs
 * `--max-nodes`), and the "nothing is dropped" hint. Also asserts the
 * advisory stays silent when the corpus fits under the cap.
 *
 * The render cap does NOT bound the scan (the full corpus is persisted),
 * so this is benign, unlike the scan-ceiling notice. Per AGENTS.md the
 * scratch project lives under `.tmp/` and the DB uses a file path (no
 * `:memory:`, per feedback_sqlite_in_memory_workaround).
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
  tmpRoot = mkdtempSync(join(projectTmp, 'scan-render-cap-'));
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

/** Seed `count` plain markdown nodes under `docs/`. */
function seedNodes(fixture: string, count: number): void {
  const dir = mkdirP(fixture, 'docs');
  for (let i = 1; i <= count; i += 1) {
    writeFileSync(join(dir, `doc-${i}.md`), `# Doc ${i}\n\nbody\n`);
  }
}

describe('sm scan, map render-cap advisory', () => {
  it('advises on stderr when the corpus exceeds scan.maxNodes', async () => {
    const fixture = freshFixture('over');
    seedNodes(fixture, 5);
    writeFileSync(
      join(mkdirP(fixture, '.skill-map'), 'settings.json'),
      JSON.stringify({ schemaVersion: 1, scan: { maxNodes: 2 } }),
    );
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeScanCmd(cap);
    await cmd.execute();

    const err = cap.stderr();
    ok(/exceed the map render cap/.test(err), err);
    ok(/5 nodes/.test(err), err);
    ok(/\(2, scan\.maxNodes\)/.test(err), err);
    ok(/Nothing is dropped/.test(err), err);
    // The advisory must NOT leak onto stdout (the machine payload stream).
    ok(!/render cap/.test(cap.stdout()), cap.stdout());
  });

  it('names --max-nodes as the source when the cap comes from the flag', async () => {
    const fixture = freshFixture('flag');
    seedNodes(fixture, 5);
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeScanCmd(cap);
    cmd.maxNodes = '2';
    await cmd.execute();

    const err = cap.stderr();
    ok(/exceed the map render cap/.test(err), err);
    ok(/\(2, --max-nodes\)/.test(err), err);
  });

  it('stays silent when the corpus fits under the cap', async () => {
    const fixture = freshFixture('under');
    seedNodes(fixture, 3);
    writeFileSync(
      join(mkdirP(fixture, '.skill-map'), 'settings.json'),
      JSON.stringify({ schemaVersion: 1, scan: { maxNodes: 256 } }),
    );
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeScanCmd(cap);
    await cmd.execute();

    ok(!/render cap/.test(cap.stderr()), cap.stderr());
  });
});

function mkdirP(root: string, rel: string): string {
  const abs = join(root, rel);
  mkdirSync(abs, { recursive: true });
  return abs;
}
