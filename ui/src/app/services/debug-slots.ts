/**
 * DEBUG-SLOTS, toggles the `is-debug-slots` class on `<html>` so the
 * view-contribution slot wrappers (`.sm-debug-slot`, see
 * `ui/src/app/debug-slots.css`) light up with strong-color borders.
 *
 * Activation rules, first match wins, then persisted to localStorage:
 *   1. URL query `?debug` / `?debug=1`: ON.
 *   2. URL query `?debug=0`: OFF.
 *   3. No query: read `sm-debug-slots` from localStorage.
 *
 * BOOT CONTRACT: this service self-wires on construction (constructor
 * resolves the initial visibility + the `effect()` toggles the root
 * class). The `provideAppInitializer` block in `app.config.ts` calls
 * `inject(DebugSlotsService)` at boot solely to fire the constructor;
 * do NOT refactor to a lazy `init()` without rewriting that block,
 * otherwise the `.is-debug-slots` class on `<html>` lags the first
 * paint until the first view-contribution host injects the service.
 *
 * KEPT dev tool, NOT temporary scaffolding (see `context/ui.md`
 * § Debug overlays). Do not remove as "cleanup"; retire only on an
 * explicit decision.
 */

import { Injectable, effect, signal } from '@angular/core';

const STORAGE_KEY = 'sm-debug-slots';
const QUERY_KEY = 'debug';
const HTML_CLASS = 'is-debug-slots';

@Injectable({ providedIn: 'root' })
export class DebugSlotsService {
  private readonly visibleState = signal(false);
  readonly visible = this.visibleState.asReadonly();

  constructor() {
    this.visibleState.set(this.resolveInitial());
    effect(() => {
      const on = this.visible();
      const root = document.documentElement;
      root.classList.toggle(HTML_CLASS, on);
    });
  }

  toggle(): void {
    const next = !this.visible();
    this.visibleState.set(next);
    try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  }

  private resolveInitial(): boolean {
    const params = new URLSearchParams(window.location.search);
    const q = params.get(QUERY_KEY);
    // Present in any form (`?debug`, `?debug=1`, `?debug=true`) turns it
    // ON; only an explicit `?debug=0` / `?debug=false` turns it OFF.
    if (q !== null && q !== '0' && q !== 'false') {
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
      return true;
    }
    if (q === '0' || q === 'false') {
      try { localStorage.setItem(STORAGE_KEY, '0'); } catch { /* ignore */ }
      return false;
    }
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  }
}
