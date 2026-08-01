/**
 * Sanitisers for strings that flow from disk-resident user content
 * (markdown frontmatter, plugin output, persisted enrichment values)
 * into terminal output. Without sanitisation a hostile file can inject
 * control sequences that move the cursor, repaint the screen, hide
 * text, write the operator's clipboard, or, on certain legacy
 * terminals, trigger command execution.
 *
 * Two layered helpers:
 *
 *   - `stripAnsi(text)`, removes the escape sequences proper: the
 *     7-bit `ESC`-led forms, their 8-bit C1 equivalents, and the
 *     "string" sequences (OSC / DCS / APC / PM / SOS) together with
 *     the payload they carry.
 *   - `sanitizeForTerminal(text)`, that strip plus every control
 *     character with no place in user content: C0 except `\t` `\n`
 *     `\r`, DEL, the whole C1 block, the Unicode line and paragraph
 *     separators, and the explicit bidi overrides. Use this everywhere
 *     a disk-sourced string is about to be `write()`-en to
 *     stdout/stderr.
 *
 * Both the 7-bit and the 8-bit encoding of every family are handled on
 * purpose (audit finding, 2026-08-01). A terminal that decodes
 * UTF-8-encoded C1 as controls reads U+009D as OSC and U+009C as ST,
 * so `U+009D 52;c;<base64> U+009C` is a working OSC 52 clipboard write
 * that contains no ESC byte at all and sailed straight through the
 * previous C0-only filter. U+0085 (NEL) is the same line-forging
 * primitive as the bare `\r` handled below, and U+202E (RLO) reverses
 * a rendered filename, so `readme-<RLO>dm.md` reads as something else
 * entirely in `sm list`.
 *
 * Every pattern below is written with `\uXXXX` / `\xXX` escapes rather
 * than literal characters on purpose: the bytes this module exists to
 * remove are invisible in an editor, and a literal one silently
 * vanishes from the source on the first careless copy.
 *
 * Surface area kept deliberately small. If a renderer needs richer
 * escaping (HTML, shell, JSON), it should reach for the matching
 * dedicated helper rather than extending this one.
 */

/**
 * "String" sequences: an introducer, an arbitrary payload, a
 * terminator. OSC (`ESC ]` / U+009D) is the dangerous one (OSC 52
 * writes the clipboard, OSC 8 forges a hyperlink); DCS (U+0090), SOS
 * (U+0098), PM (U+009E) and APC (U+009F) round out the family.
 * Matched ahead of `ANSI_ESCAPE_RE` because the payload charset is
 * unbounded: the narrower CSI-style pattern below strips the
 * introducer and leaves the payload behind as literal text.
 *
 * Terminators are ST in both spellings (`ESC \` and U+009C) and BEL,
 * and one of them is REQUIRED for the payload to be swallowed. An
 * introducer with no terminator matches nothing here and falls through
 * to `CONTROL_RE`, which drops the single character and leaves the
 * rest of the string intact.
 *
 * That asymmetry is deliberate. Consuming to end of input would mirror
 * a real terminal, which keeps eating output while it waits for an ST
 * that never comes, but the terminal only behaves that way if the
 * introducer REACHES it, and after this pass it never does. So there
 * is no fidelity to preserve, only data to lose: a single stray C1
 * byte from a mis-decoded Latin-1 filename (far more common than the
 * attack) would erase the rest of the path from `sm list`. A complete
 * introducer-plus-terminator pair still swallows everything between
 * them, which is exactly where the terminal really would.
 */
// eslint-disable-next-line no-control-regex
const STRING_SEQUENCE_RE = /(?:\x1B[P\]X^_]|[\u0090\u0098\u009D\u009E\u009F])[\s\S]*?(?:\x1B\\|[\u009C\x07])/g;

// CSI / single-char ESC sequences. Pattern adapted from `strip-ansi`
// v7 (MIT, Sindre Sorhus). The kernel deliberately stays
// dependency-free for security-critical helpers, so the regex is
// vendored (with the `\x1B` / `\u009B` lead-byte anchors preserved)
// instead of pulling in the package. The BEL-terminated branch is kept
// even though `STRING_SEQUENCE_RE` now claims OSC first: it still
// catches an `ESC [` form that happens to end in BEL. The other 8-bit
// introducers are deliberately NOT added to this lead class, they
// belong to the string family above, where the payload travels with
// the introducer instead of surviving it.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /[\x1B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\x07)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

// Control characters except TAB (\x09), LF (\x0A), CR (\x0D):
//   - C0 (\x00-\x1F), the classic block.
//   - DEL (\x7F), terminals interpret it as backspace.
//   - C1 (\x80-\x9F), the 8-bit twins of the ESC-led sequences. Whole
//     sequences are removed above; this is the backstop for a lone
//     introducer and for the single-character C1 controls that carry
//     no payload at all (IND, NEL, HTS, RI).
// The range runs \x7F-\x9F so DEL and C1 collapse into one span.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Characters that reposition or reorder rendered text without being
 * controls in the C0 / C1 sense:
 *
 *   - U+2028 / U+2029, line and paragraph separators. A terminal may
 *     break the line on them, forging output rows the same way a bare
 *     `\r` forges a column.
 *   - The explicit bidi set: marks (U+200E, U+200F), embeddings and
 *     overrides (U+202A-U+202E), isolates (U+2066-U+2069). U+202E
 *     alone renders `readme-<RLO>dm.md` as a different filename, which
 *     spoofs the operator's "which file is this" decision with no
 *     terminal-specific precondition at all.
 *
 * Right-to-left scripts are unaffected: the implicit bidi algorithm
 * renders Arabic and Hebrew correctly without any of these. The
 * zero-width joiners are deliberately NOT here, U+200D is load-bearing
 * for emoji sequences.
 */
const BIDI_AND_SEPARATOR_RE = /[\u2028\u2029\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// A bare carriage return (`\r` NOT immediately followed by `\n`) moves
// the cursor to column 0 and lets hostile content overwrite text already
// printed on the same line (a spoofing primitive, audit L2). It is
// dropped here; a `\r\n` pair is preserved so genuine CRLF line endings
// in disk content survive untouched. CR is kept out of `CONTROL_RE`
// precisely because the CRLF case needs the lookahead this regex adds.
const BARE_CR_RE = /\r(?!\n)/g;

export function stripAnsi(text: string): string {
  return text.replace(STRING_SEQUENCE_RE, '').replace(ANSI_ESCAPE_RE, '');
}

export function sanitizeForTerminal(text: string): string {
  return text
    .replace(STRING_SEQUENCE_RE, '')
    .replace(ANSI_ESCAPE_RE, '')
    .replace(CONTROL_RE, '')
    .replace(BIDI_AND_SEPARATOR_RE, '')
    .replace(BARE_CR_RE, '');
}
