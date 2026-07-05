/**
 * `<sm-settings-project-preferences>`, the rows of the Settings >
 * Project section backed by the ONE `project preferences` envelope
 * (`GET/PATCH /api/project/preferences`):
 *
 *   1. `allowSidecarWriters` toggle, team-shared sidecar-writer policy.
 *   2. `pluginTrust.projectEnabled` toggle, machine-local plugin-trust
 *      opt-in. Turning it ON expands the local code-execution surface,
 *      so the write goes through a confirm dialog (server-enforced 412).
 *   3. `scan.referencePaths`, privacy-sensitive list of folders the
 *      scan walks ONLY to validate broken links. Writes that EXPAND
 *      the scan's disk-access surface (paths outside the project) go
 *      through a `<p-confirmdialog>` and re-issue the PATCH with
 *      `confirm: true`. Persists in `<cwd>/.skill-map/settings.local.json`.
 *
 * The three stay in one child because they read and PATCH the same
 * envelope; splitting them would triple-fetch the endpoint and race
 * the writes. Lifecycle mirrors the sibling children: fetch on
 * `(visible) === true`.
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
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type {
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
} from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import { formatErr } from './settings-project.utils';

@Component({
  selector: 'sm-settings-project-preferences',
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputTextModule,
    MessageModule,
    ToggleSwitchModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './settings-project-preferences.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectPreferences {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);

  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;

  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly preferences = signal<IProjectPreferencesApi | null>(null);
  /** Pending patch keys ('scan.referencePaths', 'allowSidecarWriters', ...). */
  protected readonly pending = signal<Set<string>>(new Set());

  /** New-row input box for the reference-paths list. */
  protected readonly newReferencePath = signal('');

  protected readonly referencePaths = computed<readonly string[]>(() => {
    const env = this.preferences();
    return env?.scan.referencePaths ?? [];
  });

  /**
   * Committed sidecar-writer policy (team-shared). `true` (default)
   * keeps writer actions; `false` disables every sidecar-writing
   * extension and refuses `.sm` writes. Defaults to `true` before the
   * envelope loads so the switch does not flash "off".
   */
  protected readonly allowSidecarWriters = computed<boolean>(() => {
    return this.preferences()?.allowSidecarWriters ?? true;
  });

  /**
   * Machine-local plugin-trust opt-in (`pluginTrust.projectEnabled`).
   * `false` (default) requires per-plugin trust; `true` locally trusts
   * every plugin the project enables. Read defensively so an older
   * envelope that predates the field renders the switch off rather than
   * flashing. Flipping it ON expands the local code-execution surface, so
   * the write goes through the same confirm dialog as reference-paths.
   */
  protected readonly pluginTrustEnabled = computed<boolean>(() => {
    return this.preferences()?.pluginTrust?.projectEnabled ?? false;
  });

  constructor() {
    effect(() => {
      if (this.visible()) void this.refresh();
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
    void this.runPatch(
      'scan.referencePaths',
      { scan: { referencePaths: next } },
      this.referencePathsConfirmFlow(),
    ).then(
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
  // Sidecar-writer policy handler
  // -----------------------------------------------------------------

  protected onSidecarWritersToggle(next: boolean): void {
    void this.runPatch('allowSidecarWriters', { allowSidecarWriters: next });
  }

  // -----------------------------------------------------------------
  // Plugin-trust opt-in handler
  // -----------------------------------------------------------------

  /**
   * Flip the machine-local `pluginTrust.projectEnabled` opt-in. Turning
   * it ON expands the local code-execution surface, so the BFF answers
   * 412 `confirm-required`; `runPatch` then surfaces the dedicated trust
   * confirm dialog and retries with `confirm: true` on accept. Turning it
   * OFF narrows the surface and persists directly. On a 412 the user
   * dismisses, the toggle snaps back because `preferences()` is unchanged.
   */
  protected onProjectTrustToggle(next: boolean): void {
    void this.runPatch(
      'pluginTrust.projectEnabled',
      { pluginTrust: { projectEnabled: next } },
      this.pluginTrustConfirmFlow(),
    );
  }

  // -----------------------------------------------------------------
  // Refresh + dispatch helpers
  // -----------------------------------------------------------------

  /** Fetch the preferences envelope. */
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

  /**
   * Try the patch; if the BFF answers `confirm-required` AND the caller
   * supplied a `confirm` flow, surface that flow's confirm dialog and on
   * user accept retry with `confirm: true`. On any other error (or a 412
   * with no confirm flow, which only narrowing callers hit, never in
   * practice) surface in `saveError`. Returns `true` only when the PATCH
   * (or the confirmed retry) actually persisted; `false` on validation
   * errors or on a 412 the user did not yet accept (callers like
   * `onReferencePathAdd` use this to keep the input value editable
   * instead of clearing it).
   *
   * The confirm dialog is parameterised per surface-expanding key: the
   * mechanism (try -> catch 412 -> dialog -> retry with `confirm: true`)
   * is shared, the dialog copy and the post-confirm side effect are not
   * (reference-paths enumerates the exposed paths and clears its input;
   * plugin-trust shows its own machine-local warning).
   */
  private async runPatch(
    key: string,
    patch: IProjectPreferencesPatchApi,
    confirm?: IConfirmFlow,
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
      if (
        err instanceof DataSourceError &&
        err.code === 'confirm-required' &&
        confirm
      ) {
        const exposed = (err as DataSourceError & { paths?: string[] }).paths ?? [];
        confirm.present(exposed, async () => {
          try {
            const envelope = await this.dataSource.setProjectPreferences({
              ...patch,
              confirm: true,
            });
            this.preferences.set(envelope);
            confirm.onConfirmed?.();
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
   * Confirm flow for `scan.referencePaths`: enumerate the exposed paths
   * in the dialog and clear the new-path input after a confirmed retry.
   */
  private referencePathsConfirmFlow(): IConfirmFlow {
    return {
      present: (exposed, onAccept) => this.confirmDialog(exposed, onAccept),
      onConfirmed: () => this.newReferencePath.set(''),
    };
  }

  /**
   * Confirm flow for `pluginTrust.projectEnabled`: a dedicated
   * machine-local trust warning (the exposed-paths list does not apply to
   * a code-execution surface, so it is ignored).
   */
  private pluginTrustConfirmFlow(): IConfirmFlow {
    return {
      present: (_exposed, onAccept) => this.confirmProjectTrustDialog(onAccept),
    };
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

  private confirmProjectTrustDialog(onAccept: () => Promise<void>): void {
    this.confirmation.confirm({
      header: SETTINGS_TEXTS.project.pluginTrustConfirmHeader,
      message: SETTINGS_TEXTS.project.pluginTrustConfirmIntro,
      acceptLabel: SETTINGS_TEXTS.project.pluginTrustConfirmAccept,
      rejectLabel: SETTINGS_TEXTS.project.pluginTrustConfirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void onAccept();
      },
    });
  }
}

/**
 * Per-key confirm flow injected into `runPatch`. The 412 handling
 * mechanism is shared; this carries the surface-specific dialog
 * presentation and an optional post-confirm side effect.
 */
interface IConfirmFlow {
  /** Open the confirm dialog. `exposed` is the path list the 412 carried
   *  (empty for non-path surfaces); call `onAccept` on confirm. */
  present(exposed: string[], onAccept: () => Promise<void>): void;
  /** Ran after a confirmed retry persists (e.g. clear the input box). */
  onConfirmed?: () => void;
}
