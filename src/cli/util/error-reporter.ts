/**
 * CLI-side re-export of the kernel's `formatErrorMessage`. The body
 * lived here historically (every CLI command writes the same
 * `instanceof Error ? err.message : String(err)` shape on its catch
 * branch) until kernel + BFF callers needed the same primitive. Moving
 * the implementation under `kernel/util/format-error.ts` keeps it
 * available across the layering boundary while preserving every
 * existing import path that referenced this file.
 *
 * The shape is intentionally small — adding a `--verbose` stack mode,
 * a JSON envelope, or a sentinel-based exit code is the right job for
 * this module if those needs surface; today they don't.
 */

export { formatErrorMessage } from '../../kernel/util/format-error.js';
