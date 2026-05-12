/**
 * Kernel-accessible counterpart of `cli/util/error-reporter.ts`'s
 * `formatErrorMessage`. The CLI helper now re-exports from here so the
 * historic CLI import path keeps working while kernel + BFF callers can
 * consume it directly without crossing the layering boundary.
 *
 * Kept deliberately tiny, same shape as the original CLI helper. The
 * surface grows (e.g. a `--verbose` stack mode, JSON envelope) only
 * when a concrete need surfaces.
 */

/**
 * Compact error → string conversion.
 *
 * - `Error` → `err.message` verbatim. Callers wrap with their own
 *   verb-specific context line via `tx(*_TEXTS.x, { message })` so
 *   error catalogues stay greppable.
 * - Anything else → `String(value)`. Catches the rare throw-a-string
 *   / throw-an-object path without exploding on `null`
 *   (`String(null)` = `'null'`).
 */
export function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
