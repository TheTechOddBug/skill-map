/**
 * `<sm-inspector-audit-panel>` — read-only renderer of the sidecar
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
 * only — header chrome lives in the inspector template.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';

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

  /**
   * Header summary — surfaces the most recent activity inline so the
   * user doesn't have to expand to see "when / by whom". Catalog
   * curation lock: `last bumped 2 days ago by cli`. Falls back to
   * "never bumped" when no audit record exists.
   */
  readonly headerSummary = computed<string>(() => {
    const a = this.audit();
    if (a.lastBumpedAt === null) return this.texts.headerEmpty;
    const rel = relativeTime(a.lastBumpedAt);
    return this.texts.headerSummary(rel, a.lastBumpedBy ?? '?');
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

/**
 * Format an ISO 8601 datetime as a coarse relative phrase
 * (`2 days ago`, `3 hours ago`, `just now`). Defensive parsing —
 * unparseable strings fall back to the raw value so the header
 * still surfaces something useful.
 */
function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
  const year = Math.floor(day / 365);
  return `${year} year${year === 1 ? '' : 's'} ago`;
}
