/**
 * `UsageTrackerService`, the single UI emit point for opt-in usage analytics
 * (`spec/telemetry.md` §Usage event taxonomy).
 *
 * BOOT CONTRACT: `providedIn: 'root'` and self-wires in its constructor (a
 * router `NavigationEnd` subscription). `app.config.ts` calls
 * `inject(UsageTrackerService)` once at boot solely to fire that constructor,
 * alongside `FilterUrlSyncService`. Do NOT add a lazy `init()`.
 *
 * Every emit funnels through `captureUiUsage`, which is a hard no-op until the
 * PostHog surface is active (key configured + UI usage consent on). So this
 * service is safe to wire unconditionally: while dormant it does nothing and
 * the SDK is never even fetched.
 *
 * Only the allow-listed `surface` enums leave the browser, never a node path,
 * title, query string, or any content.
 */

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';

import { captureUiUsage } from '../core/telemetry/posthog-init';

/** Feature surfaces tracked on explicit open (not route-driven). */
export type TUsageFeatureSurface = 'inspector' | 'settings';

@Injectable({ providedIn: 'root' })
export class UsageTrackerService {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        const surface = viewSurfaceFor(event.urlAfterRedirects);
        if (surface !== null) captureUiUsage('ui.view', { surface });
      }
    });
  }

  /**
   * Record opening a feature surface that is not a route (the node inspector,
   * the settings modal). No-op while the usage surface is dormant.
   */
  trackFeature(surface: TUsageFeatureSurface): void {
    captureUiUsage('ui.feature', { surface });
  }
}

/**
 * Map a router URL to its `ui.view` surface enum, or `null` when the route is
 * not tracked. Path prefix only; the query string is never read so no filter
 * state leaks.
 */
export function viewSurfaceFor(url: string): 'graph' | 'files' | null {
  const path = url.split('?')[0] ?? '';
  if (path === '/' || path.startsWith('/map')) return 'graph';
  if (path.startsWith('/files')) return 'files';
  return null;
}
