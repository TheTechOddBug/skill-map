/**
 * `<sm-inspector-audit-panel>`, read-only renderer of the sidecar
 * `audit:` block. Catalog curation 2026-05-07 dropped `bumpReason`
 * end-to-end (BFF + spec + UI) so this component renders only the
 * surviving four fields:
 *
 *   - `lastBumpedAt` (with relative tooltip)
 *   - `lastBumpedBy`
 *   - `createdAt`
 *   - `createdBy`
 *
 * All fields are optional at the property level. The host (inspector)
 * collapses the section by default; this component renders the body
 * only, header chrome lives in the inspector template.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { relativeTime } from '../../../models/node-derived';

interface IAuditBlock {
  lastBumpedAt: string | null;
  lastBumpedBy: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

@Component({
  selector: 'sm-inspector-audit-panel',
  templateUrl: './inspector-audit-panel.html',
  styleUrl: './inspector-audit-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Flags an audit block with no populated field so the host can drop the
  // panel and the debug sub-panel below it can skip its separator hairline
  // (there is nothing above it to divide from). Replaces the former
  // `never bumped` empty-state line, which named a disabled feature.
  host: { '[class.audit-panel--empty]': '!hasContent()' },
})
export class InspectorAuditPanel {
  /** Parsed sidecar root payload (or `null` when no sidecar). */
  readonly sidecarRoot = input<Record<string, unknown> | null>(null);

  protected readonly texts = INSPECTOR_VIEW_TEXTS.audit;

  protected readonly audit = computed<IAuditBlock>(() => {
    const root = this.sidecarRoot();
    const empty: IAuditBlock = {
      lastBumpedAt: null,
      lastBumpedBy: null,
      createdAt: null,
      createdBy: null,
    };
    if (!root) return empty;
    const a = root['audit'];
    if (typeof a !== 'object' || a === null) return empty;
    const ar = a as Record<string, unknown>;
    return {
      lastBumpedAt: stringOrNull(ar['lastBumpedAt']),
      lastBumpedBy: stringOrNull(ar['lastBumpedBy']),
      createdAt: stringOrNull(ar['createdAt']),
      createdBy: stringOrNull(ar['createdBy']),
    };
  });

  /** Has at least one populated field. */
  readonly hasContent = computed<boolean>(() => {
    const a = this.audit();
    return (
      a.lastBumpedAt !== null ||
      a.lastBumpedBy !== null ||
      a.createdAt !== null ||
      a.createdBy !== null
    );
  });

  /** Pre-computed relative strings for the body labels. */
  protected readonly lastBumpedRel = computed<string | null>(() => {
    const t = this.audit().lastBumpedAt;
    return t === null ? null : relativeTime(t);
  });

  protected readonly createdRel = computed<string | null>(() => {
    const t = this.audit().createdAt;
    return t === null ? null : relativeTime(t);
  });
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
