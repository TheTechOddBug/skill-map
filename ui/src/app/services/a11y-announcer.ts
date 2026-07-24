/**
 * `A11yAnnouncerService`, a thin wrapper over CDK's `LiveAnnouncer`.
 *
 * skill-map's async lifecycle points (scan progress, queue mutations,
 * findings fix / resolve / dismiss) update signals silently, so a
 * screen-reader user gets no feedback when a background operation
 * starts, completes, or fails (WCAG 4.1.3 Status Messages). This
 * service centralises the polite/assertive `aria-live` announcement so
 * every caller uses one region instead of scattering ad-hoc live nodes.
 *
 * Kept intentionally minimal: `announce(message, politeness?)` forwards
 * to `LiveAnnouncer.announce`. `politeness` defaults to `polite`
 * (status updates that should not interrupt); pass `assertive` for
 * errors the user must hear immediately.
 */

import { Injectable, inject } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';

@Injectable({ providedIn: 'root' })
export class A11yAnnouncerService {
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  /**
   * Announce `message` on the shared `aria-live` region. `politeness`
   * defaults to `polite`; use `assertive` for errors. Fire-and-forget:
   * the returned promise (CDK resolves it when the region clears) is
   * intentionally ignored by callers.
   */
  announce(message: string, politeness: AriaLivePoliteness = 'polite'): void {
    void this.liveAnnouncer.announce(message, politeness);
  }
}

/** Re-exported for callers that want to type the second argument. */
export type AriaLivePoliteness = 'polite' | 'assertive';
