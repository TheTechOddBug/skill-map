/**
 * Coverage for `cli/util/browser-launch.validateBrowserUrl`, the URL
 * gate guarding the `sm serve` browser auto-open spawn.
 *
 * The validator's contract:
 *
 *   - accept the normal loopback URL pattern (`http://127.0.0.1:PORT/`,
 *     `http://localhost:PORT/`, `http://[::1]:PORT/`).
 *   - reject `cmd.exe` shell metacharacters (`"`, `&`, `|`, `^`, `<`,
 *     `>`, `%`), the forward-looking concern is that the Windows
 *     launcher (`cmd /c start "" <url>`) re-parses argv and would treat
 *     these as command separators or expansions.
 *   - reject control chars (C0 + DEL) to block CRLF injection, NUL
 *     truncation, and raw ESC-byte terminal smuggling.
 *   - reject empty / non-string inputs defensively.
 *
 * The test exercises the helper directly, no `child_process` mocking,
 * the separation between "decide if URL is safe" and "spawn the
 * launcher" is exactly what makes the gate auditable.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { validateBrowserUrl } from '../cli/util/browser-launch.js';

describe('validateBrowserUrl, accepts the loopback patterns used by `sm serve`', () => {
  it('accepts the IPv4 loopback URL emitted by serve', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/'), true);
  });

  it('accepts the localhost hostname variant', () => {
    assert.equal(validateBrowserUrl('http://localhost:4242/'), true);
  });

  it('accepts the IPv6 loopback URL (bracketed host)', () => {
    assert.equal(validateBrowserUrl('http://[::1]:4242/'), true);
  });

  it('accepts URLs with a trailing path segment', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/api/health'), true);
  });

  it('accepts URLs with safe punctuation (slashes, dots, colons, brackets, dashes)', () => {
    assert.equal(validateBrowserUrl('http://example.test:8080/path/to-page'), true);
  });
});

describe('validateBrowserUrl, rejects cmd.exe shell metacharacters', () => {
  it('rejects a double-quote (closes the quoted title slot)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/"x'), false);
  });

  it('rejects an ampersand (command chainer)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/&calc'), false);
  });

  it('rejects a pipe', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/|cmd'), false);
  });

  it('rejects a caret (cmd escape character)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/^evil'), false);
  });

  it('rejects redirection operators (`<`, `>`)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/<input'), false);
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/>output'), false);
  });

  it('rejects percent (environment-variable expansion)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/%USERPROFILE%'), false);
  });
});

describe('validateBrowserUrl, rejects control chars (CRLF / NUL / ESC injection)', () => {
  it('rejects CR (0x0D)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/\r'), false);
  });

  it('rejects LF (0x0A)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/\n'), false);
  });

  it('rejects NUL (0x00)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/\x00'), false);
  });

  it('rejects raw ESC (0x1B), the terminal-escape smuggling vector', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/\x1b[31m'), false);
  });

  it('rejects DEL (0x7F)', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/\x7f'), false);
  });

  it('rejects TAB (0x09), still a C0 control byte', () => {
    assert.equal(validateBrowserUrl('http://127.0.0.1:4242/\t'), false);
  });
});

describe('validateBrowserUrl, defensive rejections', () => {
  it('rejects the empty string', () => {
    assert.equal(validateBrowserUrl(''), false);
  });

  it('rejects non-string inputs (defensive, the type system already guards this)', () => {
    // Casting through unknown so the runtime guard is exercised even
    // though the static type does not allow these inputs.
    assert.equal(validateBrowserUrl(undefined as unknown as string), false);
    assert.equal(validateBrowserUrl(null as unknown as string), false);
    assert.equal(validateBrowserUrl(123 as unknown as string), false);
    assert.equal(validateBrowserUrl({} as unknown as string), false);
  });
});
