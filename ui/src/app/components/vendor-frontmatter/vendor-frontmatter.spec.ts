import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { VendorFrontmatter } from './vendor-frontmatter';
import type { TFrontmatter, TNodeKind } from '../../../models/node';

/**
 * `<sm-vendor-frontmatter>` — catalog curation 2026-05-07 tier
 * placement tests. T1 always visible; T2 visible when present;
 * T3 (Behavior) and T4 (Integrations) collapsed by default.
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

describe('VendorFrontmatter — agent T1 (always visible)', () => {
  it('renders model + tools + skills when present', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
      tools: ['Bash', 'Read'],
      skills: ['skills/foo.md'],
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-t1"]')).not.toBeNull();
    expect(dom.textContent).toContain('opus');
    expect(dom.textContent).toContain('Bash');
    expect(dom.textContent).toContain('skills/foo.md');
  });
});

describe('VendorFrontmatter — agent T2 (when present)', () => {
  it('hides T2 when neither disallowedTools nor initialPrompt is set', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-t2"]')).toBeNull();
  });

  it('shows T2 with disallowedTools', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      disallowedTools: ['Bash(rm *)'],
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-t2"]')).not.toBeNull();
    expect(dom.textContent).toContain('Bash(rm *)');
  });

  it('renders initialPrompt collapsed by default with a toggle button', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      initialPrompt: 'Begin by analyzing the repository structure and reporting findings.',
    } as unknown as TFrontmatter;
    const { dom, fixture } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt-toggle"]')).not.toBeNull();
    // Body not in DOM until expanded.
    expect(dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt"]')).toBeNull();
    const btn = dom.querySelector(
      '[data-testid="vendor-frontmatter-initial-prompt-toggle"]',
    ) as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-initial-prompt"]')).not.toBeNull();
  });
});

describe('VendorFrontmatter — agent T3 (Behavior, collapsed)', () => {
  it('shows the Behavior toggle but no body when collapsed (default)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      permissionMode: 'default',
      maxTurns: 5,
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-behavior-toggle"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-behavior-body"]')).toBeNull();
  });

  it('expands the Behavior body on toggle click', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      permissionMode: 'acceptEdits',
      maxTurns: 5,
    } as unknown as TFrontmatter;
    const { dom, fixture } = bootstrap(fm, 'agent');
    const toggle = dom.querySelector(
      '[data-testid="vendor-frontmatter-behavior-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    const body = dom.querySelector('[data-testid="vendor-frontmatter-behavior-body"]');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain('acceptEdits');
    expect(body!.textContent).toContain('5');
  });

  it('only counts background when literally true', () => {
    const fmFalse = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      background: false,
    } as unknown as TFrontmatter;
    const { dom: domFalse } = bootstrap(fmFalse, 'agent');
    expect(domFalse.querySelector('[data-testid="vendor-frontmatter-behavior-toggle"]')).toBeNull();
    const fmTrue = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      background: true,
    } as unknown as TFrontmatter;
    const { dom: domTrue } = bootstrap(fmTrue, 'agent');
    expect(domTrue.querySelector('[data-testid="vendor-frontmatter-behavior-toggle"]')).not.toBeNull();
  });
});

describe('VendorFrontmatter — agent T4 (Integrations, collapsed)', () => {
  it('hides Integrations entirely when no mcpServers and no hooks', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      model: 'opus',
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-integrations-toggle"]')).toBeNull();
  });

  it('shows the Integrations toggle when mcpServers is non-empty', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      mcpServers: [{ name: 'echo', command: 'echo hi' }],
    } as unknown as TFrontmatter;
    const { dom } = bootstrap(fm, 'agent');
    expect(dom.querySelector('[data-testid="vendor-frontmatter-integrations-toggle"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="vendor-frontmatter-integrations-body"]')).toBeNull();
  });

  it('expands Integrations body on click and renders mcpServers + hooks rows', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
      mcpServers: [{ name: 'echo', command: 'echo hi' }],
      hooks: { PreToolUse: { matchers: ['Bash'] } },
    } as unknown as TFrontmatter;
    const { dom, fixture } = bootstrap(fm, 'agent');
    const toggle = dom.querySelector(
      '[data-testid="vendor-frontmatter-integrations-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    const body = dom.querySelector('[data-testid="vendor-frontmatter-integrations-body"]');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain('echo');
    expect(body!.textContent).toContain('PreToolUse');
    expect(body!.textContent).toContain('matchers');
  });
});

describe('VendorFrontmatter — non-agent kinds', () => {
  it('hides the whole renderer for `note` (no vendor surface)', () => {
    const fm = {
      name: 'a',
      description: 'd',
      metadata: { version: '' },
    } as TFrontmatter;
    const { dom } = bootstrap(fm, 'note');
    expect(dom.querySelector('[data-testid="vendor-frontmatter"]')).toBeNull();
  });

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
});
