/**
 * URL-scheme guard for unsafe `[href]` sinks across the SPA.
 *
 * The kernel does not sanitise URL-typed values inside markdown bodies,
 * sidecar annotations, or plugin payloads, so the UI is the trust
 * boundary that decides which scheme to bind into a `<a href>`. Angular's
 * `DomSanitizer` already blocks `javascript:` in URL context, but
 * `data:`, `blob:`, `file:`, `vbscript:`, `about:`, and custom schemes
 * are NOT intercepted by Angular. A `data:text/html,...` href reached by
 * click would execute attacker-controlled HTML in this origin.
 *
 * `httpUrlOrNull` keeps the allowlist narrow on purpose: only the two
 * schemes the operator legitimately follows from notes or external-ref
 * extraction (`http:` and `https:`). Every other consumer that needs a
 * different policy (e.g. accepting `mailto:` for an `<a href="mailto:">`
 * affordance) opens its own narrow helper rather than relaxing this one.
 *
 * Pure function, no DOM touch; safe in SSR and tests.
 */

export function httpUrlOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}
