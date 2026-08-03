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
import { ProcessingAgentReadinessService } from '../../services/processing-agent-readiness';
import { UsageTrackerService } from '../../services/usage-tracker';
import type { IPluginItemApi } from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { SettingsAbout } from './settings-about';
import { SettingsBufferService } from './settings-buffer';
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
   * PrimeIcons class for the nav row's leading glyph. Purely decorative
   * (the row is named by its label, and the `<i>` is `aria-hidden`), so
   * it lives here rather than in the texts catalog, matching the Quick
   * Start group catalog this rail was aligned with.
   *
   * Every static section names its own; the dynamic `plugin:<id>`
   * sections share one generic glyph because a plugin manifest has no
   * icon field today (only provider KINDS declare one, see
   * `spec/schemas/extensions/provider-kind.schema.json`). If plugins
   * ever declare one, this becomes the fallback rather than the rule.
   */
  icon: string;
  /**
   * When true, the sidebar renders a thin divider rule immediately
   * before this item. Set on the first dynamic plugin section and on
   * `changelog` (only when dynamic sections exist), so the per-plugin
   * group is delimited above and below. Static-only configurations
   * never set it, no stray rule appears.
   */
  dividerBefore?: boolean;
  /**
   * When true, the sidebar row carries the attention dot: something in
   * that section is waiting for the operator. Today only `project`
   * raises it, for an outdated agent process skill
   * (`ProcessingAgentReadinessService.skillUpdateAvailable`), and it is
   * modelled as a section property rather than a special case in the
   * template so a second source can light a different row without
   * touching the markup.
   */
  attention?: boolean;
}

const SETTINGS_SECTIONS: readonly ISettingsSection[] = [
  { id: 'general', label: SETTINGS_TEXTS.sections.general, icon: 'pi pi-sliders-h' },
  { id: 'project', label: SETTINGS_TEXTS.sections.project, icon: 'pi pi-folder' },
  { id: 'plugins', label: SETTINGS_TEXTS.sections.plugins, icon: 'pi pi-box' },
  { id: 'changelog', label: SETTINGS_TEXTS.sections.changelog, icon: 'pi pi-history' },
  { id: 'about', label: SETTINGS_TEXTS.sections.about, icon: 'pi pi-info-circle' },
] as const;

/**
 * Glyph for a per-plugin settings section. Deliberately NOT `pi-box`
 * (the Plugins section's own icon): the list section and one plugin's
 * options are different destinations, so they should not look
 * identical in the same rail.
 */
const PLUGIN_SECTION_ICON = 'pi pi-cog';

/** Build the `plugin:<id>` section id for a plugin's settings section. */
function pluginSectionId(pluginId: string): TSettingsSection {
  return `plugin:${pluginId}`;
}

/**
 * localStorage key remembering the last section the user visited, so the
 * modal re-opens where they left off instead of always landing on
 * Plugins (user call 2026-07-26). Same `sm.settings.*` family as the
 * plugin-panel filter mirrors.
 */
const SECTION_STORAGE_KEY = 'sm.settings.section';

/** Read the remembered section; `null` on absence or storage failure. */
function readStoredSection(): TSettingsSection | null {
  try {
    const raw = window.localStorage.getItem(SECTION_STORAGE_KEY);
    if (raw === null) return null;
    const staticIds: readonly string[] = SETTINGS_SECTIONS.map((s) => s.id);
    if (staticIds.includes(raw) || raw.startsWith('plugin:')) return raw as TSettingsSection;
    return null;
  } catch {
    return null;
  }
}

/** Persist the visited section; best-effort (private mode etc.). */
function storeSection(id: TSettingsSection): void {
  try {
    window.localStorage.setItem(SECTION_STORAGE_KEY, id);
  } catch {
    /* storage unavailable; the modal just defaults next time */
  }
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
  private readonly usageTracker = inject(UsageTrackerService);
  /**
   * Source of the attention dot. App-level and already probed on boot /
   * scan / lens switch, so the chassis reads it without owning a probe
   * of its own (and without waiting for the Project section to mount).
   */
  private readonly readiness = inject(ProcessingAgentReadinessService);
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
  /** Lands on the remembered section (see `SECTION_STORAGE_KEY`);
   *  `plugins` only on a first-ever open. A stored `plugin:<id>` whose
   *  plugin no longer offers settings is reconciled to `plugins` after
   *  the plugin fetch (`loadSettingsPlugins`). */
  protected readonly activeSection = signal<TSettingsSection>(readStoredSection() ?? 'plugins');

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
      icon: PLUGIN_SECTION_ICON,
      dividerBefore: index === 0,
    }));
    const attentionOn = this.attentionSections();
    const result: ISettingsSection[] = [];
    for (const section of SETTINGS_SECTIONS) {
      const attention = attentionOn.has(section.id) ? { attention: true } : {};
      if (section.id === 'changelog' && dynamic.length > 0) {
        result.push({ ...section, ...attention, dividerBefore: true });
      } else {
        result.push({ ...section, ...attention });
      }
      if (section.id === 'plugins') result.push(...dynamic);
    }
    return result;
  });

  /**
   * Section ids currently raising the attention dot. One entry today:
   * `project`, while the agent process skill installed for the active
   * lens is older than the copy this CLI ships. The readiness service
   * owns the probe (boot, every scan, every lens switch), so the dot is
   * live without the Project section ever having been opened.
   */
  private readonly attentionSections = computed<ReadonlySet<TSettingsSection>>(() => {
    const ids = new Set<TSettingsSection>();
    if (this.readiness.skillUpdateAvailable()) ids.add('project');
    return ids;
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
      if (this.visible() && requested) {
        this.activeSection.set(requested);
        // The user SAW this section, so it is the one to remember; a
        // deep-link is not an exception to the last-visited rule.
        storeSection(requested);
      }
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
    // Reconcile a remembered `plugin:<id>` section whose plugin no longer
    // offers settings (uninstalled / disabled since the last visit): fall
    // back to the Plugins panel rather than landing on a dead section.
    const active = this.activeSection();
    if (
      active.startsWith('plugin:') &&
      !this.settingsPlugins().some((p) => pluginSectionId(p.id) === active)
    ) {
      this.activeSection.set('plugins');
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
    // Usage analytics (opt-in, default OFF): of the tab strip only the
    // Changelog / About entries are tracked (user decision; the working
    // tabs' usage is already visible through their own gestures). Only
    // an actual section CHANGE counts: re-clicking the active tab is a
    // no-op gesture and would only inflate the count.
    if (id !== this.activeSection()) {
      if (id === 'changelog') this.usageTracker.trackFeature('settings-changelog');
      if (id === 'about') this.usageTracker.trackFeature('settings-about');
    }
    this.activeSection.set(id);
    storeSection(id);
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
