/**
 * `SmTitleStrategy`, custom `TitleStrategy` that composes the
 * `document.title` from the activated route's `title` and the running
 * CLI version. The version comes from `ProjectInfoService.implVersion`,
 * a signal that resolves once `/api/health` returns, so the strategy
 * re-applies the title via `effect()` when the version arrives after
 * the initial navigation.
 *
 * Format: `${route.title} - skill-map v${implVersion}` (or without the
 * version suffix until the first probe resolves). The exact composer
 * lives in `APP_TEXTS.documentTitle` so the brand wording stays in the
 * i18n catalog.
 *
 * Wired via `{ provide: TitleStrategy, useClass: SmTitleStrategy }` in
 * `app.config.ts`. Routes set `title:` directly (Angular Router 14+
 * native field), not `data.title` (which is not auto-consumed).
 */

import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { APP_TEXTS } from '../../i18n/app.texts';
import { ProjectInfoService } from './project-info';

@Injectable({ providedIn: 'root' })
export class SmTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly projectInfo = inject(ProjectInfoService);
  private readonly lastSnapshot = signal<RouterStateSnapshot | null>(null);

  constructor() {
    super();
    effect(() => {
      const snap = this.lastSnapshot();
      // Touch the version signal so the effect re-runs when it lands.
      this.projectInfo.implVersion();
      if (snap) this.applyTitle(snap);
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.lastSnapshot.set(snapshot);
    this.applyTitle(snapshot);
  }

  private applyTitle(snapshot: RouterStateSnapshot): void {
    const base = this.buildTitle(snapshot);
    const version = this.projectInfo.implVersion();
    if (!base) {
      this.title.setTitle(version ? `${APP_TEXTS.brand} v${version}` : APP_TEXTS.brand);
      return;
    }
    this.title.setTitle(APP_TEXTS.documentTitle(base, version));
  }
}
