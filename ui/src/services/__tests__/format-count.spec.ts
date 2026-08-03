/**
 * `services/format-count`, the compact / exact number pair used by the
 * chrome counters (today the GitHub star chip).
 *
 * Two things worth pinning: the thresholds (nothing changes under a
 * thousand, so the common case is untouched) and the pinned `en-US`
 * locale, since a separator that follows the OS would read as a bug
 * inside an English label, `1.234` meaning one thousand to a German
 * reader and one-point-two to everyone else.
 */

import { describe, expect, it } from 'vitest';

import { formatCompactCount, formatExactCount } from '../format-count';

describe('formatCompactCount', () => {
  it('leaves anything under a thousand alone', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(27)).toBe('27');
    expect(formatCompactCount(999)).toBe('999');
  });

  it('shortens from a thousand up, one decimal at most', () => {
    expect(formatCompactCount(1_000)).toBe('1K');
    expect(formatCompactCount(1_234)).toBe('1.2K');
    expect(formatCompactCount(12_345)).toBe('12.3K');
    expect(formatCompactCount(123_456)).toBe('123.5K');
  });

  it('keeps going past a million', () => {
    expect(formatCompactCount(1_500_000)).toBe('1.5M');
  });
});

describe('formatExactCount', () => {
  it('groups thousands with the pinned locale, never the OS one', () => {
    expect(formatExactCount(123_456)).toBe('123,456');
    expect(formatExactCount(1_000)).toBe('1,000');
    expect(formatExactCount(27)).toBe('27');
  });

  it('is what the compact form defers to, so nothing is actually hidden', () => {
    // The chip shows `123.5K`; the accessible name and tooltip carry
    // this, which is the reason the compact form is acceptable at all.
    expect(formatExactCount(123_456)).not.toBe(formatCompactCount(123_456));
    expect(formatExactCount(123_456)).toContain('456');
  });
});
