import { describe, expect, it } from 'vitest';

import { pathBasenameForLink } from '../path-basename';

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
