/**
 * Shared option-value validators for CLI verbs.
 *
 * Two near-duplicate "must be a positive integer" checks lived inline
 * in `sm list` (`--limit`) and `sm history` (`--limit`, `--top`), each
 * with its own i18n catalog entry. Consolidating here keeps the
 * acceptance rules in lock-step (a permissive `Number.parseInt` parse
 * accepts `'12abc'` as `12` — every call site needs the same defensive
 * checks against trim + signed input + non-integer).
 *
 * The helpers stay close to the call site (a CLI-style "validate +
 * write to stderr + return null" pattern) rather than throwing because
 * Clipanion's `Option.String({ validator: ... })` cascades reject
 * before the verb's `execute` runs, which collides with the existing
 * shape of these flags (they are read inside `execute()` and only
 * validated when the user passed them).
 */

import { tx } from '../../kernel/util/tx.js';
import { OPTION_VALIDATORS_TEXTS } from '../i18n/option-validators.texts.js';
import { ansiFor } from './ansi.js';

/**
 * Pure parse: trim + strict integer + sign check. Returns `null` on
 * any rejection, the parsed value otherwise.
 *
 * Side-effect-free counterpart to `parsePositiveIntegerOption` /
 * `parseNonNegativeIntegerOption` so verbs that defer the error
 * rendering (e.g. `sm serve` builds a discriminated `IPortErr`
 * union and dispatches to a verb-specific `SERVE_TEXTS` template
 * later) can reuse the same acceptance rules without taking a
 * `stderr` dependency.
 *
 * Accepts: `'0'`, `'1'`, `'42'`, `'  100  '`.
 * Rejects: `''`, `'-3'`, `'1.5'`, `'12abc'`, `'NaN'`, `'inf'`.
 */
export function tryParseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  // Every leg below is one of the failure modes the inline validators
  // across the CLI were already catching:
  //   - `Number.isInteger`     rejects NaN / Infinity / floats.
  //   - `parsed < 0`           rejects negatives.
  //   - `String(parsed) !== trimmed`  rejects `'12abc'`-style trailing
  //                            garbage that `parseInt` happily eats.
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) {
    return null;
  }
  return parsed;
}

/**
 * Parse `raw` as a strict positive integer (`>= 1`). Writes a
 * scoped-by-`label` error line to `stderr` on rejection and returns
 * `null` so the caller can short-circuit to the appropriate exit
 * code (typically `ExitCode.Error`).
 *
 * Accepts: `'1'`, `'42'`, `'  100  '` (leading/trailing whitespace
 * trimmed for symmetry with the pre-consolidation behaviour).
 *
 * Rejects: `''`, `'0'`, `'-3'`, `'1.5'`, `'12abc'`, `'NaN'`, `'inf'`.
 */
export function parsePositiveIntegerOption(
  raw: string,
  label: string,
  stderr: NodeJS.WritableStream,
): number | null {
  const parsed = tryParseNonNegativeInt(raw);
  if (parsed === null || parsed === 0) {
    const stderrTty = stderr as NodeJS.WriteStream & { isTTY?: boolean };
    const ansi = ansiFor({ isTTY: stderrTty.isTTY === true, noColorFlag: false });
    stderr.write(
      tx(OPTION_VALIDATORS_TEXTS.notPositiveInt, {
        glyph: ansi.red('✕'),
        label,
        value: raw,
      }),
    );
    return null;
  }
  return parsed;
}

