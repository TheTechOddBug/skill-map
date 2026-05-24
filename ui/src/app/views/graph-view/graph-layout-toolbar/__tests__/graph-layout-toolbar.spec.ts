import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { GraphLayoutToolbar } from '../graph-layout-toolbar';
import {
  GraphPreferencesService,
  type TConnectionType,
} from '../../../../../services/graph-preferences';
import type {
  TLayoutAlgorithm,
  TLayoutDirection,
  TLayoutSpacing,
} from '../../layout-controls';

/**
 * Stub for `GraphPreferencesService`: each preference is a writable
 * signal exposed via `asReadonly()` to match the real shape, and the
 * matching `set*` methods drive the signal directly so the toolbar's
 * computeds react to changes inside a test the same way they would in
 * production. No localStorage round-trip, the stub keeps state in
 * memory.
 */
interface IPreferencesStubInit {
  algorithm?: TLayoutAlgorithm;
  direction?: TLayoutDirection;
  spacing?: TLayoutSpacing;
  connectionType?: TConnectionType;
}

function makeFixture(init: IPreferencesStubInit = {}) {
  const algorithm = signal<TLayoutAlgorithm>(init.algorithm ?? 'network-simplex');
  const direction = signal<TLayoutDirection>(init.direction ?? 'TOP_BOTTOM');
  const spacing = signal<TLayoutSpacing>(init.spacing ?? 'normal');
  const connectionType = signal<TConnectionType>(init.connectionType ?? 'adaptive-curve');

  const preferences = {
    layoutAlgorithm: algorithm.asReadonly(),
    layoutDirection: direction.asReadonly(),
    layoutSpacing: spacing.asReadonly(),
    connectionType: connectionType.asReadonly(),
    setLayoutAlgorithm: (v: TLayoutAlgorithm) => algorithm.set(v),
    setLayoutDirection: (v: TLayoutDirection) => direction.set(v),
    setLayoutSpacing: (v: TLayoutSpacing) => spacing.set(v),
    setConnectionType: (v: TConnectionType) => connectionType.set(v),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [GraphLayoutToolbar],
    providers: [{ provide: GraphPreferencesService, useValue: preferences }],
  });
  const fixture = TestBed.createComponent(GraphLayoutToolbar);
  fixture.detectChanges();
  return { fixture, preferences, algorithm, direction, spacing, connectionType };
}

describe('GraphLayoutToolbar', () => {
  it('renders the four layout-control toggle buttons', () => {
    const { fixture } = makeFixture();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="graph-layout-algorithm-toggle"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="graph-layout-direction-toggle"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="graph-layout-spacing-toggle"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="graph-connection-type-toggle"]')).not.toBeNull();
  });

  it('disables direction + spacing toggles when the algorithm is force', () => {
    // `force` has no flow direction, the toolbar greys out both pickers
    // and switches the tooltip to the unavailable-text variant. We
    // assert the disabled attribute rather than the tooltip text so
    // the test stays decoupled from i18n string changes.
    const { fixture } = makeFixture({ algorithm: 'force' });
    const root = fixture.nativeElement as HTMLElement;
    const directionBtn = root.querySelector(
      '[data-testid="graph-layout-direction-toggle"] button',
    ) as HTMLButtonElement | null;
    const spacingBtn = root.querySelector(
      '[data-testid="graph-layout-spacing-toggle"] button',
    ) as HTMLButtonElement | null;
    expect(directionBtn?.disabled).toBe(true);
    expect(spacingBtn?.disabled).toBe(true);
  });

  it('keeps direction + spacing enabled when the algorithm is dagre-based', () => {
    const { fixture } = makeFixture({ algorithm: 'network-simplex' });
    const root = fixture.nativeElement as HTMLElement;
    const directionBtn = root.querySelector(
      '[data-testid="graph-layout-direction-toggle"] button',
    ) as HTMLButtonElement | null;
    const spacingBtn = root.querySelector(
      '[data-testid="graph-layout-spacing-toggle"] button',
    ) as HTMLButtonElement | null;
    expect(directionBtn?.disabled).toBe(false);
    expect(spacingBtn?.disabled).toBe(false);
  });

  it('reactively swaps the direction icon when the preference changes', () => {
    const { fixture, preferences } = makeFixture({ direction: 'TOP_BOTTOM' });
    const root = fixture.nativeElement as HTMLElement;
    function directionIconClass(): string {
      // PrimeNG renders the icon inside the button as `<span class="p-button-icon pi pi-arrow-X">`.
      const span = root.querySelector(
        '[data-testid="graph-layout-direction-toggle"] .p-button-icon',
      );
      return span?.className ?? '';
    }
    expect(directionIconClass()).toContain('pi-arrow-down');
    preferences.setLayoutDirection('LEFT_RIGHT');
    fixture.detectChanges();
    expect(directionIconClass()).toContain('pi-arrow-right');
  });

  it('reactively swaps the spacing icon when the preference changes', () => {
    const { fixture, preferences } = makeFixture({ spacing: 'normal' });
    const root = fixture.nativeElement as HTMLElement;
    function spacingIconClass(): string {
      const span = root.querySelector(
        '[data-testid="graph-layout-spacing-toggle"] .p-button-icon',
      );
      return span?.className ?? '';
    }
    expect(spacingIconClass()).toContain('pi-bars');
    preferences.setLayoutSpacing('compact');
    fixture.detectChanges();
    expect(spacingIconClass()).toContain('pi-window-minimize');
    preferences.setLayoutSpacing('spacious');
    fixture.detectChanges();
    expect(spacingIconClass()).toContain('pi-window-maximize');
  });

  it('renders the active connection-type glyph on the toggle button', () => {
    // The toggle paints an inline SVG path that mirrors the selected
    // shape. Asserting the `d` attribute keeps the test resilient to
    // markup changes while still catching a wrong catalog wire-up
    // (e.g. swapping `bezier` and `adaptive-curve`).
    const { fixture, preferences } = makeFixture({ connectionType: 'segment' });
    const root = fixture.nativeElement as HTMLElement;
    function togglePath(): string {
      const path = root.querySelector(
        '[data-testid="graph-connection-type-toggle"] .graph__connection-svg--toggle path',
      );
      return path?.getAttribute('d') ?? '';
    }
    expect(togglePath()).toBe('M 2 14 L 8 14 L 8 2 L 14 2');
    preferences.setConnectionType('straight');
    fixture.detectChanges();
    expect(togglePath()).toBe('M 2 14 L 14 2');
  });

  it('writes through to the preference service when a popover option is picked', () => {
    // The popover items live inside a body-appended `<p-popover>` so
    // they are not rendered until the user clicks the toggle. We
    // exercise the wire by calling the protected `setLayoutAlgorithm`
    // (the click handler in the template) directly through the
    // component instance, that's what the popover button binds to.
    const { fixture, algorithm } = makeFixture({ algorithm: 'network-simplex' });
    const instance = fixture.componentInstance as unknown as {
      setLayoutAlgorithm(v: TLayoutAlgorithm): void;
    };
    instance.setLayoutAlgorithm('force');
    expect(algorithm()).toBe('force');
  });
});
