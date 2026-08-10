/**
 * `MapViewUrlSyncService`, the `?view=<slug>` deep link for map views
 * (`spec/map-views.md`; sibling of `FilterUrlSyncService`, same
 * self-bootstrapping shape).
 *
 * Boot contract (URL wins over localStorage):
 *
 *   1. Read `?view=` once at construction. When the param OR a stored
 *      active slug exists, trigger the lazy `loadViews()` and resolve
 *      once the list lands: a KNOWN param slug differing from the
 *      restored selection applies that view (a deep link is an explicit
 *      apply gesture, so no dirty gate at boot); a param equal to the
 *      restored slug keeps the restored state (unsaved local curation
 *      survives, see `MapViewsService`); an UNKNOWN slug is ignored
 *      silently (no error, the restored / neutral state stands).
 *   2. After boot resolution, every `activeSlug` change writes / removes
 *      the param (`replaceUrl`, merge) so a share-link always names the
 *      active view. The write-back stays parked until resolution so a
 *      stale stored slug can never clobber a deep link mid-boot.
 *
 * Deliberately BOOT-ONLY on the read side: a later in-session URL edit
 * does not re-apply (view switching mid-session belongs to the
 * switcher, where the dirty gate lives). Demo mode is fully inert, the
 * feature is hidden there.
 *
 * BOOT CONTRACT: `app.config.ts` calls `inject(MapViewUrlSyncService)`
 * in a `provideAppInitializer` block solely to fire this constructor,
 * same as `FilterUrlSyncService`. Do NOT refactor to a lazy `init()`
 * without rewriting that block.
 */

import { Injectable, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { MapViewsService } from '../../services/map-views';

const PARAM_VIEW = 'view';

@Injectable({ providedIn: 'root' })
export class MapViewUrlSyncService {
  private readonly mapViews = inject(MapViewsService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  /** Parks the write-back until the boot read resolved (see class doc). */
  private bootResolved = false;

  constructor() {
    if (!this.mapViews.available()) return;

    const initialParam = this.currentParam();
    if (initialParam !== null || this.mapViews.activeSlug() !== null) {
      void this.mapViews.loadViews().then(() => this.resolveBoot(initialParam));
    } else {
      this.bootResolved = true;
    }

    // Selection -> URL. Reads only `activeSlug`; the guard flag is
    // plain state, so the boot flip does not re-fire the effect (the
    // one write it would have produced happens in `resolveBoot`).
    effect(() => {
      const slug = this.mapViews.activeSlug();
      untracked(() => {
        if (this.bootResolved) this.writeParam(slug);
      });
    });
  }

  private resolveBoot(param: string | null): void {
    if (
      param !== null &&
      param !== this.mapViews.activeSlug() &&
      this.mapViews.views().some((entry) => entry.slug === param)
    ) {
      this.mapViews.apply(param);
    }
    this.bootResolved = true;
    this.writeParam(this.mapViews.activeSlug());
  }

  /**
   * Read the current `?view=` value from the router's serialized URL
   * (consistent with router state in test harnesses, same rationale as
   * `FilterUrlSyncService.currentParams`).
   */
  private currentParam(): string | null {
    const tree = this.router.parseUrl(this.router.url);
    const value = tree.queryParams[PARAM_VIEW];
    if (Array.isArray(value)) return value[0] ?? null;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private writeParam(slug: string | null): void {
    if (this.currentParam() === slug) return;
    void this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: { [PARAM_VIEW]: slug },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
