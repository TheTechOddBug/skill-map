/**
 * Pure helpers and shape guards used by `<app-graph-view>` outside
 * the component class. Lives next to `graph-view.ts` so the
 * `@Component`-decorated file stays focused on view bindings and
 * lifecycle while the standalone utilities and storage payload
 * guards are unit-testable in isolation.
 */

import type { INodeView } from '../../../models/node';
import type { IPoint } from './graph-layout';
import type { IStoredViewport } from './graph-view.storage';

/**
 * `true` when a node carries `tag` in EITHER source — author tags
 * (`frontmatter.tags`) or user tags (`sidecar.annotations.tags`).
 * Tag click on the inspector panel filters by union (the chip's
 * `--author` / `--user` variant is purely visual attribution; the
 * filter semantic does not narrow). Defensive against malformed
 * arrays — non-string entries are silently skipped.
 */
export function nodeHasTag(node: INodeView, tag: string): boolean {
  const fm = node.frontmatter as Record<string, unknown>;
  const author = fm['tags'];
  if (Array.isArray(author) && author.includes(tag)) return true;
  const ann = node.sidecar?.annotations;
  const user = ann?.['tags'];
  if (Array.isArray(user) && user.includes(tag)) return true;
  return false;
}

/** Shape guard for `{ x, y }` payloads parsed out of localStorage. */
export function isPoint(value: unknown): value is IPoint {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['x'] === 'number' &&
    typeof v['y'] === 'number' &&
    Number.isFinite(v['x']) &&
    Number.isFinite(v['y'])
  );
}

/** Shape guard for the persisted viewport payload. */
export function isStoredViewport(value: unknown): value is IStoredViewport {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['x'] === 'number' &&
    typeof v['y'] === 'number' &&
    typeof v['scale'] === 'number' &&
    Number.isFinite(v['x']) &&
    Number.isFinite(v['y']) &&
    Number.isFinite(v['scale']) &&
    (v['scale'] as number) > 0
  );
}
