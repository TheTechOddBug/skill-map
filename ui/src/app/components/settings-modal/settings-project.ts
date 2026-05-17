/**
 * `<sm-settings-project>`, Project section of the Settings modal.
 *
 * Surfaces the privacy-sensitive `scan.referencePaths` setting
 * (string[], paths walked for link validation only, not indexed),
 * persisted in `<cwd>/.skill-map/settings.local.json`.
 *
 * Every change that EXPANDS the scan's disk-access surface (adding
 * paths that resolve outside the project root) goes through a
 * `<p-confirmdialog>` that enumerates the paths the change will
 * expose. The confirm dialog re-issues the PATCH with
 * `confirm: true`. Writes that NARROW the surface (removing paths)
 * skip the dialog entirely.
 *
 * Mirrors the lifecycle pattern in `settings-plugins.ts` /
 * `settings-general.ts`: fetch on `(visible) === true`, render,
 * dispatch via the data-source port.
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

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type {
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
} from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';

@Component({
  selector: 'sm-settings-project',
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputTextModule,
    MessageModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './settings-project.html',
  styleUrl: './settings-project.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProject {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);

  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly preferences = signal<IProjectPreferencesApi | null>(null);
  /** Pending sub-key keys ('scan.referencePaths'), disable inputs. */
  protected readonly pending = signal<Set<string>>(new Set());

  /** New-row input box for the reference-paths list. */
  protected readonly newReferencePath = signal('');

  protected readonly referencePaths = computed<readonly string[]>(() => {
    const env = this.preferences();
    return env?.scan.referencePaths ?? [];
  });

  constructor() {
    effect(() => {
      if (this.visible()) void this.refresh();
    });
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

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

  /** Fetch the envelope. */
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
