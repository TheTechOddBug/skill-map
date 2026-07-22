import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { NodeCard } from '../node-card';
import { KindRegistryService } from '../../../../services/kind-registry';
import { ContributionsRegistryService } from '../../../services/contributions-registry';
import type {
  IFrontmatterAgent,
  INodeStats,
  INodeView,
  ISidecarOverlay,
} from '../../../../models/node';

/**
 * `<sm-node-card>`, catalog curation 2026-05-07 surface tests
 * (version suffix, tags chips, footer link stats) and per-Provider
 * accent override.
 *
 * The sidecar stale badge tests that used to live here were removed
 * when the badge moved to the slot system (`core/annotation-stale`
 * now emits an icon-only chip to `card.footer.right`, see
 * `08c33b8`). The chip rendering is exercised at the kernel layer
 * (`src/built-in-plugins/analyzers/annotation-stale/`) and at the
 * slot host layer; the card no longer carries hardcoded badge
 * markup to assert against.
 */

/**
 * The `core/node-set-tags` action-button contribution the card's tag
 * chips key their visibility off (surface follows the plugin, mirror of
 * the inspector tag row). Tag fixtures attach it; the gate test omits it.
 */
function setTagsContribution() {
  return {
    pluginId: 'core',
    extensionId: 'node-set-tags',
    nodePath: 'a.md',
    contributionId: 'editTagsButton',
    slot: 'inspector.action.button',
    payload: { actionId: 'core/node-set-tags', surface: 'tags', label: 'Edit tags', enabled: true },
  };
}

/**
 * The `core/node-bump` action-button contribution the card's version
 * label keys its visibility off (surface follows the plugin, mirror of
 * the header version chip). Version fixtures attach it; the gate test
 * omits it.
 */
function bumpContribution() {
  return {
    pluginId: 'core',
    extensionId: 'node-bump',
    nodePath: 'a.md',
    contributionId: 'bumpButton',
    slot: 'inspector.action.button',
    payload: { actionId: 'core/node-bump', surface: 'version', label: 'Bump', enabled: true },
  };
}

function makeNode(overlay?: ISidecarOverlay): INodeView {
  const view: INodeView = {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'd',
      metadata: { version: '1' },
    },
  };
  if (overlay) view.sidecar = overlay;
  return view;
}

function bootstrap(node: INodeView, stats?: INodeStats): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(NodeCard);
  fixture.componentRef.setInput('node', node);
  if (stats) fixture.componentRef.setInput('stats', stats);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('NodeCard, catalog curation surfaces (2026-05-07)', () => {
  it('renders `vN` suffix to the title from sidecar.annotations.version', () => {
    const node: INodeView = {
      path: 'agents/architect.md',
      kind: 'agent',
      frontmatter: { name: 'architect', description: 'd', metadata: { version: '' } },
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { version: 7 },
      },
      contributions: [bumpContribution()],
    };
    const dom = bootstrap(node);
    const v = dom.querySelector('[data-testid="node-card-version"]');
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain('v7');
  });

  it('falls back to legacy frontmatter.metadata.version when no sidecar version', () => {
    const node: INodeView = {
      path: 'agents/architect.md',
      kind: 'agent',
      frontmatter: {
        name: 'architect',
        description: 'd',
        metadata: { version: '1.2.3' },
      },
      contributions: [bumpContribution()],
    };
    const dom = bootstrap(node);
    const v = dom.querySelector('[data-testid="node-card-version"]');
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain('v1.2.3');
  });

  it('hides the version suffix when neither source has a version', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'markdown',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      contributions: [bumpContribution()],
    };
    const dom = bootstrap(node);
    expect(dom.querySelector('[data-testid="node-card-version"]')).toBeNull();
  });

  it('hides the version label without the core/node-bump contribution, even with a version set', () => {
    // Surface follows the plugin (user call 2026-07-22, mirror of the
    // header version chip and the tag chips): extension disabled -> no
    // version on the card; the data stays in the .sm.
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { version: 7 },
      },
    };
    const dom = bootstrap(node);
    expect(dom.querySelector('[data-testid="node-card-version"]')).toBeNull();
  });

  it('renders up to 3 tag chips from sidecar.annotations.tags', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { tags: ['x', 'y', 'z'] },
      },
      contributions: [setTagsContribution()],
    };
    const dom = bootstrap(node);
    const tagsBlock = dom.querySelector('[data-testid="node-card-tags"]');
    expect(tagsBlock).not.toBeNull();
    expect(tagsBlock!.querySelectorAll('.sm-gnode__tag-chip').length).toBe(3);
    expect(dom.querySelector('[data-testid="node-card-tags-more"]')).toBeNull();
  });

  it('shows a "+N more" overflow when more than 3 tags', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { tags: ['a', 'b', 'c', 'd', 'e'] },
      },
      contributions: [setTagsContribution()],
    };
    const dom = bootstrap(node);
    expect(dom.querySelectorAll('.sm-gnode__tag-chip').length).toBe(3);
    const more = dom.querySelector('[data-testid="node-card-tags-more"]');
    expect(more).not.toBeNull();
    expect(more!.textContent).toContain('+2');
  });

  it('hides the tags row entirely when there are no tags', () => {
    const dom = bootstrap(makeNode());
    expect(dom.querySelector('[data-testid="node-card-tags"]')).toBeNull();
  });

  it('hides the tag chips without the core/node-set-tags contribution, even with tags set', () => {
    // Surface follows the plugin (user call 2026-07-21, mirror of the
    // inspector tag row): extension disabled -> the action projects
    // nothing -> no chips on the card; the tags stay in the .sm.
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { tags: ['x', 'y'] },
      },
    };
    const dom = bootstrap(node);
    expect(dom.querySelector('[data-testid="node-card-tags"]')).toBeNull();
  });

  it('renders the aggregate severity chip synthesized by the BFF findings fold', () => {
    // The exact wire shape the read-time findings fold emits for a node
    // with only a probabilistic finding (playground.md's contradiction):
    // a synthesized `core/issue-counter/errorCount` chip on
    // `card.footer.right`, no deterministic issue behind it. Proves the
    // card renders it end to end (registry -> slot host -> NodeCounter).
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    TestBed.inject(ContributionsRegistryService).setRegistry({
      'core/issue-counter/errorCount': {
        pluginId: 'core',
        extensionId: 'issue-counter',
        contributionId: 'errorCount',
        slot: 'card.footer.right',
        icon: 'pi-times-circle',
        priority: 40,
        emitWhenEmpty: false,
      },
    });
    const node: INodeView = {
      path: 'playground.md',
      kind: 'markdown',
      frontmatter: { name: 'playground', description: 'd', metadata: { version: '' } },
      contributions: [
        {
          pluginId: 'core',
          extensionId: 'issue-counter',
          contributionId: 'errorCount',
          nodePath: 'playground.md',
          slot: 'card.footer.right',
          payload: { value: 1, severity: 'danger', tooltip: '1 error: 0 checks + 1 AI finding' },
        },
      ],
    };
    const fixture = TestBed.createComponent(NodeCard);
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    const counter = dom.querySelector('[data-testid="renderer-node-counter"]');
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toContain('1');
    expect(counter!.classList.contains('vc-counter--danger')).toBe(true);
  });

  it('emits tagClick with the tag and stops propagation when a chip is clicked', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      sidecar: { present: true, status: 'fresh', annotations: { tags: ['infra', 'review'] } },
      contributions: [setTagsContribution()],
    };
    const fixture = TestBed.createComponent(NodeCard);
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();

    const emitted: string[] = [];
    fixture.componentInstance.tagClick.subscribe((t: string) => emitted.push(t));
    // A click on a tag chip must NOT bubble to the parent [fNode] host
    // (which selects the node); assert it stays contained.
    let bubbled = false;
    (fixture.nativeElement as HTMLElement).addEventListener('click', () => {
      bubbled = true;
    });

    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[data-testid="node-card-tag"]',
    );
    chips[1]!.click();

    expect(emitted).toEqual(['review']);
    expect(bubbled).toBe(false);
  });

  it('renders the footer even when there are no stats to show', () => {
    // Empty footer remains in the DOM so the collapsed card has a
    // stable bottom strip across nodes (padding + border-top render).
    // Note: the `card.footer.left.*` slot host wrappers are always
    // mounted, when contributions are empty they render nothing
    // visible, so we assert no `.sm-gnode__stat` chips, not zero
    // children.
    const dom = bootstrap(makeNode());
    const footer = dom.querySelector('.sm-gnode__footer');
    expect(footer).not.toBeNull();
    expect(footer!.querySelectorAll('.sm-gnode__stat').length).toBe(0);
  });

  it('does NOT paint per-Provider when a non-primary contributor classified the node (kind dictates colour)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    // Seed the registry so `agent` carries Claude (primary) AND Gemini.
    // Per the design directive landed during the link-matrix session:
    // kind dictates the visual, provider does NOT. The host binds
    // `--accent` to the KIND's registry var (`--sm-kind-agent`), the same
    // value for a gemini-classified agent as for a claude one, so provider
    // identity never tints the accent. Provider identity surfaces via the
    // subtitle chip, not via icon / colour overrides that fight the kind
    // visual. See `kind-icon.ts` for the matching directive on the icon
    // resolver.
    const registry = TestBed.inject(KindRegistryService);
    registry.ingest({
      agent: {
        primaryProviderId: 'claude',
        providers: {
          claude: { label: 'Agents', color: '#3b82f6' },
          gemini: { label: 'Gemini Agents', color: '#9b72cb' },
        },
      },
    });
    const fixture = TestBed.createComponent(NodeCard);
    const node: INodeView = {
      path: '.gemini/agents/x.md',
      kind: 'agent',
      provider: 'gemini',
      frontmatter: { name: 'x', description: '', metadata: { version: '' } },
    };
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    const host = fixture.elementRef.nativeElement as HTMLElement;
    // Kind, not provider, drives the accent: `--accent` resolves the kind's
    // registry var (`--sm-kind-agent`), NOT gemini's #9b72cb.
    expect(host.style.getPropertyValue('--accent')).toBe('var(--sm-kind-agent, var(--sm-kind-markdown))');
  });

  it('drives --accent from the kind registry var, independent of provider', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const registry = TestBed.inject(KindRegistryService);
    registry.ingest({
      agent: {
        primaryProviderId: 'claude',
        providers: {
          claude: { label: 'Agents', color: '#3b82f6' },
          gemini: { label: 'Gemini Agents', color: '#9b72cb' },
        },
      },
    });
    const fixture = TestBed.createComponent(NodeCard);
    const node: INodeView = {
      path: '.claude/agents/x.md',
      kind: 'agent',
      provider: 'claude',
      frontmatter: { name: 'x', description: '', metadata: { version: '' } },
    };
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    const host = fixture.elementRef.nativeElement as HTMLElement;
    // Same kind var as the gemini case above, so the provider never changes
    // the accent; the colour comes straight from the kind registry var.
    expect(host.style.getPropertyValue('--accent')).toBe('var(--sm-kind-agent, var(--sm-kind-markdown))');
  });

  it('reads vendor color from agent frontmatter (not metadata.color)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(NodeCard);
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: {
        name: 'a',
        description: '',
        metadata: { version: '' },
        // Anthropic vendor field at top-level, NOT under metadata.
        color: 'purple',
      } as IFrontmatterAgent & { color: string },
    };
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    // The host element receives the `sm-gnode--with-color` class and
    // the `--node-color` CSS var; both are wired off `nodeColor()`.
    const host = fixture.elementRef.nativeElement as HTMLElement;
    expect(host.classList.contains('sm-gnode--with-color')).toBe(true);
    expect(host.style.getPropertyValue('--node-color')).toBe('purple');
  });
});

describe('NodeCard, favorite star button', () => {
  function bootstrapWithFavorite(isFavorite: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(NodeCard);
    fixture.componentRef.setInput('node', makeNode());
    fixture.componentRef.setInput('isFavorite', isFavorite);
    fixture.detectChanges();
    return fixture;
  }

  it('renders an outline star when isFavorite is false', () => {
    const fixture = bootstrapWithFavorite(false);
    const dom = fixture.nativeElement as HTMLElement;
    const btn = dom.querySelector('[data-testid="node-card-favorite"]');
    expect(btn).not.toBeNull();
    expect(btn!.querySelector('.pi-star')).not.toBeNull();
    expect(btn!.querySelector('.pi-star-fill')).toBeNull();
    expect(btn!.classList.contains('sm-gnode__favorite--on')).toBe(false);
  });

  it('renders a filled star and applies the --on modifier when isFavorite is true', () => {
    const fixture = bootstrapWithFavorite(true);
    const dom = fixture.nativeElement as HTMLElement;
    const btn = dom.querySelector('[data-testid="node-card-favorite"]');
    expect(btn).not.toBeNull();
    expect(btn!.querySelector('.pi-star-fill')).not.toBeNull();
    expect(btn!.classList.contains('sm-gnode__favorite--on')).toBe(true);
  });

  it('emits favoriteToggle with toggled value when clicked', () => {
    const fixture = bootstrapWithFavorite(false);
    const events: Array<{ path: string; value: boolean }> = [];
    fixture.componentInstance.favoriteToggle.subscribe((e) => events.push(e));
    const dom = fixture.nativeElement as HTMLElement;
    const btn = dom.querySelector('[data-testid="node-card-favorite"]') as HTMLButtonElement;
    btn.click();
    expect(events).toEqual([{ path: 'agents/architect.md', value: true }]);
  });

  it('emits value=false when clicked while already favorited', () => {
    const fixture = bootstrapWithFavorite(true);
    const events: Array<{ path: string; value: boolean }> = [];
    fixture.componentInstance.favoriteToggle.subscribe((e) => events.push(e));
    const dom = fixture.nativeElement as HTMLElement;
    const btn = dom.querySelector('[data-testid="node-card-favorite"]') as HTMLButtonElement;
    btn.click();
    expect(events).toEqual([{ path: 'agents/architect.md', value: false }]);
  });
});

describe('NodeCard, live-activity executing state (spec/provider-activity.md)', () => {
  /**
   * The whole "AI is working" visual treatment (conic ring, ribbon, and
   * the graph-side halo/edge styles) hangs off the `sm-gnode--executing`
   * host class, so the input -> class contract is the unit-testable
   * surface; the CSS animations themselves are visual-smoke territory.
   */
  function bootstrapWithExecuting(executing: boolean): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(NodeCard);
    fixture.componentRef.setInput('node', makeNode());
    fixture.componentRef.setInput('executing', executing);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('applies sm-gnode--executing on the host while the executing input is true', () => {
    const dom = bootstrapWithExecuting(true);
    expect(dom.classList.contains('sm-gnode--executing')).toBe(true);
  });

  it('drops the class when the executing input is false', () => {
    const dom = bootstrapWithExecuting(false);
    expect(dom.classList.contains('sm-gnode--executing')).toBe(false);
  });

  it('defaults to not executing when the input is never set', () => {
    const dom = bootstrap(makeNode());
    expect(dom.classList.contains('sm-gnode--executing')).toBe(false);
  });
});

describe('NodeCard, execution counter pill (spec/provider-activity.md §Execution stats)', () => {
  function bootstrapWithActivity(
    activity: { count: number; lastStartAt: number; lastOwner?: string; distinctOwners: number } | null,
  ): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(NodeCard);
    fixture.componentRef.setInput('node', makeNode());
    fixture.componentRef.setInput('activity', activity);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the compact count when the node has executions', () => {
    const dom = bootstrapWithActivity({
      count: 3,
      lastStartAt: 1_700_000_000_000,
      lastOwner: 'main:abc',
      distinctOwners: 2,
    });
    const pill = dom.querySelector('[data-testid="node-card-activity-count"]');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('3');
    // The count is a memory, not a live signal; a11y spells it out.
    expect(pill!.getAttribute('aria-label')).toContain('3 times');
  });

  it('compacts large counts (server-accumulated value, never client math)', () => {
    const dom = bootstrapWithActivity({
      count: 12_420,
      lastStartAt: 1_700_000_000_000,
      distinctOwners: 4,
    });
    const pill = dom.querySelector('[data-testid="node-card-activity-count"]');
    expect(pill!.textContent).toContain('12k');
  });

  it('hides the pill at count zero and when the input is absent', () => {
    const zero = bootstrapWithActivity({ count: 0, lastStartAt: 0, distinctOwners: 0 });
    expect(zero.querySelector('[data-testid="node-card-activity-count"]')).toBeNull();
    const absent = bootstrap(makeNode());
    expect(absent.querySelector('[data-testid="node-card-activity-count"]')).toBeNull();
  });
});
