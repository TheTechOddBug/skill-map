import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Tiny shared component that resolves a manifest-declared `icon` string
 * per the spec rule (`view-slots.schema.json#/$defs/IconString`):
 *
 *   - matches Unicode `\p{Extended_Pictographic}` → render as emoji text.
 *   - otherwise → render as `<i class="pi pi-{icon}">` (PrimeIcons name
 *     without the `pi-` prefix; the host prepends it).
 *
 * Used by every `node-*` renderer that surfaces a manifest icon
 * (NodeCounter, NodeAlert, NodeIcon, ScopeStat). Pass the wrapper class
 * via `hostClass` so the renderer keeps its existing CSS hooks
 * (`.vc-counter__icon`, `.vc-icon__glyph`, etc.) and the icon size
 * inherits from the renderer's scope.
 */
@Component({
  selector: 'sm-icon-glyph',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (icon()) {
      @if (isEmoji()) {
        <span [class]="hostClass()" aria-hidden="true">{{ icon() }}</span>
      } @else {
        <i [class]="hostClass() + ' pi pi-' + icon()" aria-hidden="true"></i>
      }
    }
  `,
})
export class IconGlyph {
  readonly icon = input<string | undefined>(undefined);
  readonly hostClass = input<string>('');

  protected readonly isEmoji = computed(() => {
    const i = this.icon();
    if (!i) return false;
    return /\p{Extended_Pictographic}/u.test(i);
  });
}
