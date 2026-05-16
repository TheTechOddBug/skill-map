/**
 * Coverage for the `core/update-check` built-in hook
 * (`plugins/core/hooks/update-check/index.ts`). The hook is a
 * thin wrapper around `maybeRunUpdateCheck`; full bail-condition and
 * banner-vs-refresh coverage already lives in `update-check.test.ts`.
 * These tests pin the hook-specific surface:
 *
 *   - Manifest shape: declares `core/update-check`, deterministic mode,
 *     subscribes only to `boot`.
 *   - Defensive payload handling: a `boot` event without the contracted
 *     fields is a no-op (rather than a throw / crash).
 *   - End-to-end: a contracted payload triggers the wrapped helper,
 *     which silently succeeds when the DB path doesn't exist (early
 *     bail per the helper's own semantics).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { updateCheckHook } from './index.js';
import type { IHookContext } from '../../../../kernel/extensions/index.js';

function bootCtx(data: unknown): IHookContext {
  return {
    event: {
      type: 'boot',
      timestamp: new Date().toISOString(),
      data,
    },
  };
}

describe('core/update-check hook', () => {
  it('manifest declares the expected shape', () => {
    assert.equal(updateCheckHook.id, 'update-check');
    assert.equal(updateCheckHook.pluginId, 'core');
    assert.equal(updateCheckHook.kind, 'hook');
    assert.equal(updateCheckHook.mode, 'deterministic');
    assert.deepEqual(updateCheckHook.triggers, ['boot']);
  });

  it('is a no-op when the boot payload omits dbPath', async () => {
    await assert.doesNotReject(async () =>
      updateCheckHook.on(bootCtx({ cwd: '/x', stderr: process.stderr })),
    );
  });

  it('is a no-op when the boot payload omits cwd / homedir', async () => {
    await assert.doesNotReject(async () => updateCheckHook.on(bootCtx({ dbPath: '/d' })));
  });

  it('is a no-op when the boot payload omits stderr', async () => {
    await assert.doesNotReject(async () =>
      updateCheckHook.on(bootCtx({ dbPath: '/d', cwd: '/x'})),
    );
  });

  it('is a no-op when the data field is absent entirely', async () => {
    await assert.doesNotReject(async () => updateCheckHook.on(bootCtx(undefined)));
  });

  it('forwards a contracted payload without throwing (DB missing → silent bail)', async () => {
    // `maybeRunUpdateCheck` short-circuits on missing DB; the hook
    // therefore returns cleanly with no banner emission.
    const tempDir = mkdtempSync(join(tmpdir(), 'update-check-hook-'));
    try {
      await assert.doesNotReject(async () =>
        updateCheckHook.on(
          bootCtx({
            dbPath: join(tempDir, 'never-created.db'),
            cwd: tempDir,
            stderr: process.stderr,
            noColorFlag: false,
          }),
        ),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
