/**
 * Type-shape regression tests for `models/node.ts` post catalog
 * curation 2026-05-07. The compile-time assertions verify the
 * trimmed `IFrontmatterBase` (only `name` + `description` required),
 * the per-vendor per-kind extensions (agent + skill-base), and the
 * sidecar overlay surface. Runtime assertions are minimal,
 * the load-bearing checks here are the `tsc` outputs.
 */
import { describe, expect, it } from 'vitest';
import {
  isStaleSidecar,
  STALE_SIDECAR_STATUSES,
  type IFrontmatterAgent,
  type IFrontmatterBase,
  type IFrontmatterCommand,
  type IFrontmatterSkill,
  type IFrontmatterSkillBase,
  type ISidecarOverlay,
  type INodeView,
  type TFrontmatter,
  type TFrontmatterNote,
  type TSidecarStatus,
} from '../node';

describe('models/node, frontmatter types (catalog curation 2026-05-07)', () => {
  it('IFrontmatterBase requires only name + description', () => {
    const fm: IFrontmatterBase = { name: 'a', description: 'b' };
    expect(fm.name).toBe('a');
    expect(fm.description).toBe('b');
  });

  it('extra keys ride through the base index signature (legacy `metadata:` block)', () => {
    // The pre-9.5 `metadata:` block is no longer a typed property; it
    // flows through via `additionalProperties: true` on the schema /
    // the `[extra: string]: unknown` index signature on the type.
    const fm: IFrontmatterBase = {
      name: 'a',
      description: 'b',
      metadata: { version: '1.2.3', stability: 'stable' },
    };
    const meta = fm['metadata'] as Record<string, unknown> | undefined;
    expect(meta?.['version']).toBe('1.2.3');
  });

  it('IFrontmatterAgent surfaces the 14 Anthropic agent fields', () => {
    const agent: IFrontmatterAgent = {
      name: 'architect',
      description: 'd',
      tools: ['Read', 'Edit'],
      disallowedTools: ['Bash(rm *)'],
      model: 'opus',
      permissionMode: 'plan',
      maxTurns: 10,
      skills: ['skills/foo.md'],
      mcpServers: [{ name: 'srv', command: 'node' }],
      hooks: { PreToolUse: { script: 'x' } },
      memory: 'project',
      background: false,
      effort: 'high',
      isolation: 'worktree',
      color: 'purple',
      initialPrompt: 'hello',
    };
    expect(agent.model).toBe('opus');
    expect(agent.color).toBe('purple');
  });

  it('IFrontmatterSkillBase covers the 13 Anthropic skill-base fields with verbatim spelling', () => {
    const skill: IFrontmatterSkillBase = {
      name: 's',
      description: 'd',
      when_to_use: 'when X happens',
      'argument-hint': '[issue]',
      arguments: ['name'],
      'disable-model-invocation': false,
      'user-invocable': true,
      'allowed-tools': ['Bash(git add *)'],
      model: 'sonnet',
      effort: 'medium',
      context: 'fork',
      agent: 'general-purpose',
      hooks: {},
      paths: ['src/**/*.ts'],
      shell: 'bash',
    };
    expect(skill['allowed-tools']).toEqual(['Bash(git add *)']);
    expect(skill.when_to_use).toBe('when X happens');
  });

  it('IFrontmatterSkill and IFrontmatterCommand alias the same skill-base shape', () => {
    const skill: IFrontmatterSkill = { name: 's', description: 'd', model: 'opus' };
    const cmd: IFrontmatterCommand = { name: 'c', description: 'd', model: 'opus' };
    expect(skill.model).toBe('opus');
    expect(cmd.model).toBe('opus');
  });

  it('TFrontmatterNote is a plain alias for the universal base', () => {
    const note: TFrontmatterNote = { name: 'n', description: 'd' };
    expect(note.name).toBe('n');
  });

  it('TFrontmatter union accepts every per-kind shape', () => {
    const fms: TFrontmatter[] = [
      { name: 'a', description: 'd', model: 'opus' } as IFrontmatterAgent,
      { name: 's', description: 'd', model: 'opus' } as IFrontmatterSkill,
      { name: 'c', description: 'd' } as IFrontmatterCommand,
      { name: 'n', description: 'd' } as TFrontmatterNote,
    ];
    expect(fms).toHaveLength(4);
  });
});

describe('models/node, INodeView narrowing by `node.kind`', () => {
  it('callers narrow by `node.kind` (not `frontmatter.type`)', () => {
    // Catalog curation 2026-05-07: `frontmatter.type` was dropped from
    // the typed surface. The discriminator is `INodeView.kind` from
    // the kernel, exactly what `<sm-vendor-frontmatter>` uses.
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: 'd', model: 'opus' } as IFrontmatterAgent,
    };
    if (node.kind === 'agent') {
      const fm = node.frontmatter as IFrontmatterAgent;
      expect(fm.model).toBe('opus');
    }
  });
});

describe('models/node, sidecar overlay helpers', () => {
  it('isStaleSidecar returns false for absent / fresh / null overlays', () => {
    expect(isStaleSidecar(undefined)).toBe(false);
    expect(isStaleSidecar(null)).toBe(false);
    expect(isStaleSidecar({ present: false })).toBe(false);
    expect(isStaleSidecar({ present: true, status: 'fresh' })).toBe(false);
    expect(isStaleSidecar({ present: true, status: null })).toBe(false);
  });

  it('isStaleSidecar returns true for every status in STALE_SIDECAR_STATUSES', () => {
    for (const status of ['stale-body', 'stale-frontmatter', 'stale-both'] as const) {
      const overlay: ISidecarOverlay = { present: true, status: status as TSidecarStatus };
      expect(isStaleSidecar(overlay)).toBe(true);
      expect(STALE_SIDECAR_STATUSES.has(status)).toBe(true);
    }
  });
});
