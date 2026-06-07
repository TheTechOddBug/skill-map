import { beforeEach, describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { InspectorPluginSections } from '../inspector-plugin-sections';
import { ContributionsRegistryService } from '../../../services/contributions-registry';
import type {
  IContributionApi,
  IContributionsRegistryApi,
  IContributionsRegistryEntryApi,
} from '../../../../models/api';
import type { IHostNode } from '../../view-contributions-host/view-contributions-host';

/**
 * InspectorPluginSections groups a node's `inspector.body.panel.*`
 * contributions into one collapsible section per plugin, ordered by the
 * plugin/extension `order` hints, collapsed by default, with strict
 * per-plugin isolation.
 */

const NODE_PATH = 'skills/alpha/SKILL.md';

function kv(
  pluginId: string,
  extensionId: string,
  contributionId: string,
  slot = 'inspector.body.panel.key-values',
): IContributionApi {
  return {
    pluginId,
    extensionId,
    contributionId,
    nodePath: NODE_PATH,
    slot,
    payload: { entries: [{ key: contributionId, value: 'v' }] },
  };
}

function reg(
  c: IContributionApi,
  hints: Partial<IContributionsRegistryEntryApi>,
): [string, IContributionsRegistryEntryApi] {
  const id = `${c.pluginId}/${c.extensionId}/${c.contributionId}`;
  return [
    id,
    {
      pluginId: c.pluginId,
      extensionId: c.extensionId,
      contributionId: c.contributionId,
      slot: c.slot,
      emitWhenEmpty: false,
      ...hints,
    },
  ];
}

function bootstrap(
  contributions: IContributionApi[],
  registry: IContributionsRegistryApi,
): ComponentFixture<InspectorPluginSections> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  TestBed.inject(ContributionsRegistryService).setRegistry(registry);
  const fixture = TestBed.createComponent(InspectorPluginSections);
  const node: IHostNode = { path: NODE_PATH, contributions };
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return fixture;
}

function host(fixture: ComponentFixture<InspectorPluginSections>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function sectionIds(fixture: ComponentFixture<InspectorPluginSections>): string[] {
  return Array.from(
    host(fixture).querySelectorAll('sm-collapsible-section[data-testid^="inspector-plugin-section-"]'),
  ).map((el) => el.getAttribute('data-testid')!);
}

function expand(fixture: ComponentFixture<InspectorPluginSections>, pluginId: string): void {
  const toggle = host(fixture).querySelector(
    `[data-testid="inspector-plugin-section-toggle-${pluginId}"]`,
  ) as HTMLButtonElement;
  toggle.click();
  fixture.detectChanges();
}

function brickIds(fixture: ComponentFixture<InspectorPluginSections>, pluginId: string): string[] {
  const section = host(fixture).querySelector(
    `sm-collapsible-section[data-testid="inspector-plugin-section-${pluginId}"]`,
  ) as HTMLElement;
  return Array.from(section.querySelectorAll('[data-testid^="contribution-"]')).map(
    (el) => el.getAttribute('data-testid')!,
  );
}

describe('InspectorPluginSections', () => {
  beforeEach(() => localStorage.clear());

  it('renders one section per plugin, titled by the trusted pluginId', () => {
    const cs = [kv('acme', 'm', 'a'), kv('beta', 'm', 'b')];
    const registry = Object.fromEntries([
      reg(cs[0]!, { pluginOrder: 10 }),
      reg(cs[1]!, { pluginOrder: 20 }),
    ]);
    const fixture = bootstrap(cs, registry);
    expect(sectionIds(fixture)).toHaveLength(2);
    const titles = Array.from(
      host(fixture).querySelectorAll('.sm-block__title'),
    ).map((el) => el.textContent!.trim());
    expect(titles).toContain('acme');
    expect(titles).toContain('beta');
  });

  it('orders sections by pluginOrder ASC, tie-break pluginId', () => {
    const cs = [kv('acme', 'm', 'a'), kv('beta', 'm', 'b'), kv('zeta', 'm', 'z')];
    const registry = Object.fromEntries([
      reg(cs[0]!, { pluginOrder: 20 }), // acme
      reg(cs[1]!, { pluginOrder: 10 }), // beta wins (lower order)
      reg(cs[2]!, { pluginOrder: 20 }), // zeta ties acme on order -> alpha tie-break
    ]);
    const fixture = bootstrap(cs, registry);
    expect(sectionIds(fixture)).toEqual([
      'inspector-plugin-section-beta',
      'inspector-plugin-section-acme',
      'inspector-plugin-section-zeta',
    ]);
  });

  it('orders bricks within a section by extensionOrder, then priority, then id', () => {
    const cs = [
      kv('acme', 'e1', 'c1'),
      kv('acme', 'e1', 'c2'),
      kv('acme', 'e2', 'c1'),
    ];
    const registry = Object.fromEntries([
      reg(cs[0]!, { extensionOrder: 20, priority: 20 }), // e1/c1
      reg(cs[1]!, { extensionOrder: 20, priority: 10 }), // e1/c2 (lower priority -> before c1)
      reg(cs[2]!, { extensionOrder: 10, priority: 100 }), // e2/c1 (lowest extensionOrder -> first)
    ]);
    const fixture = bootstrap(cs, registry);
    expand(fixture, 'acme');
    expect(brickIds(fixture, 'acme')).toEqual([
      'contribution-acme-e2-c1',
      'contribution-acme-e1-c2',
      'contribution-acme-e1-c1',
    ]);
  });

  it('is collapsed by default (no bricks rendered until expanded)', () => {
    const cs = [kv('acme', 'm', 'a')];
    const fixture = bootstrap(cs, Object.fromEntries([reg(cs[0]!, {})]));
    expect(brickIds(fixture, 'acme')).toHaveLength(0);
    expand(fixture, 'acme');
    expect(brickIds(fixture, 'acme')).toEqual(['contribution-acme-m-a']);
  });

  it('isolates plugins: a section only contains its own contributions', () => {
    const cs = [kv('acme', 'm', 'a'), kv('beta', 'm', 'b')];
    const fixture = bootstrap(
      cs,
      Object.fromEntries([reg(cs[0]!, {}), reg(cs[1]!, {})]),
    );
    expand(fixture, 'acme');
    expand(fixture, 'beta');
    expect(brickIds(fixture, 'acme')).toEqual(['contribution-acme-m-a']);
    expect(brickIds(fixture, 'beta')).toEqual(['contribution-beta-m-b']);
  });

  it('ignores non-body-panel slots (no section, no brick)', () => {
    const cs = [
      kv('acme', 'm', 'a'),
      kv('acme', 'm', 'chip', 'card.footer.left'),
    ];
    const fixture = bootstrap(
      cs,
      Object.fromEntries([reg(cs[0]!, {}), reg(cs[1]!, {})]),
    );
    expect(sectionIds(fixture)).toEqual(['inspector-plugin-section-acme']);
    expand(fixture, 'acme');
    expect(brickIds(fixture, 'acme')).toEqual(['contribution-acme-m-a']);
  });

  it('renders nothing when the node has no body-panel contributions', () => {
    const cs = [kv('acme', 'm', 'chip', 'card.footer.left')];
    const fixture = bootstrap(cs, Object.fromEntries([reg(cs[0]!, {})]));
    expect(sectionIds(fixture)).toHaveLength(0);
  });
});
