/**
 * `[smMiddleMousePan]` — middle-mouse drag handler that pans a
 * Foblex `<f-canvas>` without going through the user-facing zoom /
 * touchpad pipeline.
 *
 * Mouse events (not pointer) mirror the panel-resize handler in
 * graph-view.ts: fDragHandle on graph nodes consumes pointerup
 * elsewhere, so listening on `mouseup` is the reliable channel.
 *
 * High-polling mice fire mousemove 500-1000×/sec. setPosition needs a
 * matching `canvas.redraw()` to flush to the DOM, but redrawing per
 * event is wasteful — coalesce into one redraw per animation frame.
 *
 * Apply to the canvas wrap element:
 *
 *   <div #wrap [smMiddleMousePan]="canvas()"> ... </div>
 *
 * The bound value is the `FCanvasComponent` instance (from a viewChild
 * signal). The directive reads it lazily on every event, so a late
 * mount is tolerated; nothing happens until the canvas is ready.
 */

import { Directive, OnDestroy, input } from '@angular/core';
import type { FCanvasComponent } from '@foblex/flow';

import type { IPoint } from './graph-layout';

@Directive({
  selector: '[smMiddleMousePan]',
  standalone: true,
  host: {
    '(mousedown)': 'onMouseDown($event)',
  },
})
export class MiddleMousePanDirective implements OnDestroy {
  /** Bound canvas instance (typically a viewChild signal's value). */
  readonly smMiddleMousePan = input.required<FCanvasComponent | undefined>();

  private origin: { mouseX: number; mouseY: number; canvasX: number; canvasY: number } | null = null;
  private rafId: number | null = null;
  private pendingPosition: IPoint | null = null;

  onMouseDown(event: MouseEvent): void {
    if (event.button !== 1) return;
    const canvas = this.smMiddleMousePan();
    if (!canvas) return;
    event.preventDefault();
    const pos = canvas.getPosition() ?? { x: 0, y: 0 };
    this.origin = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      canvasX: pos.x,
      canvasY: pos.y,
    };
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('mouseup', this.onEnd);
  }

  ngOnDestroy(): void {
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
      const canvas = this.smMiddleMousePan();
      if (!canvas || !this.pendingPosition) return;
      canvas.setPosition(this.pendingPosition);
      canvas.redraw();
    });
  };

  private readonly onEnd = (): void => {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingPosition = null;
    this.origin = null;
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mouseup', this.onEnd);
    this.smMiddleMousePan()?.emitCanvasChangeEvent();
  };
}
