/**
 * `<sm-settings-project-lens>`, active-provider lens row of the
 * Settings > Project section.
 *
 * The live-activity hook row (whose status is keyed to the ACTIVE
 * lens) lives in the sibling `<sm-settings-project-hook>`; the chassis
 * feeds it this child's resolved lens through the public
 * `activeLensId` computed, so a section open or a confirmed lens
 * switch re-probes the hook without the two rows sharing a component
 * (they are ordered independently in the section).
 *
 * Lifecycle mirrors the sibling children: fetch on `(visible) === true`,
 * render, dispatch via the data-source port. Owns its own
 * `ConfirmationService` + `<p-confirmdialog>` (lens-switch warning).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageModule } from 'primeng/message';
import { Select, SelectModule } from 'primeng/select';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IActiveProviderApi } from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { ProviderRegistryService } from '../../../services/provider-registry';
import { ActivityReadinessService } from '../../services/activity-readiness';
import { UsageTrackerService } from '../../services/usage-tracker';
import { formatErr } from './settings-project.utils';

@Component({
  selector: 'sm-settings-project-lens',
  imports: [FormsModule, ConfirmDialogModule, MessageModule, SelectModule],
  providers: [ConfirmationService],
  templateUrl: './settings-project-lens.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectLens {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);
  private readonly providerRegistry = inject(ProviderRegistryService);
  private readonly activityReadiness = inject(ActivityReadinessService);
  private readonly usageTracker = inject(UsageTrackerService);

  readonly visible = input.required<boolean>();

  /**
   * The active-provider `<p-select>`. Held so we can force its overlay
   * shut when the section / dialog closes: the panel renders with
   * `appendTo="body"`, so it lives OUTSIDE the dialog DOM and the modal
   * hiding (the chassis keeps its content mounted, it does not destroy it)
   * would otherwise leave the open dropdown orphaned on `<body>`.
   */
  private readonly providerSelect = viewChild(Select);

  protected readonly texts = SETTINGS_TEXTS;

  // ---- active-provider state -------------------------------------------
  protected readonly activeProviderEnvelope = signal<IActiveProviderApi | null>(null);
  protected readonly activeProviderLoadError = signal<string | null>(null);
  protected readonly activeProviderSaveError = signal<string | null>(null);
  protected readonly activeProviderSwitchAnnouncement = signal<string | null>(null);

  /**
   * Options consumed by `<p-select>`. Only LENS Providers (`isLens:
   * true`) are listed: the non-gated `markdown` base is the universal
   * substrate, not a pickable lens, so it is filtered out entirely
   * (never even a greyed row). Among the lenses, each one absent from
   * the envelope's `selectable` set (the ids enabled right now) is
   * rendered disabled: greyed and not selectable (`optionDisabled` in
   * the template) plus a "(disabled)" suffix, so it stays visible but
   * can never be chosen. This covers both operator-disabled lenses and
   * the experimental ones that ship disabled by default. Before the
   * envelope loads (`selectable === null`) nothing is greyed, to avoid
   * a flash of all-disabled rows.
   */
  protected readonly providerOptions = computed<
    { id: string; label: string; disabled: boolean }[]
  >(() => {
    const env = this.activeProviderEnvelope();
    const selectable = env ? new Set(env.selectable) : null;
    const providers = this.providerRegistry
      .providers()
      // Only lenses are pickable. The non-gated `markdown` base (`isLens:
      // false`) is the substrate beneath every lens, never a dropdown row.
      .filter((p) => p.isLens)
      .map((p) => {
        const disabled = selectable !== null && !selectable.has(p.id);
        const label = disabled
          ? `${p.label} ${SETTINGS_TEXTS.project.activeProviderDisabledSuffix}`
          : p.label;
        return { id: p.id, label, disabled };
      })
      // Enabled providers first, disabled ones sink to the bottom.
      // Array.sort is stable, so relative registry order holds within each group.
      .sort((a, b) => Number(a.disabled) - Number(b.disabled));
    return providers;
  });

  /** Current resolved value (from config or autodetect); `''` for "none". */
  protected readonly activeProviderValue = computed<string>(() => {
    return this.activeProviderEnvelope()?.activeProvider ?? '';
  });

  /**
   * PUBLIC projection of the resolved lens for the chassis, which
   * feeds it to `<sm-settings-project-hook>` (the hook status is keyed
   * to the active lens). `null` until the envelope loads so the hook
   * child can tell "not loaded yet" from "none" (`''`).
   */
  readonly activeLensId = computed<string | null>(() => {
    const env = this.activeProviderEnvelope();
    return env === null ? null : env.activeProvider;
  });

  /**
   * View state the `<p-select>` binds to: tracks the committed value,
   * set optimistically on change, explicitly reset when the switch does
   * not land (dialog dismissed, POST failed) so the dropdown rolls
   * back. Re-emitting an unchanged envelope cannot do that: the value
   * computed stays equal, so it never notifies the binding.
   */
  protected readonly activeProviderView = linkedSignal(() =>
    this.activeProviderValue(),
  );

  /** Comma-separated list of detected provider ids. Empty when none. */
  protected readonly activeProviderDetectedLabel = computed<string>(() => {
    return (this.activeProviderEnvelope()?.detected ?? []).join(', ');
  });

  /** Which source the persisted value came from. */
  protected readonly activeProviderSource = computed<IActiveProviderApi['source']>(() => {
    return this.activeProviderEnvelope()?.source ?? 'default';
  });

  constructor() {
    effect(() => {
      if (this.visible()) void this.refreshActiveProvider();
    });

    // Close the provider dropdown when the section / dialog closes. The
    // panel is `appendTo="body"` so it outlives a still-mounted trigger;
    // without this an open dropdown orphans on `<body>` after the modal
    // hides. `hide()` is a no-op when the overlay is already closed.
    effect(() => {
      if (!this.visible()) this.providerSelect()?.hide();
    });
  }

  // -----------------------------------------------------------------
  // Active-provider handlers
  // -----------------------------------------------------------------

  /**
   * Triggered by the `<p-select>`'s change. Opens the confirm dialog
   * because switching the lens is destructive of the scan_* DB zone
   * (see spec/architecture.md §Active Provider Lens). On accept, calls
   * the data-source; on reject, resets the view signal to the
   * committed value so the dropdown rolls back.
   */
  protected onActiveProviderChange(newValue: string): void {
    if (newValue === this.activeProviderValue()) return;
    this.activeProviderView.set(newValue);
    this.confirmActiveProviderSwitch(newValue, async () => {
      await this.runActiveProviderSwitch(newValue);
    });
  }

  // -----------------------------------------------------------------
  // Refresh + dispatch helpers
  // -----------------------------------------------------------------

  /** Fetch the active-provider envelope. */
  private async refreshActiveProvider(): Promise<void> {
    this.activeProviderLoadError.set(null);
    this.activeProviderSaveError.set(null);
    try {
      const envelope = await this.dataSource.getActiveProvider();
      this.activeProviderEnvelope.set(envelope);
    } catch (err) {
      this.activeProviderLoadError.set(formatErr(err));
      this.activeProviderEnvelope.set(null);
    }
  }

  /**
   * Persist the lens switch, then announce the NEW lens by its
   * registry label. Errors land in `activeProviderSaveError` and the
   * dropdown reverts to the prior envelope value (the user sees their
   * action did not take effect).
   */
  private async runActiveProviderSwitch(newValue: string): Promise<void> {
    // Usage analytics (opt-in, default OFF): the CONFIRMED switch counts
    // (this method only runs on the dialog accept); the tracker collapses
    // third-party ids and attaches the cross-event `lens` property.
    this.usageTracker.trackLensSelect(newValue, 'settings');
    this.activeProviderSaveError.set(null);
    this.activeProviderSwitchAnnouncement.set(null);
    try {
      const envelope = await this.dataSource.setActiveProvider(newValue);
      this.activeProviderEnvelope.set({
        activeProvider: envelope.activeProvider,
        detected: envelope.detected,
        source: envelope.source,
        selectable: envelope.selectable,
        markerDrift: envelope.markerDrift,
      });
      const entry = this.providerRegistry
        .providers()
        .find((p) => p.id === envelope.activeProvider);
      this.activeProviderSwitchAnnouncement.set(
        this.texts.project.activeProviderSwitched(entry?.label ?? envelope.activeProvider),
      );
      // Lens-conditioned surfaces elsewhere in the section (the hook
      // row probes itself; the capture row's shell-unlock copy reads
      // the shared readiness probe) follow the NEW lens immediately.
      void this.activityReadiness.refresh();
    } catch (err) {
      this.activeProviderSaveError.set(formatErr(err));
      this.activeProviderView.set(this.activeProviderValue());
    }
  }

  private confirmActiveProviderSwitch(_newValue: string, onAccept: () => Promise<void>): void {
    this.confirmation.confirm({
      header: this.texts.project.activeProviderConfirmHeader,
      message: this.texts.project.activeProviderConfirmIntro,
      acceptLabel: this.texts.project.activeProviderConfirmAccept,
      rejectLabel: this.texts.project.activeProviderConfirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void onAccept();
      },
      reject: () => {
        this.activeProviderView.set(this.activeProviderValue());
      },
    });
  }
}
