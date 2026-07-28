/**
 * `[smToggleRow]`, makes a whole Settings row flip its boolean switch.
 *
 * The rows are wide (label + a paragraph of description on the left, a
 * small switch pinned right), so aiming at the switch is the fiddliest
 * part of the interaction. The Plugins list already let the operator
 * click anywhere on an extension row to enable or disable it; this
 * directive gives every other Settings toggle the same affordance
 * without each component growing its own handler.
 *
 * It applies to BOOLEAN rows only. A row whose control is a select, a
 * text field, or a button is untouched: "click anywhere" is only
 * unambiguous when there is exactly one thing the click could mean.
 *
 * Mechanism: forward the gesture to the real control rather than call
 * the host component's toggle method. The click is dispatched on the
 * `<p-toggleswitch>` element, whose own host listener owns the state
 * change, so this directive needs to know nothing about which signal,
 * which pending-key bookkeeping, or which confirm dialog sits behind a
 * given row. Two consequences worth stating, both deliberate:
 *
 *   - Disabled and readonly rows are handled for free. PrimeNG's
 *     `onClick` bails on `$disabled()` / `readonly`, so the guard lives
 *     in one place (the library) instead of being re-derived per row.
 *   - Consent-gated rows keep their dialogs. `follow-external-symlinks`
 *     routes through the same `ngModelChange` it always did.
 *
 * Accessibility: this adds NO role and NO tabindex. The row stays a
 * plain container and the switch remains the focusable control, which
 * is the whole point, an earlier `role="button"` on a container row is
 * exactly what erased its contents from the accessibility tree (a11y
 * audit C4). A pointer convenience must not become a fake control.
 */

import { Directive, ElementRef, inject } from '@angular/core';

import { clickedInteractive } from './interactive-click';

@Directive({
  selector: '[smToggleRow]',
  host: {
    '(click)': 'onClick($event)',
  },
})
export class ToggleRowDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  onClick(event: Event): void {
    // Anything that handles its own activation is left alone: the
    // switch itself, and the `<label for>` whose native forwarding
    // would otherwise fire alongside ours and cancel the toggle out.
    if (clickedInteractive(event)) return;
    const toggle = this.host.nativeElement.querySelector<HTMLElement>('p-toggleswitch');
    // The synthetic click re-enters this handler as it bubbles, with the
    // switch as its target, so the guard above ends the recursion. No
    // flag needed.
    toggle?.click();
  }
}
