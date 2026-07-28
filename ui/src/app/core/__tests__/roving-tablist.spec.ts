/**
 * The roving-tabindex keyboard machine shared by both tab strips
 * (Quick Start groups, workspace rail sections). These specs pin the
 * contract that made the strips operable at all: without arrow keys a
 * roving tabindex leaves every unselected tab unreachable, which is how
 * both shipped inoperable (a11y audit C2 / H3, WCAG 2.1.1).
 */

import { describe, expect, it, vi } from 'vitest';

import { handleRovingTablistKeydown, type TTablistOrientation } from '../roving-tablist';

/** Build a tablist with `count` tabs and dispatch a keydown from `fromIndex`. */
function press(
  key: string,
  opts: {
    orientation: TTablistOrientation;
    count?: number;
    fromIndex?: number | null;
    selectedIndex?: number;
  },
): { selected: number[]; focused: number | null; defaultPrevented: boolean } {
  const count = opts.count ?? 3;
  const host = document.createElement('div');
  host.setAttribute('role', 'tablist');
  const tabs: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    host.appendChild(tab);
    tabs.push(tab);
  }
  document.body.appendChild(host);

  const selected: number[] = [];
  // `fromIndex: null` models the event arriving on the tablist itself,
  // where the machine has to fall back to the selected index.
  const target = opts.fromIndex === null ? host : tabs[opts.fromIndex ?? 0];
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  Object.defineProperty(event, 'currentTarget', { value: host });

  handleRovingTablistKeydown(event, {
    orientation: opts.orientation,
    selectedIndex: () => opts.selectedIndex ?? 0,
    select: (i) => selected.push(i),
  });

  const focused = tabs.indexOf(document.activeElement as HTMLElement);
  host.remove();
  return { selected, focused: focused >= 0 ? focused : null, defaultPrevented: event.defaultPrevented };
}

describe('handleRovingTablistKeydown', () => {
  it('moves forward and back along a vertical strip', () => {
    expect(press('ArrowDown', { orientation: 'vertical', fromIndex: 0 }).selected).toEqual([1]);
    expect(press('ArrowUp', { orientation: 'vertical', fromIndex: 2 }).selected).toEqual([1]);
  });

  it('moves forward and back along a horizontal strip', () => {
    expect(press('ArrowRight', { orientation: 'horizontal', fromIndex: 0 }).selected).toEqual([1]);
    expect(press('ArrowLeft', { orientation: 'horizontal', fromIndex: 2 }).selected).toEqual([1]);
  });

  it('wraps at both ends', () => {
    expect(press('ArrowDown', { orientation: 'vertical', fromIndex: 2 }).selected).toEqual([0]);
    expect(press('ArrowUp', { orientation: 'vertical', fromIndex: 0 }).selected).toEqual([2]);
  });

  it('jumps to the ends with Home and End', () => {
    expect(press('Home', { orientation: 'vertical', fromIndex: 1 }).selected).toEqual([0]);
    expect(press('End', { orientation: 'vertical', fromIndex: 1 }).selected).toEqual([2]);
  });

  it('moves DOM focus, not just selection', () => {
    // Selection alone would strand focus: the roving tabindex marks every
    // unselected tab `-1`, so the next Tab would jump out of the strip.
    expect(press('ArrowDown', { orientation: 'vertical', fromIndex: 0 }).focused).toBe(1);
  });

  it('ignores the perpendicular axis', () => {
    // Binding both axes would make the dead axis silently move focus
    // sideways, which is why the orientation is explicit.
    expect(press('ArrowRight', { orientation: 'vertical', fromIndex: 0 }).selected).toEqual([]);
    expect(press('ArrowDown', { orientation: 'horizontal', fromIndex: 0 }).selected).toEqual([]);
  });

  it('leaves unhandled keys to their default behaviour', () => {
    for (const key of ['Tab', 'Escape', 'Enter', 'a']) {
      const r = press(key, { orientation: 'vertical', fromIndex: 0 });
      expect(r.selected).toEqual([]);
      expect(r.defaultPrevented).toBe(false);
    }
  });

  it('preventDefault fires only on a handled key', () => {
    expect(press('ArrowDown', { orientation: 'vertical', fromIndex: 0 }).defaultPrevented).toBe(
      true,
    );
  });

  it('falls back to the selected index when the event is not on a tab', () => {
    const r = press('ArrowDown', { orientation: 'vertical', fromIndex: null, selectedIndex: 1 });
    expect(r.selected).toEqual([2]);
  });

  it('is inert on an empty strip', () => {
    const r = press('ArrowDown', { orientation: 'vertical', count: 0 });
    expect(r.selected).toEqual([]);
    expect(r.defaultPrevented).toBe(false);
  });
});
