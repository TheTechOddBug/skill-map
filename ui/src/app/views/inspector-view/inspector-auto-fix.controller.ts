/**
 * Persisted "Automatic" toggle for the inspector's AI-actions launcher
 * (Step 16): when ON, one click on a finder-with-fixer button submits the
 * finder with `autoFix: true` and the kernel auto-chains its fixers on
 * record; when OFF, the button behaves per its two states (Detect ⇄ Fix).
 *
 * The choice is an INSPECTOR-level view preference, not per-node state:
 * it persists in `localStorage` (sibling key of the activity filter and
 * the section-collapse map) and applies to every node the inspector
 * visits. Mirrors `inspector-activity-filter.controller`: a `setupX`
 * factory returns a typed handle the component holds, with an `effect`
 * that writes every change back to storage.
 */

import { assertInInjectionContext, effect, signal } from '@angular/core';

const STORAGE_KEY = 'skill-map.ui.inspector.autoFix';
const DEFAULT_ENABLED = false;

export interface IAutoFixHandle {
  /** Whether automatic (detect + fix in one click) is on (default `false`). */
  enabled(): boolean;
  /** Set the flag and persist it. Non-boolean input coerces to `false`. */
  set(value: boolean): void;
}

export function setupAutoFix(): IAutoFixHandle {
  // The persist effect below runs in the component's reactive context.
  assertInInjectionContext(setupAutoFix);

  const state = signal<boolean>(loadEnabled());

  // Persist on every change. Runs once on init (writes the loaded value
  // straight back, a harmless no-op) and again after every set.
  effect(() => {
    saveEnabled(state());
  });

  return {
    enabled: () => state(),
    set: (value) => state.set(value === true),
  };
}

/** Defensive parse: only the literal `'true'` is on; anything else is off. */
function parseEnabled(raw: unknown): boolean {
  return raw === 'true';
}

function loadEnabled(): boolean {
  try {
    return parseEnabled(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage unavailable; the in-session default is fine.
    return DEFAULT_ENABLED;
  }
}

function saveEnabled(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Storage unavailable / over quota; the preference is non-critical.
  }
}
