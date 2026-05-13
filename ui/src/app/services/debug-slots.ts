/**
 * DEBUG-SLOTS, toggles the `is-debug-slots` class on `<html>` so the
 * view-contribution slot wrappers (`.sm-debug-slot`, see
 * `ui/src/app/debug-slots.css`) light up with strong-color borders.
 *
 * Activation rules, first match wins, then persisted to localStorage:
 *   1. URL query `?debug-slots=1` → ON.
 *   2. URL query `?debug-slots=0` → OFF.
 *   3. No query                    → read `sm-debug-slots` from localStorage.
 *
 * Remove this file together with `debug-slots.css` and the wrappers /
 * mounts marked `DEBUG-SLOTS` once the slot mapping discussion lands.
 */

import { Injectable, effect, signal } from '@angular/core';

const STORAGE_KEY = 'sm-debug-slots';
const QUERY_KEY = 'debug-slots';
const HTML_CLASS = 'is-debug-slots';

@Injectable({ providedIn: 'root' })
export class DebugSlotsService {
  readonly visible = signal(false);

  constructor() {
    this.visible.set(this.resolveInitial());
    effect(() => {
      const on = this.visible();
      const root = document.documentElement;
      root.classList.toggle(HTML_CLASS, on);
    });
  }

  toggle(): void {
    const next = !this.visible();
    this.visible.set(next);
    try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  }

  private resolveInitial(): boolean {
    const params = new URLSearchParams(window.location.search);
    const q = params.get(QUERY_KEY);
    if (q === '1' || q === 'true') {
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
