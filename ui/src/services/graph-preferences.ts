/**
 * `GraphPreferencesService`, user-tunable visual preferences for the
 * graph view, persisted in `localStorage` (per-browser, not synced).
 *
 * Today the service owns a single key, `connectionType`, which feeds
 * Foblex's `<f-connection [fType]>` input. The catalog mirrors the
 * Foblex `EFConnectionType` enum 1:1, see
 * `node_modules/@foblex/flow/.../fesm2022/foblex-flow.mjs`:
 *
 *   - `segment`         , orthogonal poly-line (default, current behaviour)
 *   - `straight`        , single straight segment between connectors
 *   - `bezier`          , smooth bezier curve
 *   - `adaptive-curve`  , curve that adapts its tangent to the
 *                         connector orientation
 *
 * Why a service instead of inlining the localStorage read in
 * `graph-view.ts`:
 *   - The Settings modal (`<sm-settings-general>`) and the graph view
 *     share the same source of truth, a writable signal lets the
 *     graph re-render the next CD cycle when the user flips the
 *     selectbutton without forcing a reload.
 *   - Bad / unknown values written by an older version (or by hand)
 *     get normalised once at boot rather than every read.
 *
 * Persistence shape: a plain string under `sm.graph.connection-type`.
 * Mirrors the conventions in `graph-view.storage.ts` (every read
 * defends against malformed payloads and missing storage; every write
 * swallows quota errors).
 */

import { Injectable, signal } from '@angular/core';
import { EFConnectionType } from '@foblex/flow';

/** Foblex `EFConnectionType` literal alias, scoped for narrowing without dragging the enum into every consumer. */
export type TConnectionType =
  | 'segment'
  | 'straight'
  | 'bezier'
  | 'adaptive-curve';

/**
 * Default edge shape. `adaptive-curve` follows the connector orientation
 * pinned by `fInputConnectableSide="top"` / `fOutputConnectableSide="bottom"`,
 * so edges leave each card downward and curve up into the next card,
 * which reads cleaner than the orthogonal `segment` default in a
 * top-down dagre layout. Users can flip it from Settings → General.
 */
export const DEFAULT_CONNECTION_TYPE: TConnectionType = 'adaptive-curve';

/** Closed catalog used both for runtime validation (sanitise) and to drive the Settings selectbutton options. */
export const CONNECTION_TYPES: ReadonlyArray<TConnectionType> = [
  'segment',
  'straight',
  'bezier',
  'adaptive-curve',
];

const STORAGE_KEY = 'sm.graph.connection-type';

@Injectable({ providedIn: 'root' })
export class GraphPreferencesService {
  private readonly _connectionType = signal<TConnectionType>(readStored());

  /** Readable signal for graph-view (template) + selectbutton ngModel. */
  readonly connectionType = this._connectionType.asReadonly();

  /**
   * Mutate the connection type. No-op when the new value equals the
   * current one, the signal's equality check would short-circuit
   * anyway but bailing earlier avoids a useless localStorage write.
   */
  setConnectionType(value: TConnectionType): void {
    if (this._connectionType() === value) return;
    this._connectionType.set(value);
    writeStored(value);
  }

  /**
   * Map our wire literal to the Foblex enum value. Foblex accepts
   * either the enum or the raw string (the enum IS a string union),
   * so call sites can also use the signal directly, this helper just
   * documents the bridge for readers.
   */
  static toFoblexEnum(value: TConnectionType): EFConnectionType {
    return value as EFConnectionType;
  }
}

function readStored(): TConnectionType {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_CONNECTION_TYPE;
  }
  if (!raw) return DEFAULT_CONNECTION_TYPE;
  return isConnectionType(raw) ? raw : DEFAULT_CONNECTION_TYPE;
}

function writeStored(value: TConnectionType): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Quota exceeded or storage blocked, swallow (matches the rest
    // of the graph-view storage helpers).
  }
}

function isConnectionType(value: unknown): value is TConnectionType {
  return (
    typeof value === 'string' &&
    (CONNECTION_TYPES as ReadonlyArray<string>).includes(value)
  );
}
