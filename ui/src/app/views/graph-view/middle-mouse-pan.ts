/**
 * `[smMiddleMousePan]`, middle-mouse drag handler that pans a
 * Foblex `<f-canvas>`.
 *
 * Mouse events (not pointer) mirror the panel-resize handler in
 * graph-view.ts: fDragHandle on graph nodes consumes pointerup
 * elsewhere, so listening on `mouseup` is the reliable channel.
 *
 * High-polling mice fire mousemove 500-1000×/sec. The pan applies each
 * new position by writing the `viewportPosition` signal that backs the
 * `<f-canvas>` `[position]` binding: Foblex 18.6 dropped the public
 * `setPosition`, so driving the input is the only path, and it is the
 * same path the viewport animations take (Foblex applies the transform
 * and redraws on the input change, no manual `redraw()`). The writes are
 * coalesced into one per animation frame so a high-polling mouse does not
 * thrash change detection.
 *
 * Apply to the canvas wrap element:
 *
 *   <div #wrap [smMiddleMousePan]="panTarget"> ... </div>
 *
 * The bound value is a small accessor object the host wires to its
 * viewport signals (see `IMiddleMousePanTarget`); the directive reads it
 * lazily on every event, so a late canvas mount is tolerated.
 *
 * The middle press is consumed in the CAPTURE phase on the wrapper, so
 * it never reaches Foblex's own `mousedown` listener on the `f-flow`
 * host below. `FDraggableDirective.onPointerDown` runs its selection
 * claimants for ANY button and, when the button is not draggable under
 * the active scheme (middle is not, on the default scheme), immediately
 * finalizes with an `EmitSelectionChangeEvent`, which clears a live
 * selection (single or marquee-built multi) the instant a middle-click
 * pan starts on the background. The middle button is app-owned (this
 * pan); hiding the press from Foblex keeps its selection intact at the
 * source instead of patching the cleared state back afterwards. A
 * bubble-phase Angular host binding cannot do this: the `f-flow` host
 * sits deeper in the DOM, so its listener would run first.
 */

import { Directive, ElementRef, OnDestroy, inject, input } from '@angular/core';

import type { IPoint } from './graph-layout';

/**
 * What the directive needs from its host to pan the canvas: read the
 * current viewport position, write a new one (drives the `[position]`
 * binding, which Foblex applies and redraws), and flush a final
 * canvas-change so the viewport persists when the gesture ends.
 */
export interface IMiddleMousePanTarget {
  readPosition(): IPoint;
  writePosition(position: IPoint): void;
  emitChange(): void;
}

@Directive({
  selector: '[smMiddleMousePan]',
})
export class MiddleMousePanDirective implements OnDestroy {
  /** Viewport accessors, typically wired to the host's viewport signals. */
  readonly smMiddleMousePan = input.required<IMiddleMousePanTarget>();

  private readonly hostElement: HTMLElement = inject(ElementRef).nativeElement;

  private origin: { mouseX: number; mouseY: number; canvasX: number; canvasY: number } | null = null;
  private rafId: number | null = null;
  private pendingPosition: IPoint | null = null;

  constructor() {
    // Capture phase, NOT an Angular host binding (those are bubble
    // phase): the press must be consumed before Foblex's `mousedown`
    // listener on the deeper `f-flow` host clears the selection. See
    // the module doc.
    this.hostElement.addEventListener('mousedown', this.onMouseDown, { capture: true });
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = this.smMiddleMousePan().readPosition();
    this.origin = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      canvasX: pos.x,
      canvasY: pos.y,
    };
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('mouseup', this.onEnd);
  };

  ngOnDestroy(): void {
    this.hostElement.removeEventListener('mousedown', this.onMouseDown, { capture: true });
    this.onEnd();
  }

  private readonly onMove = (event: MouseEvent): void => {
    if (!this.origin) return;
    this.pendingPosition = {
      x: this.origin.canvasX + (event.clientX - this.origin.mouseX),
      y: this.origin.canvasY + (event.clientY - this.origin.mouseY),
    };
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.pendingPosition) return;
      this.smMiddleMousePan().writePosition(this.pendingPosition);
    });
  };

  private readonly onEnd = (): void => {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    const wasPanning = this.origin !== null;
    this.pendingPosition = null;
    this.origin = null;
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mouseup', this.onEnd);
    // Flush a final canvas-change so the viewport persists, but only when
    // a pan actually ran (avoid a spurious emit on plain teardown).
    if (wasPanning) this.smMiddleMousePan().emitChange();
  };
}
