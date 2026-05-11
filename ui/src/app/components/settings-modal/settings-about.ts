/**
 * `<sm-settings-about>` — About section of the Settings modal. Shows
 * the CLI / server version, the spec version, the schema version,
 * scope, and DB status. The CLI version is sourced from
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
  template: `
    <section class="settings-about" aria-labelledby="settings-about-heading" data-testid="settings-about">
      <header class="settings-about__header">
        <img
          class="settings-about__logo"
          [src]="markSrc()"
          alt=""
          aria-hidden="true"
          data-testid="settings-about-logo"
        />
        <div class="settings-about__heading-text">
          <h2 id="settings-about-heading" class="settings-about__title">
            {{ texts.aboutHeading }}
          </h2>
          <p class="settings-about__intro">{{ texts.aboutIntro }}</p>
        </div>
      </header>

      @if (loadError()) {
        <p class="settings-about__error" data-testid="settings-about-error">
          {{ texts.aboutErrorPrefix }} {{ loadError() }}
        </p>
      }

      <a
        class="settings-about__star"
        [href]="texts.aboutGithubUrl"
        target="_blank"
        rel="noopener noreferrer"
        [attr.aria-label]="texts.aboutStarA11y"
        data-testid="settings-about-star"
      >
        <i class="fa-solid fa-star settings-about__star-icon" aria-hidden="true"></i>
        <span class="settings-about__star-text">
          <span class="settings-about__star-heading">{{ texts.aboutStarHeading }}</span>
          <span class="settings-about__star-body">{{ texts.aboutStarBody }}</span>
        </span>
        <span class="settings-about__star-cta">
          <i class="fa-solid fa-star" aria-hidden="true"></i>
          {{ texts.aboutStarCta }}
        </span>
      </a>

      <dl class="settings-about__list">
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutWebsiteLabel }}</dt>
          <dd class="settings-about__value">
            <a
              [href]="texts.aboutWebsiteUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="settings-about__link"
              data-testid="settings-about-website"
            >{{ texts.aboutWebsiteUrl }}</a>
          </dd>
        </div>
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutGithubLabel }}</dt>
          <dd class="settings-about__value">
            <a
              [href]="texts.aboutGithubUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="settings-about__link"
              data-testid="settings-about-github"
            >{{ texts.aboutGithubUrl }}</a>
          </dd>
        </div>
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutCliLabel }}</dt>
          <dd class="settings-about__value" data-testid="settings-about-cli">
            {{ cliVersion() }}
          </dd>
        </div>
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutSpecLabel }}</dt>
          <dd class="settings-about__value" data-testid="settings-about-spec">
            {{ specVersion() }}
          </dd>
        </div>
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutSchemaLabel }}</dt>
          <dd class="settings-about__value" data-testid="settings-about-schema">
            {{ schemaVersion() }}
          </dd>
        </div>
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutScopeLabel }}</dt>
          <dd class="settings-about__value" data-testid="settings-about-scope">
            {{ scope() }}
          </dd>
        </div>
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutFolderLabel }}</dt>
          <dd class="settings-about__value" data-testid="settings-about-cwd">
            {{ cwd() }}
          </dd>
        </div>
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutDbLabel }}</dt>
          <dd class="settings-about__value" data-testid="settings-about-db">
            {{ dbDisplay() }}
          </dd>
        </div>
        <div class="settings-about__row">
          <dt class="settings-about__label">{{ texts.aboutHomeLabel }}</dt>
          <dd class="settings-about__value" data-testid="settings-about-home">
            {{ homeDir() }}
          </dd>
        </div>
      </dl>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
        padding: 1.25rem 1.5rem;
      }
      .settings-about {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .settings-about__header {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .settings-about__logo {
        width: 64px;
        height: 64px;
        flex-shrink: 0;
      }
      .settings-about__heading-text {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
      }
      .settings-about__title {
        font-size: 1.15rem;
        font-weight: 600;
        margin: 0;
      }
      .settings-about__intro {
        margin: 0;
        color: var(--p-text-muted-color);
        font-size: 0.875rem;
      }
      .settings-about__error {
        margin: 0;
        padding: 0.5rem 0.75rem;
        border-radius: var(--p-border-radius);
        background: var(--p-message-error-background);
        color: var(--p-message-error-color);
        font-size: 0.875rem;
      }
      .settings-about__list {
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .settings-about__row {
        display: grid;
        grid-template-columns: 180px 1fr;
        align-items: baseline;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: var(--p-border-radius);
      }
      .settings-about__row:nth-child(odd) {
        background: var(--p-content-hover-background);
      }
      .settings-about__label {
        margin: 0;
        font-size: 0.875rem;
        color: var(--p-text-muted-color);
      }
      .settings-about__value {
        margin: 0;
        font-family: var(--p-monospace-font-family, ui-monospace, monospace);
        font-size: 0.875rem;
        word-break: break-all;
      }
      .settings-about__link {
        color: var(--p-primary-color);
        text-decoration: none;
      }
      .settings-about__link:hover,
      .settings-about__link:focus-visible {
        text-decoration: underline;
      }
      /* GitHub-star callout. Gold/amber accent built off color-mix
         against a single seed so light + dark themes share the recipe.
         The whole card is the link target — clicking anywhere opens
         the repo. The CTA pill on the right doubles as a visual
         affordance ("this is clickable") without a real <button>. */
      .settings-about__star {
        --star-accent: #f4b400;
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 0.875rem 1rem;
        border-radius: var(--p-border-radius);
        border: 1px solid color-mix(in oklab, var(--star-accent) 45%, transparent);
        background: color-mix(in oklab, var(--star-accent) 12%, transparent);
        color: var(--p-text-color);
        text-decoration: none;
        cursor: pointer;
        transition:
          background 0.15s ease,
          border-color 0.15s ease,
          transform 0.15s ease;
      }
      .settings-about__star:hover,
      .settings-about__star:focus-visible {
        background: color-mix(in oklab, var(--star-accent) 22%, transparent);
        border-color: color-mix(in oklab, var(--star-accent) 70%, transparent);
        transform: translateY(-1px);
        outline: none;
      }
      :host-context(.app-dark) .settings-about__star {
        background: color-mix(in oklab, var(--star-accent) 18%, transparent);
        border-color: color-mix(in oklab, var(--star-accent) 55%, transparent);
      }
      :host-context(.app-dark) .settings-about__star:hover,
      :host-context(.app-dark) .settings-about__star:focus-visible {
        background: color-mix(in oklab, var(--star-accent) 30%, transparent);
        border-color: var(--star-accent);
      }
      .settings-about__star-icon {
        font-size: 1.5rem;
        color: var(--star-accent);
        flex-shrink: 0;
      }
      .settings-about__star-text {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        flex: 1;
        min-width: 0;
      }
      .settings-about__star-heading {
        font-weight: 600;
        font-size: 0.95rem;
      }
      .settings-about__star-body {
        font-size: 0.8125rem;
        color: var(--p-text-muted-color);
        line-height: 1.4;
      }
      .settings-about__star-cta {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        border-radius: 999px;
        background: var(--star-accent);
        color: #1a1a1a;
        font-weight: 600;
        font-size: 0.8125rem;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .settings-about__star:hover .settings-about__star-cta,
      .settings-about__star:focus-visible .settings-about__star-cta {
        background: color-mix(in oklab, var(--star-accent) 88%, white);
      }
    `,
  ],
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
  /** Mark logo source — flips with the active theme so the SVG fill
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
  protected readonly scope = computed(
    () => this.health()?.scope ?? this.texts.aboutLoading,
  );
  protected readonly cwd = computed(
    () => this.health()?.cwd ?? this.texts.aboutLoading,
  );
  /**
   * Combined "<status> · <path>" cell for the DB row. Falls back to
   * the bare status during the load window so the UI doesn't flash an
   * empty path. When the DB is missing, `dbPath` still points at the
   * spot it would live — useful for the "run sm scan there" hint.
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
  /**
   * User-scope `.skill-map/` directory (`<homedir>/.skill-map`). Shown
   * verbatim — the path is deterministic from `homedir` and surfaces
   * regardless of whether any configuration has been written yet.
   */
  protected readonly homeDir = computed(
    () => this.health()?.homeDir ?? this.texts.aboutLoading,
  );

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
 * Both POSIX (`/`) and Windows (`\\`) separators are handled — the BFF
 * runs on the same OS as the user's project, so `cwd` and `dbPath`
 * always share the same separator style. The trailing-separator strip
 * makes `\/home\/foo\/proj` and `\/home\/foo\/proj\/` behave identically.
 *
 * Returns the absolute path unchanged if the DB lives outside `cwd`
 * (e.g. global scope `~/.skill-map/...` while the user is in a
 * project folder, or an explicit `--db <other-path>` override) —
 * better honest than wrong.
 */
function relativeToCwd(dbPath: string, cwd: string): string {
  if (!dbPath || !cwd) return dbPath;
  const normalizedCwd = cwd.replace(/[/\\]+$/, '');
  if (!dbPath.startsWith(normalizedCwd)) return dbPath;
  const rest = dbPath.slice(normalizedCwd.length);
  return rest.replace(/^[/\\]+/, '');
}
