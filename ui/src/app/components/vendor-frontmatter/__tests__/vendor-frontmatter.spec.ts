import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { VendorFrontmatter } from '../vendor-frontmatter';
import type { TFrontmatter, TNodeKind } from '../../../../models/node';

/**
 * `<sm-vendor-frontmatter>`, three typographic sub-sections (Behavior /
 * Capabilities / Initial prompt) replacing the prior collapsed
 * "Provider-specific" wrapper. Each section hides on its own when its
 * fields are empty; the renderer hides entirely when all three are empty.
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

describe('VendorFrontmatter, visibility', () => {
  it('renders the root when an agent has at least one populated field', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter"]')).not.toBeNull();
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

describe('VendorFrontmatter, Behavior section', () => {
  it('renders the Behavior section when an agent declares model', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'claude-opus-4-7',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-behavior"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Behavior');
    expect(section!.textContent).toContain('claude-opus-4-7');
  });

  it('hides the Behavior section when only capabilities-only fields are populated', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      tools: ['Bash'],
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-behavior"]')).toBeNull();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-capabilities"]')).not.toBeNull();
  });

  it('only counts background as a Behavior field when literally true', () => {
    const fmFalse = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      background: false,
    } as unknown as TFrontmatter;
    const { dom: domFalse } = bootstrap(fmFalse, 'agent');
    // background:false alone leaves Behavior empty so the renderer hides.
    expect(domFalse.querySelector('[data-testid="vendor-frontmatter"]')).toBeNull();

    const fmTrue = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      background: true,
    } as unknown as TFrontmatter;
    const { dom: domTrue } = bootstrap(fmTrue, 'agent');
    expect(domTrue.querySelector('[data-testid="vendor-frontmatter-behavior"]')).not.toBeNull();
    expect(domTrue.textContent).toContain('Background');
  });

  it('does NOT render name, description, or color rows (header consumes them)', () => {
    const fm = {
      name: 'theArchitect',
      description: 'a long description that should NOT bleed into the body',
      metadata: { version: '' },
      model: 'opus',
      color: 'cyan',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const root = dom.querySelector('[data-testid="vendor-frontmatter"]');
    expect(root).not.toBeNull();
    expect(root!.textContent).not.toContain('theArchitect');
    expect(root!.textContent).not.toContain('a long description');
    expect(root!.textContent).not.toContain('Color');
    expect(root!.textContent).not.toContain('cyan');
  });
});

describe('VendorFrontmatter, Capabilities section', () => {
  it('renders tools, mcpServers, and hooks rows', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      tools: ['Bash', 'Read'],
      mcpServers: [{ name: 'echo', command: 'echo hi', args: ['x'] }],
      hooks: { PreToolUse: { matchers: ['Bash'] } },
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-capabilities"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Bash');
    expect(section!.textContent).toContain('echo');
    expect(section!.textContent).toContain('PreToolUse');
    expect(section!.textContent).toContain('matchers');
  });

  it('hides the Capabilities section when no capability fields are populated', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-capabilities"]')).toBeNull();
  });
});

describe('VendorFrontmatter, Initial prompt section', () => {
  it('renders the initialPrompt as an always-visible quote block (no toggle)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      initialPrompt: 'Begin by analyzing the repository structure and reporting findings.',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt"]');
    expect(section).not.toBeNull();
    const quote = dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt-quote"]');
    expect(quote).not.toBeNull();
    expect(quote!.textContent).toContain('Begin by analyzing');
  });

  it('hides the Initial prompt section when initialPrompt is empty', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt"]')).toBeNull();
  });
});

describe('VendorFrontmatter, skill / command kinds', () => {
  it('renders the skill-base block for `skill` kind', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      when_to_use: 'When refactoring TypeScript.',
      'argument-hint': '[file]',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'skill');
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

  it('does NOT render the Behavior or Initial prompt sections for skill / command', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      when_to_use: 'When the user wants X.',
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'skill');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-behavior"]')).toBeNull();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt"]')).toBeNull();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-capabilities"]')).not.toBeNull();
  });
});
