import { describe, expect, it } from 'vitest';

import {
  buildNameIndex,
  normalizeTrigger,
  pathBasenameForLink,
  resolveTargetToPath,
} from '../trigger-resolve';

describe('normalizeTrigger', () => {
  it('lowercases and unifies separators', () => {
    expect(normalizeTrigger('Build-Deploy')).toBe('build deploy');
    expect(normalizeTrigger('build_deploy')).toBe('build deploy');
    expect(normalizeTrigger('build deploy')).toBe('build deploy');
  });

  it('strips diacritics via NFD + Mn removal', () => {
    expect(normalizeTrigger('árbol')).toBe('arbol');
    expect(normalizeTrigger('café')).toBe('cafe');
  });

  it('preserves leading sigils', () => {
    // The normalizer does not strip `/` or `@`; the resolver does
    // that after normalising for the lookup.
    expect(normalizeTrigger('/deploy')).toBe('/deploy');
    expect(normalizeTrigger('@my-agent')).toBe('@my agent');
  });

  it('trims and collapses runs of whitespace', () => {
    expect(normalizeTrigger('  build   deploy  ')).toBe('build deploy');
  });
});

describe('pathBasenameForLink', () => {
  it('returns the filename without extension for plain .md paths', () => {
    expect(pathBasenameForLink('notes/todo.md')).toBe('todo');
    expect(pathBasenameForLink('.claude/agents/architect.md')).toBe('architect');
  });

  it('returns the parent directory for `SKILL.md` paths', () => {
    expect(pathBasenameForLink('.claude/skills/foo-skill/SKILL.md')).toBe('foo-skill');
    expect(pathBasenameForLink('.agents/skills/bar/SKILL.md')).toBe('bar');
  });

  it('handles bare basenames (no slashes)', () => {
    expect(pathBasenameForLink('stable-markdown.md')).toBe('stable-markdown');
  });

  it('returns the input when given an empty string', () => {
    expect(pathBasenameForLink('')).toBe('');
  });

  it('treats a lone `SKILL.md` (no parent) as the literal filename without extension', () => {
    // Edge case, `SKILL.md` with no parent directory cannot resolve
    // to "the parent name"; the function falls through to the
    // `.md`-stripping branch.
    expect(pathBasenameForLink('SKILL.md')).toBe('SKILL');
  });
});

describe('buildNameIndex', () => {
  it('indexes by `frontmatter.name` (canonical path)', () => {
    const idx = buildNameIndex([
      { path: 'a/foo.md', frontmatter: { name: 'foo' } },
      { path: 'b/bar.md', frontmatter: { name: 'bar' } },
    ]);
    expect(idx.get('foo')).toBe('a/foo.md');
    expect(idx.get('bar')).toBe('b/bar.md');
  });

  it('falls back to the path basename when `frontmatter.name` is missing or empty', () => {
    const idx = buildNameIndex([
      { path: 'agents/full-agent-gemini.md', frontmatter: { name: '' } },
      { path: 'agents/local-agent.md' },
    ]);
    expect(idx.get('full agent gemini')).toBe('agents/full-agent-gemini.md');
    expect(idx.get('local agent')).toBe('agents/local-agent.md');
  });

  it('prefers canonical `frontmatter.name` over the basename fallback on collisions', () => {
    // Two nodes whose normalised keys collide: one has a canonical
    // name, the other only the basename. The canonical one wins
    // because the first pass populates the map before the fallback.
    const idx = buildNameIndex([
      { path: 'a/foo.md', frontmatter: { name: 'foo' } },
      { path: 'b/foo.md', frontmatter: { name: '' } },
    ]);
    expect(idx.get('foo')).toBe('a/foo.md');
  });

  it('keeps the first canonical occurrence when two nodes share a normalised name', () => {
    const idx = buildNameIndex([
      { path: 'first.md', frontmatter: { name: 'Foo' } },
      { path: 'second.md', frontmatter: { name: 'foo' } },
    ]);
    expect(idx.get('foo')).toBe('first.md');
  });

  it('skips entries that produce an empty derived key', () => {
    const idx = buildNameIndex([{ path: '' }]);
    expect(idx.size).toBe(0);
  });
});

describe('resolveTargetToPath', () => {
  const nameIndex = new Map<string, string>([
    ['deploy', 'commands/deploy.md'],
    ['my agent', 'agents/my-agent.md'],
  ]);

  it('passes path-style targets through unchanged', () => {
    expect(resolveTargetToPath('commands/deploy.md', null, nameIndex)).toBe('commands/deploy.md');
    expect(resolveTargetToPath('./local.md', null, nameIndex)).toBe('./local.md');
  });

  it('resolves a slash trigger to the matching node path', () => {
    expect(resolveTargetToPath('/deploy', '/deploy', nameIndex)).toBe('commands/deploy.md');
  });

  it('resolves an at-directive trigger via the normalised name', () => {
    expect(resolveTargetToPath('@my-agent', '@my agent', nameIndex)).toBe('agents/my-agent.md');
  });

  it('returns the raw target when no node name matches', () => {
    expect(resolveTargetToPath('/unknown', '/unknown', nameIndex)).toBe('/unknown');
  });

  it('falls back to normalising the raw target when `normalizedTrigger` is absent', () => {
    expect(resolveTargetToPath('/Deploy', null, nameIndex)).toBe('commands/deploy.md');
  });
});
