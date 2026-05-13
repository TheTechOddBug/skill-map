/**
 * Baseline security headers middleware (audit `app-hacker` L2).
 *
 * Stamps every response with a small set of defence-in-depth headers
 * before it leaves the BFF. Lives in its own factory (rather than inline
 * inside `createApp`) so tests can exercise the contract without
 * standing up the full app graph.
 *
 *   - `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
 *     blocks the SPA from being framed by any other local page
 *     (defence against local clickjacking from other processes,
 *     malicious file:// pages, or browser extensions), pins `<base>`
 *     to same-origin, and constrains form submissions to same-origin.
 *     `frame-ancestors` only takes effect via header (the spec ignores
 *     it from `<meta http-equiv>`), which is why the policy lives here
 *     and not in `index.html`.
 *   - `X-Frame-Options: DENY`, legacy clickjacking guard kept as
 *     belt-and-suspenders for browsers that don't honour
 *     `frame-ancestors`.
 *   - `X-Content-Type-Options: nosniff`, blocks MIME-sniff confusion
 *     on user-uploaded markdown / sidecar payloads echoed back through
 *     the API.
 *   - `Referrer-Policy: no-referrer`, the SPA navigates to external
 *     `source` / `docsUrl` annotations; we never want the local
 *     skill-map origin (with port + path) leaking to those targets.
 *
 * `script-src` / `style-src` are intentionally not set: PrimeNG ships
 * inline styles and the SPA bundle uses inline init scripts, locking
 * those down requires nonce wiring through the build pipeline (out of
 * scope for this audit).
 *
 * Each header is set only when missing so a later middleware or route
 * (e.g. a dev affordance) can override without an extra strip step.
 */

import type { Context, Next } from 'hono';

export const DEFAULT_CSP =
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function createSecurityHeaders(): (c: Context, next: Next) => Promise<void> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    if (!h.has('content-security-policy')) h.set('content-security-policy', DEFAULT_CSP);
    if (!h.has('x-frame-options')) h.set('x-frame-options', 'DENY');
    if (!h.has('x-content-type-options')) h.set('x-content-type-options', 'nosniff');
    if (!h.has('referrer-policy')) h.set('referrer-policy', 'no-referrer');
  };
}
