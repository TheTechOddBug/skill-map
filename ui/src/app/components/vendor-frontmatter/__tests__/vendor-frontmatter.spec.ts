import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { VendorFrontmatter } from '../vendor-frontmatter';
import type { TFrontmatter, TNodeKind } from '../../../../models/node';

/**
 * `<sm-vendor-frontmatter>`, a single `Definition` section that lists
 * every vendor frontmatter field in one definition list, with the
 * initial prompt as a quote block at its foot. The runtime / capability
 * grouping is a presentation choice (the frontmatter is flat), so it
 * collapses into one rail; the section hides entirely when every field
 * is empty.
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

  it('exposes a single Definition section, not the legacy three-section split', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      tools: ['Bash'],
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelectorAll('[data-testid="vendor-frontmatter-definition"]').length).toBe(1);
    expect(dom.querySelector('[data-testid="vendor-frontmatter-behavior"]')).toBeNull();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-capabilities"]')).toBeNull();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt"]')).toBeNull();
  });
});

describe('VendorFrontmatter, Definition section (agent)', () => {
  it('renders the section titled Definition when an agent declares model', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'claude-opus-4-7',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-definition"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Definition');
    expect(section!.textContent).toContain('claude-opus-4-7');
  });

  it('lists runtime and capability fields together in the one section', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      tools: ['Bash', 'Read'],
      mcpServers: [{ name: 'echo', command: 'echo hi', args: ['x'] }],
      hooks: { PreToolUse: { matchers: ['Bash'] } },
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-definition"]');
    expect(section).not.toBeNull();
    // Both runtime (model) and capability (tools / mcp / hooks) fields
    // live in the same section now.
    expect(section!.textContent).toContain('opus');
    expect(section!.textContent).toContain('Bash');
    expect(section!.textContent).toContain('echo');
    expect(section!.textContent).toContain('PreToolUse');
    expect(section!.textContent).toContain('matchers');
  });

  it('renders the section for a capability-only agent (no runtime fields)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      tools: ['Bash'],
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-definition"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Bash');
  });

  it('only counts background as a populated field when literally true', () => {
    const fmFalse = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      background: false,
    } as unknown as TFrontmatter;
    const { dom: domFalse } = bootstrap(fmFalse, 'agent');
    // background:false alone leaves every field empty so the renderer hides.
    expect(domFalse.querySelector('[data-testid="vendor-frontmatter"]')).toBeNull();

    const fmTrue = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      background: true,
    } as unknown as TFrontmatter;
    const { dom: domTrue } = bootstrap(fmTrue, 'agent');
    expect(domTrue.querySelector('[data-testid="vendor-frontmatter-definition"]')).not.toBeNull();
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

describe('VendorFrontmatter, Initial prompt', () => {
  it('renders the initialPrompt as a quote block at the foot of the Definition section', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      initialPrompt: 'Begin by analyzing the repository structure and reporting findings.',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-definition"]');
    expect(section).not.toBeNull();
    const quote = section!.querySelector('[data-testid="vendor-frontmatter-initial-prompt-quote"]');
    expect(quote).not.toBeNull();
    expect(quote!.textContent).toContain('Begin by analyzing');
    // The quote carries its own sub-label inside the shared section.
    expect(section!.textContent).toContain('Initial prompt');
  });

  it('hides the quote block when initialPrompt is empty', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(
      dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt-quote"]'),
    ).toBeNull();
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

  it('renders disallowed-tools for a skill (danger span with ban icon)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      'allowed-tools': ['Read', 'Edit'],
      'disallowed-tools': ['Bash', 'WebFetch'],
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'skill');
    const base = dom.querySelector('[data-testid="vendor-frontmatter-skill-base"]');
    expect(base).not.toBeNull();
    const danger = base!.querySelectorAll('.vfm__danger');
    expect(danger.length).toBe(2);
    expect(base!.querySelector('.vfm__danger .pi-ban')).not.toBeNull();
    expect(base!.textContent).toContain('Bash');
    expect(base!.textContent).toContain('WebFetch');
  });

  it('accepts a single-string disallowed-tools for a command', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      'disallowed-tools': 'Bash',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'command');
    const base = dom.querySelector('[data-testid="vendor-frontmatter-skill-base"]');
    expect(base).not.toBeNull();
    expect(base!.querySelectorAll('.vfm__danger').length).toBe(1);
    expect(base!.textContent).toContain('Bash');
  });

  it('does NOT render the Initial prompt quote for skill / command (agent only)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      when_to_use: 'When the user wants X.',
      model: 'opus',
      initialPrompt: 'this is agent-only and must not leak',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'skill');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-definition"]')).not.toBeNull();
    expect(
      dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt-quote"]'),
    ).toBeNull();
    expect(dom.textContent).not.toContain('this is agent-only');
  });
});
