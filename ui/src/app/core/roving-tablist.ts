/**
 * Keyboard machine for a `role="tablist"` driven by a roving tabindex.
 *
 * A roving tabindex puts exactly ONE tab in the document tab sequence
 * (`tabindex="0"` on the selected one, `-1` on the rest). That is only a
 * valid pattern when arrow keys move between the tabs: without them the
 * unselected tabs are unreachable by any keyboard means, which is how
 * both of this app's tab strips shipped inoperable (a11y audit C2 / H3,
 * WCAG 2.1.1). The two halves are a package, so they live together here
 * rather than as a convention two components are trusted to remember.
 *
 * Extracted after the two strips (Quick Start groups, workspace rail
 * sections) were fixed with byte-identical handlers: a duplicated
 * keyboard machine is exactly the drift risk that produces one strip
 * wrapping and the other not.
 *
 * Selection follows focus (automatic activation), which the APG allows
 * when revealing a panel is cheap. It is also mandatory here: both
 * strips key their roving tabindex off the selection signal, so moving
 * focus without selecting would leave focus on a `tabindex="-1"` element
 * and strand the next Tab.
 *
 * Pure function, no injection context, no state: the tab elements are
 * read off the event's `currentTarget` at call time, so the caller never
 * has to keep DOM references or ids in sync with the rendered order.
 */

/** Which arrow pair walks the strip, per its `aria-orientation`. */
export type TTablistOrientation = 'horizontal' | 'vertical';

export interface IRovingTablistConfig {
  /**
   * Axis of the strip. MUST match the rendered layout and the element's
   * `aria-orientation`: binding the wrong pair leaves the visible axis
   * dead and makes the perpendicular one move focus sideways.
   */
  orientation: TTablistOrientation;
  /**
   * Index of the selected tab, used only when the event did not
   * originate on a tab (e.g. it arrived on the tablist itself), so the
   * walk starts somewhere sensible.
   */
  selectedIndex: () => number;
  /**
   * Commit the selection for the tab at `index`. Focus is moved by this
   * helper afterwards, the caller only owns the selection side effect.
   */
  select: (index: number) => void;
}

/**
 * Handle one keydown on a tablist. Binds ArrowUp / ArrowDown on a
 * vertical strip and ArrowLeft / ArrowRight on a horizontal one, plus
 * Home / End on both, and wraps at either end. Every other key (Tab,
 * Escape, Enter, typing) keeps its default behaviour: `preventDefault`
 * fires only on a key this machine actually handles.
 */
export function handleRovingTablistKeydown(
  event: KeyboardEvent,
  config: IRovingTablistConfig,
): void {
  const host = event.currentTarget;
  if (!(host instanceof HTMLElement)) return;
  // Read the tabs off the DOM: their order IS the strip order, and it
  // hands over the focus target without an id lookup (which matters for
  // the Quick Start strip, rendered inside a body portal).
  const tabs = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
  if (tabs.length === 0) return;

  const focused = tabs.indexOf(event.target as HTMLElement);
  const current = focused >= 0 ? focused : config.selectedIndex();
  const forward = config.orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  const backward = config.orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';

  let next: number;
  switch (event.key) {
    case forward:
      next = (current + 1) % tabs.length;
      break;
    case backward:
      // `current` can be -1 when the selected item is not in the strip;
      // the double modulo keeps the walk in range either way.
      next = (((current - 1) % tabs.length) + tabs.length) % tabs.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = tabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  config.select(next);
  // Focus moves too, not just selection: a `tabindex="-1"` button is
  // still programmatically focusable, so no render wait is needed.
  tabs[next]?.focus();
}
