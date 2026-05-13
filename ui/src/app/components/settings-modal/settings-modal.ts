/**
 * `<sm-settings-modal>`, Settings dialog chassis. Owns the fixed-size
 * `p-dialog` shell and the left-rail section navigation; sub-components
 * (`SettingsPlugins`, `SettingsGeneral`, future siblings) own each
 * section's content.
 *
 * Adding a new section is one entry in `SETTINGS_SECTIONS` plus the
 * sub-component import below, the chassis layout stays untouched.
 *
 * The modal is `@defer`-wrapped at the App level so its full chunk
 * (Dialog + Message + ToggleSwitch + sub-components) only loads on
 * first open.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { SettingsAbout } from './settings-about';
import { SettingsChangelog } from './settings-changelog';
import { SettingsGeneral } from './settings-general';
import { SettingsPlugins } from './settings-plugins';
import { SettingsProject } from './settings-project';

export type TSettingsSection = 'plugins' | 'general' | 'project' | 'changelog' | 'about';

interface ISettingsSection {
  id: TSettingsSection;
  label: string;
}

const SETTINGS_SECTIONS: readonly ISettingsSection[] = [
  { id: 'general', label: SETTINGS_TEXTS.sections.general },
  { id: 'project', label: SETTINGS_TEXTS.sections.project },
  { id: 'plugins', label: SETTINGS_TEXTS.sections.plugins },
  { id: 'changelog', label: SETTINGS_TEXTS.sections.changelog },
  { id: 'about', label: SETTINGS_TEXTS.sections.about },
] as const;

@Component({
  selector: 'sm-settings-modal',
  imports: [
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    SettingsAbout,
    SettingsChangelog,
    SettingsGeneral,
    SettingsPlugins,
    SettingsProject,
  ],
  providers: [ConfirmationService],
  templateUrl: './settings-modal.html',
  styleUrl: './settings-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsModal {
  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();

  private readonly confirmation = inject(ConfirmationService);
  /**
   * Live reference to the rendered `<sm-settings-plugins>` so the
   * chassis can interrogate its buffered-edit state (`dirtyIds().size`)
   * and dispatch `applyChanges()` / `discardChanges()` from the
   * close-confirm dialog. `viewChild` returns a signal; reading
   * `pluginsPanel()` after the @switch has rendered the plugins case
   * yields the instance (or `undefined` for other sections, which is
   * fine because the only intercept path runs while plugins is
   * active, other sections have no dirty buffer).
   */
  private readonly pluginsPanel = viewChild(SettingsPlugins);

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly sections = SETTINGS_SECTIONS;
  protected readonly activeSection = signal<TSettingsSection>('plugins');
  /**
   * Fixed dialog dimensions. Lifted out of the template so the literal
   * is allocated once (the inline form re-evaluated on every CD pass
   * even though the values never change).
   */
  protected readonly dialogStyle: Readonly<Record<string, string>> = {
    width: '1024px',
    height: '720px',
    maxWidth: '92vw',
    maxHeight: '90vh',
  };

  /** Per-section visibility, sub-components mount once and observe a
   * derived `visible` so they refetch when the section becomes active
   * (Plugins) and stay quiet when it is not. */
  protected readonly pluginsVisible = computed(
    () => this.visible() && this.activeSection() === 'plugins',
  );
  protected readonly generalVisible = computed(
    () => this.visible() && this.activeSection() === 'general',
  );
  protected readonly projectVisible = computed(
    () => this.visible() && this.activeSection() === 'project',
  );
  protected readonly aboutVisible = computed(
    () => this.visible() && this.activeSection() === 'about',
  );

  /**
   * Intercept p-dialog visibility transitions. Opening (next=true)
   * propagates verbatim. Closing (next=false) is gated by the plugins
   * panel's dirty buffer:
   *
   *   - 0 dirty: propagate, dialog closes.
   *   - 1+ dirty: do NOT propagate. Open the confirm dialog. The user
   *     picks Apply (apply + close), Discard (revert + close), or
   *     Keep editing (dismiss the confirm, modal stays open).
   *
   * The dialog stays visually open while the confirm is up because
   * we never emit `visibleChange(false)` until the user chooses.
   * `[visible]="visible()"` is a one-way binding from the parent's
   * `settingsOpen` signal, so suppressing the emit is sufficient.
   */
  protected onVisibleChange(next: boolean): void {
    if (next) {
      this.visibleChange.emit(true);
      return;
    }
    const panel = this.pluginsPanel();
    const dirtyCount = panel?.dirtyIds().size ?? 0;
    if (dirtyCount === 0) {
      this.visibleChange.emit(false);
      return;
    }
    this.confirmation.confirm({
      header: this.texts.confirmCloseTitle,
      message: this.texts.confirmCloseBody(dirtyCount),
      acceptLabel: this.texts.applyAndClose,
      rejectLabel: this.texts.discardChanges,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      // Keep editing, `confirmation.confirm` does not surface a
      // built-in "third action" hook, but the dialog renders an X /
      // Escape that resolves neither accept nor reject. The modal
      // simply stays open because we never propagated the close.
      accept: () => {
        // Delegate the close to the panel's `applied` output (wired in
        // `onPluginsApplied`). That way a failed apply keeps the modal
        // open with the error visible and the buffer dirty, the user
        // can read `toggleError`, fix what they can, and retry or
        // discard without being forced back into a half-closed state.
        // A successful apply still closes the modal via the same path
        // the footer Apply button uses, so both surfaces feel uniform.
        void panel?.applyChanges();
      },
      reject: () => {
        panel?.discardChanges();
        this.visibleChange.emit(false);
      },
    });
  }

  protected selectSection(id: TSettingsSection): void {
    this.activeSection.set(id);
  }

  /**
   * Bridge from `<sm-settings-plugins>`'s `applied` output to the
   * dialog's visibility: a successful apply (from the footer Apply
   * button OR the close-confirm dialog's Apply action) closes the
   * modal. Idempotent, when the confirm-dialog path already emits
   * `false` in its `accept` callback, this second emit is harmless
   * because the parent's `settingsOpen` signal is already false.
   */
  protected onPluginsApplied(): void {
    this.visibleChange.emit(false);
  }
}
