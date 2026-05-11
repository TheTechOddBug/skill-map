import { describe, expect, it } from 'vitest';

import { resolveIcon } from './icon';

/**
 * Pure-function spec for the manifest icon resolver. We exercise the
 * resolver directly (no Angular TestBed) so the test matrix stays
 * decoupled from the component plumbing — the chassis is one line
 * (`<i>` vs `<span>`) and the contract is the routing table.
 */

describe('resolveIcon — empty / nullish input', () => {
  it('returns null for undefined', () => {
    expect(resolveIcon(undefined)).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(resolveIcon('')).toBeNull();
  });
  it('returns null for whitespace-only string', () => {
    expect(resolveIcon('   ')).toBeNull();
  });
});

describe('resolveIcon — emoji branch (non-ASCII-letter first codepoint)', () => {
  it('routes a single-codepoint emoji to <span>', () => {
    expect(resolveIcon('🚀')).toEqual({ kind: 'emoji', text: '🚀' });
  });
  it('routes a ZWJ-joined compound emoji to <span>', () => {
    expect(resolveIcon('👨‍💻')).toEqual({ kind: 'emoji', text: '👨‍💻' });
  });
  it('routes ASCII punctuation icons (`@`, `#`) to <span> — used by at-directive examples', () => {
    expect(resolveIcon('@')).toEqual({ kind: 'emoji', text: '@' });
    expect(resolveIcon('#')).toEqual({ kind: 'emoji', text: '#' });
  });
});

describe('resolveIcon — PrimeIcons branch', () => {
  it('shorthand `pi-foo` prepends the `pi` class loader', () => {
    expect(resolveIcon('pi-search')).toEqual({ kind: 'pi', cls: 'pi pi-search' });
  });
  it('full class `pi pi-foo` passes through', () => {
    expect(resolveIcon('pi pi-search')).toEqual({ kind: 'pi', cls: 'pi pi-search' });
  });
  it('allows digits and dashes in the name', () => {
    expect(resolveIcon('pi-arrow-down-left')).toEqual({ kind: 'pi', cls: 'pi pi-arrow-down-left' });
    expect(resolveIcon('pi-volume-1')).toEqual({ kind: 'pi', cls: 'pi pi-volume-1' });
  });
});

describe('resolveIcon — FontAwesome explicit family branch', () => {
  it('passes through `fa-solid fa-foo`', () => {
    expect(resolveIcon('fa-solid fa-star')).toEqual({ kind: 'fa', cls: 'fa-solid fa-star' });
  });
  it('passes through `fa-regular fa-foo`', () => {
    expect(resolveIcon('fa-regular fa-star')).toEqual({ kind: 'fa', cls: 'fa-regular fa-star' });
  });
  it('passes through `fa-brands fa-foo`', () => {
    expect(resolveIcon('fa-brands fa-github')).toEqual({ kind: 'fa', cls: 'fa-brands fa-github' });
  });
});

describe('resolveIcon — FontAwesome shorthand branch', () => {
  it('defaults `fa-foo` to `fa-solid fa-foo`', () => {
    expect(resolveIcon('fa-star')).toEqual({ kind: 'fa', cls: 'fa-solid fa-star' });
  });
  it('keeps multi-token icon names with dashes', () => {
    expect(resolveIcon('fa-magnifying-glass')).toEqual({
      kind: 'fa',
      cls: 'fa-solid fa-magnifying-glass',
    });
  });
});

describe('resolveIcon — invalid / rejected', () => {
  it('returns null for bare names (greenfield: no fallback)', () => {
    expect(resolveIcon('star-fill')).toBeNull();
    expect(resolveIcon('search')).toBeNull();
    expect(resolveIcon('arrow-down')).toBeNull();
  });
  it('returns null for prefixes with invalid name shape', () => {
    expect(resolveIcon('pi-')).toBeNull();
    expect(resolveIcon('fa-')).toBeNull();
  });
  it('returns null for FA family without an `fa-foo` token', () => {
    expect(resolveIcon('fa-solid')).toBeNull();
    expect(resolveIcon('fa-regular')).toBeNull();
  });
  it('returns null for FA family without a following space', () => {
    expect(resolveIcon('fa-solidfa-star')).toBeNull();
  });
  it('returns null for an unknown FA family', () => {
    expect(resolveIcon('fa-light fa-star')).toBeNull();
  });
  it('returns null for uppercase prefixes', () => {
    expect(resolveIcon('PI-search')).toBeNull();
    expect(resolveIcon('FA-star')).toBeNull();
  });
  it('trims surrounding whitespace before validating', () => {
    expect(resolveIcon('  pi-search  ')).toEqual({ kind: 'pi', cls: 'pi pi-search' });
    expect(resolveIcon('\tfa-solid fa-star\n')).toEqual({ kind: 'fa', cls: 'fa-solid fa-star' });
  });
});
