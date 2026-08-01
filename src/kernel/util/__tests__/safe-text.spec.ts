/**
 * `kernel/util/safe-text`, sanitisers used before printing
 * disk-sourced content (frontmatter titles, plugin output, persisted
 * issue messages) to a TTY. The risk: a hostile markdown file can ship
 * ANSI/CSI escapes that move the cursor, repaint the screen, hide
 * text, or, on certain legacy terminals, trigger command execution.
 *
 * `stripAnsi` removes the escape sequences proper. `sanitizeForTerminal`
 * also drops C0 control characters except the three we keep (`\t`, `\n`,
 * `\r`). The two are kept separate so a future renderer can pick the
 * lighter strip when it has its own line-discipline rules.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sanitizeForTerminal, stripAnsi } from '../safe-text.js';

describe('stripAnsi', () => {
  it('passes through plain text unchanged', () => {
    assert.equal(stripAnsi('hello world'), 'hello world');
  });

  it('removes a CSI SGR sequence (color reset)', () => {
    assert.equal(stripAnsi('[31mred[0m'), 'red');
  });

  it('removes a screen-clearing CSI sequence', () => {
    assert.equal(stripAnsi('before[2J[Hafter'), 'beforeafter');
  });

  it('removes a cursor-move CSI sequence', () => {
    assert.equal(stripAnsi('row1[10;20Hpwn'), 'row1pwn');
  });

  it('preserves newlines and tabs', () => {
    assert.equal(stripAnsi('a\n\tb'), 'a\n\tb');
  });

  it('removes an OSC 8 hyperlink sequence (URL chars in the param)', () => {
    // OSC 8 emits `ESC ] 8 ; ; <url> BEL <label> ESC ] 8 ; ; BEL`.
    // The expanded charset (`-/#&.:=?%@~_`) lets the regex match the
    // `https://example.com` URL. Pre-audit (M6) the regex stopped at the
    // `:` and left the URL fragment behind.
    const link = '\x1B]8;;https://example.com\x07label\x1B]8;;\x07';
    assert.equal(stripAnsi(link), 'label');
  });
});

describe('sanitizeForTerminal', () => {
  it('passes through plain text unchanged', () => {
    assert.equal(sanitizeForTerminal('Hello, Arquitecto!'), 'Hello, Arquitecto!');
  });

  it('strips ANSI escapes (delegates to stripAnsi)', () => {
    assert.equal(sanitizeForTerminal('[31mred[0m'), 'red');
  });

  it('drops NUL, BEL, BS', () => {
    assert.equal(sanitizeForTerminal('a\x00b\x07c\x08d'), 'abcd');
  });

  it('drops VT, FF and the SO..US block', () => {
    assert.equal(sanitizeForTerminal('a\x0bb\x0cc\x0ed\x1fe'), 'abcde');
  });

  it('drops DEL (0x7F)', () => {
    assert.equal(sanitizeForTerminal('a\x7fb'), 'ab');
  });

  it('preserves TAB and LF', () => {
    assert.equal(sanitizeForTerminal('a\tb\nc'), 'a\tb\nc');
  });

  it('preserves a CRLF pair but drops a bare CR (column-0 overwrite spoof)', () => {
    // `\r\n` is a genuine line ending, kept intact; a lone `\r` would
    // reposition the cursor to overwrite already-printed text (audit L2).
    assert.equal(sanitizeForTerminal('line1\r\nline2'), 'line1\r\nline2');
    assert.equal(sanitizeForTerminal('safe\rHACKED'), 'safeHACKED');
    assert.equal(sanitizeForTerminal('trailing\r'), 'trailing');
  });

  it('strips a screen-repaint + colour-reset attack from a hostile title', () => {
    const hostile = 'My Agent[2J[H[31mPWN[0m';
    assert.equal(sanitizeForTerminal(hostile), 'My AgentPWN');
  });

  it('preserves printable Unicode (CJK, emoji, accented)', () => {
    assert.equal(sanitizeForTerminal('café, 日本, 🚀'), 'café, 日本, 🚀');
  });
});

/**
 * Regression matrix for the 2026-08-01 audit finding: the filter used
 * to stop at DEL, so the entire C1 block, the Unicode separators and
 * the bidi overrides reached the terminal intact. Each row is one
 * family; a future edit to any single regex cannot silently reopen one
 * without turning a row red.
 *
 * Codepoints are built with `String.fromCodePoint` rather than written
 * as literals: the characters under test are invisible in an editor
 * and a literal one does not survive a careless copy of this file.
 */
describe('sanitizeForTerminal, control-character matrix', () => {
  const ch = (cp: number): string => String.fromCodePoint(cp);

  const DROPPED: ReadonlyArray<readonly [number, string]> = [
    // C1 single-character controls. NEL in particular is the same
    // line-forging primitive as the bare CR handled above.
    [0x84, 'IND'],
    [0x85, 'NEL'],
    [0x88, 'HTS'],
    [0x8d, 'RI'],
    // C1 string introducers and terminators, stripped even when they
    // appear alone (a well-formed sequence is removed with its payload
    // by the case below).
    [0x90, 'DCS'],
    [0x98, 'SOS'],
    [0x9b, 'CSI'],
    [0x9c, 'ST'],
    [0x9d, 'OSC'],
    [0x9e, 'PM'],
    [0x9f, 'APC'],
    // Line and paragraph separators: row forgery.
    [0x2028, 'LINE SEPARATOR'],
    [0x2029, 'PARAGRAPH SEPARATOR'],
    // Explicit bidi: filename and label spoofing.
    [0x200e, 'LRM'],
    [0x200f, 'RLM'],
    [0x202a, 'LRE'],
    [0x202d, 'LRO'],
    [0x202e, 'RLO'],
    [0x2066, 'LRI'],
    [0x2069, 'PDI'],
  ];

  for (const [cp, name] of DROPPED) {
    it(`drops U+${cp.toString(16).toUpperCase().padStart(4, '0')} (${name})`, () => {
      assert.equal(sanitizeForTerminal(`a${ch(cp)}b`), 'ab');
    });
  }

  it('removes an 8-bit OSC 52 clipboard write with its payload', () => {
    // The exploit from the audit: no ESC byte anywhere, so the
    // pre-fix C0-only filter passed it through untouched and a
    // terminal decoding UTF-8 C1 as controls wrote the operator's
    // clipboard. Payload must not survive as literal text either.
    const attack = `${ch(0x9d)}52;c;ZWNobyBQV05FRAo=${ch(0x9c)}tail.md`;
    assert.equal(sanitizeForTerminal(attack), 'tail.md');
  });

  it('removes 7-bit string sequences (DCS / APC / PM) with their payload', () => {
    assert.equal(sanitizeForTerminal('a\x1BPpayload\x1B\\b'), 'ab');
    assert.equal(sanitizeForTerminal('a\x1B_payload\x1B\\b'), 'ab');
    assert.equal(sanitizeForTerminal('a\x1B^payload\x1B\\b'), 'ab');
  });

  it('keeps the tail after an UNterminated introducer (no data loss)', () => {
    // The introducer never reaches the terminal, so there is no
    // string-collecting mode to be faithful to. Dropping the tail
    // would only punish mis-decoded Latin-1 filenames, which are far
    // more common than the attack.
    assert.equal(sanitizeForTerminal(`ok${ch(0x9d)}52;c;never-closed`), 'ok52;c;never-closed');
  });

  it('swallows everything between a COMPLETE introducer / terminator pair', () => {
    // Here the terminal really would collect the payload as a string,
    // so removing it matches what the operator would have seen.
    assert.equal(sanitizeForTerminal(`a${ch(0x9d)}hidden${ch(0x9c)}b`), 'ab');
  });

  it('leaves right-to-left script intact (implicit bidi needs no controls)', () => {
    assert.equal(sanitizeForTerminal('مرحبا shalom שלום'), 'مرحبا shalom שלום');
  });

  it('preserves the zero-width joiner that emoji sequences need', () => {
    const family = `👨${ch(0x200d)}👩${ch(0x200d)}👧`;
    assert.equal(sanitizeForTerminal(family), family);
  });
});
