/**
 * `<sm-settings-modal>`, Settings dialog chassis. Owns the fixed-size
 * `p-dialog` shell, the left-rail section navigation, and the GLOBAL
 * footer (Discard / Apply) that commits every buffered surface in one
 * bulk PATCH. Sub-components (`SettingsPlugins`, `SettingsGeneral`,
 * `SettingsPluginSection`, future siblings) own each section's content.
 *
 * Static sections come from `SETTINGS_SECTIONS`; between "Plugins" and
 * "Changelog" the chassis splices one dynamic section per plugin that
 * declares operator settings (`plugin:<pluginId>` ids), discovered by
 * fetching the plugin list when the modal opens. A thin divider rule
 * brackets the dynamic group when it is non-empty.
 *
 * Buffered edits: every buffered surface (the Plugins panel's toggles,
 * each plugin section's option edits) registers an `IBufferOwner` on the
 * `SettingsBufferService`. The chassis reads `buffer.dirtyCount()` to
 * gate the close-confirm dialog + show the global footer, and dispatches
 * the single global Apply / Discard through the same service.
 *
 * The modal is `@defer`-wrapped at the App level so its full chunk only
 * loads on first open.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IPluginItemApi } from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { SettingsAbout } from './settings-about';
import { SettingsBufferService } from './settings-buffer.service';
import { SettingsChangelog } from './settings-changelog';
import { SettingsGeneral } from './settings-general';
import { SettingsPlugins } from './settings-plugins';
import { SettingsPluginSection } from './settings-plugin-section';
import { sortPluginsByPin } from './settings-plugins.utils';
import { pluginHasSettings } from './settings-plugin-section.controller';
import { SettingsProject } from './settings-project';

/** Static section ids plus the dynamic `plugin:<pluginId>` ids the
 *  chassis appends for plugins that declare operator settings. */
export type TSettingsSection =
  | 'plugins'
  | 'general'
  | 'project'
  | 'changelog'
  | 'about'
  | `plugin:${string}`;

interface ISettingsSection {
  id: TSettingsSection;
  label: string;
  /**
   * When true, the sidebar renders a thin divider rule immediately
   * before this item. Set on the first dynamic plugin section and on
   * `changelog` (only when dynamic sections exist), so the per-plugin
   * group is delimited above and below. Static-only configurations
   * never set it, no stray rule appears.
   */
  dividerBefore?: boolean;
}

const SETTINGS_SECTIONS: readonly ISettingsSection[] = [
  { id: 'general', label: SETTINGS_TEXTS.sections.general },
  { id: 'project', label: SETTINGS_TEXTS.sections.project },
  { id: 'plugins', label: SETTINGS_TEXTS.sections.plugins },
  { id: 'changelog', label: SETTINGS_TEXTS.sections.changelog },
  { id: 'about', label: SETTINGS_TEXTS.sections.about },
] as const;

/** Build the `plugin:<id>` section id for a plugin's settings section. */
function pluginSectionId(pluginId: string): TSettingsSection {
  return `plugin:${pluginId}`;
}

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
    SettingsPluginSection,
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

  /**
   * Section to land on the next time the modal opens. `null` keeps the
   * default (`plugins`). Callers set it to deep-link the modal, e.g. the
   * provider-marker drift banner opens on `project` where the active-lens
   * dropdown lives. Consumed once per open by the effect below; the App
   * resets it to `null` on close so a subsequent gear-click opens on the
   * default section.
   */
  readonly initialSection = input<TSettingsSection | null>(null);

  private readonly confirmation = inject(ConfirmationService);
  private readonly dataSource = inject(DATA_SOURCE);
  /**
   * Coordination point for buffered sub-surfaces. The Plugins panel and
   * every plugin section register their dirty-state contract on
   * construction; the chassis reads `buffer.dirtyCount()` reactively to
   * gate the close-confirm dialog + the global footer, and dispatches the
   * single global Apply / Discard through the same service. No
   * `viewChild` reach across the chassis-child boundary, the contract is
   * explicit via [[IBufferOwner]].
   */
  protected readonly buffer = inject(SettingsBufferService);

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly activeSection = signal<TSettingsSection>('plugins');

  /**
   * Plugins that declare operator settings, discovered by fetching the
   * plugin list when the modal opens. Each becomes a dynamic sidebar
   * section between "Plugins" and "Changelog". Empty until the first
   * successful fetch.
   */
  private readonly settingsPlugins = signal<readonly IPluginItemApi[]>([]);

  /**
   * Static sections + the dynamic per-plugin sections, in render order:
   * general, project, plugins, [plugin:<id> sorted by pin order],
   * changelog, about. The dynamic group is spliced immediately after
   * the `plugins` static entry so the rail matches the Plugins panel's
   * ordering and keeps the plugin material adjacent. When at least one
   * dynamic section exists, the first one carries `dividerBefore` (rule
   * between Plugins and the group) and `changelog` carries it too (rule
   * between the group and the rest), bracketing the group visually.
   */
  protected readonly sections = computed<readonly ISettingsSection[]>(() => {
    const dynamic: ISettingsSection[] = this.settingsPlugins().map((plugin, index) => ({
      id: pluginSectionId(plugin.id),
      label: this.texts.pluginSection.navLabel(plugin.id),
      dividerBefore: index === 0,
    }));
    const result: ISettingsSection[] = [];
    for (const section of SETTINGS_SECTIONS) {
      if (section.id === 'changelog' && dynamic.length > 0) {
        result.push({ ...section, dividerBefore: true });
      } else {
        result.push({ ...section });
      }
      if (section.id === 'plugins') result.push(...dynamic);
    }
    return result;
  });

  /** The plugin item backing the active `plugin:<id>` section, or null
   *  for a static section. Drives the `<sm-settings-plugin-section>`
   *  binding. */
  protected readonly activePluginItem = computed<IPluginItemApi | null>(() => {
    const active = this.activeSection();
    if (!active.startsWith('plugin:')) return null;
    const id = active.slice('plugin:'.length);
    return this.settingsPlugins().find((p) => p.id === id) ?? null;
  });

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

  constructor() {
    // Discover the per-plugin settings sections on open. Fires whenever
    // the modal becomes visible so a plugin enabled / created from
    // another terminal surfaces its section (between Plugins and
    // Changelog) on the next open.
    effect(() => {
      if (this.visible()) void this.loadSettingsPlugins();
    });

    // Deep-link the modal to a requested section on open (e.g. the
    // drift banner opens on `project`). Only acts while visible and when
    // a section was requested, so a normal gear-click keeps the default.
    effect(() => {
      const requested = this.initialSection();
      if (this.visible() && requested) this.activeSection.set(requested);
    });
  }

  /** Fetch the plugin list and keep only the plugins that declare
   *  operator settings, sorted by the canonical pin order. Failures are
   *  swallowed: the sections simply do not appear (the Plugins panel
   *  surfaces the same load error in its own view). */
  private async loadSettingsPlugins(): Promise<void> {
    try {
      const envelope = await this.dataSource.listPlugins();
      const withSettings = envelope.items.filter(pluginHasSettings);
      this.settingsPlugins.set(sortPluginsByPin(withSettings));
    } catch {
      this.settingsPlugins.set([]);
    }
  }

  /**
   * Intercept p-dialog visibility transitions. Opening (next=true)
   * propagates verbatim. Closing (next=false) is gated by the aggregate
   * dirty buffer:
   *
   *   - 0 dirty: propagate, dialog closes.
   *   - 1+ dirty: do NOT propagate. Open the confirm dialog. The user
   *     picks Apply (apply + close), Discard (revert + close), or
   *     Keep editing (dismiss the confirm, modal stays open).
   *
   * The dialog stays visually open while the confirm is up because we
   * never emit `visibleChange(false)` until the user chooses.
   * `[visible]="visible()"` is a one-way binding from the parent's
   * `settingsOpen` signal, so suppressing the emit is sufficient.
   */
  protected onVisibleChange(next: boolean): void {
    if (next) {
      this.visibleChange.emit(true);
      return;
    }
    const dirtyCount = this.buffer.dirtyCount();
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
      // Keep editing: `confirmation.confirm` has no built-in "third
      // action" hook, but the dialog's X / Escape resolves neither
      // accept nor reject. The modal stays open because we never
      // propagated the close.
      accept: () => {
        void this.applyAndClose();
      },
      reject: () => {
        this.buffer.discardChanges();
        this.visibleChange.emit(false);
      },
    });
  }

  protected selectSection(id: TSettingsSection): void {
    this.activeSection.set(id);
  }

  /**
   * Global Apply (footer button + confirm-dialog Apply action). Commits
   * every buffered owner's pending edits in one bulk PATCH via the
   * service; closes the modal on success. A failed apply keeps the modal
   * open with the buffers dirty and the error visible so the user can
   * read it, fix what they can, and retry or discard.
   */
  protected async applyAndClose(): Promise<void> {
    const result = await this.buffer.applyChanges();
    if (result.ok) this.visibleChange.emit(false);
  }

  /** Global Discard (footer button). Reverts every buffered owner; the
   *  modal stays open. */
  protected discardChanges(): void {
    this.buffer.discardChanges();
  }
}
