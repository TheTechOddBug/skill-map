/**
 * `<sm-settings-modal>` — Settings dialog chassis. Owns the fixed-size
 * `p-dialog` shell and the left-rail section navigation; sub-components
 * (`SettingsPlugins`, `SettingsComingSoon`, future siblings) own each
 * section's content.
 *
 * Adding a new section is one entry in `SETTINGS_SECTIONS` plus the
 * sub-component import below — the chassis layout stays untouched.
 *
 * The modal is `@defer`-wrapped at the App level so its full chunk
 * (Dialog + Message + ToggleSwitch + sub-components) only loads on
 * first open.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { SettingsAbout } from './settings-about';
import { SettingsChangelog } from './settings-changelog';
import { SettingsComingSoon } from './settings-coming-soon';
import { SettingsGeneral } from './settings-general';
import { SettingsPlugins } from './settings-plugins';
import { SettingsProject } from './settings-project';

export type TSettingsSection = 'plugins' | 'general' | 'project' | 'changelog' | 'about';

interface ISettingsSection {
  id: TSettingsSection;
  label: string;
  /**
   * `available` — section ships its own component (today: `plugins`).
   * `coming-soon` — placeholder; the chassis renders `SettingsComingSoon`
   * with the section label so the sidebar metaphor is honest about
   * what works and what is reserved.
   */
  status: 'available' | 'coming-soon';
}

const SETTINGS_SECTIONS: readonly ISettingsSection[] = [
  { id: 'general', label: SETTINGS_TEXTS.sections.general, status: 'available' },
  { id: 'project', label: SETTINGS_TEXTS.sections.project, status: 'available' },
  { id: 'plugins', label: SETTINGS_TEXTS.sections.plugins, status: 'available' },
  { id: 'changelog', label: SETTINGS_TEXTS.sections.changelog, status: 'available' },
  { id: 'about', label: SETTINGS_TEXTS.sections.about, status: 'available' },
] as const;

@Component({
  selector: 'sm-settings-modal',
  imports: [
    ButtonModule,
    DialogModule,
    SettingsAbout,
    SettingsChangelog,
    SettingsGeneral,
    SettingsPlugins,
    SettingsProject,
    SettingsComingSoon,
  ],
  templateUrl: './settings-modal.html',
  styleUrl: './settings-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsModal {
  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly sections = SETTINGS_SECTIONS;
  protected readonly activeSection = signal<TSettingsSection>('plugins');

  /** Per-section visibility — sub-components mount once and observe a
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

  /** Active section descriptor — drives the placeholder branch. */
  protected readonly activeDescriptor = computed(
    () => this.sections.find((s) => s.id === this.activeSection()) ?? this.sections[0],
  );

  protected onVisibleChange(next: boolean): void {
    this.visibleChange.emit(next);
  }

  protected selectSection(id: TSettingsSection): void {
    this.activeSection.set(id);
  }
}
