/**
 * Helpers for the best-effort browser auto-open invoked from `sm serve`.
 *
 * The Windows launcher path is the load-bearing one: `cmd.exe /c start ""
 * <url>` re-parses its argv before invoking the URL handler. If the URL
 * ever carries an unquoted ampersand, pipe, caret, redirection, or
 * percent-expansion, cmd re-interprets the trailing characters as shell
 * metacharacters. Today the URL is always `http://<loopback>:<port>/`
 * (validated upstream by the BFF host check), so the risk is forward-
 * looking, defensive validation here prevents a future contributor from
 * piping a richer URL into the spawn without re-auditing the launcher.
 *
 * The validator is pure (string in, boolean out) so it's testable without
 * mocking `child_process`; the spawn call itself stays in `serve.ts`.
 *
 * Forbidden character set (cmd shell metacharacters + control chars):
 *
 *   - `"`  ends the quoted title slot, opens command-injection avenue.
 *   - `&`  command chainer (`start url & calc`).
 *   - `|`  pipe.
 *   - `^`  cmd escape character.
 *   - `<`, `>`  redirection.
 *   - `%`  environment-variable expansion (`%USERPROFILE%`).
 *   - control chars (0x00-0x1F, 0x7F)  CRLF injection, NUL truncation,
 *     terminal escape smuggling.
 *
 * Anything else passes; the verb still falls back to `open` / `xdg-open`
 * on non-Windows, which do not re-parse argv this way, but a single
 * validator keeps every platform on the same safe surface.
 */

/**
 * Returns `true` iff `url` is safe to hand to the platform browser
 * launcher (in particular the Windows `cmd /c start` path). Pure
 * function: no I/O, no process inspection.
 *
 * The check is intentionally conservative; the only legitimate input
 * today is a loopback HTTP URL, so rejecting any cmd / control-char
 * metacharacter is cheaper than enumerating safe variants.
 */
export function validateBrowserUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  // Forbidden shell metacharacters for `cmd.exe`. Also covers other
  // launchers (`open`, `xdg-open`) which generally do not re-parse,
  // but a unified surface beats per-platform special cases.
  const FORBIDDEN_META = /["&|^<>%]/;
  if (FORBIDDEN_META.test(url)) return false;
  // Control chars (C0 + DEL). Catches CR/LF injection, NUL truncation,
  // and terminal escape smuggling via raw ESC bytes.
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}
