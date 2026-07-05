import { describe, expect, it } from 'vitest';

import { KIND_NAME_PATTERN, cssColorOrNull, cssKindNameOrFallback } from '../css-guard';

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

describe('cssKindNameOrFallback', () => {
  it('returns a schema-valid kind verbatim so registered kinds keep their palette', () => {
    expect(cssKindNameOrFallback('agent')).toBe('agent');
    expect(cssKindNameOrFallback('workflow')).toBe('workflow');
    expect(cssKindNameOrFallback('my-plugin_kind2')).toBe('my-plugin_kind2');
  });

  it('degrades an off-pattern kind to the neutral markdown fallback', () => {
    // The exact break-out shapes a malicious plugin-declared kind could try
    // against the `var(--sm-kind-<kind>)` composition.
    expect(cssKindNameOrFallback('a);background:url(https://attacker/x')).toBe('markdown');
    expect(cssKindNameOrFallback('a, red')).toBe('markdown');
    expect(cssKindNameOrFallback('a};body{display:none')).toBe('markdown');
    expect(cssKindNameOrFallback('9leadingdigit')).toBe('markdown');
    expect(cssKindNameOrFallback('has space')).toBe('markdown');
    expect(cssKindNameOrFallback('')).toBe('markdown');
  });

  it('degrades non-strings (null kind on no selection) to the fallback', () => {
    expect(cssKindNameOrFallback(null)).toBe('markdown');
    expect(cssKindNameOrFallback(undefined)).toBe('markdown');
    expect(cssKindNameOrFallback(123)).toBe('markdown');
  });

  it('honours a custom fallback', () => {
    expect(cssKindNameOrFallback('bad;', 'skill')).toBe('skill');
  });

  it('caps the name length at the schema bound (64 chars)', () => {
    expect(cssKindNameOrFallback('a'.repeat(64))).toBe('a'.repeat(64));
    expect(cssKindNameOrFallback('a'.repeat(65))).toBe('markdown');
  });

  it('KIND_NAME_PATTERN is the single exported source of truth', () => {
    expect(KIND_NAME_PATTERN.test('agent')).toBe(true);
    expect(KIND_NAME_PATTERN.test('a;')).toBe(false);
  });
});
