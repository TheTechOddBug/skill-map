import { describe, expect, it } from 'vitest';

import { captureUiException, initUiSentry, isUiDsnConfigured } from '../sentry-init';

/**
 * Locks the DORMANT-UNLESS-CONSENT contract (`spec/telemetry.md`). A real
 * UI DSN now ships, so dormancy is gated by consent alone:
 *   - `isUiDsnConfigured()` reports true (the DSN is configured).
 *   - `initUiSentry` is a hard no-op when consent is OFF: it returns
 *     without throwing and, crucially, never dynamic-imports the
 *     `@sentry/angular` SDK on that path (the chunk stays out of the
 *     dormant runtime entirely).
 *   - `captureUiException` is a no-op while the SDK was never initialised,
 *     so the unconditional ErrorHandler forward is harmless.
 *
 * We deliberately do NOT exercise the consent-ON path here: it would load
 * the real `@sentry/angular` SDK and call `Sentry.init` inside jsdom (a
 * side effect with global handlers). The active path is covered manually
 * against a live Sentry project, not in this unit test. We also do NOT spy
 * on the SDK module (its ESM exports are non-configurable in this runner);
 * the dormant path never imports it, so observable behaviour (resolves,
 * does not throw, no-op) is the meaningful assertion.
 */

describe('sentry-init (dormant unless consent)', () => {
  it('reports the UI DSN as configured (a real DSN ships)', () => {
    expect(isUiDsnConfigured()).toBe(true);
  });

  it('initUiSentry is a no-op when consent is OFF, even with a configured DSN (dormant)', async () => {
    await expect(
      initUiSentry({ consentEnabled: false, release: '1.2.3', environment: 'prod' }),
    ).resolves.toBeUndefined();
    await expect(
      initUiSentry({ consentEnabled: false, release: null, environment: 'dev' }),
    ).resolves.toBeUndefined();
  });

  it('captureUiException is a no-op (does not throw) while the SDK was never initialised', () => {
    expect(() => captureUiException(new Error('boom'))).not.toThrow();
  });
});
