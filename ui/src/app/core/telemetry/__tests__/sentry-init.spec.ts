import { describe, expect, it } from 'vitest';

import { captureUiException, initUiSentry, isUiDsnConfigured } from '../sentry-init';

/**
 * Locks the DORMANT-BY-DEFAULT contract (`spec/telemetry.md`). The UI
 * DSN placeholder is empty today, so:
 *   - `isUiDsnConfigured()` reports false.
 *   - `initUiSentry` is a hard no-op regardless of the consent flag: it
 *     returns without throwing and, crucially, never dynamic-imports the
 *     `@sentry/angular` SDK on that path (the chunk stays out of the
 *     dormant runtime entirely). This is the guarantee that the feature
 *     ships fully inert with no sentry.io account.
 *   - `captureUiException` is a no-op while the SDK was never initialised,
 *     so the unconditional ErrorHandler forward is harmless.
 *
 * We deliberately do NOT spy on the `@sentry/angular` module: its ESM
 * exports are non-configurable in this runner, and the dormant path
 * never imports the module anyway, so the meaningful assertion is the
 * observable behaviour (resolves, does not throw, no-op). When the real
 * DSN lands, the `isUiDsnConfigured()` assertion below is the canary
 * that forces a deliberate update of this contract test.
 */

describe('sentry-init (dormant by default)', () => {
  it('reports the UI DSN as not configured while the placeholder is empty', () => {
    expect(isUiDsnConfigured()).toBe(false);
  });

  it('initUiSentry resolves to a no-op when consent is OFF (dormant)', async () => {
    await expect(
      initUiSentry({ consentEnabled: false, release: '1.2.3' }),
    ).resolves.toBeUndefined();
  });

  it('initUiSentry resolves to a no-op even when consent is ON, because the DSN is empty', async () => {
    await expect(
      initUiSentry({ consentEnabled: true, release: '1.2.3' }),
    ).resolves.toBeUndefined();
    await expect(
      initUiSentry({ consentEnabled: true, release: null }),
    ).resolves.toBeUndefined();
  });

  it('captureUiException is a no-op (does not throw) while the SDK was never initialised', () => {
    expect(() => captureUiException(new Error('boom'))).not.toThrow();
  });
});
