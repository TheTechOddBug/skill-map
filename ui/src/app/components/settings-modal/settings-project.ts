/**
 * `<sm-settings-project>`, Project section of the Settings modal.
 *
 * Thin chassis: heading + intro plus seven self-contained children,
 * each owning its own state machine, fetch lifecycle (keyed on
 * `visible`), error surfaces, and confirm dialogs:
 *
 *   - `<sm-settings-project-lens>`: active-provider lens select.
 *   - `<sm-settings-project-live>`: live-updates toggle
 *     (`ui.liveUpdates` in `settings.local.json`).
 *   - `<sm-settings-project-hook>`: live-activity hook install button.
 *     The hook status is keyed to the ACTIVE lens, so the chassis
 *     threads the lens child's `activeLensId` into it (a cross-child
 *     dependency shared with the skill child below).
 *   - `<sm-settings-project-skill>`: agent drain-skill install button
 *     (Install / Update / up-to-date), the hook row's sibling install
 *     affordance, keyed to the ACTIVE lens the same way.
 *   - `<sm-settings-project-realtime>`: real-time-activity toggle
 *     (`ui.realtimeActivity`), gated by live updates AND the hook the
 *     row above installs; a separate child from the live-updates row
 *     precisely so the hook installer can sit between them.
 *   - `<sm-settings-project-capture>`: conversation-capture consent
 *     toggle.
 *   - `<sm-settings-project-preferences>`: the rows backed by the one
 *     project-preferences envelope (follow-external-symlinks opt-in,
 *     reference-paths list, sidecar-writer
 *     policy), mounted LAST so the surface-expanding toggles close
 *     the section. It also hosts the mount point of the self-contained
 *     `<sm-settings-project-ignore>` (`.skillmapignore` patterns)
 *     between its reference-paths and gitignore rows, row order
 *     only, the envelope machinery does not touch it.
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
import { SettingsProjectHook } from './settings-project-hook';
import { SettingsProjectLens } from './settings-project-lens';
import { SettingsProjectLive } from './settings-project-live';
import { SettingsProjectPreferences } from './settings-project-preferences';
import { SettingsProjectRealtime } from './settings-project-realtime';
import { SettingsProjectSkill } from './settings-project-skill';

@Component({
  selector: 'sm-settings-project',
  imports: [
    SettingsProjectCapture,
    SettingsProjectHook,
    SettingsProjectLens,
    SettingsProjectLive,
    SettingsProjectPreferences,
    SettingsProjectRealtime,
    SettingsProjectSkill,
  ],
  templateUrl: './settings-project.html',
  styleUrl: './settings-project.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProject {
  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
}
