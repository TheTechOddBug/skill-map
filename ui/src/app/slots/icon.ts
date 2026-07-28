import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Tiny shared component that resolves a manifest-declared `icon` string
 * per the spec rule (`view-slots.schema.json#/$defs/IconString`):
 *
 *   - First codepoint is NOT an ASCII letter → render as emoji text in `<span>`.
 *   - `pi-foo` or `pi pi-foo` → PrimeIcons (`<i class="pi pi-foo">`).
 *   - `fa-solid fa-foo` / `fa-regular fa-foo` / `fa-brands fa-foo` →
 *     FontAwesome pass-through.
 *   - `fa-foo` (no family token) → defaults to `fa-solid fa-foo`.
 *   - Anything else → resolver returns `null`; nothing renders + a console
 *     warning that surfaces the offending value.
 *
 * The AJV `pattern` on `IconString` rejects bare-name manifests at load,
 * so the `null` branch only covers runtime corruption (legacy persisted
 * row, hand-edited sidecar). The warning lets the operator clean it up.
 *
 * Used by every `node-*` / `scope-stat` renderer that surfaces a manifest
 * icon (NodeCounter, NodeAlert, NodeIcon, ScopeStat). Pass the wrapper
 * class via `hostClass` so the renderer keeps its CSS hooks
 * (`.vc-counter__icon`, `.vc-icon__glyph`, etc.) and the icon size
 * inherits from the renderer's scope.
 */

export type TResolvedIcon =
  | { kind: 'emoji'; text: string }
  | { kind: 'pi'; cls: string }
  | { kind: 'fa'; cls: string };

/**
 * Pure resolver, exported so tests can exercise the branch matrix
 * without booting Angular TestBed.
 */
export function resolveIcon(raw: string | undefined): TResolvedIcon | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length === 0) return null;

  // Emoji / symbol branch: first codepoint is NOT an ASCII letter. Mirrors
  // the AJV `[^a-zA-Z].*` alternative in `IconString.pattern`. Catches
  // every emoji (single codepoint or ZWJ-joined sequence) and the few
  // ASCII punctuation icons existing manifests use (`@`, `#`).
  const first = value.codePointAt(0) ?? 0;
  const isAsciiLetter =
    (first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a);
  if (!isAsciiLetter) {
    return { kind: 'emoji', text: value };
  }

  // PrimeIcons, accept both shorthand (`pi-foo`) and full class
  // (`pi pi-foo`). The shorthand prepends the PrimeIcons class loader
  // (`pi`) so the rendered <i> always carries both tokens.
  if (/^pi pi-[a-z0-9-]+$/.test(value)) {
    return { kind: 'pi', cls: value };
  }
  if (/^pi-[a-z0-9-]+$/.test(value)) {
    return { kind: 'pi', cls: `pi ${value}` };
  }

  // FontAwesome, explicit family wins (`fa-solid fa-foo` / regular / brands)
  // and passes through unmodified. Shorthand (`fa-foo`) defaults to solid;
  // FA Free's regular set is small so solid is the safe choice.
  if (/^fa-(?:solid|regular|brands) fa-[a-z0-9-]+$/.test(value)) {
    return { kind: 'fa', cls: value };
  }
  if (/^fa-[a-z0-9-]+$/.test(value)) {
    const name = value.slice(3);
    // Reject the family keywords on their own (`fa-solid`, `fa-regular`,
    // `fa-brands`), they look like shorthand but are the family token
    // missing its `fa-foo`. Reject names that contain `fa-` internally,
    // catches typos like `fa-solidfa-star` (missing the space between
    // family and icon).
    if (name === 'solid' || name === 'regular' || name === 'brands') return null;
    if (name.includes('fa-')) return null;
    return { kind: 'fa', cls: `fa-solid ${value}` };
  }

  return null;
}

@Component({
  selector: 'sm-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resolved(); as r) {
      @if (r.kind === 'emoji') {
        <span [class]="hostClass()" aria-hidden="true">{{ r.text }}</span>
      } @else {
        <i [class]="hostClass() + ' ' + r.cls" aria-hidden="true"></i>
      }
    }
  `,
  // PrimeIcons / FontAwesome `<i>` glyphs ship with absolute, non-inherited
  // font-size in their default CSS. Forcing the `<i>` AND `<span>` to
  // inherit makes the rendered glyph follow the wrapper's font-size in
  // both branches, so a renderer that wants an --sm-fs-2xs icon declares
  // it on the wrapper class once and both branches obey.
  //
  // The 1px `<i>` nudge mirrors `node-card.css`, PrimeIcons' (and FA's)
  // icon fonts have an asymmetric ascender/descender so the glyph reads
  // above the em-box centre even when the BOX is correctly flex-aligned.
  // Emojis use the system font's balanced metrics and do not need it.
  styles: [`
    :host i,
    :host span { font-size: inherit; line-height: inherit; }
    :host i { transform: translateY(1px); }
  `],
})
export class Icon {
  readonly icon = input<string | undefined>(undefined);
  readonly hostClass = input<string>('');

  protected readonly resolved = computed<TResolvedIcon | null>(() => {
    const raw = this.icon();
    const out = resolveIcon(raw);
    if (raw && !out) {
      // eslint-disable-next-line no-console
      console.warn(
        `[sm-icon] Invalid icon string "${raw}". Expected emoji, ` +
          `pi-foo, pi pi-foo, fa-{solid|regular|brands} fa-foo, or fa-foo.`,
      );
    }
    return out;
  });
}
