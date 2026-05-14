import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';

import { LINK_KIND_PALETTE_TEXTS } from '../../../i18n/link-kind-palette.texts';
import { ALL_LINK_KINDS, FilterStoreService } from '../../../services/filter-store';
import type { TLinkKindApi } from '../../../models/api';

/**
 * One palette entry per spec link kind. Either `icon` (PrimeIcons
 * class string, rendered as `<i>`) OR `text` (literal character,
 * rendered as a styled span). Mutually exclusive at the template
 * level. The choice per kind is intentional: kinds that surface from
 * a literal markdown glyph (`/`, `@`) carry that exact character so
 * the operator recognises the source syntax instantly; kinds that
 * live in sidecar YAML (`supersedes`) or in `[text](path)` markdown
 * (`references`) use a representative PrimeIcon because their
 * source has no single-glyph signature.
 */
interface ILinkKindEntry {
  readonly kind: TLinkKindApi;
  readonly label: string;
  readonly icon?: string;
  readonly text?: string;
}

/**
 * Floating palette for toggling edge-kind visibility on the graph
 * view. Sibling of `<sm-kind-palette>`, stacks directly below it via
 * the `.graph__filter-stack` wrapper in graph-view.html.
 *
 * Differences vs the node-kind palette:
 *   - No counter, the operator cares about visibility, not totals.
 *   - Icon-only chassis with tooltip (the closed catalog of 4 link
 *     kinds is easy to memorise; counts would clutter without adding
 *     information).
 *   - Catalog is spec-fixed (`ALL_LINK_KINDS`), no Provider-driven
 *     extensibility, so no registry lookup needed.
 *
 * Toggling delegates to `FilterStoreService.toggleLinkKind`, the
 * existing `projectVisible()` in graph-layout reads
 * `selectedLinkKinds` and drops edges whose kind is filtered out.
 */
@Component({
  selector: 'sm-link-kind-palette',
  imports: [FormsModule, ToggleButtonModule, TooltipModule],
  templateUrl: './link-kind-palette.html',
  styleUrl: './link-kind-palette.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkKindPalette {
  private readonly filters = inject(FilterStoreService);

  protected readonly texts = LINK_KIND_PALETTE_TEXTS;

  /**
   * Per-kind glyph mapping. `text` carries the literal markdown
   * character for kinds whose source syntax has one (`/<command>`
   * for `invokes`, `@<handle>` for `mentions`); `icon` is a
   * PrimeIcons class for kinds whose source is structured (YAML in
   * `.sm` for `supersedes`, `[text](path)` for `references`).
   */
  protected readonly entries: readonly ILinkKindEntry[] = [
    { kind: 'invokes', label: LINK_KIND_PALETTE_TEXTS.kinds.invokes, text: '/' },
    { kind: 'references', label: LINK_KIND_PALETTE_TEXTS.kinds.references, icon: 'pi pi-link' },
    { kind: 'mentions', label: LINK_KIND_PALETTE_TEXTS.kinds.mentions, text: '@' },
    { kind: 'supersedes', label: LINK_KIND_PALETTE_TEXTS.kinds.supersedes, icon: 'pi pi-angle-double-right' },
  ];

  // Self-check: every entry must be in the spec-fixed universe; trips
  // immediately during development if a manual edit drifts the list.
  constructor() {
    for (const e of this.entries) {
      if (!ALL_LINK_KINDS.includes(e.kind)) {
        throw new Error(`link-kind-palette: unknown link kind "${e.kind}"`);
      }
    }
  }

  isActive(kind: TLinkKindApi): boolean {
    return this.filters.isLinkKindActive(kind);
  }

  toggle(kind: TLinkKindApi): void {
    this.filters.toggleLinkKind(kind);
  }
}
