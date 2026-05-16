/**
 * `SmTitleStrategy`, custom `TitleStrategy` that composes the
 * `document.title` from the current project name (last segment of
 * `/api/health.cwd`) and the running CLI version. Both come from
 * `ProjectInfoService` as signals that resolve once the health probe
 * lands, so the strategy re-applies the title via `effect()` when the
 * data arrives after the initial navigation.
 *
 * Format: `${projectName} - skill-map v${implVersion}` (with the
 * project / version segments dropped while still null). Route-level
 * `title:` is intentionally ignored, the operator works on one
 * project at a time and the tab is most useful as a project
 * discriminator across browser windows. The exact composer lives in
 * `APP_TEXTS.documentTitle` so the brand wording stays in the i18n
 * catalog.
 *
 * Wired via `{ provide: TitleStrategy, useClass: SmTitleStrategy }` in
 * `app.config.ts`.
 */

import { Injectable, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { APP_TEXTS } from '../../i18n/app.texts';
import { ProjectInfoService } from './project-info';

@Injectable({ providedIn: 'root' })
export class SmTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly projectInfo = inject(ProjectInfoService);

  constructor() {
    super();
    effect(() => {
      const projectName = lastPathSegment(this.projectInfo.cwd());
      const version = this.projectInfo.implVersion();
      this.title.setTitle(APP_TEXTS.documentTitle(projectName, version));
    });
  }

  override updateTitle(_snapshot: RouterStateSnapshot): void {
    const projectName = lastPathSegment(this.projectInfo.cwd());
    const version = this.projectInfo.implVersion();
    this.title.setTitle(APP_TEXTS.documentTitle(projectName, version));
  }
}

/**
 * Strips trailing slashes and returns the final segment of a path.
 * Handles `/` and `\` so Windows-flavoured cwds (`C:\projects\skill-map`)
 * read the same as POSIX. Returns null for null / empty / `.` so the
 * composer drops the project segment entirely when no real path is
 * available (demo mode, pre-health flash).
 */
function lastPathSegment(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.replace(/[\\/]+$/, '');
  if (!trimmed || trimmed === '.') return null;
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const segment = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return segment || null;
}
