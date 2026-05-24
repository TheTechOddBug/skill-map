/**
 * `localStorage` helpers for `<sm-graph-view>`. Same shape as
 * `settings-plugins.storage.ts`, every read defends against
 * malformed payloads and missing storage; every write swallows
 * quota errors so a full disk never crashes the view.
 *
 * Keys live under `sm.graph.*`, JSON-encoded values where the shape
 * is non-trivial (`viewport`, `node-positions`, `node-expanded`)
 * and a plain stringified integer for the panel-width single-value
 * case. Type guards (`isPoint`, `isStoredViewport`) live in
 * `./graph-view.utils.ts` so the storage layer stays focused on
 * I/O.
 */

import { isPoint, isStoredViewport } from './graph-view.utils';
import type { IPoint, TNodePositions } from './graph-layout';

const VIEWPORT_STORAGE_KEY = 'sm.graph.viewport';
const NODE_POSITIONS_STORAGE_KEY = 'sm.graph.node-positions';
const NODE_EXPANDED_STORAGE_KEY = 'sm.graph.node-expanded';
const PANEL_WIDTH_STORAGE_KEY = 'sm.graph.panel-width';

export interface IStoredViewport {
  x: number;
  y: number;
  scale: number;
}

export function readStoredViewport(): IStoredViewport | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isStoredViewport(parsed) ? parsed : null;
}

export function writeStoredViewport(viewport: IStoredViewport): void {
  try {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(viewport));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}

export function readStoredNodePositions(): TNodePositions {
  const result: TNodePositions = new Map();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NODE_POSITIONS_STORAGE_KEY);
  } catch {
    return result;
  }
  if (!raw) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (typeof parsed !== 'object' || parsed === null) return result;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isPoint(value)) result.set(key, { x: (value as IPoint).x, y: (value as IPoint).y });
  }
  return result;
}

export function writeStoredNodePositions(positions: TNodePositions): void {
  try {
    // Serialise as a plain `{ [path]: { x, y } }` object so the on-disk
    // shape matches every prior release; switching the in-memory type
    // to `Map` did not change the wire / storage contract.
    const obj: Record<string, IPoint> = {};
    for (const [k, v] of positions) obj[k] = v;
    localStorage.setItem(NODE_POSITIONS_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}

export function readStoredExpanded(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NODE_EXPANDED_STORAGE_KEY);
  } catch {
    return new Set();
  }
  if (!raw) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const result = new Set<string>();
  for (const id of parsed) {
    if (typeof id === 'string' && id.length > 0) result.add(id);
  }
  return result;
}

export function writeStoredExpanded(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(NODE_EXPANDED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}

export function readStoredPanelWidth(): number | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function writeStoredPanelWidth(width: number): void {
  try {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Quota exceeded or storage blocked, ignore.
  }
}
