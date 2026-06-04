/**
 * `<sm-settings-about>`, About section of the Settings modal. Shows
 * the CLI / server version, the spec version, the schema version,
 * project folder, and DB status. The CLI version is sourced from
 * `UpdateCheckService` (loaded on App boot); the rest comes from
 * `GET /api/health`, fetched lazily when the section becomes visible.
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

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IHealthResponseApi } from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import { ThemeService } from '../../../services/theme';
import { UpdateCheckService } from '../../services/update-check';

@Component({
  selector: 'sm-settings-about',
  templateUrl: './settings-about.html',
  styleUrl: './settings-about.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsAbout {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly updateCheck = inject(UpdateCheckService);
  private readonly theme = inject(ThemeService);

  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly health = signal<IHealthResponseApi | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** Mark logo source, flips with the active theme so the SVG fill
   *  stays readable on both backgrounds. Mirror of the topbar's
   *  `App.markSrc` computed; the assets live in `ui/public/`. */
  protected readonly markSrc = computed(() =>
    this.theme.resolved() === 'dark'
      ? 'skill-map-mark-light.svg'
      : 'skill-map-mark-dark.svg',
  );

  protected readonly cliVersion = computed(() => {
    return this.updateCheck.current()
      ?? this.health()?.implVersion
      ?? this.texts.aboutUnknown;
  });
  protected readonly specVersion = computed(
    () => this.health()?.specVersion ?? this.texts.aboutLoading,
  );
  protected readonly schemaVersion = computed(
    () => this.health()?.schemaVersion ?? this.texts.aboutLoading,
  );
  protected readonly cwd = computed(
    () => this.health()?.cwd ?? this.texts.aboutLoading,
  );
  /**
   * Combined "<status> · <path>" cell for the DB row. Falls back to
   * the bare status during the load window so the UI doesn't flash an
   * empty path. When the DB is missing, `dbPath` still points at the
   * spot it would live, useful for the "run sm scan there" hint.
   *
   * Path is rendered relative to `cwd` (the project folder shown in
   * the row above) so the user sees `​.skill-map/skill-map.db` instead
   * of the longer `~/.../.skill-map/skill-map.db` clutter. Both
   * `cwd` and `dbPath` arrive `~`-prefixed from the BFF, so the
   * prefix-strip works on equal footing.
   */
  protected readonly dbDisplay = computed(() => {
    const h = this.health();
    if (!h) return this.texts.aboutLoading;
    return this.texts.aboutDbValue(h.db, relativeToCwd(h.dbPath, h.cwd));
  });
  constructor() {
    effect(() => {
      if (this.visible() && this.health() === null) void this.load();
    });
  }

  private async load(): Promise<void> {
    this.loadError.set(null);
    try {
      const payload = await this.dataSource.health();
      this.health.set(payload);
    } catch (err) {
      const message =
        err instanceof DataSourceError ? err.message
        : err instanceof Error ? err.message
        : String(err);
      this.loadError.set(message);
    }
  }
}

/**
 * Strip the `cwd` prefix from `dbPath` so the DB row shows the path
 * relative to the project folder (which is already in the row above).
 *
 * Both POSIX (`/`) and Windows (`\\`) separators are handled, the BFF
 * runs on the same OS as the user's project, so `cwd` and `dbPath`
 * always share the same separator style. The trailing-separator strip
 * makes `\/home\/foo\/proj` and `\/home\/foo\/proj\/` behave identically.
 *
 * Returns the absolute path unchanged if the DB lives outside `cwd`
 * (e.g. an explicit `--db <other-path>` override), better honest
 * than wrong.
 */
function relativeToCwd(dbPath: string, cwd: string): string {
  if (!dbPath || !cwd) return dbPath;
  const normalizedCwd = cwd.replace(/[/\\]+$/, '');
  if (!dbPath.startsWith(normalizedCwd)) return dbPath;
  const rest = dbPath.slice(normalizedCwd.length);
  return rest.replace(/^[/\\]+/, '');
}
