/**
 * `<sm-settings-project>`, Project section of the Settings modal.
 *
 * Thin chassis: heading + intro plus four self-contained children, each
 * owning its own state machine, fetch lifecycle (keyed on `visible`),
 * error surfaces, and confirm dialogs:
 *
 *   - `<sm-settings-project-lens>`: active-provider lens select + the
 *     live-activity hook install button (coupled: the hook status is
 *     keyed to the active lens).
 *   - `<sm-settings-project-capture>`: conversation-capture consent
 *     toggle.
 *   - `<sm-settings-project-preferences>`: the rows backed by the one
 *     project-preferences envelope (sidecar-writer policy, plugin-trust
 *     opt-in, reference-paths list).
 *   - `<sm-settings-project-ignore>`: `.skillmapignore` patterns.
 *
 * The split mirrors the plugins section's decomposition
 * (`settings-plugin-section.ts` and friends): five independent state
 * machines used to live inline here and every new project surface made
 * the pile deeper. The shared row CSS vocabulary lives in
 * `settings-project-rows.css`; the tiny shared helper in
 * `settings-project.utils.ts`.
 */

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { SettingsProjectCapture } from './settings-project-capture';
import { SettingsProjectIgnore } from './settings-project-ignore';
import { SettingsProjectLens } from './settings-project-lens';
import { SettingsProjectPreferences } from './settings-project-preferences';

@Component({
  selector: 'sm-settings-project',
  imports: [
    SettingsProjectCapture,
    SettingsProjectIgnore,
    SettingsProjectLens,
    SettingsProjectPreferences,
  ],
  templateUrl: './settings-project.html',
  styleUrl: './settings-project.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProject {
  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
}
