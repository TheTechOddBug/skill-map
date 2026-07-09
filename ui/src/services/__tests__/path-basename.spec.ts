import { describe, expect, it } from 'vitest';

import { activityNodeLabel, pathBasenameForLink } from '../path-basename';

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

describe('activityNodeLabel', () => {
  it('shows the server name for an mcp node path', () => {
    expect(activityNodeLabel('mcp://notion')).toBe('notion');
    expect(activityNodeLabel('mcp://github-server/tool')).toBe('github-server');
  });

  it('falls back to the basename label for a non-mcp path', () => {
    expect(activityNodeLabel('.claude/skills/deploy/SKILL.md')).toBe('deploy');
    expect(activityNodeLabel('.claude/agents/reviewer.md')).toBe('reviewer');
  });

  it('returns the raw value for a degenerate `mcp://` with no server', () => {
    expect(activityNodeLabel('mcp://')).toBe('mcp://');
  });
});
