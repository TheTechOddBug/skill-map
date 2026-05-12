/**
 * DNS rebinding + cross-origin defence for the BFF.
 *
 * `sm serve` binds 127.0.0.1 (validated in `options.ts`). On its own
 * that prevents a remote LAN attacker from reaching the API, but it
 * does NOT defend against the operator's OWN browser being weaponised
 * by a malicious page via DNS rebinding (or a careless cross-origin
 * `fetch`), the browser still resolves whatever hostname the attacker
 * controls to 127.0.0.1 and the server accepts the request.
 *
 * The gate enforces two invariants on every request, before any route
 * runs:
 *
 *   1. **Host header hostname**: must be a loopback IP literal
 *      (`127.0.0.1`, `::1`) OR the literal `'localhost'`. The hostname
 *      is what an attacker controls via DNS (port pinning adds no
 *      extra defence: an attacker can target any port we listen on),
 *      so we deliberately ignore the port half of `Host` to stay
 *      friendly to tests that bind ephemeral ports and to operators
 *      who run on a non-default port. Missing `Host` is tolerated
 *      (legacy HTTP/1.0).
 *
 *      `'localhost'` IS in the allow-list. Dropping it (audit L5) was
 *      attempted and reverted: the Angular dev server on port 4200
 *      proxies `/api/*` to the BFF preserving `Host: localhost:4200`,
 *      so the strict drop broke the dev workflow. The residual risk
 *      (a poisoned `/etc/hosts` mapping `localhost` to a non-loopback
 *      IP) is narrow: it also requires the operator to have bound the
 *      BFF off-loopback (`--host 0.0.0.0`) which `options.ts` rejects
 *      in combination with `--dev-cors`. The standing assumption is
 *      "localhost resolves to loopback on every operator's machine".
 *   2. **Origin header hostname** (only on `/api/*` and `/ws`): must be
 *      absent, `null` (sandboxed / file:// / cross-document navigation),
 *      or a loopback hostname. Same port-agnostic posture; this also
 *      means `--dev-cors` does NOT need a special widening (a Vite UI
 *      on a different port is loopback regardless of mode). The flag
 *      remains useful for the CORS response headers but plays no role
 *      in the gate decision.
 *
 * Always-on. Cannot be disabled at runtime. Violations throw
 * `LoopbackGateError`, which `formatError` shapes into the canonical
 * envelope `403 { ok: false, error: { code: 'host-not-allowed' |
 * 'origin-not-allowed', message, details: null } }`. `details` stays
 * `null` so the gate is opaque to probes (no per-request state leaks).
 */

import type { Context, Next } from 'hono';

import { LoopbackGateError } from './app.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';

export interface ILoopbackGateOptions {
  /**
   * Reserved for future use (e.g. surfacing the bound port in error
   * envelopes for debugging). The gate currently ignores port entirely;
   * see header comment for the rationale.
   */
  port: number;
}

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  '127.0.0.1',
  '::1',
  'localhost',
]);

/**
 * Construct the request-time middleware. The per-request hot path is
 * two `URL` parses + two `Set.has` calls.
 */
export function createLoopbackGate(_opts: ILoopbackGateOptions) {
  return async function loopbackGate(c: Context, next: Next): Promise<void> {
    if (!hostAllowed(c.req.header('host'))) {
      throw new LoopbackGateError({
        code: 'host-not-allowed',
        message: SERVER_TEXTS.hostNotAllowed,
      });
    }
    if (originGuarded(c.req.path) && !originAllowed(c.req.header('origin'))) {
      throw new LoopbackGateError({
        code: 'origin-not-allowed',
        message: SERVER_TEXTS.originNotAllowed,
      });
    }
    await next();
  };
}

function hostAllowed(host: string | undefined): boolean {
  if (host === undefined || host === '') return true;
  return LOOPBACK_HOSTNAMES.has(hostnameOf(host));
}

function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined || origin === '') return true;
  if (origin.toLowerCase() === 'null') return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Extract the hostname portion from a `Host` header. Handles plain
 * hostnames (`localhost`), hostnames with ports (`localhost:4242`),
 * and bracketed IPv6 (`[::1]:4242` → `::1`).
 */
function hostnameOf(host: string): string {
  const lower = host.toLowerCase();
  if (lower.startsWith('[')) {
    const close = lower.indexOf(']');
    if (close < 0) return lower;
    return lower.slice(1, close);
  }
  const colon = lower.indexOf(':');
  return colon < 0 ? lower : lower.slice(0, colon);
}

function originGuarded(path: string): boolean {
  if (path === '/ws') return true;
  if (path.startsWith('/api/')) return true;
  return false;
}
