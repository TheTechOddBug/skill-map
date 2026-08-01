/**
 * Coverage for the `core/update-check` built-in hook
 * (`plugins/core/hooks/update-check/index.ts`). The hook is a thin
 * subscriber that invokes the driver-injected probe (`runUpdateCheck`
 * on the `boot` payload); full bail-condition and banner-vs-refresh
 * coverage lives with the probe itself (`update-check.spec.ts`).
 * These tests pin the hook-specific surface:
 *
 *   - Manifest shape: declares `core/update-check`, subscribes only
 *     to `boot`.
 *   - Defensive payload handling: a `boot` event without the
 *     contracted fields (no `runUpdateCheck`, no `stderr`, no data at
 *     all) is a no-op (rather than a throw / crash).
 *   - Forwarding: a contracted payload invokes the injected probe
 *     exactly once with the payload's `stderr` / `noColorFlag`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { updateCheckHook } from '../index.js';
import type { IHookContext } from '../../../../../kernel/extensions/index.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';

function bootCtx(data: unknown): IHookContext {
  return {
    log: SILENT_EXTENSION_LOGGER,
    settings: {},
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
    // `mode` retired per structure-as-truth refactor (hooks are deterministic-only).
    assert.deepEqual(updateCheckHook.triggers, ['boot']);
  });

  it('is a no-op when the driver injects no runUpdateCheck', async () => {
    await assert.doesNotReject(async () =>
      updateCheckHook.on(bootCtx({ stderr: process.stderr, noColorFlag: false })),
    );
  });

  it('is a no-op when the boot payload omits stderr', async () => {
    let calls = 0;
    await updateCheckHook.on(
      bootCtx({
        runUpdateCheck: async () => {
          calls += 1;
        },
      }),
    );
    assert.equal(calls, 0);
  });

  it('is a no-op when the data field is absent entirely', async () => {
    await assert.doesNotReject(async () => updateCheckHook.on(bootCtx(undefined)));
  });

  it('invokes the injected probe once, forwarding stderr and noColorFlag', async () => {
    const received: Array<{ stderr: NodeJS.WriteStream; noColorFlag: boolean }> = [];
    await updateCheckHook.on(
      bootCtx({
        stderr: process.stderr,
        noColorFlag: true,
        runUpdateCheck: async (opts: { stderr: NodeJS.WriteStream; noColorFlag: boolean }) => {
          received.push(opts);
        },
      }),
    );
    assert.equal(received.length, 1);
    assert.equal(received[0]!.stderr, process.stderr);
    assert.equal(received[0]!.noColorFlag, true);
  });

  it('defaults noColorFlag to false when the payload omits it', async () => {
    const received: Array<{ noColorFlag: boolean }> = [];
    await updateCheckHook.on(
      bootCtx({
        stderr: process.stderr,
        runUpdateCheck: async (opts: { stderr: NodeJS.WriteStream; noColorFlag: boolean }) => {
          received.push(opts);
        },
      }),
    );
    assert.equal(received.length, 1);
    assert.equal(received[0]!.noColorFlag, false);
  });
});
