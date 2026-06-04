/**
 * CSS-color guard for author-controlled `color`-typed values bound into
 * `[style.*]` / custom-property sinks across the SPA.
 *
 * `frontmatter.color` (the agent vendor field) is author-controlled and
 * the kernel does not neutralise it (the `schema-violation` analyzer
 * reports but does not strip), so the UI is the trust boundary before
 * the value reaches a CSS context. Angular `[style.prop]` bindings set
 * the value straight onto the CSSOM without the HTML/style sanitizer, so
 * an unvalidated value like `url(https://attacker/beacon)` bound into
 * `[style.background]` becomes an outbound tracking / exfiltration
 * request when the operator views the node (CWE-79 / CWE-1236, CSS-
 * context injection). Custom properties (`--node-color`) are even laxer:
 * the CSSOM stores any value verbatim and only validates at the use site.
 *
 * `cssColorOrNull` keeps the allowlist narrow: a hex literal or a bare
 * named colour (alphabetic only). Both forms are free of the characters
 * an injection needs (`(`, `)`, `;`, `:`, `/`, whitespace, quotes), so
 * `url(...)`, declaration breakouts, and comments are all rejected. An
 * off-spec value degrades to `null` (the kind-default palette wins), the
 * same graceful-fallback posture as `httpUrlOrNull`.
 *
 * Pure function, no DOM touch; safe in SSR and tests.
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_COLOR = /^[a-z]+$/i;

export function cssColorOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0) return null;
  if (HEX_COLOR.test(s) || NAMED_COLOR.test(s)) return s;
  return null;
}
