/**
 * `<sm-settings-plugin-section>`, one per-plugin Settings section.
 *
 * Each plugin that declares operator settings on at least one extension
 * gets its own sidebar entry (below "About"); the chassis renders this
 * component when that section is active. It shows the plugin id as a
 * title and, per settings-declaring extension, the extension id as a
 * subtitle followed by one `<sm-input-type-control>` per declared
 * setting (seeded from `settingValues` / declaration `default` / blank
 * for secrets, with the secret "set" / "empty" hint driven by
 * `secretSettingsSet`).
 *
 * Edits are buffered locally (via `setupPluginSection`) and registered as
 * an `IBufferOwner` on the chassis-level `SettingsBufferService`: the
 * section never issues a PATCH, the chassis merges its `collectChanges()`
 * into the single global Apply, reseeds it from the response, and
 * discards it. Only extensions that declare settings render here; the
 * `plugin` input always carries at least one such extension (the chassis
 * filters before mounting the section).
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
} from '@angular/core';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type {
  IPluginExtensionApi,
  IPluginExtensionSettingApi,
  IPluginItemApi,
} from '../../../models/api';
import {
  InputTypeControl,
  type IInputTypeDescriptor,
  type TInputTypeValue,
} from '../../renderers/input-type-control/input-type-control';

import {
  setupPluginSection,
  type IPluginSectionHandle,
  type ISettingsExtension,
} from './settings-plugin-section.controller';
import { SettingsBufferService, type IBufferOwner } from './settings-buffer.service';

@Component({
  selector: 'sm-settings-plugin-section',
  imports: [InputTypeControl],
  templateUrl: './settings-plugin-section.html',
  styleUrl: './settings-plugin-section.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPluginSection implements OnInit {
  private readonly buffer = inject(SettingsBufferService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The plugin whose settings this section edits. Required, always
   * carries at least one settings-declaring extension (the chassis
   * filters with `pluginHasSettings` before mounting). The chassis
   * remounts the section per plugin id (`@switch` on the active section),
   * so the handle is created once in `ngOnInit` against the resolved
   * input; a global Apply reseeds it via the buffer owner's `reseed`.
   */
  readonly plugin = input.required<IPluginItemApi>();

  protected readonly texts = SETTINGS_TEXTS;

  /**
   * Per-plugin buffered settings machine. Built in `ngOnInit` (after the
   * `plugin` input is resolved, before the first change detection of the
   * template). Registering the buffer owner in a lifecycle hook keeps it
   * out of the template-evaluation path so the `dirtyCount` it feeds is
   * never mutated mid-render.
   */
  private handleRef: IPluginSectionHandle | null = null;

  ngOnInit(): void {
    const handle = setupPluginSection(this.plugin());
    this.handleRef = handle;
    const owner: IBufferOwner = {
      dirtyIds: handle.dirtyIds,
      collectChanges: () => handle.collectChanges(),
      reseed: (plugins) => this.reseed(plugins),
      discardChanges: () => handle.discardChanges(),
    };
    this.buffer.register(owner);
    this.destroyRef.onDestroy(() => this.buffer.deregister(owner));
  }

  private get handle(): IPluginSectionHandle {
    // Always resolved post-`ngOnInit`; the template only reads it after
    // the view exists. The non-null assertion documents that invariant.
    return this.handleRef!;
  }

  /** Settings-declaring extensions of the current plugin, in order. */
  protected readonly settingsExtensions = computed<readonly ISettingsExtension[]>(
    () => this.handle.settingsExtensions(),
  );

  protected pluginId(): string {
    return this.plugin().id;
  }

  /** Current buffered value for one setting under one extension. */
  protected settingValue(key: string, settingId: string): TInputTypeValue {
    return this.handle.settingValue(key, settingId) as TInputTypeValue;
  }

  /** Buffer a single setting edit. The control already emits the declared
   *  runtime type; we coerce through the shared value union. */
  protected onSettingChange(
    key: string,
    settingId: string,
    next: TInputTypeValue,
  ): void {
    this.handle.onSettingChange(key, settingId, next as never);
  }

  /** Optional helper text shown below the control. */
  protected settingDescription(decl: IPluginExtensionSettingApi): string | undefined {
    return decl.description;
  }

  /**
   * Build the `IInputTypeDescriptor` for one declared setting: maps the
   * declaration's per-type params onto the control's flat descriptor
   * shape and threads the secret "is set" flag (from `secretSettingsSet`)
   * so the secret control shows the right "Set" / "Empty" hint.
   */
  protected settingDescriptor(
    ext: IPluginExtensionApi,
    decl: IPluginExtensionSettingApi,
  ): IInputTypeDescriptor {
    const descriptor: IInputTypeDescriptor = {
      inputType: decl.type,
      label: decl.label,
    };
    if ('options' in decl) descriptor.options = decl.options;
    if ('min' in decl && decl.min !== undefined) descriptor.min = decl.min;
    if ('max' in decl && decl.max !== undefined) descriptor.max = decl.max;
    if ('step' in decl && decl.step !== undefined) descriptor.step = decl.step;
    if ('multiple' in decl && decl.multiple !== undefined) descriptor.multiple = decl.multiple;
    if ('flags' in decl && decl.flags !== undefined) descriptor.flags = decl.flags;
    if ('keyLabel' in decl && decl.keyLabel !== undefined) descriptor.keyLabel = decl.keyLabel;
    if ('valueLabel' in decl && decl.valueLabel !== undefined) descriptor.valueLabel = decl.valueLabel;
    if (decl.type === 'secret') {
      descriptor.secretIsSet = ext.secretSettingsSet?.includes(decl.id) ?? false;
    }
    return descriptor;
  }

  /** Re-seed the buffer from the post-write list, picking out THIS
   *  plugin's item (matched by id). Skips silently when the plugin is
   *  absent from the response (defensive, the apply preserves the row). */
  private reseed(plugins: readonly IPluginItemApi[]): void {
    const next = plugins.find((p) => p.id === this.plugin().id);
    if (next) this.handle.reseedFrom(next);
  }
}
