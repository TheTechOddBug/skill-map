/**
 * `GithubStarsService`, the repository star count behind the topbar
 * affordance and the Settings → About card
 * (`spec/cli-contract.md` §`GET /api/github-stars`).
 *
 * One read per app load, no polling. The number moves by single digits
 * per day, and the server already caches it for hours, so re-asking is
 * pure noise; a page reload is the refresh mechanism.
 *
 * `count()` is `null` until the read lands AND stays `null` on every
 * failure, which every consumer renders as NOTHING. That is the whole
 * error handling: skill-map runs on localhost and must work offline, so
 * a decoration that renders `0`, an error, or a spinner that never
 * resolves would turn a healthy install into one that looks broken. The
 * server collapses toggle-off / offline / rate-limited into the same
 * `null` precisely so no consumer has to branch on why.
 *
 * Lives in `app/services/` (not `services/`): it feeds app-shell
 * chrome, per the layering rule in `context/ui.md`.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { DATA_SOURCE } from '../../services/data-source/data-source.port';
import { formatCompactCount } from '../../services/format-count';

@Injectable({ providedIn: 'root' })
export class GithubStarsService {
  private readonly dataSource = inject(DATA_SOURCE);

  private readonly _count = signal<number | null>(null);

  /** Star count, or `null` when unknown. Consumers render nothing on null. */
  readonly count = this._count.asReadonly();

  /**
   * Display form, compact (`1.2K`), or `null` when unknown. The chip
   * lives in a row that already scrolls on narrow windows, so the exact
   * digits lose to the horizontal room; the accessible name and the
   * tooltip carry the full number, so nothing is actually hidden.
   */
  readonly countLabel = computed<string | null>(() => {
    const value = this._count();
    return value === null ? null : formatCompactCount(value);
  });

  /** Convenience for `@if` blocks: there is a number worth showing. */
  readonly hasCount = computed<boolean>(() => this._count() !== null);

  constructor() {
    void this.refresh();
  }

  /**
   * Read the count once. Never rejects: a transport failure resolves to
   * the same `null` an offline server reports, so a consumer can call
   * this without a catch and the UI degrades identically either way.
   */
  async refresh(): Promise<void> {
    try {
      const { count } = await this.dataSource.getGithubStars();
      this._count.set(typeof count === 'number' ? count : null);
    } catch {
      this._count.set(null);
    }
  }
}
