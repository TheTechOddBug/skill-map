/**
 * `<sm-settings-general>`, General section of the Settings modal.
 *
 * Today renders a single toggle (`updateCheck.enabled`); the
 * component is built around a declarative `GENERAL_TOGGLES` array so
 * a future user-only preference (locale, theme, …) is one entry plus
 * one i18n string rather than a template / component edit.
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
import {
  CONNECTION_TYPES,
  GraphPreferencesService,
  type TConnectionType,
} from '../../../services/graph-preferences';

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
 * Selectbutton option type for the connection-type picker. Built from
 * `CONNECTION_TYPES` so the catalog stays in lock-step with
 * `GraphPreferencesService`. Labels come from `SETTINGS_TEXTS` at
 * template time so the static array stays i18n-free.
 */
interface IConnectionTypeOption {
  value: TConnectionType;
  labelKey: TConnectionType;
}

// PrimeNG's `<p-selectbutton [options]>` types the input as `any[]` (a
// mutable array), so we expose this catalog as a plain `IConnectionTypeOption[]`
// rather than a `ReadonlyArray<...>` to avoid an Angular compiler complaint
// (`TS4104`). The list is still effectively immutable, we never mutate it.
const CONNECTION_TYPE_OPTIONS: IConnectionTypeOption[] = CONNECTION_TYPES.map(
  (value) => ({ value, labelKey: value }),
);

@Component({
  selector: 'sm-settings-general',
  imports: [FormsModule, MessageModule, SelectButtonModule, ToggleSwitchModule],
  templateUrl: './settings-general.html',
  styleUrl: './settings-general.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsGeneral {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly graphPreferences = inject(GraphPreferencesService);

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
  protected readonly connectionTypeOptions = CONNECTION_TYPE_OPTIONS;
  /** Live signal so the selectbutton reflects external changes (e.g. another tab). */
  protected readonly connectionType = this.graphPreferences.connectionType;
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
   * Connection-type change handler. Persists synchronously via
   * `GraphPreferencesService` (localStorage, no BFF round-trip), so
   * the graph view re-renders the next CD pass and the selectbutton
   * reflects the new state immediately. Defensive against PrimeNG's
   * "deselect" (null) emission, the catalog is mandatory so a null
   * collapse falls back to the default rather than crashing the
   * graph's `[fType]` binding.
   */
  protected onConnectionTypeChange(next: TConnectionType | null): void {
    if (next === null) return;
    this.graphPreferences.setConnectionType(next);
  }

  /** Resolve the displayed label for a connection-type option (`segment` → "Orthogonal"). */
  protected connectionTypeLabel(key: TConnectionType): string {
    return SETTINGS_TEXTS.general.connectionType.options[key].label;
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
