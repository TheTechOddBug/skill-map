/**
 * Operations-log writer contract (`spec/cli-contract.md` §Operations log):
 * append shape, no-project silence, fire-and-forget, and the
 * single-generation size rotation.
 */

import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  appendOperation,
  OPERATIONS_LOG_MAX_BYTES,
} from '../operations-log.js';

let tmp: string;
let counter = 0;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-oplog-'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Fresh fake project root, `.skill-map/` included unless told otherwise. */
function freshProject(withDir = true): string {
  counter += 1;
  const root = join(tmp, `proj-${counter}`);
  mkdirSync(withDir ? join(root, '.skill-map') : root, { recursive: true });
  return root;
}

function logPath(root: string): string {
  return join(root, '.skill-map', 'operations.log');
}

describe('appendOperation', () => {
  it('appends one JSONL line with the entry fields plus an ISO stamp', () => {
    const root = freshProject();
    appendOperation(root, {
      op: 'jobs.submit',
      target: 'playground.md',
      extension: 'core/ai-contradiction-analyzer',
      channel: 'ui',
      outcome: 'queued',
      id: 'd-1',
    });
    appendOperation(root, { op: 'findings.clear', target: '*', channel: 'cli', outcome: 'ok', detail: 'deleted=16' });

    const lines = readFileSync(logPath(root), 'utf8').trimEnd().split('\n');
    strictEqual(lines.length, 2);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    ok(typeof first['at'] === 'string' && !Number.isNaN(Date.parse(first['at'] as string)));
    deepStrictEqual(
      { ...first, at: undefined },
      {
        at: undefined,
        op: 'jobs.submit',
        target: 'playground.md',
        extension: 'core/ai-contradiction-analyzer',
        channel: 'ui',
        outcome: 'queued',
        id: 'd-1',
      },
    );
    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    strictEqual(second['detail'], 'deleted=16');
    strictEqual('extension' in second, false, 'absent optionals are omitted');
  });

  it('is a silent no-op when the project has no .skill-map directory', () => {
    const root = freshProject(false);
    appendOperation(root, { op: 'scan', target: '*', channel: 'cli', outcome: 'ok' });
    strictEqual(existsSync(logPath(root)), false);
  });

  it('rotates a single generation once the cap is exceeded', () => {
    const root = freshProject();
    // Pre-fill past the cap, then append: the oversized file must move to
    // `.1` and the fresh file starts with the incoming line.
    writeFileSync(logPath(root), 'x'.repeat(OPERATIONS_LOG_MAX_BYTES + 1));
    appendOperation(root, { op: 'scan', target: '*', channel: 'watcher', outcome: 'ok' });

    const fresh = readFileSync(logPath(root), 'utf8').trimEnd().split('\n');
    strictEqual(fresh.length, 1);
    strictEqual((JSON.parse(fresh[0]!) as { op: string }).op, 'scan');
    ok(existsSync(`${logPath(root)}.1`), 'previous generation kept as .1');
  });
});
