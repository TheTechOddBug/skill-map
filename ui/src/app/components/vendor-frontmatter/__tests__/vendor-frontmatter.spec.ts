import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { SafeHtml } from '@angular/platform-browser';

import { VendorFrontmatter } from '../vendor-frontmatter';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import type { TFrontmatter, TNodeKind } from '../../../../models/node';

/**
 * Deterministic markdown stub: turns `**x**` into `<strong>x</strong>`
 * and wraps in a `<p>`. The real markdown-it transform is covered by the
 * MarkdownRenderer spec; here we only assert the component wires
 * `render()` output into the prompt quote.
 */
const markdownStub = {
  render: (src: string): Promise<SafeHtml> =>
    Promise.resolve(
      `<p>${src.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>` as unknown as SafeHtml,
    ),
  renderInline: (src: string): Promise<SafeHtml> => Promise.resolve(src as unknown as SafeHtml),
} as unknown as MarkdownRenderer;

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
  skillPathByName?: ReadonlyMap<string, string>,
): { dom: HTMLElement; fixture: ReturnType<typeof TestBed.createComponent<VendorFrontmatter>> } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(VendorFrontmatter);
  fixture.componentRef.setInput('frontmatter', fm);
  fixture.componentRef.setInput('kind', kind);
  if (skillPathByName) fixture.componentRef.setInput('skillPathByName', skillPathByName);
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

  it('renders background even when false (shows the actual value)', () => {
    const fmFalse = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      background: false,
    } as unknown as TFrontmatter;
    const { dom: domFalse } = bootstrap(fmFalse, 'agent');
    const sectionFalse = domFalse.querySelector('[data-testid="vendor-frontmatter-definition"]');
    expect(sectionFalse).not.toBeNull();
    expect(sectionFalse!.textContent).toContain('Background');
    expect(sectionFalse!.textContent).toContain('false');

    const fmTrue = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      background: true,
    } as unknown as TFrontmatter;
    const { dom: domTrue } = bootstrap(fmTrue, 'agent');
    expect(domTrue.textContent).toContain('Background');
    expect(domTrue.textContent).toContain('true');
  });

  it('renders color (value + swatch) but not name/description (header consumes those)', () => {
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
    expect(root!.textContent).toContain('Color');
    expect(root!.textContent).toContain('cyan');
    expect(root!.querySelector('.vfm__swatch')).not.toBeNull();
  });

  it('renders unknown frontmatter keys via the generic catch-all', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      pruebaDeDesconocido: 'es una prueba',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-definition"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('pruebaDeDesconocido');
    expect(section!.textContent).toContain('es una prueba');
    // Catch-all fields carry a warning glyph flagging them as non-provider.
    expect(section!.querySelector('.vfm__unknown')).not.toBeNull();
  });

  it('does NOT dump name / description / metadata through the catch-all', () => {
    const fm = {
      name: 'theArchitect',
      description: 'long desc here',
      metadata: { version: '1.2.3' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    const section = dom.querySelector('[data-testid="vendor-frontmatter-definition"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).not.toContain('metadata');
    expect(section!.textContent).not.toContain('1.2.3');
    expect(section!.textContent).not.toContain('theArchitect');
  });
});

describe('VendorFrontmatter, Initial prompt', () => {
  it('renders the initialPrompt as a markdown quote block at the foot of the section', async () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      initialPrompt: 'Begin by **analyzing** the repository structure.',
    } as unknown as TFrontmatter;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: MarkdownRenderer, useValue: markdownStub }],
    });
    const fixture = TestBed.createComponent(VendorFrontmatter);
    fixture.componentRef.setInput('frontmatter', fm);
    fixture.componentRef.setInput('kind', 'agent');
    fixture.detectChanges();
    // The render signal resolves on a microtask (stubbed); let it settle.
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const dom = fixture.nativeElement as HTMLElement;
    const section = dom.querySelector('[data-testid="vendor-frontmatter-definition"]');
    expect(section).not.toBeNull();
    const quote = section!.querySelector('[data-testid="vendor-frontmatter-initial-prompt-quote"]');
    expect(quote).not.toBeNull();
    expect(quote!.textContent).toContain('Begin by analyzing');
    // Wired through MarkdownRenderer.render: **emphasis** becomes <strong>.
    expect(quote!.querySelector('strong')).not.toBeNull();
    expect(quote!.innerHTML).not.toContain('**');
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

  it('renders no dedicated Initial prompt quote for skill / command (agent only)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      when_to_use: 'When the user wants X.',
      model: 'opus',
      initialPrompt: 'agent-only field on a skill',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'skill');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-definition"]')).not.toBeNull();
    // The dedicated agent-only quote block is not rendered for a skill.
    expect(
      dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt-quote"]'),
    ).toBeNull();
    // But the value is not hidden: `initialPrompt` is an unrecognised key
    // for a skill, so it surfaces through the generic catch-all (show-all).
    expect(dom.textContent).toContain('initialPrompt');
    expect(dom.textContent).toContain('agent-only field on a skill');
  });
});

describe('VendorFrontmatter, agent skills links', () => {
  it('renders a resolvable skill as a clickable link with an arrow', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      skills: ['known-skill'],
    } as unknown as TFrontmatter;
    const map = new Map([['known-skill', '.claude/skills/known-skill/SKILL.md']]);
    const { dom, fixture } = bootstrap(fm, 'agent', map);
    let opened: string | null = null;
    fixture.componentRef.setInput('onSkillClick', (p: string) => {
      opened = p;
    });
    fixture.detectChanges();

    const link = dom.querySelector('.sm-node-link--known') as HTMLElement | null;
    expect(link).not.toBeNull();
    expect(link!.querySelector('.pi-arrow-up-right')).not.toBeNull();
    expect(link!.textContent).toContain('known-skill');
    link!.click();
    expect(opened).toBe('.claude/skills/known-skill/SKILL.md');
  });

  it('renders an unresolvable skill dimmed, with no link and no arrow', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      skills: ['ghost-skill'],
    } as unknown as TFrontmatter;
    // No map → the skill does not resolve.
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('.sm-node-link--known')).toBeNull();
    expect(dom.querySelector('.pi-arrow-up-right')).toBeNull();
    // The identifier is still shown (as a dimmed span), just not linked.
    expect(dom.textContent).toContain('ghost-skill');
  });
});
