/**
 * DNS rebinding + cross-origin defence for the BFF.
 *
 * `sm serve` binds 127.0.0.1 (validated in `options.ts`). On its own
 * that prevents a remote LAN attacker from reaching the API, but it
 * does NOT defend against the operator's OWN browser being weaponised
 * by a malicious page via DNS rebinding (or a careless cross-origin
 * `fetch`) — the browser still resolves whatever hostname the attacker
 * controls to 127.0.0.1 and the server accepts the request.
 *
 * The gate enforces two invariants on every request, before any route
 * runs:
 *
 *   1. **Host header hostname**: must be a loopback name
 *      (`127.0.0.1`, `localhost`, `::1`). The hostname is what an
 *      attacker controls via DNS — port pinning adds no extra defence
 *      (an attacker can target any port we listen on), so we deliberately
 *      ignore the port half of `Host` to stay friendly to tests that
 *      bind ephemeral ports and to operators who run on a non-default
 *      port. Missing `Host` is tolerated (legacy HTTP/1.0).
 *   2. **Origin header hostname** (only on `/api/*` and `/ws`): must be
 *      absent, `null` (sandboxed / file:// / cross-document navigation),
 *      or a loopback hostname. Same port-agnostic posture; this also
 *      means `--dev-cors` does NOT need a special widening (a Vite UI
 *      on a different port is loopback regardless of mode). The flag
 *      remains useful for the CORS response headers but plays no role
 *      in the gate decision.
 *
 * Always-on. Cannot be disabled at runtime. The complete decline
 * envelope is `403 { error: 'host-not-allowed' | 'origin-not-allowed' }`
 * with no further detail so the gate is opaque to probes.
 */

import type { Context, Next } from 'hono';

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
  'localhost',
  '::1',
]);

/**
 * Construct the request-time middleware. The per-request hot path is
 * two `URL` parses + two `Set.has` calls.
 */
export function createLoopbackGate(_opts: ILoopbackGateOptions) {
  return async function loopbackGate(c: Context, next: Next): Promise<Response | void> {
    if (!hostAllowed(c.req.header('host'))) {
      return c.json({ error: 'host-not-allowed' }, 403);
    }
    if (originGuarded(c.req.path) && !originAllowed(c.req.header('origin'))) {
      return c.json({ error: 'origin-not-allowed' }, 403);
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
