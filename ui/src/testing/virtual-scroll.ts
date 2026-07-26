import type { ComponentFixture } from '@angular/core/testing';

/**
 * Let a PrimeNG virtual-scroll table compute and render its first window.
 *
 * `Scroller.init()` defers everything that matters (`setSpacerSize`,
 * `setSize`, `calculateOptions`) into a `setTimeout(..., 1)`, so a plain
 * synchronous `fixture.detectChanges()` runs while `last` is still 0 and
 * the rendered slice is `items.slice(0, 0)`. Every DOM assertion against a
 * virtualised table therefore has to cross a real macrotask first; the
 * repo's usual `flush()` of two `await Promise.resolve()` (see
 * `settings-project.spec.ts`) is microtask-only and is NOT enough here.
 *
 * Geometry is stubbed in `src/test-setup.ts`, which sizes the scroller
 * viewport at 800px. With 36px rows that yields a 47-row window, so specs
 * under that size still see their whole dataset in the DOM.
 *
 * Call it once after mounting; later row-set changes re-slice against the
 * window that is already computed and do not need another settle.
 */
export async function settleVirtualScroll(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 5));
  fixture.detectChanges();
}
