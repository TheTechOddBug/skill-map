import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { VendorFrontmatter } from './vendor-frontmatter';
import type { TFrontmatter, TNodeKind } from '../../../models/node';

/**
 * `<sm-vendor-frontmatter>` — single collapsed "Provider-specific"
 * section tests (catalog curation refinement 2026-05-07).
 */

function bootstrap(
  fm: TFrontmatter,
  kind: TNodeKind,
  knownPaths?: ReadonlySet<string>,
): { dom: HTMLElement; fixture: ReturnType<typeof TestBed.createComponent<VendorFrontmatter>> } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(VendorFrontmatter);
  fixture.componentRef.setInput('frontmatter', fm);
  fixture.componentRef.setInput('kind', kind);
  if (knownPaths) fixture.componentRef.setInput('knownPaths', knownPaths);
  fixture.detectChanges();
  return { dom: fixture.nativeElement as HTMLElement, fixture };
}

describe('VendorFrontmatter — Provider-specific section header', () => {
  it('renders the toggle for an agent with at least one populated field', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter"]')).not.toBeNull();
    const toggle = dom.querySelector('[data-testid="vendor-frontmatter-section-toggle"]');
    expect(toggle).not.toBeNull();
    // Header copy + populated count.
    expect(toggle!.textContent).toContain('Provider-specific');
    expect(toggle!.textContent).toContain('1 field');
  });

  it('keeps the section collapsed by default', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-section-body"]')).toBeNull();
  });

  it('expands the section body on toggle click', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      tools: ['Bash', 'Read'],
    } as unknown as TFrontmatter;
    const { dom, fixture } = bootstrap(fm, 'agent');
    const toggle = dom.querySelector(
      '[data-testid="vendor-frontmatter-section-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    const body = dom.querySelector('[data-testid="vendor-frontmatter-section-body"]');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain('opus');
    expect(body!.textContent).toContain('Bash');
  });

  it('hides the renderer entirely when the kind has no vendor surface (markdown)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
    } as TFrontmatter;
    const { dom } = bootstrap(fm, 'markdown');
    expect(dom.querySelector('[data-testid="vendor-frontmatter"]')).toBeNull();
  });

  it('hides the renderer when an agent has zero populated vendor fields', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
    } as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter"]')).toBeNull();
  });
});

describe('VendorFrontmatter — agent fields rendered when expanded', () => {
  function expandedAgent(fm: TFrontmatter): HTMLElement {
    const { dom, fixture } = bootstrap(fm, 'agent');
    const toggle = dom.querySelector(
      '[data-testid="vendor-frontmatter-section-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    return dom;
  }

  it('renders the model row when frontmatter.model is set', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'claude-opus-4-7',
    } as unknown as TFrontmatter;
    const dom = expandedAgent(fm);
    expect(dom.textContent).toContain('Model');
    expect(dom.textContent).toContain('claude-opus-4-7');
  });

  it('does NOT render a `name` row (now exclusively in the inspector header)', () => {
    const fm = {
      name: 'theArchitect',
      description: 'desc',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const dom = expandedAgent(fm);
    // The agent name "theArchitect" must not bleed into the body.
    const body = dom.querySelector('[data-testid="vendor-frontmatter-section-body"]');
    expect(body!.textContent).not.toContain('theArchitect');
  });

  it('does NOT render a `description` row (header owns the description)', () => {
    const fm = {
      name: 'a',
      description: 'this is a long description that should NOT appear here',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const dom = expandedAgent(fm);
    const body = dom.querySelector('[data-testid="vendor-frontmatter-section-body"]');
    expect(body!.textContent).not.toContain('this is a long description');
  });

  it('does NOT render a `Color` row (vendor color is consumed by the title accent)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      color: 'cyan',
    } as unknown as TFrontmatter;
    const dom = expandedAgent(fm);
    const body = dom.querySelector('[data-testid="vendor-frontmatter-section-body"]');
    expect(body!.textContent).not.toContain('Color');
    // The literal "cyan" must not bleed in either.
    expect(body!.textContent).not.toContain('cyan');
  });

  it('only counts background when literally true (false → not in count)', () => {
    const fmFalse = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      background: false,
    } as unknown as TFrontmatter;
    const { dom: domFalse } = bootstrap(fmFalse, 'agent');
    // model = 1 field. background:false adds nothing.
    const toggleFalse = domFalse.querySelector(
      '[data-testid="vendor-frontmatter-section-toggle"]',
    );
    expect(toggleFalse!.textContent).toContain('1 field');

    const fmTrue = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      background: true,
    } as unknown as TFrontmatter;
    const { dom: domTrue } = bootstrap(fmTrue, 'agent');
    const toggleTrue = domTrue.querySelector(
      '[data-testid="vendor-frontmatter-section-toggle"]',
    );
    expect(toggleTrue!.textContent).toContain('2 fields');
  });

  it('renders mcpServers and hooks rows when expanded', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      mcpServers: [{ name: 'echo', command: 'echo hi' }],
      hooks: { PreToolUse: { matchers: ['Bash'] } },
    } as unknown as TFrontmatter;
    const dom = expandedAgent(fm);
    const body = dom.querySelector('[data-testid="vendor-frontmatter-section-body"]');
    expect(body!.textContent).toContain('echo');
    expect(body!.textContent).toContain('PreToolUse');
    expect(body!.textContent).toContain('matchers');
  });

  it('renders the initialPrompt collapsed quote with its own toggle', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      initialPrompt: 'Begin by analyzing the repository structure and reporting findings.',
    } as unknown as TFrontmatter;
    const dom = expandedAgent(fm);
    const ipToggle = dom.querySelector(
      '[data-testid="vendor-frontmatter-initial-prompt-toggle"]',
    );
    expect(ipToggle).not.toBeNull();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt"]')).toBeNull();
  });

  it('counts each populated field exactly once (8 typical agent fields)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      tools: ['Bash'],
      skills: ['skills/foo.md'],
      disallowedTools: ['Bash(rm *)'],
      permissionMode: 'default',
      maxTurns: 5,
      effort: 'high',
      memory: 'persistent',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const toggle = dom.querySelector('[data-testid="vendor-frontmatter-section-toggle"]');
    expect(toggle!.textContent).toContain('8 fields');
  });
});

describe('VendorFrontmatter — skill / command kinds', () => {
  it('renders the skill-base block for `skill` kind when expanded', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      when_to_use: 'When refactoring TypeScript.',
      'argument-hint': '[file]',
    } as unknown as TFrontmatter;
    const { dom, fixture } = bootstrap(fm, 'skill');
    const toggle = dom.querySelector(
      '[data-testid="vendor-frontmatter-section-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-skill-base"]')).not.toBeNull();
    expect(dom.textContent).toContain('When refactoring TypeScript.');
  });

  it('hides the renderer for a skill with zero populated skill-base fields', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
    } as TFrontmatter;
    const { dom } = bootstrap(fm, 'skill');
    expect(dom.querySelector('[data-testid="vendor-frontmatter"]')).toBeNull();
  });
});
