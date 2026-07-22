/**
 * Per-node derivations shared by `<sm-node-card>` (graph card) and the
 * inspector header. Card and panel are intentionally redundant surfaces
 *, the panel reads as a continuation of the card the user clicked,
 * so every per-node fact (version, stability, age, tools breakdown,
 * stale tooltip) MUST come from the same place. Two-implementations of
 * the same mental model drifts silently when one source moves and the
 * other doesn't.
 *
 * All functions here are PURE: same input, same output, no Angular
 * dependency, no `this`. Components wrap them in `computed()` for
 * change-detection bookkeeping, but the derivation itself is plain TS.
 *
 * Source-of-truth conventions baked into these helpers:
 *
 *   - Sidecar `annotations.*` wins over legacy frontmatter `metadata.*`
 *     (the pre-Step-9.5 home, kept as fallback for un-migrated `.md`).
 *   - Vendor frontmatter keys use Anthropic's mixed casing verbatim:
 *     `tools` (camel/lower) for agents, `allowed-tools` (kebab) for
 *     skills/commands. Bracket access in TS so the hyphen survives.
 *   - `lastBumpedAt` lives on `sidecar.root.audit`, the canonical
 *     activity timestamp written by every `bump`.
 */

import {
  isStaleSidecar,
  legacyFrontmatterMetadata,
  type INodeView,
  type TStability,
} from './node';
import type { IContributionApi } from './api';

/**
 * Sidecar drift tooltip dictionary. Card and inspector both pass their
 * own i18n table (same shape, `node-card.texts.ts`'s `sidecar` block
 * is the canonical strings; the inspector reuses them via
 * `cardTexts.sidecar`). Typed loosely so consumers don't need to
 * import the texts type circularly.
 */
export interface ISidecarTooltipTexts {
  staleBody: string;
  staleFrontmatter: string;
  staleBoth: string;
}

/**
 * Effective version label for the card / inspector header.
 *
 * Source order:
 *   1. `sidecar.annotations.version` (integer monotonic counter, the
 *      catalog-curation 2026-05-07 home).
 *   2. Legacy `frontmatter.metadata.version` (semver string, pre-9.5).
 *
 * Returns `null` when both are absent. The leading `v` is added here
 * so the call site renders the chip without templating concerns.
 */
export function effectiveVersion(node: INodeView | null | undefined): string | null {
  if (!node) return null;
  const ann = node.sidecar?.annotations;
  if (ann && typeof ann['version'] === 'number') return `v${ann['version']}`;
  const legacy = legacyFrontmatterMetadata(node.frontmatter)?.['version'];
  return typeof legacy === 'string' && legacy.length > 0 ? `v${legacy}` : null;
}

/**
 * Effective stability for the card / inspector header.
 *
 * Source order: sidecar `annotations.stability` → legacy
 * `metadata.stability`. Returns `null` when absent or unrecognised.
 */
export function effectiveStability(node: INodeView | null | undefined): TStability | null {
  if (!node) return null;
  const ann = node.sidecar?.annotations;
  const fromAnn = ann?.['stability'];
  if (fromAnn === 'stable' || fromAnn === 'experimental' || fromAnn === 'deprecated') {
    return fromAnn;
  }
  const legacy = legacyFrontmatterMetadata(node.frontmatter)?.['stability'];
  if (legacy === 'stable' || legacy === 'experimental' || legacy === 'deprecated') {
    return legacy;
  }
  return null;
}

/**
 * True when the node's sidecar overlay reports drift (any
 * `stale-*` status). Re-exports `isStaleSidecar` from the node model
 * with a node-level signature so call sites read uniformly with the
 * other helpers in this file.
 */
export function effectiveIsStale(node: INodeView | null | undefined): boolean {
  return isStaleSidecar(node?.sidecar);
}

/**
 * Effective tag list (sidecar-curated). Tags are single-source: the
 * `.sm` sidecar `annotations.tags` is the canonical home; legacy
 * `frontmatter.metadata.tags` is the fallback for un-migrated `.md`
 * files. The former author source (`frontmatter.tags`) was retired,
 * tags now come from the curator only.
 */
export function effectiveUserTags(node: INodeView | null | undefined): string[] {
  if (!node) return [];
  const ann = node.sidecar?.annotations;
  const fromAnn = ann?.['tags'];
  if (Array.isArray(fromAnn)) {
    return fromAnn.filter((t): t is string => typeof t === 'string' && t.length > 0);
  }
  const legacy = legacyFrontmatterMetadata(node.frontmatter)?.['tags'];
  if (Array.isArray(legacy)) {
    return legacy.filter((t): t is string => typeof t === 'string' && t.length > 0);
  }
  return [];
}

/**
 * The re-homed action surfaces (`spec/view-slots.md` §Re-homed
 * surfaces): an `inspector.action.button` payload may DECLARE that it
 * is a named UI surface instead of a generic button. The UI selects
 * re-homed contributions by this declaration and dispatches the
 * payload's `actionId`; it never matches extension ids, so any plugin
 * may claim a surface and a disabled extension removes it (the
 * projection stops emitting).
 */
export type TActionSurface = 'version' | 'stability' | 'tags';

/** A loosely-typed view over an action-button payload's declared fields. */
interface ISurfacePayloadProbe {
  surface?: unknown;
}

/** The `surface` a contribution payload declares, or `null`. */
export function contributionSurface(payload: unknown): TActionSurface | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as ISurfacePayloadProbe).surface;
  return value === 'version' || value === 'stability' || value === 'tags' ? value : null;
}

/**
 * The node's `inspector.action.button` contribution claiming `surface`,
 * or `null` when none does (extension disabled -> the projection stops
 * -> the surface disappears). When several claim the same surface the
 * first in contribution order wins (the wire order follows contribution
 * priority).
 */
export function actionSurfaceContribution(
  node: INodeView | null | undefined,
  surface: TActionSurface,
): IContributionApi | null {
  return (
    (node?.contributions ?? []).find(
      (c) => c.slot === 'inspector.action.button' && contributionSurface(c.payload) === surface,
    ) ?? null
  );
}

/**
 * Sidecar drift tooltip, picks the matching string from the i18n
 * dictionary based on the overlay status. Returns `''` when the node
 * is fresh / has no overlay so the call site can bind it
 * unconditionally.
 */
export function effectiveStaleTooltip(
  node: INodeView | null | undefined,
  texts: ISidecarTooltipTexts,
): string {
  switch (node?.sidecar?.status) {
    case 'stale-body':
      return texts.staleBody;
    case 'stale-frontmatter':
      return texts.staleFrontmatter;
    case 'stale-both':
      return texts.staleBoth;
    default:
      return '';
  }
}

/**
 * Pretty number formatting for bytes / tokens (`12420` → `12k`).
 * Below 1k passes through; 1k-10k keeps one decimal (`1.2k`); 10k+
 * rounds to integers (`12k`).
 */
export function compactNumber(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * Format an ISO 8601 datetime as a coarse relative phrase
 * (`2 days ago`, `just now`). Defensive parsing, unparseable
 * strings fall back to the raw value so the call site still surfaces
 * something useful instead of `Invalid Date`.
 */
export function relativeTime(iso: string): string {
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

/**
 * Compact "last modified" cell for the files-view column: a file's
 * `mtime` (Unix ms) rendered as an ISO short date (`2026-06-13`, UTC).
 * The format seam, swapping the column to relative / long form is a
 * one-line change here. Non-finite input yields the empty string so a
 * bad value never throws `RangeError` from `toISOString()`.
 */
export function formatModifiedAt(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Full "last modified" tooltip: the same `mtime` with the wall-clock
 * time appended (`2026-06-13 14:32:47Z`, UTC). Mirrors the CLI history
 * timestamp shape. Empty string on non-finite input.
 */
export function formatModifiedAtFull(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')}Z`;
}
