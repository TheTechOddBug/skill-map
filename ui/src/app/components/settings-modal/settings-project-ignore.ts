/**
 * `<sm-settings-project-ignore>`, `.skillmapignore` patterns row of the
 * Settings > Project section.
 *
 * Gitignore-style filter for the scan. No privacy gate (patterns only
 * NARROW the surface); no existence check (entries are patterns, not
 * paths). The BFF preserves any comments / blank lines in the file on
 * write, so the operator can keep their hand-authored layout while
 * still using the UI for add/remove. Persists in `<cwd>/.skillmapignore`.
 *
 * Lifecycle mirrors the sibling children: fetch on `(visible) === true`.
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
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { UsageTrackerService } from '../../services/usage-tracker';
import type { IProjectIgnoreApi, IProjectIgnorePatchApi } from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { formatErr } from './settings-project.utils';

/**
 * Single line, no ASCII control / DEL characters. Mirrors the BFF's
 * AJV schema in `routes/project-ignore.ts`. Surfaces the validation
 * error in the same input the user typed in, before the network
 * round-trip.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RX = /[\n\r\x00-\x1F\x7F]/;

@Component({
  selector: 'sm-settings-project-ignore',
  imports: [FormsModule, ButtonModule, InputTextModule, MessageModule],
  templateUrl: './settings-project-ignore.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectIgnore {
  private readonly usageTracker = inject(UsageTrackerService);
  private readonly dataSource = inject(DATA_SOURCE);

  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;

  protected readonly ignoreLoadError = signal<string | null>(null);
  protected readonly ignoreSaveError = signal<string | null>(null);
  protected readonly ignoreEnvelope = signal<IProjectIgnoreApi | null>(null);
  protected readonly newIgnorePattern = signal('');
  /** Pending keys ('ignore.patterns' only in this child). */
  protected readonly pending = signal<Set<string>>(new Set());

  protected readonly ignorePatterns = computed<readonly string[]>(() => {
    return this.ignoreEnvelope()?.patterns ?? [];
  });

  constructor() {
    effect(() => {
      if (this.visible()) void this.refreshIgnore();
    });
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  protected onIgnorePatternAdd(): void {
    // Usage analytics (opt-in, default OFF): the gesture only, NEVER the
    // pattern text. See spec/telemetry.md §Usage event taxonomy.
    this.usageTracker.trackFeature('ignore-patterns-add');
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
    this.usageTracker.trackFeature('ignore-patterns-remove');
    const next = this.ignorePatterns().filter((p) => p !== pattern);
    void this.runIgnorePatch({ patterns: [...next] });
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

  /**
   * Dispatch a `.skillmapignore` patch. Simpler than the preferences
   * child's `runPatch` (no 412 / confirm-required branch, no existence
   * check) because the route narrows the scan surface by design.
   * Returns `true` on a successful persist so the caller can clear the
   * input box.
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
}
