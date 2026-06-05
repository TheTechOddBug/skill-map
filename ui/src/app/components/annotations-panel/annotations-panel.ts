/**
 * `<sm-annotations-panel>`, read-only renderer of a node's sidecar
 * (`.sm`) `annotations:` block. Mirrors the sub-section grouping
 * declared in `spec/schemas/annotations.schema.json`:
 *
 *   - Authors: `authors[]`, `license`
 *   - Supersession: `supersedes`, `supersededBy`
 *   - Repository: `source` (upstream URL), `sourceVersion`
 *   - Docs: `docsUrl`
 *
 * Tags (`annotations.tags`) are NOT rendered here: they live in the
 * inspector header as a clickable tag row (clicking one selects every
 * node carrying that tag on the map).
 *
 * Each sub-section hides cleanly when its data is empty / absent.
 * Path-typed fields (`supersedes`, `supersededBy`) render as
 * clickable chips. When the target path is NOT in the local node
 * store the chip degrades to a muted / strikethrough state with a
 * "broken-ref" tooltip, the host (inspector) decides whether to
 * upgrade the heuristic via a verify round-trip.
 *
 * No editing in 9.6.5, the bump button (in the inspector action area)
 * mutates the sidecar via the BFF; this panel only displays.
 *
 * Pre-curation fields the orchestrator dropped end-to-end (panel no
 * longer renders even if a stale `.sm` carries them):
 *   - Lifecycle.created / Lifecycle.updated → `audit:` carries the
 *     authoritative timestamps.
 *   - Provenance.type / Provenance.author → curated out (multi-author
 *     `authors[]` is the only surviving author-shape).
 *   - Taxonomy.category / Taxonomy.keywords → tags absorb the role.
 *   - The whole Display section (icon / color / priority).
 *   - Supersession.provides → curated out (no semantics yet).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { ANNOTATIONS_PANEL_TEXTS } from '../../../i18n/annotations-panel.texts';
import type { ISidecarOverlay } from '../../../models/node';
import { httpUrlOrNull } from '../../../services/url-guard';

interface ISupersessionSection {
  supersedes: readonly string[];
  supersededBy: string | null;
}

interface IProvenanceSection {
  authors: readonly string[];
  license: string | null;
}

interface IRepositorySection {
  source: string | null;
  sourceVersion: string | null;
}

interface IDocsSection {
  docsUrl: string | null;
}

@Component({
  selector: 'sm-annotations-panel',
  imports: [TooltipModule],
  templateUrl: './annotations-panel.html',
  styleUrl: './annotations-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnotationsPanel {
  readonly overlay = input<ISidecarOverlay | null | undefined>(undefined);

  /**
   * Set of node paths that exist in the local store. The panel uses it
   * to mark broken-ref chips (paths that don't resolve to a known
   * node). Empty / absent → all chips render in the live state and the
   * host has to resolve breakage some other way.
   */
  readonly knownPaths = input<ReadonlySet<string> | null>(null);

  /**
   * Emitted when the user clicks a path-typed annotation chip
   * (`supersedes`, `supersededBy`). The host (inspector) decides how
   * to navigate, same pattern as the existing relations card.
   */
  readonly openPath = output<string>();

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

  /**
   * `true` when at least one section has data to render from the
   * sidecar overlay's annotations. Drives the empty-state branches at
   * the top of the template: when this is false we render the "no
   * sidecar" / "no annotations" placeholder; otherwise we render the
   * sections.
   */
  protected readonly hasAnyContent = computed<boolean>(
    () =>
      this.hasSupersession() ||
      this.hasProvenance() ||
      this.hasRepository() ||
      this.hasDocs(),
  );

  protected readonly supersession = computed<ISupersessionSection>(() => {
    const a = this.annotations() ?? {};
    return {
      supersedes: stringArray(a['supersedes']),
      supersededBy: stringOrNull(a['supersededBy']),
    };
  });
  protected readonly hasSupersession = computed<boolean>(() =>
    sectionHasContent(this.supersession() as unknown as Record<string, unknown>),
  );

  protected readonly provenance = computed<IProvenanceSection>(() => {
    const a = this.annotations() ?? {};
    return {
      authors: stringArray(a['authors']),
      license: stringOrNull(a['license']),
    };
  });
  protected readonly hasProvenance = computed<boolean>(() =>
    sectionHasContent(this.provenance() as unknown as Record<string, unknown>),
  );

  protected readonly repository = computed<IRepositorySection>(() => {
    const a = this.annotations() ?? {};
    return {
      source: httpUrlOrNull(a['source']),
      sourceVersion: stringOrNull(a['sourceVersion']),
    };
  });
  protected readonly hasRepository = computed<boolean>(() =>
    sectionHasContent(this.repository() as unknown as Record<string, unknown>),
  );

  protected readonly docs = computed<IDocsSection>(() => {
    const a = this.annotations() ?? {};
    return { docsUrl: httpUrlOrNull(a['docsUrl']) };
  });
  protected readonly hasDocs = computed<boolean>(() =>
    sectionHasContent(this.docs() as unknown as Record<string, unknown>),
  );

  /** Heuristic: true when the path is NOT in the local node store. */
  protected isBroken(path: string): boolean {
    const known = this.knownPaths();
    if (!known) return false;
    return !known.has(path);
  }

  protected onOpenPath(p: string): void {
    if (this.isBroken(p)) return;
    this.openPath.emit(p);
  }
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
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
