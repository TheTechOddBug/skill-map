/**
 * `<sm-annotations-panel>`, read-only renderer of a node's sidecar
 * (`.sm`) `annotations:` block. Mirrors the sub-section grouping
 * declared in `spec/schemas/annotations.schema.json`:
 *
 *   - Lifecycle: `version`, `stability`
 *   - Supersession: `supersedes`, `supersededBy`
 *   - Provenance: `authors[]`, `license`, `source`, `sourceVersion`
 *   - Taxonomy: `tags`
 *   - Docs: `docsUrl`
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
import { ChipModule } from 'primeng/chip';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { ANNOTATIONS_PANEL_TEXTS } from '../../../i18n/annotations-panel.texts';
import type { ISidecarOverlay, TStability } from '../../../models/node';
import { httpUrlOrNull } from '../../../services/url-guard';
import { STABILITY_SEVERITY } from '../severity-map';

interface ILifecycleSection {
  version: number | null;
  stability: TStability | null;
}

interface ISupersessionSection {
  supersedes: readonly string[];
  supersededBy: string | null;
}

interface IProvenanceSection {
  authors: readonly string[];
  license: string | null;
  source: string | null;
  sourceVersion: string | null;
}

interface ITaxonomySection {
  /** Tags written into `frontmatter.tags` by the file's author. Rendered first. */
  authorTags: readonly string[];
  /** Tags written into `sidecar.annotations.tags` by the curator. Rendered after author tags. */
  userTags: readonly string[];
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
   * Author tags from `frontmatter.tags`. The panel renders them in the
   * Taxonomy section alongside user tags (from sidecar annotations),
   * ordered author-first with distinct chip styling so the
   * dual-source attribution stays explicit. Default: empty array.
   */
  readonly authorTags = input<readonly string[]>([]);

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

  /**
   * Emitted when the user clicks a tag chip (author or user, the
   * source distinction is purely visual on the chip variant; the
   * click semantic is union by tag string). The host forwards this
   * to the graph view, which uses Foblex Flow's native selection API
   * (`flow.select(matchingPaths, [])`) to multi-select every node
   * carrying the tag. Toggle: clicking the chip whose tag is already
   * the active selection clears it.
   */
  readonly tagClick = output<string>();

  /**
   * Currently-active tag selection from the graph view, projected
   * down through the inspector. When set, the matching chip(s)
   * render in the "active" visual state (solid primary fill). A
   * tag present in BOTH author and user sources lights up BOTH
   * chip variants, they share the same tag string and the click
   * semantic is union by tag.
   */
  readonly activeTag = input<string | null>(null);

  /** Pure helper used by the template to mark active chips. */
  protected isActiveTag(tag: string): boolean {
    return this.activeTag() === tag;
  }

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
   * `true` when at least one section has data to render, either a
   * sidecar overlay with annotations, OR author tags from the
   * frontmatter (which feed the Taxonomy section regardless of the
   * sidecar). Drives the empty-state branches at the top of the
   * template: when this is false we render the "no sidecar" /
   * "no annotations" placeholder; otherwise we render the sections.
   */
  protected readonly hasAnyContent = computed<boolean>(
    () =>
      this.hasLifecycle() ||
      this.hasSupersession() ||
      this.hasProvenance() ||
      this.hasTaxonomy() ||
      this.hasDocs(),
  );

  protected readonly lifecycle = computed<ILifecycleSection>(() => {
    const a = this.annotations() ?? {};
    return {
      version: numberOrNull(a['version']),
      stability: stabilityOrNull(a['stability']),
    };
  });
  protected readonly hasLifecycle = computed<boolean>(() =>
    sectionHasContent(this.lifecycle() as unknown as Record<string, unknown>),
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
      source: httpUrlOrNull(a['source']),
      sourceVersion: stringOrNull(a['sourceVersion']),
    };
  });
  protected readonly hasProvenance = computed<boolean>(() =>
    sectionHasContent(this.provenance() as unknown as Record<string, unknown>),
  );

  protected readonly taxonomy = computed<ITaxonomySection>(() => {
    const a = this.annotations() ?? {};
    return {
      authorTags: this.authorTags(),
      userTags: stringArray(a['tags']),
    };
  });
  protected readonly hasTaxonomy = computed<boolean>(() => {
    const tx = this.taxonomy();
    return tx.authorTags.length > 0 || tx.userTags.length > 0;
  });

  protected readonly docs = computed<IDocsSection>(() => {
    const a = this.annotations() ?? {};
    return { docsUrl: httpUrlOrNull(a['docsUrl']) };
  });
  protected readonly hasDocs = computed<boolean>(() =>
    sectionHasContent(this.docs() as unknown as Record<string, unknown>),
  );

  protected stabilitySeverity(s: TStability): 'success' | 'info' | 'warn' {
    return STABILITY_SEVERITY[s];
  }

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
