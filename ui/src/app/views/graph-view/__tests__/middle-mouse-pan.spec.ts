/**
 * `MiddleMousePanDirective` spec. Pins the two halves of the contract:
 *
 *   1. The pan mechanics: middle press anchors the origin, document
 *      mousemove writes rAF-coalesced positions through the target
 *      accessors, mouseup flushes one final `emitChange`.
 *   2. The capture-phase consume: the middle press must NOT propagate
 *      to listeners deeper in the wrapper (Foblex's `f-flow` host
 *      listens `mousedown` there and would clear the live selection
 *      via its any-button selection claimants + finalize). A left press
 *      must keep propagating untouched.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { MiddleMousePanDirective, type IMiddleMousePanTarget } from '../middle-mouse-pan';
import type { IPoint } from '../graph-layout';

@Component({
  imports: [MiddleMousePanDirective],
  template: `
    <div class="wrap" [smMiddleMousePan]="target">
      <div class="inner"></div>
    </div>
  `,
})
class HostCmp {
  readonly written: IPoint[] = [];
  changes = 0;
  readonly target: IMiddleMousePanTarget = {
    readPosition: () => ({ x: 5, y: 7 }),
    writePosition: (position: IPoint) => {
      this.written.push(position);
    },
    emitChange: () => {
      this.changes += 1;
    },
  };
}

function mouse(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

describe('MiddleMousePanDirective', () => {
  let fixture: ComponentFixture<HostCmp>;
  let host: HostCmp;
  let inner: HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    host = fixture.componentInstance;
    inner = fixture.nativeElement.querySelector('.inner') as HTMLElement;
  });

  it('middle press pans: origin + deltas flow through the target, mouseup emits one change', () => {
    inner.dispatchEvent(mouse('mousedown', { button: 1, clientX: 100, clientY: 100 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 130, clientY: 80 }));
    expect(host.written).toEqual([{ x: 5 + 30, y: 7 - 20 }]);

    document.dispatchEvent(mouse('mouseup', {}));
    expect(host.changes).toBe(1);

    // Post-gesture moves are inert: the document listeners were removed.
    document.dispatchEvent(mouse('mousemove', { clientX: 500, clientY: 500 }));
    expect(host.written).toHaveLength(1);
  });

  it('consumes the middle press in capture phase, deeper listeners never see it', () => {
    // Stand-in for Foblex's own `mousedown` listener on the `f-flow`
    // host: bubble phase, deeper than the wrapper. If this fires, the
    // library clears the selection on a middle-click pan.
    const deeperListener = vi.fn();
    inner.addEventListener('mousedown', deeperListener);

    inner.dispatchEvent(mouse('mousedown', { button: 1, clientX: 0, clientY: 0 }));
    expect(deeperListener).not.toHaveBeenCalled();

    document.dispatchEvent(mouse('mouseup', {}));
  });

  it('leaves non-middle presses alone: no pan, propagation intact', () => {
    const deeperListener = vi.fn();
    inner.addEventListener('mousedown', deeperListener);

    inner.dispatchEvent(mouse('mousedown', { button: 0, clientX: 10, clientY: 10 }));
    expect(deeperListener).toHaveBeenCalledTimes(1);

    document.dispatchEvent(mouse('mousemove', { clientX: 50, clientY: 50 }));
    expect(host.written).toHaveLength(0);
    expect(host.changes).toBe(0);
  });

  it('destroy removes the capture listener and tears down an in-flight pan', () => {
    inner.dispatchEvent(mouse('mousedown', { button: 1, clientX: 0, clientY: 0 }));
    fixture.destroy();
    // The in-flight pan flushed its final change on teardown.
    expect(host.changes).toBe(1);

    const deeperListener = vi.fn();
    inner.addEventListener('mousedown', deeperListener);
    inner.dispatchEvent(mouse('mousedown', { button: 1, clientX: 0, clientY: 0 }));
    expect(deeperListener).toHaveBeenCalledTimes(1);
  });
});
