/**
 * `<sm-settings-project>`, Project section of the Settings modal.
 *
 * Two co-located list-rows:
 *
 *   1. `scan.referencePaths`, privacy-sensitive list of folders the
 *      scan walks ONLY to validate broken links. Writes that EXPAND
 *      the scan's disk-access surface (paths outside the project)
 *      go through a `<p-confirmdialog>` and re-issue the PATCH with
 *      `confirm: true`. Persists in
 *      `<cwd>/.skill-map/settings.local.json`.
 *
 *   2. `.skillmapignore` patterns, gitignore-style filter for the
 *      scan. No privacy gate (patterns only NARROW the surface);
 *      no existence check (entries are patterns, not paths). The
 *      BFF preserves any comments / blank lines in the file on
 *      write, so the operator can keep their hand-authored layout
 *      while still using the UI for add/remove. Persists in
 *      `<cwd>/.skillmapignore`.
 *
 * Lifecycle mirrors `settings-plugins.ts` / `settings-general.ts`:
 * fetch both envelopes on `(visible) === true`, render, dispatch
 * via the data-source port.
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
import { ButtonModule } from 'primeng/button';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type {
  IActiveProviderApi,
  IProjectIgnoreApi,
  IProjectIgnorePatchApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
} from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import { ProviderRegistryService } from '../../../services/provider-registry';

/**
 * Single line, no ASCII control / DEL characters. Mirrors the BFF's
 * AJV schema in `routes/project-ignore.ts`. Surfaces the validation
 * error in the same input the user typed in, before the network
 * round-trip.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RX = /[\n\r\x00-\x1F\x7F]/;

@Component({
  selector: 'sm-settings-project',
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputTextModule,
    MessageModule,
    SelectModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './settings-project.html',
  styleUrl: './settings-project.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProject {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);
  private readonly providerRegistry = inject(ProviderRegistryService);

  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
  // ---- reference-paths state -------------------------------------------
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly preferences = signal<IProjectPreferencesApi | null>(null);
  /** Pending sub-key keys ('scan.referencePaths' or 'ignore.patterns'). */
  protected readonly pending = signal<Set<string>>(new Set());

  /** New-row input box for the reference-paths list. */
  protected readonly newReferencePath = signal('');

  protected readonly referencePaths = computed<readonly string[]>(() => {
    const env = this.preferences();
    return env?.scan.referencePaths ?? [];
  });

  // ---- ignore-patterns state -------------------------------------------
  protected readonly ignoreLoadError = signal<string | null>(null);
  protected readonly ignoreSaveError = signal<string | null>(null);
  protected readonly ignoreEnvelope = signal<IProjectIgnoreApi | null>(null);
  protected readonly newIgnorePattern = signal('');

  protected readonly ignorePatterns = computed<readonly string[]>(() => {
    return this.ignoreEnvelope()?.patterns ?? [];
  });

  // ---- active-provider state -------------------------------------------
  protected readonly activeProviderEnvelope = signal<IActiveProviderApi | null>(null);
  protected readonly activeProviderLoadError = signal<string | null>(null);
  protected readonly activeProviderSaveError = signal<string | null>(null);
  protected readonly activeProviderSwitchAnnouncement = signal<string | null>(null);
  /**
   * Options consumed by `<p-select>`. Prepends the "(none)" entry so the
   * user can explicitly clear the lens; the rest come from the runtime
   * `ProviderRegistryService` (fed by the `providerRegistry` envelope
   * field), so the dropdown lists exactly the Providers registered in
   * this scope, never a hardcoded list. Downstream `'' → null`
   * conversion stays in `onActiveProviderChange()`.
   *
   * Each registry Provider absent from the envelope's `selectable` set
   * (the ids enabled right now) is rendered disabled: greyed and not
   * selectable (`optionDisabled` in the template) plus a "(disabled)"
   * label suffix, so a disabled Provider stays visible but can never be
   * chosen as the lens. Before the envelope loads (`selectable === null`)
   * nothing is greyed, to avoid a flash of all-disabled rows.
   */
  protected readonly providerOptions = computed<
    { id: string; label: string; disabled: boolean }[]
  >(() => {
    const env = this.activeProviderEnvelope();
    const selectable = env ? new Set(env.selectable) : null;
    return [
      { id: '', label: SETTINGS_TEXTS.project.activeProviderEmptyOption, disabled: false },
      ...this.providerRegistry.providers().map((p) => {
        const disabled = selectable !== null && !selectable.has(p.id);
        const label = disabled
          ? `${p.label} ${SETTINGS_TEXTS.project.activeProviderDisabledSuffix}`
          : p.label;
        return { id: p.id, label, disabled };
      }),
    ];
  });

  /** Current resolved value (from config or autodetect); `''` for "none". */
  protected readonly activeProviderValue = computed<string>(() => {
    return this.activeProviderEnvelope()?.activeProvider ?? '';
  });

  /** Comma-separated list of detected provider ids. Empty when none. */
  protected readonly activeProviderDetectedLabel = computed<string>(() => {
    return (this.activeProviderEnvelope()?.detected ?? []).join(', ');
  });

  /** Which source the persisted value came from. */
  protected readonly activeProviderSource = computed<IActiveProviderApi['source']>(() => {
    return this.activeProviderEnvelope()?.source ?? 'none';
  });

  constructor() {
    effect(() => {
      if (this.visible()) {
        void this.refresh();
        void this.refreshIgnore();
        void this.refreshActiveProvider();
      }
    });
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  // -----------------------------------------------------------------
  // Reference-paths handlers
  // -----------------------------------------------------------------

  protected onReferencePathAdd(): void {
    const raw = this.newReferencePath().trim();
    if (raw.length === 0) return;
    if (raw.includes(',')) {
      this.saveError.set(this.texts.project.commaForbidden);
      return;
    }
    const next = [...this.referencePaths(), raw];
    void this.runPatch('scan.referencePaths', { scan: { referencePaths: next } }).then(
      (ok) => {
        // Only clear the input on a successful persist; a 400 (path
        // does not exist, comma, malformed) or 412 (confirm required
        // and the user dismissed the dialog) leaves the value in
        // place so the operator can edit and retry without retyping.
        if (ok) this.newReferencePath.set('');
      },
    );
  }

  protected onReferencePathRemove(path: string): void {
    const next = this.referencePaths().filter((p) => p !== path);
    void this.runPatch('scan.referencePaths', { scan: { referencePaths: [...next] } });
  }

  // -----------------------------------------------------------------
  // Ignore-patterns handlers
  // -----------------------------------------------------------------

  protected onIgnorePatternAdd(): void {
    const raw = this.newIgnorePattern().trim();
    if (raw.length === 0) {
      this.ignoreSaveError.set(this.texts.project.ignorePatternEmpty);
      return;
    }
    if (CONTROL_CHAR_RX.test(raw)) {
      this.ignoreSaveError.set(this.texts.project.ignorePatternHasControlChar);
      return;
    }
    const current = this.ignorePatterns();
    if (current.includes(raw)) {
      this.ignoreSaveError.set(this.texts.project.ignorePatternDuplicate);
      return;
    }
    const next = [...current, raw];
    void this.runIgnorePatch({ patterns: next }).then((ok) => {
      if (ok) this.newIgnorePattern.set('');
    });
  }

  protected onIgnorePatternRemove(pattern: string): void {
    const next = this.ignorePatterns().filter((p) => p !== pattern);
    void this.runIgnorePatch({ patterns: [...next] });
  }

  // -----------------------------------------------------------------
  // Active-provider handlers
  // -----------------------------------------------------------------

  /**
   * Triggered by the `<select>`'s `(change)` event. Opens the
   * confirm dialog because switching the lens is destructive of the
   * scan_* DB zone (see spec/architecture.md §Active Provider Lens).
   * On accept, calls the data-source; on reject, reverts the
   * dropdown to the previous value by re-emitting the envelope.
   */
  protected onActiveProviderChange(newValue: string): void {
    if (newValue === '' || newValue === this.activeProviderValue()) return;
    this.confirmActiveProviderSwitch(newValue, async () => {
      await this.runActiveProviderSwitch(newValue);
    });
  }

  // -----------------------------------------------------------------
  // Refresh + dispatch helpers
  // -----------------------------------------------------------------

  /** Fetch the reference-paths envelope. */
  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);
    try {
      const envelope = await this.dataSource.getProjectPreferences();
      this.preferences.set(envelope);
    } catch (err) {
      this.loadError.set(formatErr(err));
      this.preferences.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /** Fetch the ignore-patterns envelope. */
  private async refreshIgnore(): Promise<void> {
    this.ignoreLoadError.set(null);
    this.ignoreSaveError.set(null);
    try {
      const envelope = await this.dataSource.getProjectIgnore();
      this.ignoreEnvelope.set(envelope);
    } catch (err) {
      this.ignoreLoadError.set(formatErr(err));
      this.ignoreEnvelope.set(null);
    }
  }

  /** Fetch the active-provider envelope. */
  private async refreshActiveProvider(): Promise<void> {
    this.activeProviderLoadError.set(null);
    this.activeProviderSaveError.set(null);
    try {
      const envelope = await this.dataSource.getActiveProvider();
      this.activeProviderEnvelope.set(envelope);
    } catch (err) {
      this.activeProviderLoadError.set(formatErr(err));
      this.activeProviderEnvelope.set(null);
    }
  }

  /**
   * Persist the lens switch, then update local state with the
   * server's announcement of what was cleared. Errors land in
   * `activeProviderSaveError` and the dropdown reverts to the prior
   * envelope value (the user sees their action did not take effect).
   */
  private async runActiveProviderSwitch(newValue: string): Promise<void> {
    this.activeProviderSaveError.set(null);
    this.activeProviderSwitchAnnouncement.set(null);
    try {
      const envelope = await this.dataSource.setActiveProvider(newValue);
      this.activeProviderEnvelope.set({
        activeProvider: envelope.activeProvider,
        detected: envelope.detected,
        source: envelope.source,
        selectable: envelope.selectable,
      });
      const dropped = envelope.switch.dropped;
      if (dropped === null) {
        this.activeProviderSwitchAnnouncement.set(
          this.texts.project.activeProviderSwitchedNoDb,
        );
      } else {
        const t = this.texts.project;
        this.activeProviderSwitchAnnouncement.set(
          `${t.activeProviderSwitchedPrefix} ${dropped.tableCount} ${t.activeProviderSwitchedSuffix}`,
        );
      }
    } catch (err) {
      this.activeProviderSaveError.set(formatErr(err));
    }
  }

  private confirmActiveProviderSwitch(_newValue: string, onAccept: () => Promise<void>): void {
    this.confirmation.confirm({
      header: this.texts.project.activeProviderConfirmHeader,
      message: this.texts.project.activeProviderConfirmIntro,
      acceptLabel: this.texts.project.activeProviderConfirmAccept,
      rejectLabel: this.texts.project.activeProviderConfirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void onAccept();
      },
      reject: () => {
        // Revert the dropdown to the previous envelope value by
        // re-emitting it; the (change) handler short-circuits on
        // unchanged values, so this puts the UI back in sync.
        const env = this.activeProviderEnvelope();
        if (env) this.activeProviderEnvelope.set({ ...env });
      },
    });
  }

  /**
   * Try the patch; if the BFF answers `confirm-required`, surface
   * the confirm dialog with the paths the change would expose, and
   * on user accept retry with `confirm: true`. On any other error
   * surface in `saveError`. Returns `true` only when the PATCH (or
   * the confirmed retry) actually persisted; `false` on validation
   * errors, on a 412 the user did not yet accept (callers like
   * `onReferencePathAdd` use this to keep the input value editable
   * instead of clearing it).
   */
  private async runPatch(
    key: string,
    patch: IProjectPreferencesPatchApi,
  ): Promise<boolean> {
    if (this.pending().has(key)) return false;
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.saveError.set(null);
    let success = false;
    try {
      const envelope = await this.dataSource.setProjectPreferences(patch);
      this.preferences.set(envelope);
      success = true;
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'confirm-required') {
        const exposed = (err as DataSourceError & { paths?: string[] }).paths ?? [];
        this.confirmDialog(exposed, async () => {
          try {
            const envelope = await this.dataSource.setProjectPreferences({
              ...patch,
              confirm: true,
            });
            this.preferences.set(envelope);
            this.newReferencePath.set('');
          } catch (innerErr) {
            this.saveError.set(formatErr(innerErr));
          }
        });
      } else {
        this.saveError.set(formatErr(err));
      }
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
    return success;
  }

  /**
   * Dispatch a `.skillmapignore` patch. Simpler than `runPatch` (no
   * 412 / confirm-required branch, no existence check) because the
   * route narrows the scan surface by design. Returns `true` on a
   * successful persist so the caller can clear the input box.
   */
  private async runIgnorePatch(patch: IProjectIgnorePatchApi): Promise<boolean> {
    const key = 'ignore.patterns';
    if (this.pending().has(key)) return false;
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.ignoreSaveError.set(null);
    let success = false;
    try {
      const envelope = await this.dataSource.setProjectIgnore(patch);
      this.ignoreEnvelope.set(envelope);
      success = true;
    } catch (err) {
      this.ignoreSaveError.set(formatErr(err));
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
    return success;
  }

  private confirmDialog(paths: string[], onAccept: () => Promise<void>): void {
    this.confirmation.confirm({
      header: SETTINGS_TEXTS.project.confirmDialogHeader,
      message:
        SETTINGS_TEXTS.project.confirmDialogIntro +
        '\n' +
        paths.map((p) => `• ${p}`).join('\n'),
      acceptLabel: SETTINGS_TEXTS.project.confirmDialogAccept,
      rejectLabel: SETTINGS_TEXTS.project.confirmDialogReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void onAccept();
      },
    });
  }
}

function formatErr(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
