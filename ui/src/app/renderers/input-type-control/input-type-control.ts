/**
 * `<sm-input-type-control>`, a reusable form control that renders the
 * PrimeNG widget matching an input-type descriptor and reports the
 * collected value back through a two-way `value` model.
 *
 * Two consumers:
 *   - the parametrized-action prompt flow (Pasos 2-3): a `prompt`
 *     payload names an `inputType` + `paramKey`; the action dialog hosts
 *     this control to gather the value before dispatching.
 *   - the Settings → Plugins per-extension settings form: one control
 *     per declared setting, seeded from the resolved effective value.
 *
 * Catalog coverage (closed catalog in `spec/input-types.md`): all TWELVE
 * types render a real control, no read-only fallback.
 *
 *   - `single-string`   -> `<input pInputText>`               value: string
 *   - `integer`         -> `<p-inputnumber>` (whole)          value: number
 *   - `number`          -> `<p-inputnumber mode="decimal">`   value: number
 *   - `boolean-flag`    -> `<p-toggleswitch>`                 value: boolean
 *   - `enum-pick`       -> `<p-select>` over `options`        value: string
 *   - `enum-multipick`  -> `<p-multiselect>` over `options`   value: string[]
 *   - `string-list`     -> `<p-autocomplete multiple>`        value: string[]
 *   - `path-glob`       -> text input OR tag input (`multiple`) value: string | string[]
 *   - `regex`           -> `<input pInputText>` + flags suffix value: string
 *   - `secret`          -> `<p-password>` + set/empty hint     value: string
 *   - `key-value-list`  -> small editable rows table           value: { key, value }[]
 *   - `match-list`      -> kind select + input + removable rows value: { type, value }[]
 *
 * On `match-list`: the pending entry validates INLINE before it can be
 * added (an uncompilable regex or a control character never reaches the
 * two-way `value`, and therefore never reaches the network), mirroring
 * the write-time gate the resolver applies server-side. Rows are
 * removal-only; editing an entry is remove + re-add.
 *
 * On the tag inputs (`string-list`, multiple `path-glob`):
 * `spec/input-types.md` names `<p-chips>` as the canonical tag input, but
 * PrimeNG 21 (the pinned 21.1.6) retired the standalone Chips component
 * and folded tag-input into AutoComplete via `[multiple]="true"
 * [typeahead]="false"`. That is the official PrimeNG 21 replacement
 * (Enter adds the trimmed input as a tag, with built-in dedup) and the
 * `[(ngModel)]` value is a `string[]`, exactly the contract the spec
 * promises. Wiring the actually-installed component (not a removed one)
 * is the no-hack path.
 *
 * For `secret`: the current value is NEVER received (the BFF strips it),
 * so the field opens blank. Leaving it blank means "do not change"; a
 * typed value means "set". The descriptor's `secretIsSet` drives the
 * "Set" / "Empty" hint and the placeholder.
 *
 * LINT (renderer attr-sanitization, see context/ui.md / view-slots.md):
 * no `[innerHTML]` / `[style]` / `[src]` / `[href]` is bound from
 * descriptor data. The label is interpolated, option labels are
 * interpolated by the PrimeNG widgets, the value rides `[(ngModel)]`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import type {
  ISettingEnumOptionApi,
  ISettingKeyValueEntryApi,
  ISettingMatchEntryApi,
} from '../../../models/api';
import { INPUT_TYPE_CONTROL_TEXTS } from '../../../i18n/input-type-control.texts';

/** A single choice for the `enum-pick` / `enum-multipick` widgets. */
export type IInputTypeOption = ISettingEnumOptionApi;

/** A single `{ key, value }` row for the `key-value-list` widget. */
export type IInputTypeKeyValueEntry = ISettingKeyValueEntryApi;

/** A single `{ type, value }` entry for the `match-list` widget. */
export type IInputTypeMatchEntry = ISettingMatchEntryApi;

/** The three match kinds a `match-list` entry can declare. */
const MATCH_KINDS: ReadonlySet<string> = new Set(['literal', 'regex', 'glob']);

/**
 * Single line, no ASCII control / DEL characters. Mirrors the kernel
 * resolver's `validateMatchList` gate so a value that would be rejected
 * at write time is surfaced in the input instead, before any network
 * round-trip (same pattern as the `.skillmapignore` row).
 */
// eslint-disable-next-line no-control-regex
const MATCH_CONTROL_CHAR_RX = /[\n\r\x00-\x1F\x7F]/;

/**
 * Mirror of the kernel resolver's `MATCH_ENTRY_VALUE_CAP`
 * (`src/core/config/plugin-settings.ts`) and the schema's
 * `maxLength: 256`. Enforced inline like the other entry gates: the
 * settings Apply is an all-or-nothing bulk PATCH, so an oversize entry
 * that slipped past Add would reject the operator's ENTIRE batch with a
 * kernel-voice footer error instead of this field-level message.
 */
const MATCH_VALUE_CAP = 256;

/**
 * The subset of a setting declaration this control needs to render: the
 * input-type id, the field label, and the per-type parameters
 * (`options`, numeric bounds, `multiple`, regex `flags`, key/value
 * column labels). `paramKey` / `settingId` are the caller's concern, not
 * the control's.
 *
 * `defaultValue` is the optional pre-filled value the host seeds the
 * control with before it mounts (the host writes the two-way `value`
 * directly, so this field is informational only).
 */
export interface IInputTypeDescriptor {
  inputType: string;
  label: string;
  /** Choices for `enum-pick` / `enum-multipick`. */
  options?: IInputTypeOption[];
  /** Numeric bounds + spinner step for `integer` / `number`. */
  min?: number;
  max?: number;
  step?: number;
  /** `path-glob`: when true the value is a `string[]` (tag input). */
  multiple?: boolean;
  /** `regex`: flags shown as a static, non-editable suffix. */
  flags?: string;
  /** `key-value-list`: per-column header labels. */
  keyLabel?: string;
  valueLabel?: string;
  /** `secret`: whether a stored value already exists (drives the hint). */
  secretIsSet?: boolean;
  defaultValue?: TInputTypeValue;
  /**
   * `string-list`: optional typeahead vocabulary the host seeds (e.g. the
   * tags already present in the graph). When non-empty the autocomplete
   * switches from a pure free-text chips input to a suggesting one (still
   * free-text: a value not in the list is committed verbatim). Host-seeded
   * and runtime-only, like `defaultValue`; not a manifest-declared field.
   */
  suggestions?: string[];
  /**
   * Optional badge rendered after the label (e.g. the Settings panels'
   * 👥 "shared with your team" marker on values persisted in the
   * committed project layer). Host-seeded presentation data, like
   * `suggestions`; the control carries no storage semantics of its own.
   * `badgeTooltip` doubles as the hover title and the screen-reader
   * text.
   */
  badge?: string;
  badgeTooltip?: string;
  /**
   * Optional host-provided uniqueness seed for the control's DOM id
   * (e.g. the Settings plugin section passes `<extensionKey>-<declId>`).
   * Without it the id falls back to type+label, which is only safe when
   * the host renders a single control (the action-prompt dialog) or can
   * guarantee label uniqueness.
   */
  idSeed?: string;
}

/** Value shapes the control can hold across the twelve input-types. */
export type TInputTypeValue =
  | string
  | string[]
  | boolean
  | number
  | IInputTypeKeyValueEntry[]
  | IInputTypeMatchEntry[];

/**
 * Density of the rendered PrimeNG widgets. `'normal'` (default) leaves
 * the controls at their standard size, used by the action-prompt dialog.
 * `'small'` applies PrimeNG's official small sizing so the Settings
 * plugin section's controls match the modal's compact density. Only the
 * Settings host passes `'small'`, the action-prompt stays unchanged.
 */
export type TInputTypeSize = 'normal' | 'small';

/** The `size` value PrimeNG widgets accept: `undefined` at normal
 *  density, `'small'` when compacted. */
type TPrimeNgSize = 'small' | undefined;

@Component({
  selector: 'sm-input-type-control',
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    MultiSelectModule,
    AutoCompleteModule,
    PasswordModule,
    ToggleSwitchModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './input-type-control.html',
  styleUrl: './input-type-control.css',
})
export class InputTypeControl {
  protected readonly texts = INPUT_TYPE_CONTROL_TEXTS;

  /** The input-type + label (+ per-type params) to render. */
  readonly descriptor = input.required<IInputTypeDescriptor>();

  /**
   * Widget density. Defaults to `'normal'`; the Settings plugin section
   * passes `'small'` to match the modal's compact controls. The
   * action-prompt dialog leaves the default so its prompt stays full
   * size. Mapped to PrimeNG's `size` / `pSize` props via `pngSize`.
   */
  readonly size = input<TInputTypeSize>('normal');

  /**
   * Two-way bound collected value. Callers read it via `[(value)]` or
   * the `valueChange` output. The value shape matches the input-type's
   * spec runtime type (string / string[] / boolean / number /
   * key-value rows).
   */
  readonly value = model<TInputTypeValue>('');

  protected readonly inputType = computed(() => this.descriptor().inputType);
  protected readonly label = computed(() => this.descriptor().label);
  protected readonly badge = computed(() => this.descriptor().badge ?? '');
  protected readonly badgeTooltip = computed(() => this.descriptor().badgeTooltip ?? '');
  protected readonly options = computed<IInputTypeOption[]>(
    () => this.descriptor().options ?? [],
  );
  protected readonly min = computed(() => this.descriptor().min);
  protected readonly max = computed(() => this.descriptor().max);
  protected readonly step = computed(() => this.descriptor().step ?? 1);
  protected readonly multiple = computed(() => this.descriptor().multiple === true);
  protected readonly flags = computed(() => this.descriptor().flags ?? '');
  protected readonly keyLabel = computed(
    () => this.descriptor().keyLabel ?? this.texts.keyValueKeyDefault,
  );
  protected readonly valueLabel = computed(
    () => this.descriptor().valueLabel ?? this.texts.keyValueValueDefault,
  );
  protected readonly secretIsSet = computed(() => this.descriptor().secretIsSet === true);

  /**
   * The value bound to each PrimeNG widget's `size` / `pSize` prop:
   * `'small'` when the host requested compact density, `undefined`
   * otherwise (PrimeNG reads `undefined` as its default size). Binding
   * `undefined` rather than omitting the prop keeps a single template
   * shape for both densities.
   */
  protected readonly pngSize = computed<TPrimeNgSize>(() =>
    this.size() === 'small' ? 'small' : undefined,
  );

  /**
   * Stable id linking the `<label>` to the rendered widget. Prefers the
   * host-provided `idSeed` (unique per setting): two extensions in one
   * settings section can legally declare same-type, same-label settings,
   * and a type+label id would then collide (label clicks and AT target
   * the first widget). The type+label fallback covers hosts that pass no
   * seed (the action-prompt dialog renders one control at a time).
   */
  protected readonly fieldId = computed(() => {
    const seed = this.descriptor().idSeed ?? `${this.inputType()}-${this.label()}`;
    return `itc-${seed.replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase()}`;
  });

  /** Scalar projection of the value for the string / select / password widgets. */
  protected readonly stringValue = computed<string>(() => {
    const v = this.value();
    return typeof v === 'string' ? v : '';
  });

  /** Array projection of the value for the tag-input / multiselect widgets. */
  protected readonly listValue = computed<string[]>(() => {
    const v = this.value();
    return Array.isArray(v) ? (v.filter((e) => typeof e === 'string') as string[]) : [];
  });

  /** `string-list`: true when the host seeded a suggestion vocabulary. */
  protected readonly hasSuggestions = computed<boolean>(
    () => (this.descriptor().suggestions?.length ?? 0) > 0,
  );

  /**
   * The seeded `string-list` vocabulary minus the values already selected,
   * rendered as a click-to-add palette below the chips input. PrimeNG's
   * AutoComplete only commits typed text on Enter when `typeahead` is OFF
   * (the `onEnterKey` handler gates the add behind `!typeahead`), so we keep
   * the input a pure chips field (Enter / blur add a brand-new value, never
   * blocked) and surface the suggestions as a palette instead of a typeahead
   * dropdown. Clicking a palette entry appends it via `addSuggestion`.
   */
  protected readonly unselectedSuggestions = computed<string[]>(() => {
    const all = this.descriptor().suggestions ?? [];
    const selected = new Set(this.listValue());
    return all.filter((s) => !selected.has(s));
  });

  /** Numeric projection for the inputnumber widgets. `null` clears it. */
  protected readonly numberValue = computed<number | null>(() => {
    const v = this.value();
    return typeof v === 'number' ? v : null;
  });

  /** Boolean projection for the toggle widget. */
  protected readonly booleanValue = computed<boolean>(() => this.value() === true);

  /** Key-value rows projection for the editable table. */
  protected readonly keyValueRows = computed<IInputTypeKeyValueEntry[]>(() => {
    const v = this.value();
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is IInputTypeKeyValueEntry =>
        typeof e === 'object' && e !== null && 'key' in e && 'value' in e,
    );
  });

  /** Match entries projection for the `match-list` editor. */
  protected readonly matchRows = computed<IInputTypeMatchEntry[]>(() => {
    const v = this.value();
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is IInputTypeMatchEntry =>
        typeof e === 'object' &&
        e !== null &&
        'value' in e &&
        typeof (e as { value?: unknown }).value === 'string' &&
        MATCH_KINDS.has(String((e as { type?: unknown }).type)),
    );
  });

  /** `match-list`: choices for the pending entry's kind select. */
  protected readonly matchKindOptions: IInputTypeOption[] = [
    { value: 'literal', label: INPUT_TYPE_CONTROL_TEXTS.matchKindLiteral },
    { value: 'regex', label: INPUT_TYPE_CONTROL_TEXTS.matchKindRegex },
    { value: 'glob', label: INPUT_TYPE_CONTROL_TEXTS.matchKindGlob },
  ];

  /** `match-list`: the pending entry's kind (kept across adds). */
  protected readonly pendingMatchType = signal<IInputTypeMatchEntry['type']>('literal');
  /** `match-list`: the pending entry's value input. */
  protected readonly pendingMatchValue = signal('');

  /**
   * `match-list`: inline validation error for the PENDING entry, or
   * `null` when it may be added. An uncompilable regex, a control
   * character, an over-cap value or a duplicate `(type, value)` entry
   * blocks the Add button and never reaches the two-way `value`, so the
   * invalid entry cannot travel to the host or the network (the length /
   * control-char / regex gates mirror the kernel's `validateMatchEntry`;
   * the dedupe matches the tag inputs' `[unique]` posture). Empty input
   * is not an error, just not addable yet.
   */
  protected readonly pendingMatchError = computed<string | null>(() => {
    const raw = this.pendingMatchValue().trim();
    if (raw.length === 0) return null;
    if (raw.length > MATCH_VALUE_CAP) return this.texts.matchTooLong;
    if (MATCH_CONTROL_CHAR_RX.test(raw)) return this.texts.matchHasControlChar;
    if (this.pendingMatchType() === 'regex') {
      try {
        new RegExp(raw);
      } catch {
        return this.texts.matchInvalidRegex;
      }
    }
    const type = this.pendingMatchType();
    if (this.matchRows().some((r) => r.type === type && r.value === raw)) {
      return this.texts.matchDuplicate;
    }
    return null;
  });

  /** `match-list`: whether the pending entry may be committed. */
  protected readonly canAddMatch = computed<boolean>(
    () => this.pendingMatchValue().trim().length > 0 && this.pendingMatchError() === null,
  );

  protected addMatchEntry(): void {
    if (!this.canAddMatch()) return;
    const entry: IInputTypeMatchEntry = {
      type: this.pendingMatchType(),
      value: this.pendingMatchValue().trim(),
    };
    this.value.set([...this.matchRows(), entry]);
    // Keep the kind selection: adding several entries of one kind in a
    // row is the common gesture; only the value clears.
    this.pendingMatchValue.set('');
  }

  protected removeMatchEntry(index: number): void {
    const rows = this.matchRows().slice();
    rows.splice(index, 1);
    this.value.set(rows);
  }

  protected onPendingMatchTypeChange(next: string): void {
    this.pendingMatchType.set(MATCH_KINDS.has(next) ? (next as IInputTypeMatchEntry['type']) : 'literal');
  }

  protected onStringChange(next: string): void {
    this.value.set(next ?? '');
  }

  protected onListChange(next: string[]): void {
    this.value.set(Array.isArray(next) ? next : []);
  }

  /**
   * `string-list` palette: append a clicked suggestion to the list value.
   * Guards against a duplicate (the palette already hides selected entries,
   * but a stale click is harmless this way).
   */
  protected addSuggestion(tag: string): void {
    if (this.listValue().includes(tag)) return;
    this.value.set([...this.listValue(), tag]);
  }

  protected onNumberChange(next: number | null): void {
    // PrimeNG emits `null` when the field is cleared; collapse to the
    // empty-string sentinel the host treats as "unset" so a cleared
    // numeric field round-trips as a blank rather than `0`.
    this.value.set(next === null || next === undefined ? '' : next);
  }

  protected onBooleanChange(next: boolean): void {
    this.value.set(next === true);
  }

  /** `path-glob`: route the change to scalar / list per `multiple`. */
  protected onPathGlobChange(next: string | string[]): void {
    if (this.multiple()) {
      this.value.set(Array.isArray(next) ? next : []);
    } else {
      this.value.set(typeof next === 'string' ? next : '');
    }
  }

  /**
   * Stable per-row identity for the `key-value-list` `@for` track. Rows
   * carry no natural key (both columns are freely editable, duplicates are
   * legal), so identity is minted lazily per row object and carried over
   * when `updateRow` replaces the object on a keystroke. Tracking by this
   * id instead of `$index` keeps the trailing rows' DOM (and any focused
   * input in them) intact when a mid-list row is removed.
   */
  private readonly rowIds = new WeakMap<IInputTypeKeyValueEntry, number>();
  private nextRowId = 0;

  protected rowTrackId(row: IInputTypeKeyValueEntry): number {
    let id = this.rowIds.get(row);
    if (id === undefined) {
      id = this.nextRowId++;
      this.rowIds.set(row, id);
    }
    return id;
  }

  protected onKeyChange(index: number, next: string): void {
    this.updateRow(index, { key: next ?? '' });
  }

  protected onValueChange(index: number, next: string): void {
    this.updateRow(index, { value: next ?? '' });
  }

  protected addRow(): void {
    this.value.set([...this.keyValueRows(), { key: '', value: '' }]);
  }

  protected removeRow(index: number): void {
    const rows = this.keyValueRows().slice();
    rows.splice(index, 1);
    this.value.set(rows);
  }

  private updateRow(index: number, patch: Partial<IInputTypeKeyValueEntry>): void {
    const rows = this.keyValueRows().slice();
    const current = rows[index];
    if (!current) return;
    const next = { ...current, ...patch };
    const id = this.rowIds.get(current);
    if (id !== undefined) this.rowIds.set(next, id);
    rows[index] = next;
    this.value.set(rows);
  }
}
