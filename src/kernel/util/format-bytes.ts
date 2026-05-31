/**
 * Human-readable byte size formatter, shared by the oversized-file
 * warnings the CLI (`sm scan` / `sm watch`) and serve terminal emit.
 *
 * Binary units (1 KiB = 1024 B) to match `scan.maxFileSizeBytes`'s own
 * documentation (default 1048576 = 1 MiB). One source so scan / watch /
 * serve render the same `1.5 MiB` for the same byte count.
 *
 * Output shape:
 *   - exact bytes for values under 1 KiB (`512 B`);
 *   - one decimal place otherwise, trailing `.0` stripped
 *     (`1 KiB`, `1.5 MiB`, `2 GiB`).
 *
 * Negative or non-finite input is clamped to `0 B`, the formatter is a
 * display helper, not a validator.
 */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  // Drop a trailing `.0` so `1.0 MiB` reads as `1 MiB`.
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${UNITS[unitIndex]}`;
}
