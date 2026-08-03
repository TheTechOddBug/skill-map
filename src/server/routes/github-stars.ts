/**
 * `GET /api/github-stars`, the skill-map repository's star count for the
 * topbar affordance and the Settings → About card
 * (`spec/cli-contract.md` §`GET /api/github-stars`).
 *
 * Why the SERVER reads it and not the browser: unauthenticated GitHub
 * API requests are capped at 60 per hour PER IP, a budget shared by
 * every tab, every project and every other tool on that machine. One
 * request per server per window is a rounding error against that; one
 * per tab reload is not. The count is also identical for everyone, so
 * there is nothing per-client about the read.
 *
 * Everything degrades to `count: null`, which the UI renders as NOTHING
 * (no zero, no error, no spinner). skill-map runs on localhost and is
 * expected to work with no network at all, so a star counter that
 * renders `0` or an error banner turns a healthy offline install into
 * one that looks broken. The four ways to get `null`:
 *
 *   - the operator turned `githubStars.enabled` off (no request is made);
 *   - the machine is offline / the request timed out;
 *   - GitHub rate-limited the IP (403 with the quota headers);
 *   - the payload did not carry a numeric `stargazers_count`.
 *
 * The cache is in memory, not persisted. The count carries no human
 * judgment, so the storage rule (`spec/architecture.md` §Storage rule)
 * puts it nowhere durable: losing it on restart costs exactly one HTTP
 * request. A negative result is cached too, and for longer, so an
 * offline machine or a rate-limited IP is not re-probed on every poll.
 */

import type { Hono } from 'hono';

import { PROJECT_REPO } from '../../kernel/project-repo.js';
import { isGithubStarsEnabled } from '../../cli/util/user-settings-store.js';

export interface IGithubStarsResponse {
  /** Star count, or `null` when unknown for ANY reason (renders nothing). */
  count: number | null;
  /** Epoch ms of the successful read behind `count`, `null` when unknown. */
  checkedAt: number | null;
}

/** How long a successful read is served from memory. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * How long a FAILED read is remembered. Shorter than the success TTL so
 * a machine that comes back online recovers within the hour, long enough
 * that a poll loop cannot turn an outage into a request storm.
 */
const FAILURE_TTL_MS = 30 * 60 * 1000;
/** A star count is not worth holding a socket open for. */
const REQUEST_TIMEOUT_MS = 4000;

interface ICacheEntry {
  count: number | null;
  checkedAt: number | null;
  /** Epoch ms after which the entry is re-probed. */
  staleAt: number;
}

let cache: ICacheEntry | null = null;
/** In-flight probe, so concurrent requests share one round-trip. */
let inFlight: Promise<ICacheEntry> | null = null;

/** Test seam: drop the memoised value so a spec starts from cold. */
export function resetGithubStarsCache(): void {
  cache = null;
  inFlight = null;
}

export function registerGithubStarsRoute(app: Hono): void {
  app.get('/api/github-stars', async (c) => {
    // Toggle off: answer the degraded shape WITHOUT touching the
    // network. The opt-out has to mean "no request", not "request but
    // hide the result".
    if (!isGithubStarsEnabled()) {
      return c.json({ count: null, checkedAt: null } satisfies IGithubStarsResponse);
    }
    const entry = await readStars();
    return c.json({
      count: entry.count,
      checkedAt: entry.checkedAt,
    } satisfies IGithubStarsResponse);
  });
}

/** Cached read, collapsing concurrent callers onto one probe. */
async function readStars(): Promise<ICacheEntry> {
  const now = Date.now();
  if (cache !== null && now < cache.staleAt) return cache;
  if (inFlight !== null) return inFlight;

  const probe = probeStars(now).then((entry) => {
    cache = entry;
    inFlight = null;
    return entry;
  });
  inFlight = probe;
  return probe;
}

async function probeStars(now: number): Promise<ICacheEntry> {
  const failure: ICacheEntry = {
    count: null,
    checkedAt: null,
    staleAt: now + FAILURE_TTL_MS,
  };
  try {
    const response = await fetch(
      `https://api.github.com/repos/${PROJECT_REPO.owner}/${PROJECT_REPO.name}`,
      {
        headers: {
          // Documented as the recommended media type; keeps the payload
          // on the stable v3 shape.
          Accept: 'application/vnd.github+json',
          'User-Agent': 'skill-map',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    // Covers rate limiting (403 / 429), a renamed repository (404) and
    // anything else: all of them are "unknown", none is worth a
    // distinct UI state.
    if (!response.ok) return failure;
    const body: unknown = await response.json();
    const count = (body as { stargazers_count?: unknown }).stargazers_count;
    if (typeof count !== 'number' || !Number.isFinite(count)) return failure;
    return { count, checkedAt: Date.now(), staleAt: Date.now() + CACHE_TTL_MS };
  } catch {
    // Offline, DNS failure, timeout, malformed JSON. Never throws out of
    // here: a non-essential decoration must not surface as a 500.
    return failure;
  }
}
