/**
 * `<sm-settings-coming-soon>` — placeholder body for sidebar entries
 * whose content has not landed yet (today: General, About). The
 * sidebar metaphor stays visible from day one so users discover
 * future surfaces without us having to commit a date.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';

@Component({
  selector: 'sm-settings-coming-soon',
  template: `
    <section
      class="settings-coming-soon"
      [attr.aria-labelledby]="headingId()"
      [attr.data-testid]="'settings-coming-soon-' + sectionId()"
    >
      <i class="pi pi-clock settings-coming-soon__icon" aria-hidden="true"></i>
      <h2 [id]="headingId()" class="settings-coming-soon__title">
        {{ texts.comingSoonTitle }}
      </h2>
      <p class="settings-coming-soon__body">
        {{ texts.comingSoonBody(sectionLabel()) }}
      </p>
    </section>
  `,
  styles: [
    `
      :host {
        display: flex;
        height: 100%;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
      }
      .settings-coming-soon {
        max-width: 420px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        color: var(--p-text-muted-color);
      }
      .settings-coming-soon__icon {
        font-size: 2rem;
        opacity: 0.6;
      }
      .settings-coming-soon__title {
        font-size: 1.05rem;
        font-weight: 600;
        margin: 0;
        color: var(--p-text-color);
      }
      .settings-coming-soon__body {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.5;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComingSoon {
  readonly sectionId = input.required<string>();
  readonly sectionLabel = input.required<string>();

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly headingId = computed(
    () => `settings-coming-soon-${this.sectionId()}-heading`,
  );
}
