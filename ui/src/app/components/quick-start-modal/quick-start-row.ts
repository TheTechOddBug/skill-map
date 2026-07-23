/**
 * `<sm-quick-start-row>`, the presentational row shell of the Quick Start
 * modal. One uniform shape across all nine checks: a text block (label +
 * one-line description + an optional contextual hint) on the left, and on
 * the right a readiness indicator (icon + short status text) followed by
 * the projected action control.
 *
 * Purely presentational, no data source, no probes: the container
 * (`QuickStartModal`) owns every signal, computes the `status` / `statusText`,
 * and projects the action button through `<ng-content>`. That keeps the
 * per-row state machines in one place while the row markup stays a single
 * reusable brick. The row vocabulary (borders, spacing, muted text) is the
 * same one the Settings Project-section rows use
 * (`settings-project-rows.css`), copied into `quick-start-row.css` because
 * emulated encapsulation scopes each component's styles.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { TQuickStartStatus } from '../../../i18n/quick-start.texts';

@Component({
  selector: 'sm-quick-start-row',
  templateUrl: './quick-start-row.html',
  styleUrl: './quick-start-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickStartRow {
  readonly label = input.required<string>();
  readonly description = input.required<string>();
  /** Readiness state: green check / muted slash / dim question mark. */
  readonly status = input.required<TQuickStartStatus>();
  /** Short label next to the indicator icon (e.g. "On", "Installed"). */
  readonly statusText = input.required<string>();
  /** Optional contextual hint line under the description (blocked / restart guidance). */
  readonly meta = input<string | null>(null);
  /** Stable id root: the row gets it, the status span gets `<testid>-status`. */
  readonly testid = input.required<string>();

  /** Indicator glyph, one per readiness state (PrimeNG icon font). */
  protected readonly statusIcon = computed<string>(() => {
    switch (this.status()) {
      case 'ready':
        return 'pi pi-check-circle';
      case 'not-ready':
        return 'pi pi-ban';
      case 'unknown':
        return 'pi pi-question-circle';
    }
  });
}
