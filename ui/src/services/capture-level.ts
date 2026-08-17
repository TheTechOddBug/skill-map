/**
 * `CaptureLevelService`, the client mirror of the serve-side capture
 * ladder (spec `provider-activity.md` §Capture level): ONE cumulative
 * knob for how much runtime activity skill-map keeps, moved live from
 * the Sessions rail's selector (beside the Record control) or its
 * Settings mirror.
 *
 * The service holds the last KNOWN level; hydration rides the journal
 * read-back the Sessions tab already performs (`hydrate(level)`, no
 * extra request) plus an on-demand `refresh()` for surfaces that open
 * without the tab (the Settings row). `set()` POSTs and adopts the
 * server's echoed effective level; failures (demo mode, dead server)
 * roll back to the previous value so the selector never lies.
 */

import { Injectable, inject, signal } from '@angular/core';

import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';

/** Ladder order (spec §Capture level); `shell` is reserved (no capture yet). */
export const CAPTURE_LEVELS = ['executions', 'reads', 'writes', 'mcp', 'shell'] as const;

export type TCaptureLevel = (typeof CAPTURE_LEVELS)[number];

export const DEFAULT_CAPTURE_LEVEL: TCaptureLevel = 'mcp';

export function isCaptureLevel(value: unknown): value is TCaptureLevel {
  return typeof value === 'string' && (CAPTURE_LEVELS as readonly string[]).includes(value);
}

@Injectable({ providedIn: 'root' })
export class CaptureLevelService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  private readonly _level = signal<TCaptureLevel>(DEFAULT_CAPTURE_LEVEL);
  /** Last known ladder position (default until a hydration lands). */
  readonly level = this._level.asReadonly();

  private readonly _busy = signal(false);
  /** A move is in flight; selectors disable to avoid racing echoes. */
  readonly busy = this._busy.asReadonly();

  private readonly _shellCapture = signal(false);
  /**
   * The install-side shell opt-in (spec §Capture level rung 5): the
   * selector's fifth position unlocks only while this is on. Hydrated
   * from the journal envelope alongside the level.
   */
  readonly shellCapture = this._shellCapture.asReadonly();

  /** Adopt the install-side opt-in learned from a journal read-back. */
  hydrateShellCapture(on: boolean): void {
    this._shellCapture.set(on);
  }

  /** Adopt a level learned from a journal read-back (no request). */
  hydrate(level: string): void {
    if (isCaptureLevel(level)) this._level.set(level);
  }

  /** Fetch the live level (surfaces that open without the Sessions tab). */
  async refresh(): Promise<void> {
    try {
      const { captureLevel, shellCapture } = await this.dataSource.getSessionJournal();
      this.hydrate(captureLevel);
      this.hydrateShellCapture(shellCapture);
    } catch {
      // Best-effort (demo mode, dead server): keep the last known level.
    }
  }

  /** Move the ladder; adopts the server echo, rolls back on failure. */
  async set(level: TCaptureLevel): Promise<void> {
    const previous = this._level();
    if (level === previous || this._busy()) return;
    this._busy.set(true);
    this._level.set(level); // optimistic: the selector answers instantly
    try {
      const effective = await this.dataSource.setCaptureLevel(level);
      this.hydrate(effective);
    } catch {
      this._level.set(previous);
    } finally {
      this._busy.set(false);
    }
  }
}
