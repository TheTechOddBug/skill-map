/**
 * Theme service, tri-state (`auto` | `light` | `dark`) with live system-pref
 * detection, plus an orthogonal `extraTheme` slot (today: `matrix`) that
 * overrides the tri-state when active. Persists both pieces to localStorage
 * and toggles classes on the document root in sync with `resolved()`:
 *
 * - `.app-dark` , registered as Aura's `darkModeSelector` in `app.config.ts`
 *   so PrimeNG swaps its palette.
 * - `.dark`     , the selector Foblex Flow ships defaults for in
 *   `@foblex/flow/styles/tokens/_semantic.scss` (`.dark, [data-theme='dark']`).
 *   Without it the graph stays on the light palette regardless of the rest
 *   of the app.
 * - `.app-matrix` , active when `extraTheme === 'matrix'`. Sits on top of
 *   the dark classes (matrix builds on PrimeNG's dark palette and retints
 *   it green) so we keep the dark classes set in matrix mode too.
 *
 * In `auto` mode the resolved theme follows the OS via the
 * `(prefers-color-scheme: dark)` media query and reacts live to changes.
 *
 * `extraTheme` is settings-only: there is no header affordance to enable
 * it. The header dark/light toggle CLEARS it (and advances the mode one
 * step) so the user gets an immediate visual exit from matrix without
 * needing to open Settings again.
 */

import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

export type TThemeMode = 'auto' | 'light' | 'dark';
export type TResolvedTheme = 'light' | 'dark';
export type TExtraTheme = 'matrix' | null;

const STORAGE_KEY = 'skill-map.ui.theme';
const EXTRA_STORAGE_KEY = 'skill-map.ui.extra-theme';
const PRIMENG_DARK_CLASS = 'app-dark';
const FOBLEX_DARK_CLASS = 'dark';
const MATRIX_CLASS = 'app-matrix';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
const FAVICON_DEFAULT = 'favicon.svg';
const FAVICON_MATRIX = 'favicon-matrix.svg';
const FAVICON_SELECTOR = 'link[rel="icon"][type="image/svg+xml"]';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly mode = signal<TThemeMode>(this.readInitialMode());
  readonly extraTheme = signal<TExtraTheme>(this.readInitialExtra());
  private readonly systemPrefersDark = signal<boolean>(this.readSystemPref());

  /**
   * Resolved tri-state (`light` | `dark`). Independent of `extraTheme`,
   * matrix builds on top of the dark palette rather than replacing the
   * tri-state. Consumers that need to know whether matrix is on read
   * the `extraTheme` signal directly.
   */
  readonly resolved = computed<TResolvedTheme>(() => {
    const m = this.mode();
    if (m === 'auto') return this.systemPrefersDark() ? 'dark' : 'light';
    return m;
  });

  constructor() {
    this.subscribeToSystemPref();

    effect(() => {
      const extra = this.extraTheme();
      const baseDark = this.resolved() === 'dark';
      // Matrix is dark-flavored, force the PrimeNG / Foblex dark classes
      // whenever it is active so the retint sits on top of a dark base
      // rather than the light palette.
      const isDark = baseDark || extra === 'matrix';
      const root = this.doc.documentElement;
      root.classList.toggle(PRIMENG_DARK_CLASS, isDark);
      root.classList.toggle(FOBLEX_DARK_CLASS, isDark);
      root.classList.toggle(MATRIX_CLASS, extra === 'matrix');
      // Swap the SVG favicon so the browser tab carries the matrix
      // green mark while the theme is active. The default favicon is
      // self-adaptive via `prefers-color-scheme`, so the non-matrix
      // path leaves it untouched and the dark / light auto behavior
      // keeps working as before.
      this.applyFavicon(extra === 'matrix' ? FAVICON_MATRIX : FAVICON_DEFAULT);
      try {
        const ls = this.doc.defaultView?.localStorage;
        ls?.setItem(STORAGE_KEY, this.mode());
        if (extra === null) ls?.removeItem(EXTRA_STORAGE_KEY);
        else ls?.setItem(EXTRA_STORAGE_KEY, extra);
      } catch {
        // Storage may be unavailable (privacy mode); tolerate silently.
      }
    });
  }

  /**
   * Header button handler. Clears the extra theme (if any) AND advances
   * the tri-state one step, so a single click always produces a visible
   * change: from matrix the user lands on the next mode in the cycle
   * (`auto` → `light` → `dark` → `auto`).
   */
  toggle(): void {
    if (this.extraTheme() !== null) this.extraTheme.set(null);
    this.mode.update((m) => (m === 'auto' ? 'light' : m === 'light' ? 'dark' : 'auto'));
  }

  set(mode: TThemeMode): void {
    this.mode.set(mode);
  }

  setExtraTheme(theme: TExtraTheme): void {
    this.extraTheme.set(theme);
  }

  private readInitialMode(): TThemeMode {
    try {
      const stored = this.doc.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (stored === 'auto' || stored === 'light' || stored === 'dark') return stored;
    } catch {
      // ignore
    }
    return 'auto';
  }

  private readInitialExtra(): TExtraTheme {
    try {
      const stored = this.doc.defaultView?.localStorage.getItem(EXTRA_STORAGE_KEY);
      if (stored === 'matrix') return stored;
    } catch {
      // ignore
    }
    return null;
  }

  private readSystemPref(): boolean {
    try {
      return this.doc.defaultView?.matchMedia(SYSTEM_DARK_QUERY).matches ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Points the SVG favicon `<link>` at the given href. Idempotent: no
   * DOM write when the value already matches, so a navigation that
   * re-runs the theme effect without a real change does not trigger
   * the browser to re-fetch the icon.
   */
  private applyFavicon(href: string): void {
    const link = this.doc.querySelector(FAVICON_SELECTOR);
    if (!link) return;
    if (link.getAttribute('href') === href) return;
    link.setAttribute('href', href);
  }

  private subscribeToSystemPref(): void {
    const win = this.doc.defaultView;
    if (!win || typeof win.matchMedia !== 'function') return;
    const mq = win.matchMedia(SYSTEM_DARK_QUERY);
    const handler = (event: MediaQueryListEvent): void => {
      this.systemPrefersDark.set(event.matches);
    };
    mq.addEventListener('change', handler);
    // Pair the listener with cleanup so HMR cycles don't accumulate
    // dangling handlers across reload boundaries in dev.
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', handler));
  }
}
