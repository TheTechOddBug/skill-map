/**
 * Coverage for `server/routes/actions:assertSidecarWritesContained`, the
 * L1 hardening that validates an Action-returned sidecar `w.path` stays
 * inside the project root BEFORE any write.
 *
 * Built-in Actions derive the path from an already-contained node path,
 * but a buggy or hostile plugin Action could return an out-of-tree
 * absolute path; this guard rejects it (400) so one bad path aborts the
 * whole batch instead of clobbering a file outside the project. The
 * underlying containment + symlink logic lives in `assertContained`
 * (path-guard, separately tested); these tests lock the L1-specific
 * relativize-then-assert composition over absolute `w.path` values.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { HTTPException } from 'hono/http-exception';

import { assertSidecarWritesContained } from '../actions.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'sm-l1-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function sidecar(path: string) {
  return [{ kind: 'sidecar' as const, path, changes: {} }];
}

describe('assertSidecarWritesContained (L1)', () => {
  it('allows an in-tree absolute sidecar path', () => {
    assert.doesNotThrow(() => assertSidecarWritesContained(sidecar(join(cwd, 'docs', 'note.sm')), cwd));
  });

  it('rejects an absolute path escaping the project root with a 400', () => {
    const escaping = resolve(cwd, '..', 'evil.sm');
    assert.throws(
      () => assertSidecarWritesContained(sidecar(escaping), cwd),
      (err: unknown) => err instanceof HTTPException && err.status === 400,
    );
  });

  it('rejects an absolute path on an unrelated root (e.g. /etc) with a 400', () => {
    assert.throws(
      () => assertSidecarWritesContained(sidecar('/etc/passwd.sm'), cwd),
      (err: unknown) => err instanceof HTTPException && err.status === 400,
    );
  });

  it('aborts the whole batch when any one write escapes (no partial pass)', () => {
    const writes = [
      { kind: 'sidecar' as const, path: join(cwd, 'ok.sm'), changes: {} },
      { kind: 'sidecar' as const, path: resolve(cwd, '..', 'evil.sm'), changes: {} },
    ];
    assert.throws(
      () => assertSidecarWritesContained(writes, cwd),
      (err: unknown) => err instanceof HTTPException && err.status === 400,
    );
  });

  it('is a no-op for an empty / undefined write list', () => {
    assert.doesNotThrow(() => assertSidecarWritesContained([], cwd));
    assert.doesNotThrow(() => assertSidecarWritesContained(undefined, cwd));
  });
});
