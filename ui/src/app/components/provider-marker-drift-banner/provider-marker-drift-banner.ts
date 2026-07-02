/**
 * `<sm-provider-marker-drift-banner>`, a centered nudge in the topbar
 * shown when the filesystem-detected provider markers diverge from the
 * project's persisted `activeProviderMarkers` snapshot (e.g. a `.claude/`
 * directory appeared after the lens was pinned to `opencode`).
 *
 * Sibling of `<sm-tutorial-reminder-banner>`: same shell-center slot,
 * same pill styling, same dismiss affordance. Visibility is derived from
 * `ProjectInfoService.markerDrift()` (fed by the shared
 * `/api/active-provider` probe) rather than an independent fetch, so:
 *
 *   - Switching the lens in Settings clears the notice for free: the App
 *     re-probes the active provider on Settings close, the BFF returns
 *     `markerDrift: null`, and this banner hides.
 *   - Dismissing reconciles the snapshot server-side
 *     (`acceptMarkerDrift` -> POST accept-markers), the refreshed
 *     envelope carries `markerDrift: null`, and the banner hides.
 *
 * "Switch lens" is delegated up via the `switchLens` output; the App
 * shell opens the Settings modal on its Project section, where the
 * existing active-lens dropdown lives (no lens-switch logic is
 * reimplemented here).
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { PROVIDER_MARKER_DRIFT_BANNER_TEXTS } from '../../../i18n/provider-marker-drift-banner.texts';
import { ProjectInfoService } from '../../services/project-info';

@Component({
  selector: 'sm-provider-marker-drift-banner',
  imports: [ButtonModule],
  templateUrl: './provider-marker-drift-banner.html',
  styleUrl: './provider-marker-drift-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProviderMarkerDriftBanner {
  private readonly projectInfo = inject(ProjectInfoService);

  protected readonly texts = PROVIDER_MARKER_DRIFT_BANNER_TEXTS;

  /**
   * Emits when the user clicks "Switch lens". The App shell wires it to
   * open the Settings modal on its Project section (the active-lens
   * dropdown). Decoupling via output keeps the banner testable without a
   * settings service in the way.
   */
  readonly switchLens = output<void>();

  /** Shown only when the last probe reported drift. */
  protected readonly visible = computed<boolean>(
    () => this.projectInfo.markerDrift() !== null,
  );

  /** The newly-appeared marker ids, comma-joined for the notice chip. */
  protected readonly addedLabel = computed<string>(() =>
    (this.projectInfo.markerDrift()?.added ?? []).join(', '),
  );

  protected onSwitchLens(): void {
    this.switchLens.emit();
  }

  /**
   * Accept the new markers: reconcile the snapshot server-side, then let
   * the refreshed envelope (`markerDrift: null`) hide the banner. On a
   * transient failure the notice stays up so the user can retry.
   */
  protected async onDismiss(): Promise<void> {
    try {
      await this.projectInfo.acceptMarkerDrift();
    } catch {
      // Best-effort: a failed accept leaves the drift state untouched,
      // so the notice remains visible for a retry. Demo mode never
      // drifts, so this path is unused there.
    }
  }
}
