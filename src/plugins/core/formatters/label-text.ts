/**
 * Shared label normalisation for the line-oriented graph formatters
 * (`mermaid`, `dot`). Both grammars are newline-delimited: a raw `\n`
 * inside a node label or an edge label does not "wrap the text", it
 * terminates the statement and corrupts every line that follows.
 *
 * Node paths and node kinds are disk-sourced strings (a scanned file
 * name, a Provider-declared kind), so they are untrusted input for this
 * purpose. This helper flattens them to a single printable line BEFORE
 * the per-format escaping runs:
 *
 *   1. `sanitizeForTerminal` drops ANSI sequences and the C0 control
 *      subset (the same gate the `ascii` formatter applies).
 *   2. Any surviving whitespace control (`\t`, `\n`, `\r`) collapses to
 *      a single space, because steps 1 keeps those three by design.
 *
 * This is STRUCTURAL escaping, not the terminal sanitisation the CLI
 * exempts formatter output from (`context/cli-output-style.md`
 * §Sanitisation, payload-channel exemption): the verb still writes the
 * formatter's bytes verbatim, the formatter is simply responsible for
 * emitting a parseable document. Per-format character escaping (`#quot;`
 * for Mermaid, `\"` for DOT) lives in the formatter that owns the
 * grammar; only the newline problem is shared.
 *
 * Lives directly under `formatters/` (not in a subdirectory) on purpose:
 * the built-ins codegen only walks `formatters/<name>/index.ts`
 * DIRECTORIES, so a plain sibling module is invisible to it and cannot
 * be mistaken for a formatter named `label-text`.
 */

import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';

/** Whitespace controls `sanitizeForTerminal` deliberately preserves. */
const WHITESPACE_CONTROL_RE = /[\t\n\r]+/g;

/**
 * Flatten a disk-sourced string into one printable line, free of ANSI
 * sequences and control bytes. The caller applies its own grammar's
 * character escaping on top.
 */
export function toSingleLineLabel(text: string): string {
  return sanitizeForTerminal(text).replace(WHITESPACE_CONTROL_RE, ' ');
}

/**
 * Locale-INDEPENDENT string comparator. `localeCompare` (used by the
 * `ascii` formatter and `sm export`) resolves against the runtime's
 * default locale, so its ordering can differ between two machines with
 * different `LANG` values. Formatter output is contractually
 * byte-deterministic for the same input graph
 * (`spec/plugin-author-guide.md` §Formatters), so the graph formatters
 * sort on UTF-16 code units instead.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
