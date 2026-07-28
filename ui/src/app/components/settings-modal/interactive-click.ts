/**
 * Shared guard for the "click anywhere on the row" affordances in
 * Settings (the Plugins list rows, and every boolean row via
 * `[smToggleRow]`).
 *
 * Lives in its own module rather than in `settings-plugins.utils.ts`
 * because it stopped being a plugins concern the moment a second
 * consumer appeared: a generic row directive importing a plugins utils
 * file would read as a dependency that is not really there.
 */

/**
 * True when the click landed on (or inside) something that handles its
 * own activation: the switch, a button, a form control, or a `<label>`
 * whose native `for` forwarding already reaches the control.
 *
 * Row-level listeners back off on a hit, which is what keeps a single
 * gesture from firing twice and cancelling itself out. Matching by
 * ROLE and tag rather than by class list means a new control dropped
 * into a row is covered without anyone remembering to update this.
 *
 * `a[href]` is here for a link inside a row description: following it
 * should never also toggle the row.
 */
export function clickedInteractive(event: Event): boolean {
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== 'function') return false;
  return (
    target.closest('label, button, input, select, textarea, a[href], [role="switch"], p-toggleswitch') !==
    null
  );
}
