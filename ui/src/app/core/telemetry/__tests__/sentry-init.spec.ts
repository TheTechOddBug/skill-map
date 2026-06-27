import { describe, expect, it } from 'vitest';

import {
  buildUiIntegrations,
  captureUiException,
  initUiSentry,
  isUiDsnConfigured,
  type UiIntegration,
} from '../sentry-init';

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

/**
 * Locks the privacy posture of the integration set independently of the
 * consent-ON init path (which the suite above deliberately never runs).
 * `buildUiIntegrations` is pure, so we drive it with fake defaults and a
 * fake breadcrumbs factory, no SDK load, no `Sentry.init`.
 */
describe('buildUiIntegrations (privacy posture)', () => {
  const make = (name: string): UiIntegration => ({ name }) as UiIntegration;

  it('drops the BrowserSession integration so no release-health beacon is sent', () => {
    const out = buildUiIntegrations(
      () => make('Breadcrumbs'),
      [make('BrowserSession'), make('Breadcrumbs'), make('GlobalHandlers')],
    );
    expect(out.some((i) => i.name === 'BrowserSession')).toBe(false);
    expect(out.some((i) => i.name === 'GlobalHandlers')).toBe(true);
  });

  it('reconfigures Breadcrumbs to disable console/fetch/xhr/dom (the path/url-bearing sources)', () => {
    let captured: unknown = null;
    const out = buildUiIntegrations(
      (options) => {
        captured = options;
        return make('Breadcrumbs');
      },
      [make('Breadcrumbs')],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('Breadcrumbs');
    expect(captured).toEqual({ console: false, fetch: false, xhr: false, dom: false });
  });

  it('passes every other default integration through untouched', () => {
    const out = buildUiIntegrations(
      () => make('Breadcrumbs'),
      [make('GlobalHandlers'), make('LinkedErrors'), make('HttpContext')],
    );
    expect(out.map((i) => i.name)).toEqual(['GlobalHandlers', 'LinkedErrors', 'HttpContext']);
  });
});
