/**
 * DEBUG-PERF, controls the floating PerfHud (FPS, frame time, render
 * stats) in the bottom-left of the graph canvas.
 *
 * Resolution order (first match wins):
 *   1. URL query `?debug-fps` / `?debug-fps=1` → ON (override).
 *   2. URL query `?debug-fps=0` → OFF (override).
 *   3. No query                  → fall back to `DEFAULT_SETTINGS.graph.perfHud`.
 *
 * Intentionally **no localStorage**. The query string is a puntual
 * override for debug sessions; the persistent state lives in the
 * settings (today compile-time `DEFAULT_SETTINGS`, tomorrow the runtime
 * settings loader from ROADMAP §Configuration → "Runtime delivery to
 * the UI"). When the loader ships and the user flips
 * `graph.perfHud: false`, the HUD goes silent by default and
 * `?debug-fps=1` is the way to bring it back ad-hoc, exactly the
 * behaviour we want.
 */

import { Injectable, signal } from '@angular/core';

import { DEFAULT_SETTINGS } from '../../models/settings';

const QUERY_KEY = 'debug-fps';

@Injectable({ providedIn: 'root' })
export class DebugPerfService {
  private readonly visibleState = signal(this.resolveInitial());
  readonly visible = this.visibleState.asReadonly();

  private resolveInitial(): boolean {
    const params = new URLSearchParams(window.location.search);
    const q = params.get(QUERY_KEY);
    // Present in any form (`?debug-fps`, `?debug-fps=1`) turns it ON; only
    // an explicit `?debug-fps=0` / `?debug-fps=false` turns it OFF.
    if (q !== null && q !== '0' && q !== 'false') return true;
    if (q === '0' || q === 'false') return false;
    return DEFAULT_SETTINGS.graph.perfHud;
  }
}
