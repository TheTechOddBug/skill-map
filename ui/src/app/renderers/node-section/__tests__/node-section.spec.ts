import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { NodeSection } from '../node-section';
import type { IRendererInputs } from '../../../slots/slot-renderer-map';

/**
 * NodeSection renderer (`inspector.body.section` slot). A plugin-owned
 * collapsible inspector zone built on `<sm-collapsible-section>`:
 *
 *   - title is `<pluginId>:<zone>` for drop-in plugins, bare `<zone>`
 *     for system (bundled) plugins. The prefix is applied by the
 *     renderer from the contribution's `pluginId`, never from the
 *     payload (non-falsifiable).
 *   - content is a key/value definition list (reuses `<sm-node-key-values>`).
 *   - the collapse state is owned locally, seeded from `defaultCollapsed`.
 *
 * Contribution data is bound via interpolation only, no `[innerHTML]` /
 * `[style]` / `[src]` / `[href]`.
 */

function makeInputs(overrides: Partial<IRendererInputs> = {}): IRendererInputs {
  return {
    pluginId: 'acme-plugin',
    extensionId: 'coverage',
    contributionId: 'zone',
    nodePath: 'agents/architect.md',
    payload: { zone: 'coverage', entries: [] },
    ...overrides,
  };
}

function bootstrap(inputs: IRendererInputs): ComponentFixture<NodeSection> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(NodeSection);
  fixture.componentRef.setInput('inputs', inputs);
  fixture.detectChanges();
  return fixture;
}

function root(fixture: ComponentFixture<NodeSection>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="renderer-node-section"]',
  ) as HTMLElement;
}

function title(fixture: ComponentFixture<NodeSection>): string {
  return root(fixture).querySelector('.sm-block__title')!.textContent!.trim();
}

function toggle(fixture: ComponentFixture<NodeSection>): HTMLButtonElement {
  return root(fixture).querySelector(
    '[data-testid="renderer-node-section-toggle"]',
  ) as HTMLButtonElement;
}

describe('NodeSection', () => {
  it('renders the data-testid root', () => {
    const fixture = bootstrap(makeInputs());
    expect(root(fixture)).not.toBeNull();
  });

  it('prefixes the title with the pluginId for a non-system plugin', () => {
    const fixture = bootstrap(
      makeInputs({ pluginId: 'acme-plugin', payload: { zone: 'coverage', entries: [] } }),
    );
    expect(title(fixture)).toBe('acme-plugin:coverage');
  });

  it('omits the prefix for a system (bundled) plugin', () => {
    const fixture = bootstrap(
      makeInputs({ pluginId: 'core', payload: { zone: 'coverage', entries: [] } }),
    );
    expect(title(fixture)).toBe('coverage');
  });

  it('treats every built-in plugin id as system (no prefix)', () => {
    for (const id of ['core', 'claude', 'openai', 'antigravity', 'agent-skills']) {
      const fixture = bootstrap(
        makeInputs({ pluginId: id, payload: { zone: 'zone', entries: [] } }),
      );
      expect(title(fixture)).toBe('zone');
    }
  });

  it('cannot be tricked into hiding the prefix via a falsified payload', () => {
    // A drop-in plugin trying to disguise itself as `core` can only set
    // the zone name; the prefix comes from the (trusted) contribution
    // pluginId, so the `core:` it stuffs into `zone` still gets prefixed.
    const fixture = bootstrap(
      makeInputs({ pluginId: 'evil-plugin', payload: { zone: 'core:fake', entries: [] } }),
    );
    expect(title(fixture)).toBe('evil-plugin:core:fake');
  });

  it('renders the key/value entries inside the section', () => {
    const fixture = bootstrap(
      makeInputs({
        pluginId: 'core',
        payload: {
          zone: 'coverage',
          entries: [
            { key: 'files', value: 12 },
            { key: 'ratio', value: '80%' },
          ],
        },
      }),
    );
    const dts = root(fixture).querySelectorAll('dt');
    const dds = root(fixture).querySelectorAll('dd');
    expect(Array.from(dts).map((e) => e.textContent)).toEqual(['files', 'ratio']);
    expect(Array.from(dds).map((e) => e.textContent)).toEqual(['12', '80%']);
  });

  it('is expanded by default (no defaultCollapsed)', () => {
    const fixture = bootstrap(
      makeInputs({ payload: { zone: 'coverage', entries: [{ key: 'k', value: 'v' }] } }),
    );
    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(root(fixture).querySelector('dt')).not.toBeNull();
  });

  it('starts collapsed when defaultCollapsed is true', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: { zone: 'coverage', defaultCollapsed: true, entries: [{ key: 'k', value: 'v' }] },
      }),
    );
    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('false');
    // Collapsed: the body (and its entries) is not instantiated.
    expect(root(fixture).querySelector('dt')).toBeNull();
  });

  it('toggles the collapse state on click', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: { zone: 'coverage', defaultCollapsed: true, entries: [{ key: 'k', value: 'v' }] },
      }),
    );
    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('false');
    toggle(fixture).click();
    fixture.detectChanges();
    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(root(fixture).querySelector('dt')).not.toBeNull();
  });

  it('renders the zone icon when the payload carries one', () => {
    const fixture = bootstrap(
      makeInputs({ payload: { zone: 'coverage', icon: 'pi pi-chart-bar', entries: [] } }),
    );
    expect(root(fixture).querySelector('.vc-section__icon')).not.toBeNull();
  });

  it('tolerates a non-object payload without throwing', () => {
    const fixture = bootstrap(makeInputs({ payload: 'oops' }));
    // No zone -> empty title; the section still mounts without crashing.
    expect(root(fixture)).not.toBeNull();
    expect(title(fixture)).toBe('');
  });

  it('never binds entry data via innerHTML', () => {
    const fixture = bootstrap(
      makeInputs({
        pluginId: 'core',
        payload: { zone: 'z', entries: [{ key: 'k', value: '<b>x</b>' }] },
      }),
    );
    // The angle brackets are rendered as text, never as live markup.
    const dd = root(fixture).querySelector('dd')!;
    expect(dd.textContent).toBe('<b>x</b>');
    expect(dd.querySelector('b')).toBeNull();
  });
});
