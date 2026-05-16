/**
 * `<sm-settings-general>`, General section of the Settings modal.
 *
 * Today renders a single toggle (`updateCheck.enabled`); the
 * component is built around a declarative `GENERAL_TOGGLES` array so
 * a future per-machine preference (locale, theme, …) is one entry
 * plus one i18n string rather than a template / component edit.
 *
 * Lifecycle: fetch on `(visible) === true` via the data-source port,
 * reflect the value into a per-key signal, dispatch `setPreferences`
 * on change with the patched sub-key. Errors bubble through
 * dedicated load / save signals so the toast region is one
 * `<p-message>` tag rather than a manual error map.
 *
 * Mirrors the lifecycle pattern in `settings-plugins.ts` so the two
 * sections share the same shape from the chassis's point of view.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageModule } from 'primeng/message';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IPreferencesApi, IPreferencesPatchApi } from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import { ThemeService, type TExtraTheme } from '../../../services/theme';

/**
 * Declarative catalogue of toggles rendered in the General section.
 * Each entry binds:
 *   - the dot-path the BFF / settings.json knows the key by;
 *   - i18n label + description (resolved against `SETTINGS_TEXTS.general.toggles`);
 *   - getter / setter that read / project the corresponding value
 *     into the wire-shape `IPreferencesApi` and patch back via
 *     `IPreferencesPatchApi`.
 *
 * Adding a new toggle is one entry here plus one nested key in
 * `SETTINGS_TEXTS.general.toggles`. The template iterates this list
 * with `@for`, so no template change is needed.
 */
interface IGeneralToggleDef {
  /** Stable dot-path; doubles as the i18n catalog key. */
  key: 'updateCheck.enabled';
  /** Read the current value from a fetched envelope. */
  read(envelope: IPreferencesApi): boolean;
  /** Build the patch body for the new value. */
  patch(value: boolean): IPreferencesPatchApi;
}

const GENERAL_TOGGLES: ReadonlyArray<IGeneralToggleDef> = [
  {
    key: 'updateCheck.enabled',
    read: (envelope) => envelope.updateCheck.enabled,
    patch: (value) => ({ updateCheck: { enabled: value } }),
  },
];

/**
 * Extra-theme selectbutton catalog. Wire values are the string keys
 * (`none` | `matrix`) rather than `TExtraTheme` (`matrix | null`)
 * because PrimeNG's selectbutton does not bind cleanly to `null`
 * option values, the `[allowEmpty]=false` path treats null as
 * "deselected" and breaks the ngModel round-trip.
 */
type TExtraThemeOptionValue = 'none' | 'matrix';

interface IExtraThemeOption {
  value: TExtraThemeOptionValue;
  labelKey: TExtraThemeOptionValue;
}

const EXTRA_THEME_OPTIONS: IExtraThemeOption[] = [
  { value: 'none', labelKey: 'none' },
  { value: 'matrix', labelKey: 'matrix' },
];

function toExtraThemeWire(value: TExtraTheme): TExtraThemeOptionValue {
  return value === 'matrix' ? 'matrix' : 'none';
}

function fromExtraThemeWire(value: TExtraThemeOptionValue): TExtraTheme {
  return value === 'matrix' ? 'matrix' : null;
}

@Component({
  selector: 'sm-settings-general',
  imports: [FormsModule, MessageModule, SelectButtonModule, ToggleSwitchModule],
  templateUrl: './settings-general.html',
  styleUrl: './settings-general.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsGeneral {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly themeService = inject(ThemeService);

  /**
   * Section visibility. The chassis flips it true when the General
   * section becomes active AND the modal itself is visible; we
   * refresh the envelope on every transition to true so a flag
   * toggled via `sm config set -g` from another terminal surfaces
   * on the next view.
   */
  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly toggles = GENERAL_TOGGLES;
  protected readonly extraThemeOptions = EXTRA_THEME_OPTIONS;
  /**
   * Wire-shape (`'none' | 'matrix'`) projection of the extra theme.
   * Computed so the topbar toggle (which clears `extraTheme` back to
   * `null`) reflects in the selectbutton without a manual refresh.
   */
  protected readonly extraThemeWire = computed<TExtraThemeOptionValue>(() =>
    toExtraThemeWire(this.themeService.extraTheme()),
  );
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

  protected toggleLabel(key: IGeneralToggleDef['key']): string {
    return SETTINGS_TEXTS.general.toggles[key].label;
  }

  protected toggleDescription(key: IGeneralToggleDef['key']): string {
    return SETTINGS_TEXTS.general.toggles[key].description;
  }

  /**
   * Read the current value from the envelope (or `false` until the
   * first fetch resolves, the toggle visually starts at "off" and
   * snaps to its real value once the BFF responds; the parent's
   * `loading` signal disables it during that window so the user
   * never sees the wrong state in an interactive way).
   */
  protected valueOf(def: IGeneralToggleDef): boolean {
    const envelope = this.preferences();
    if (!envelope) return false;
    return def.read(envelope);
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  protected onToggle(def: IGeneralToggleDef, nextValue: boolean): void {
    void this.runToggle(def, nextValue);
  }

  /**
   * Extra-theme change handler. Mirrors `onConnectionTypeChange`: the
   * catalog is mandatory (`[allowEmpty]=false`), so a null collapse
   * from PrimeNG falls back to `'none'` rather than crashing the
   * mapping into `TExtraTheme`.
   */
  protected onExtraThemeChange(next: TExtraThemeOptionValue | null): void {
    this.themeService.setExtraTheme(fromExtraThemeWire(next ?? 'none'));
  }

  protected extraThemeLabel(key: TExtraThemeOptionValue): string {
    return SETTINGS_TEXTS.general.extraTheme.options[key].label;
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

  private async runToggle(def: IGeneralToggleDef, nextValue: boolean): Promise<void> {
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
