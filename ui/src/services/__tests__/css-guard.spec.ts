import { describe, expect, it } from 'vitest';

import { cssColorOrNull } from '../css-guard';

describe('cssColorOrNull', () => {
  it('accepts hex colours (3/4/6/8 digits, any case)', () => {
    expect(cssColorOrNull('#3b82f6')).toBe('#3b82f6');
    expect(cssColorOrNull('#abc')).toBe('#abc');
    expect(cssColorOrNull('#AABBCCDD')).toBe('#AABBCCDD');
  });

  it('accepts bare named colours', () => {
    expect(cssColorOrNull('purple')).toBe('purple');
    expect(cssColorOrNull('RebeccaPurple')).toBe('RebeccaPurple');
    expect(cssColorOrNull('transparent')).toBe('transparent');
  });

  it('trims surrounding whitespace', () => {
    expect(cssColorOrNull('  blue  ')).toBe('blue');
  });

  it('rejects url() beacons, declaration breakouts, comments, and functions', () => {
    expect(cssColorOrNull('url(https://attacker.example/beacon)')).toBeNull();
    expect(cssColorOrNull('red;background:url(https://attacker.example/x)')).toBeNull();
    expect(cssColorOrNull('blue/**/;')).toBeNull();
    expect(cssColorOrNull('var(--x)')).toBeNull();
    // Functional colours are rejected on purpose: allowing `(` would open
    // the door to `url(`. frontmatter.color is a named enum or hex.
    expect(cssColorOrNull('rgb(1, 2, 3)')).toBeNull();
  });

  it('rejects non-strings, empty input, and malformed hex', () => {
    expect(cssColorOrNull(null)).toBeNull();
    expect(cssColorOrNull(undefined)).toBeNull();
    expect(cssColorOrNull(123)).toBeNull();
    expect(cssColorOrNull('')).toBeNull();
    expect(cssColorOrNull('   ')).toBeNull();
    expect(cssColorOrNull('#12')).toBeNull();
    expect(cssColorOrNull('#xyz')).toBeNull();
  });
});
