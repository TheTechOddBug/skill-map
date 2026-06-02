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
 * Only allow-listed view / feature names and the active theme leave the
 * browser, never a node path, title, query string, or any content.
 */

import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';

import { captureUiUsage, registerUsageSuperProps } from '../core/telemetry/posthog-init';
import { ThemeService } from '../../services/theme';

/** Feature surfaces tracked on explicit open (not route-driven). */
export type TUsageFeatureSurface = 'inspector' | 'settings';

@Injectable({ providedIn: 'root' })
export class UsageTrackerService {
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        const view = viewNameFor(event.urlAfterRedirects);
        if (view !== null) captureUiUsage(`ui.view.${view}`);
      }
    });
    // Keep the active theme as a PostHog super-property so any metric can be
    // broken down by it. Re-fires on every theme change; a no-op while
    // dormant (the boot value is re-registered after init, see app.config).
    effect(() => this.syncTheme());
  }

  /**
   * Record opening a feature surface that is not a route (the node inspector,
   * the settings modal) as `ui.feature.<feature>`. No-op while the usage
   * surface is dormant.
   */
  trackFeature(surface: TUsageFeatureSurface): void {
    captureUiUsage(`ui.feature.${surface}`);
  }

  /**
   * Push the current theme as super-properties: `theme_base` (the resolved
   * light / dark) and `theme_extra` (the active extra theme id, or `none`).
   * Called by the theme effect on change, and once from app boot after the SDK
   * activates so the initial theme is captured. No-op while dormant.
   */
  syncTheme(): void {
    registerUsageSuperProps({
      theme_base: this.theme.resolved(),
      theme_extra: this.theme.extraTheme() ?? 'none',
    });
  }
}

/**
 * Map a router URL to its `ui.view.<view>` name suffix (`workspace`), or
 * `null` when the route is not tracked. The suffix is a closed set from the
 * route table, never user input, so the PostHog event catalog stays bounded.
 * Path prefix only; the query string is never read so no filter state leaks.
 */
export function viewNameFor(url: string): 'workspace' | null {
  const path = url.split('?')[0] ?? '';
  if (path === '/') return 'workspace';
  return null;
}
