/**
 * DEBUG-SLOTS marker for the dedicated `inspector.surface.*` slots.
 *
 * The `?debug=1` overlay paints rings around every
 * `<sm-view-contributions-host>`, but the five surface slots
 * (2026-07-23) are consumed by their OWN components (header chips, tag
 * row, summarize / auto-tag buttons) and never mount a host, so they
 * were invisible to the overlay. This directive gives the consuming
 * element the SAME debug affordances the host carries: the
 * `sm-debug-slot` class + `data-debug-slot` (the ring + label via
 * `debug-slots.css`) and a `title` naming the claiming contribution's
 * qualified id. All bindings drop entirely while debug is off, so
 * production DOM stays clean.
 *
 * KEPT dev tool (see `context/ui.md` § Debug overlays), retire only
 * with the overlay itself.
 */

import { Directive, computed, inject, input } from '@angular/core';

import { DebugSlotsService } from '../services/debug-slots';
import type { TSurfaceSlot } from '../../models/node-derived';

@Directive({
  selector: '[smDebugSurface]',
  host: {
    '[class.sm-debug-slot]': 'debug.visible()',
    '[attr.data-debug-slot]': 'debug.visible() ? smDebugSurface() : null',
    '[attr.title]': 'debugTitle()',
  },
})
export class DebugSurface {
  protected readonly debug = inject(DebugSlotsService);

  /** The surface slot id this element renders. */
  readonly smDebugSurface = input.required<TSurfaceSlot>();

  /**
   * Qualified id (`plugin/extension/contribution`) of the claiming
   * contribution, mirroring the host overlay's hover tooltip. Optional:
   * without it the tooltip shows the slot id alone.
   */
  readonly smDebugSurfaceClaim = input<string | null>(null);

  protected readonly debugTitle = computed<string | null>(() => {
    if (!this.debug.visible()) return null;
    return this.smDebugSurfaceClaim() ?? this.smDebugSurface();
  });
}
