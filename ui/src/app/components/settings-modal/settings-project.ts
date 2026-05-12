/**
 * `<sm-settings-project>` — Project section of the Settings modal.
 *
 * Surfaces two privacy-sensitive scan settings persisted in the
 * project's `<cwd>/.skill-map/settings.local.json`:
 *   - `scan.extraFolders`    (string[] — paths added to scan roots,
 *                             the only way to extend the scan beyond
 *                             the project)
 *   - `scan.referencePaths`  (string[] — paths walked for link
 *                             validation only, not indexed)
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
  /** Pending sub-key keys ('scan.extraFolders' / etc.) — disable inputs. */
  protected readonly pending = signal<Set<string>>(new Set());

  /** New-row input boxes for each list. */
  protected readonly newExtraFolder = signal('');
  protected readonly newReferencePath = signal('');

  protected readonly extraFolders = computed<readonly string[]>(() => {
    const env = this.preferences();
    return env?.scan.extraFolders ?? [];
  });
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

  protected onExtraFolderAdd(): void {
    const raw = this.newExtraFolder().trim();
    if (raw.length === 0) return;
    const next = [...this.extraFolders(), raw];
    void this.runPatch('scan.extraFolders', { scan: { extraFolders: next } }).then(() => {
      this.newExtraFolder.set('');
    });
  }

  protected onExtraFolderRemove(path: string): void {
    const next = this.extraFolders().filter((p) => p !== path);
    void this.runPatch('scan.extraFolders', { scan: { extraFolders: [...next] } });
  }

  protected onReferencePathAdd(): void {
    const raw = this.newReferencePath().trim();
    if (raw.length === 0) return;
    const next = [...this.referencePaths(), raw];
    void this.runPatch('scan.referencePaths', { scan: { referencePaths: next } }).then(
      () => {
        this.newReferencePath.set('');
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
   * surface in `saveError`.
   */
  private async runPatch(
    key: string,
    patch: IProjectPreferencesPatchApi,
  ): Promise<void> {
    if (this.pending().has(key)) return;
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.saveError.set(null);
    try {
      const envelope = await this.dataSource.setProjectPreferences(patch);
      this.preferences.set(envelope);
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
