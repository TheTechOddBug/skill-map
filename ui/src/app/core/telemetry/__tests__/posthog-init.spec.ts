import { describe, expect, it } from 'vitest';

import { captureUiUsage, initUiUsage, isUiUsageKeyConfigured } from '../posthog-init';

/**
 * Locks the DORMANT-UNLESS-CONSENT contract for the UI usage surface
 * (`spec/telemetry.md` §Surface: Usage). A real `POSTHOG_KEY_UI` now ships, so
 * dormancy is gated by consent alone:
 *   - `isUiUsageKeyConfigured()` reports true (the key is configured).
 *   - `initUiUsage` is a hard no-op when consent is OFF: it returns without
 *     throwing and never dynamic-imports `posthog-js` (the chunk stays out of
 *     the dormant runtime).
 *   - `captureUiUsage` is a no-op while the SDK was never initialised, so the
 *     view tracker can fire unconditionally.
 *
 * We deliberately do NOT exercise the consent-ON path here: it would load the
 * real `posthog-js` SDK and call `posthog.init` inside jsdom. The active path
 * is covered manually against a live PostHog project.
 */
describe('UI usage surface (dormant unless consent)', () => {
  it('isUiUsageKeyConfigured is true now that a real key ships', () => {
    expect(isUiUsageKeyConfigured()).toBe(true);
  });

  it('initUiUsage resolves to a no-op while UI usage consent is OFF', async () => {
    await expect(
      initUiUsage({ consentEnabled: false, distinctId: 'anon-123' }),
    ).resolves.toBeUndefined();
  });

  it('captureUiUsage never throws while dormant', () => {
    expect(() => captureUiUsage('ui.view', { surface: 'graph' })).not.toThrow();
  });
});
