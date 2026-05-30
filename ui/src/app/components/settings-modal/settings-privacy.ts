/**
 * `<sm-settings-privacy>`, Privacy section of the Settings modal.
 *
 * Renders a single toggle (`telemetry.errorsEnabled`, opt-in anonymous
 * error reporting per `spec/telemetry.md`). Built around a declarative
 * `PRIVACY_TOGGLES` array so a future privacy preference is one entry
 * plus one i18n string rather than a template / component edit, mirroring
 * the `settings-general` pattern exactly.
 *
 * The toggle persists the operator's choice to `~/.skill-map/settings.json`
 * via `PATCH /api/preferences` even though the telemetry surface is
 * DORMANT today (the UI Sentry DSN placeholder is empty, so nothing is
 * ever initialised or sent). Recording the choice now means error capture
 * starts honouring it the moment a real DSN lands, with no migration.
 *
 * Lifecycle: fetch on `(visible) === true` via the data-source port,
 * reflect the value into a per-key signal, dispatch `setPreferences` on
 * change with the patched sub-key. Errors bubble through dedicated load /
 * save signals.
 */

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IPreferencesApi, IPreferencesPatchApi } from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';

/**
 * Declarative catalogue of toggles rendered in the Privacy section.
 * Each entry binds the dot-path the BFF / settings.json knows the key
 * by (doubles as the i18n catalog key) plus a getter / setter that
 * read / project the value into the wire-shape `IPreferencesApi` and
 * patch back via `IPreferencesPatchApi`.
 */
interface IPrivacyToggleDef {
  /** Stable dot-path; doubles as the i18n catalog key. */
  key: 'telemetry.errorsEnabled';
  /** Read the current value from a fetched envelope. */
  read(envelope: IPreferencesApi): boolean;
  /** Build the patch body for the new value. */
  patch(value: boolean): IPreferencesPatchApi;
}

const PRIVACY_TOGGLES: ReadonlyArray<IPrivacyToggleDef> = [
  {
    key: 'telemetry.errorsEnabled',
    read: (envelope) => envelope.telemetry.errorsEnabled,
    patch: (value) => ({ telemetry: { errorsEnabled: value } }),
  },
];

@Component({
  selector: 'sm-settings-privacy',
  imports: [FormsModule, MessageModule, ToggleSwitchModule],
  templateUrl: './settings-privacy.html',
  styleUrl: './settings-privacy.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPrivacy {
  private readonly dataSource = inject(DATA_SOURCE);

  /**
   * Section visibility. The chassis flips it true when the Privacy
   * section becomes active AND the modal itself is visible; we refresh
   * the envelope on every transition to true so a flag toggled from
   * another surface surfaces on the next view.
   */
  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly toggles = PRIVACY_TOGGLES;
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  /** Current envelope. `null` until the first fetch resolves. */
  protected readonly preferences = signal<IPreferencesApi | null>(null);
  /** Pending toggle keys, disable the switch so a double-click doesn't
   *  fire two PATCHes. */
  protected readonly pending = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      if (this.visible()) void this.refresh();
    });
  }

  protected toggleLabel(key: IPrivacyToggleDef['key']): string {
    return SETTINGS_TEXTS.privacy.toggles[key].label;
  }

  protected toggleDescription(key: IPrivacyToggleDef['key']): string {
    return SETTINGS_TEXTS.privacy.toggles[key].description;
  }

  /**
   * Read the current value from the envelope (or `false` until the
   * first fetch resolves; the parent's `loading` signal disables the
   * toggle during that window so the user never sees the wrong state
   * in an interactive way).
   */
  protected valueOf(def: IPrivacyToggleDef): boolean {
    const envelope = this.preferences();
    if (!envelope) return false;
    return def.read(envelope);
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  protected onToggle(def: IPrivacyToggleDef, nextValue: boolean): void {
    void this.runToggle(def, nextValue);
  }

  /** Fetch (or re-fetch) the envelope. Errors surface in `loadError`. */
  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);
    try {
      const envelope = await this.dataSource.getPreferences();
      this.preferences.set(envelope);
    } catch (err) {
      this.loadError.set(formatErr(err));
      this.preferences.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async runToggle(def: IPrivacyToggleDef, nextValue: boolean): Promise<void> {
    if (this.pending().has(def.key)) return;
    const next = new Set(this.pending());
    next.add(def.key);
    this.pending.set(next);
    this.saveError.set(null);
    try {
      const envelope = await this.dataSource.setPreferences(def.patch(nextValue));
      this.preferences.set(envelope);
    } catch (err) {
      this.saveError.set(formatErr(err));
    } finally {
      const after = new Set(this.pending());
      after.delete(def.key);
      this.pending.set(after);
    }
  }
}

function formatErr(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
