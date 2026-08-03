/**
 * Number formatting for counts shown in chrome, where horizontal room is
 * scarce and the exact digit rarely matters.
 *
 * Locale is PINNED to `en-US` rather than left to the browser. The UI is
 * English-only (AGENTS.md §Externalized texts, not internationalized),
 * and a number sitting inside an English label that switches separator
 * with the OS reads as a bug: `1.234` next to "Star" means one thousand
 * to a German reader and one-point-two to everyone else. The card's
 * byte / token labels already pin the same way.
 */

const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const EXACT = new Intl.NumberFormat('en-US');

/**
 * Short form for display: `999`, `1K`, `1.2K`, `12.3K`, `123.5K`.
 * Under a thousand nothing changes, so small numbers stay literal.
 *
 * Compact loses precision on purpose, which is why every caller pairs it
 * with `formatExactCount` in the accessible name / tooltip: the reader
 * who wants the real number is one hover (or one screen reader) away.
 */
export function formatCompactCount(value: number): string {
  return COMPACT.format(value);
}

/** Full form with thousands separators: `123,456`. */
export function formatExactCount(value: number): string {
  return EXACT.format(value);
}
