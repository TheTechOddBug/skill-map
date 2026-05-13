/**
 * `<sm-settings-changelog>`, user-facing release notes for the
 * Settings → Changelog tab. Reads `USER_CHANGELOG` (bundled JSON via
 * `data/user-changelog.ts`) and renders newest-first as a vertical
 * stack of version blocks. Each block: `v{version}, {date}` header,
 * a bullet list of highlights, with affected packages shown as small
 * pills after each bullet.
 *
 * Internal-only releases (`kind: 'internal'`) render a single muted
 * line so versions don't silently disappear from the user's view,
 * "we shipped, just nothing user-facing this time".
 *
 * Read-only by nature; same content in live and demo modes (the
 * underlying JSON is bundled into the SPA).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { OnInit } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import {
  USER_CHANGELOG,
  type IUserChangelogEntry,
} from '../../../data/user-changelog';

interface IRenderedHighlight {
  readonly bodyHtml: SafeHtml;
  readonly packages: readonly string[];
}

interface IRenderedEntry {
  readonly version: string;
  readonly date: string;
  readonly kind: IUserChangelogEntry['kind'];
  readonly highlights: readonly IRenderedHighlight[];
}

@Component({
  selector: 'sm-settings-changelog',
  templateUrl: './settings-changelog.html',
  styleUrl: './settings-changelog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsChangelog implements OnInit {
  private readonly markdown = inject(MarkdownRenderer);

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly entries = signal<readonly IRenderedEntry[]>([]);

  protected readonly hasEntries = computed(() => this.entries().length > 0);

  ngOnInit(): void {
    void this.renderAll();
  }

  /**
   * Render every highlight body through the markdown pipeline (same
   * markdown-it + DOMPurify path the inspector body uses) and stash
   * the result in a signal. `MarkdownRenderer.render` is async because
   * the highlight() / DOMPurify chain is initialised lazily; entries
   * stay empty until the first render flush completes, fine because
   * the panel is itself behind a `@defer` boundary.
   */
  private async renderAll(): Promise<void> {
    const out: IRenderedEntry[] = [];
    for (const entry of USER_CHANGELOG.entries) {
      const highlights: IRenderedHighlight[] = [];
      for (const h of entry.highlights) {
        highlights.push({
          bodyHtml: await this.markdown.render(h.body),
          packages: h.packages,
        });
      }
      out.push({
        version: entry.version,
        date: this.formatDate(entry.date),
        kind: entry.kind,
        highlights,
      });
    }
    this.entries.set(out);
  }

  /**
   * `2026-05-09` → `9 May 2026`. Locale-stable: en-GB short format
   * via `Intl.DateTimeFormat`. Falls back to the raw ISO string if
   * parsing fails (defensive against malformed seed data).
   */
  private formatDate(iso: string): string {
    const date = new Date(iso + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
}
