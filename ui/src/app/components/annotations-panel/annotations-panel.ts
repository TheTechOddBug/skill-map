/**
 * `<sm-annotations-panel>` — Step 9.6.5. Read-only renderer of a node's
 * sidecar (`.sm`) `annotations:` block. Categorised per the logical
 * grouping declared in `spec/schemas/annotations.schema.json`:
 *
 *   - Lifecycle: version, stability, created, updated, released
 *   - Supersession: supersedes, supersededBy, requires, conflictsWith,
 *     provides, related
 *   - Provenance: type, author, authors, license, source, sourceVersion
 *   - Taxonomy: tags, category, keywords
 *   - Display: icon, color, priority, hidden
 *   - Docs: docsUrl
 *
 * Empty sections collapse / hide. Values render as text / chip / link
 * based on type:
 *
 *   - `version` → integer
 *   - `stability` → coloured chip
 *   - dates → ISO 8601, tooltip shows the raw value
 *   - path lists → clickable chips, navigate via `(openPath)` output
 *   - `source` / `docsUrl` → external links (target=_blank rel=noopener)
 *   - `tags` / `keywords` → chip lists
 *   - everything else → plain text
 *
 * No editing in 9.6.5 — the bump button (in the inspector action area)
 * mutates the sidecar via the BFF; this panel only displays.
 */

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  input,
} from '@angular/core';
import { ChipModule } from 'primeng/chip';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { ANNOTATIONS_PANEL_TEXTS } from '../../../i18n/annotations-panel.texts';
import type { ISidecarOverlay, TStability } from '../../../models/node';

/**
 * Stability-tag severity mapping. Matches `inspector-view.ts` so the
 * panel's chip tints align with the inspector header's stability tag.
 */
const STABILITY_SEVERITY: Record<TStability, 'success' | 'info' | 'warn'> = {
  stable: 'success',
  experimental: 'info',
  deprecated: 'warn',
};

interface ILifecycleSection {
  version: number | null;
  stability: TStability | null;
  created: string | null;
  updated: string | null;
  released: string | null;
}

interface ISupersessionSection {
  supersedes: readonly string[];
  supersededBy: string | null;
  requires: readonly string[];
  conflictsWith: readonly string[];
  provides: readonly string[];
  related: readonly string[];
}

interface IProvenanceSection {
  type: string | null;
  author: string | null;
  authors: readonly string[];
  license: string | null;
  source: string | null;
  sourceVersion: string | null;
}

interface ITaxonomySection {
  tags: readonly string[];
  category: string | null;
  keywords: readonly string[];
}

interface IDisplaySection {
  icon: string | null;
  color: string | null;
  priority: number | null;
  hidden: boolean | null;
}

interface IDocsSection {
  docsUrl: string | null;
}

@Component({
  selector: 'sm-annotations-panel',
  imports: [ChipModule, TagModule, TooltipModule],
  templateUrl: './annotations-panel.html',
  styleUrl: './annotations-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnotationsPanel {
  readonly overlay = input<ISidecarOverlay | null | undefined>(undefined);

  /**
   * Emitted when the user clicks a path-typed annotation chip
   * (`supersedes`, `supersededBy`, `requires`, `related`). The host
   * (inspector) decides how to navigate — same pattern as the existing
   * relations card.
   */
  @Output() readonly openPath = new EventEmitter<string>();

  protected readonly texts = ANNOTATIONS_PANEL_TEXTS;

  protected readonly annotations = computed<Record<string, unknown> | null>(() => {
    const o = this.overlay();
    if (!o || !o.present) return null;
    return o.annotations ?? null;
  });

  protected readonly hasAnnotations = computed<boolean>(() => {
    const a = this.annotations();
    return a !== null && Object.keys(a).length > 0;
  });

  protected readonly lifecycle = computed<ILifecycleSection>(() => {
    const a = this.annotations() ?? {};
    return {
      version: numberOrNull(a['version']),
      stability: stabilityOrNull(a['stability']),
      created: stringOrNull(a['created']),
      updated: stringOrNull(a['updated']),
      released: stringOrNull(a['released']),
    };
  });
  protected readonly hasLifecycle = computed<boolean>(() => sectionHasContent(this.lifecycle() as unknown as Record<string, unknown>));

  protected readonly supersession = computed<ISupersessionSection>(() => {
    const a = this.annotations() ?? {};
    return {
      supersedes: stringArray(a['supersedes']),
      supersededBy: stringOrNull(a['supersededBy']),
      requires: stringArray(a['requires']),
      conflictsWith: stringArray(a['conflictsWith']),
      provides: stringArray(a['provides']),
      related: stringArray(a['related']),
    };
  });
  protected readonly hasSupersession = computed<boolean>(() => sectionHasContent(this.supersession() as unknown as Record<string, unknown>));

  protected readonly provenance = computed<IProvenanceSection>(() => {
    const a = this.annotations() ?? {};
    return {
      type: stringOrNull(a['type']),
      author: stringOrNull(a['author']),
      authors: stringArray(a['authors']),
      license: stringOrNull(a['license']),
      source: stringOrNull(a['source']),
      sourceVersion: stringOrNull(a['sourceVersion']),
    };
  });
  protected readonly hasProvenance = computed<boolean>(() => sectionHasContent(this.provenance() as unknown as Record<string, unknown>));

  protected readonly taxonomy = computed<ITaxonomySection>(() => {
    const a = this.annotations() ?? {};
    return {
      tags: stringArray(a['tags']),
      category: stringOrNull(a['category']),
      keywords: stringArray(a['keywords']),
    };
  });
  protected readonly hasTaxonomy = computed<boolean>(() => sectionHasContent(this.taxonomy() as unknown as Record<string, unknown>));

  protected readonly display = computed<IDisplaySection>(() => {
    const a = this.annotations() ?? {};
    return {
      icon: stringOrNull(a['icon']),
      color: stringOrNull(a['color']),
      priority: numberOrNull(a['priority']),
      hidden: typeof a['hidden'] === 'boolean' ? (a['hidden'] as boolean) : null,
    };
  });
  protected readonly hasDisplay = computed<boolean>(() => sectionHasContent(this.display() as unknown as Record<string, unknown>));

  protected readonly docs = computed<IDocsSection>(() => {
    const a = this.annotations() ?? {};
    return { docsUrl: stringOrNull(a['docsUrl']) };
  });
  protected readonly hasDocs = computed<boolean>(() => sectionHasContent(this.docs() as unknown as Record<string, unknown>));

  protected stabilitySeverity(s: TStability): 'success' | 'info' | 'warn' {
    return STABILITY_SEVERITY[s];
  }

  protected onOpenPath(p: string): void {
    this.openPath.emit(p);
  }
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function stabilityOrNull(v: unknown): TStability | null {
  if (v === 'stable' || v === 'experimental' || v === 'deprecated') return v;
  return null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * True when at least one field on the section object carries a non-empty
 * value (non-null, non-empty-array, non-empty-string).
 */
function sectionHasContent(section: Record<string, unknown>): boolean {
  for (const value of Object.values(section)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) return true;
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > 0) return true;
      continue;
    }
    // numbers (including 0), booleans (including false) count as content.
    return true;
  }
  return false;
}
