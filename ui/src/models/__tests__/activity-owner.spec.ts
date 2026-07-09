import { describe, expect, it } from 'vitest';

import { shortenOwner } from '../activity-owner';

describe('shortenOwner', () => {
  it('keeps the prefix and truncates the id part to 8 chars', () => {
    expect(shortenOwner('main:6cfe5636-2e56-4271-91a6-87fc3d4355be')).toBe('main:6cfe5636');
  });

  it('leaves a short id untouched', () => {
    expect(shortenOwner('main:abc')).toBe('main:abc');
    expect(shortenOwner('main:6cfe5636')).toBe('main:6cfe5636');
  });

  it('truncates the whole string to 8 chars when there is no prefix', () => {
    expect(shortenOwner('abcdefghijklmno')).toBe('abcdefgh');
    expect(shortenOwner('agent-1')).toBe('agent-1');
  });

  it('splits on the FIRST colon only', () => {
    expect(shortenOwner('spawn:t1:extra-tail-here')).toBe('spawn:t1:extra');
  });

  it('returns empty for empty input', () => {
    expect(shortenOwner('')).toBe('');
  });
});
