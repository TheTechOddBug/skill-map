/**
 * Built-in deterministic `github/enrichment` Action, Model A provenance
 * verification (`spec/schemas/enrichments/github.schema.json`).
 *
 * Verifies that a node's LOCAL body matches the canonical upstream
 * content its sidecar annotations declare (`source` +
 * `sourceVersion`, `spec/schemas/annotations.schema.json`):
 *
 *   - `sourceVersion` is a full 40-hex commit SHA → `method: 'raw-sha'`.
 *     The pin IS the SHA, so the content is fetched straight from the
 *     immutable raw URL (`raw.githubusercontent.com/<o>/<r>/<sha>/<p>`),
 *     no API call, `resolvedSha` stays null.
 *   - anything else (tag / branch) → `method: 'api-ref'`. The ref is
 *     resolved to a commit SHA via
 *     `GET https://api.github.com/repos/<o>/<r>/commits/<ref>`
 *     (Authorization only when the optional `token` secret setting is
 *     configured), recorded as `resolvedSha`, then the raw fetch runs
 *     at that SHA.
 *
 * **Hash semantics (load-bearing).** `localBodyHash` is the node's
 * `body_hash`, which the scan computes as sha256 of the body AFTER the
 * frontmatter fence (`kernel/orchestrator/walk.ts`:
 * `sha256(raw.body)`). The remote file is hashed THE SAME WAY: the
 * fetched text runs through the same frontmatter splitter the walker
 * uses (`frontmatterYamlParser`, the `--- yaml --- body` fence regex)
 * and the extracted body is sha256'd. A remote copy that differs ONLY
 * in frontmatter (e.g. the upstream carries different metadata) still
 * verifies `true`; only body drift flips the verdict.
 *
 * **Declared network IO.** The manifest declares `io: ['network']`: the
 * ONE sanctioned carve-out from extension purity
 * (`spec/architecture.md` §Extension purity). Every remote call routes
 * through the injected `ctx.fetch`, never a global, so the dispatcher
 * (`sm refresh`, the only execution surface, never `sm scan`, never a
 * queued job) enforces the committed `allowNetworkActions` project
 * policy (default off) and tests substitute a fake transport. A missing
 * `ctx.fetch` is a programmer error (a dispatcher that skipped the
 * injection) and throws; every REMOTE failure (network error, non-OK
 * status, rate limit) instead lands as a valid `verified: false` report
 * with a `detail`, so the state row records the failed verification
 * rather than crashing the refresh.
 *
 * **Enricher signal.** The sibling `report.schema.json` extends the
 * canonical `enrichments/github.schema.json` via `$ref`; that reference
 * is what marks this Action as an enricher
 * (`kernel/enrichments/enrichment-schema.ts`), the mirror of the
 * summarizer convention. No manifest flag.
 *
 * Ships `stability: 'experimental'` (disabled by default; the Settings
 * toggle / `sm plugins enable github/enrichment` opts in), same
 * mechanism as `core/node-bump`.
 */

import type {
  IAction,
  IActionContext,
  IActionResult,
  IBuiltInManifest,
} from '../../../../kernel/extensions/index.js';
import { sha256 } from '../../../../kernel/orchestrator/node-build.js';
import { tx } from '../../../../kernel/util/tx.js';
import { frontmatterYamlParser } from '../../../core/parsers/frontmatter-yaml/index.js';
import { GITHUB_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';
import { GITHUB_ENRICHMENT_TEXTS as T } from './enrichment.texts.js';

/**
 * Report shape mirroring the sibling `report.schema.json` (which
 * `allOf`-extends the canonical `enrichments/github.schema.json`).
 */
export interface IGithubEnrichmentReport {
  verified: boolean;
  sourceUrl: string;
  method: 'raw-sha' | 'api-ref';
  resolvedSha: string | null;
  localBodyHash: string;
  remoteBodyHash: string | null;
  detail?: string;
}

/** Parsed `(owner, repo, path)` triple out of a `source` annotation. */
interface IGithubSourceRef {
  owner: string;
  repo: string;
  path: string;
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/;

export const enrichmentAction: IBuiltInManifest<IAction> = {
  id: 'enrichment',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Verifies a node against its declared GitHub upstream: fetches the file pinned by the `source` / `sourceVersion` annotations and reports whether the local body still matches it. Runs via `sm refresh` and requires the `allowNetworkActions` project policy.',
  // Ships disabled (experimental): a network-reaching action must be a
  // double opt-in, the extension toggle AND the allowNetworkActions
  // project policy. Same ships-disabled mechanism as core/node-bump.
  stability: 'experimental',
  mode: 'deterministic',
  // The single sanctioned purity carve-out: invoke() reaches the network
  // through the injected ctx.fetch, gated by `allowNetworkActions`.
  io: ['network'],
  settings: {
    token: {
      type: 'secret',
      label: 'GitHub token',
      description:
        'Optional personal access token. Sent as the Authorization header on GitHub API ref-resolution calls, raising the unauthenticated rate limit and reaching private repositories.',
    },
  },

  // The runtime contract uses generic <TInput, TReport>; the enrichment
  // verification takes no input (the node's annotations drive it) and
  // narrows the report. The cast is the standard pattern for built-ins
  // that want typed local I/O while staying compatible with the open
  // generic (mirrors core/node-bump).
  invoke<TInput, TReport>(
    _input: TInput,
    ctx: IActionContext,
  ): Promise<IActionResult<TReport>> {
    return invokeEnrichment(ctx) as Promise<IActionResult<TReport>>;
  },
};

/**
 * The verification pipeline. Returns a report for EVERY remote or
 * annotation defect (`verified: false` + `detail`); throwing is
 * reserved for programmer errors (missing `ctx.fetch`).
 */
async function invokeEnrichment(
  ctx: IActionContext,
): Promise<IActionResult<IGithubEnrichmentReport>> {
  const fetchImpl = requireInjectedFetch(ctx);
  const localBodyHash = ctx.node.bodyHash;

  const prov = readProvenance(ctx.node);
  if (!prov.ok) {
    return failure(prov.method, prov.sourceUrl, localBodyHash, null, prov.detail);
  }

  const ref = parseGithubSource(prov.source);
  if (ref === null) {
    return failure(
      prov.method,
      prov.source,
      localBodyHash,
      null,
      tx(T.detailUnparseableSource, { source: prov.source }),
    );
  }

  const resolved = await resolveVerificationSha(fetchImpl, ref, prov.version, prov.method, ctx);
  if (!resolved.ok) {
    return failure(prov.method, resolved.attemptedUrl, localBodyHash, null, resolved.detail);
  }

  const rawUrl = rawContentUrl(ref, resolved.sha);
  const fetched = await fetchRawBody(fetchImpl, rawUrl);
  if (!fetched.ok) {
    return failure(prov.method, rawUrl, localBodyHash, resolved.resolvedSha, fetched.detail);
  }

  return buildVerdict(prov.method, rawUrl, localBodyHash, resolved.resolvedSha, fetched.text, ref.path);
}

/**
 * Guard the injected transport (programmer error when absent: the
 * manifest declares io:['network'], so the dispatcher MUST inject
 * ctx.fetch before invoking).
 */
function requireInjectedFetch(ctx: IActionContext): typeof globalThis.fetch {
  const fetchImpl = ctx.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'github/enrichment invoked without ctx.fetch; the dispatcher must inject it for io:[network] actions',
    );
  }
  return fetchImpl;
}

type TProvenance =
  | { ok: true; source: string; version: string; method: 'raw-sha' | 'api-ref' }
  | { ok: false; method: 'raw-sha' | 'api-ref'; sourceUrl: string; detail: string };

/**
 * Read the `source` / `sourceVersion` sidecar annotations off the node.
 * The missing-annotation branch is defensive: the `sm refresh`
 * dispatcher already no-op-skips nodes without both annotations, so it
 * only fires on a direct out-of-contract invocation.
 */
function readProvenance(node: IActionContext['node']): TProvenance {
  const annotations = (node.sidecar?.annotations ?? {}) as Record<string, unknown>;
  const source = typeof annotations['source'] === 'string' ? annotations['source'] : '';
  const version =
    typeof annotations['sourceVersion'] === 'string' ? annotations['sourceVersion'] : '';
  const method: 'raw-sha' | 'api-ref' = FULL_SHA_RE.test(version) ? 'raw-sha' : 'api-ref';
  if (source.length === 0 || version.length === 0) {
    return { ok: false, method, sourceUrl: source, detail: T.detailMissingAnnotations };
  }
  return { ok: true, source, version, method };
}

/**
 * The verdict: hash the remote content the SAME way the walker hashed
 * the local body, split off the frontmatter fence, sha256 the body
 * only. See the file header, a frontmatter-only difference must not
 * flip the verdict.
 */
function buildVerdict(
  method: 'raw-sha' | 'api-ref',
  sourceUrl: string,
  localBodyHash: string,
  resolvedSha: string | null,
  remoteText: string,
  remotePath: string,
): IActionResult<IGithubEnrichmentReport> {
  const remoteBody = frontmatterYamlParser.parse(remoteText, remotePath).body;
  const remoteBodyHash = sha256(remoteBody);
  const verified = remoteBodyHash === localBodyHash;
  const report: IGithubEnrichmentReport = {
    verified,
    sourceUrl,
    method,
    resolvedSha,
    localBodyHash,
    remoteBodyHash,
  };
  if (!verified) report.detail = T.detailBodyMismatch;
  return { report };
}

/** Compose a `verified: false` report (remote / annotation defect). */
function failure(
  method: 'raw-sha' | 'api-ref',
  sourceUrl: string,
  localBodyHash: string,
  resolvedSha: string | null,
  detail: string,
): IActionResult<IGithubEnrichmentReport> {
  return {
    report: {
      verified: false,
      sourceUrl,
      method,
      resolvedSha,
      localBodyHash,
      remoteBodyHash: null,
      detail,
    },
  };
}

type TShaResolution =
  | { ok: true; sha: string; resolvedSha: string | null }
  | { ok: false; attemptedUrl: string; detail: string };

/**
 * Decide which commit SHA anchors the raw fetch. A full-SHA pin is
 * immutable and needs no API round-trip (`resolvedSha` stays null, the
 * pin IS the SHA); a tag / branch resolves through the GitHub API,
 * with `Authorization: Bearer <token>` attached ONLY when the operator
 * configured the `token` secret setting.
 */
async function resolveVerificationSha(
  fetchImpl: typeof globalThis.fetch,
  ref: IGithubSourceRef,
  version: string,
  method: 'raw-sha' | 'api-ref',
  ctx: IActionContext,
): Promise<TShaResolution> {
  if (method === 'raw-sha') {
    return { ok: true, sha: version, resolvedSha: null };
  }

  const apiUrl = `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(version)}`;
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  const token = ctx.settings['token'];
  if (typeof token === 'string' && token.length > 0) {
    headers['authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(apiUrl, { headers });
  } catch (err) {
    return {
      ok: false,
      attemptedUrl: apiUrl,
      detail: tx(T.detailFetchError, { url: apiUrl, message: errorMessage(err) }),
    };
  }
  if (!response.ok) {
    const detail = isRateLimited(response)
      ? tx(T.detailRateLimited, { ref: version, status: response.status })
      : tx(T.detailRefResolveFailed, { ref: version, status: response.status });
    return { ok: false, attemptedUrl: apiUrl, detail };
  }

  const sha = await readCommitSha(response);
  if (sha === null) {
    return {
      ok: false,
      attemptedUrl: apiUrl,
      detail: tx(T.detailRefNoSha, { ref: version }),
    };
  }
  return { ok: true, sha, resolvedSha: sha };
}

/** Extract `.sha` from the commits API response, `null` on any defect. */
async function readCommitSha(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { sha?: unknown };
    return typeof body.sha === 'string' && body.sha.length > 0 ? body.sha : null;
  } catch {
    return null;
  }
}

type TRawFetch = { ok: true; text: string } | { ok: false; detail: string };

/** Fetch the raw file content at the anchored SHA. */
async function fetchRawBody(
  fetchImpl: typeof globalThis.fetch,
  rawUrl: string,
): Promise<TRawFetch> {
  let response: Response;
  try {
    response = await fetchImpl(rawUrl);
  } catch (err) {
    return {
      ok: false,
      detail: tx(T.detailFetchError, { url: rawUrl, message: errorMessage(err) }),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      detail: tx(T.detailRawFetchStatus, { status: response.status, url: rawUrl }),
    };
  }
  try {
    return { ok: true, text: await response.text() };
  } catch (err) {
    return {
      ok: false,
      detail: tx(T.detailFetchError, { url: rawUrl, message: errorMessage(err) }),
    };
  }
}

/** The immutable raw-content URL for `(owner, repo, sha, path)`. */
function rawContentUrl(ref: IGithubSourceRef, sha: string): string {
  return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${sha}/${ref.path}`;
}

/**
 * Rate-limit detection: GitHub answers `403` with
 * `x-ratelimit-remaining: 0` (classic) or a plain `429`.
 */
function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return (
    response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
  );
}

/**
 * Parse a `source` annotation into `(owner, repo, path)`. Accepted
 * forms (scheme optional, `www.` tolerated, query / fragment such as
 * `#L10` line anchors stripped):
 *
 *   - `github.com/<owner>/<repo>/blob/<ref>/<path>` (the browser URL;
 *     the embedded `<ref>` is DISCARDED, `sourceVersion` is the pin).
 *   - `github.com/<owner>/<repo>/<path>` (shorthand without `blob`).
 *   - `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` (the raw
 *     URL the annotations catalog cites as the canonical example; the
 *     embedded `<ref>` is likewise discarded).
 *
 * Anything else returns `null` and the caller reports
 * `verified: false` with an unparseable-source detail.
 */
export function parseGithubSource(source: string): IGithubSourceRef | null {
  const cleaned = source.split(/[?#]/, 1)[0] ?? '';
  const withoutScheme = cleaned.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const segments = withoutScheme.split('/').filter((s) => s.length > 0);
  const host = (segments.shift() ?? '').toLowerCase().replace(/^www\./, '');
  if (host === 'github.com') return parseGithubComSegments(segments);
  if (host === 'raw.githubusercontent.com') return parseRawHostSegments(segments);
  return null;
}

/** `<owner>/<repo>/[blob/<ref>/]<path…>` under the github.com host. */
function parseGithubComSegments(segments: string[]): IGithubSourceRef | null {
  const [owner, repo, ...rest] = segments;
  if (!owner || !repo || rest.length === 0) return null;
  let pathSegments = rest;
  if (rest[0] === 'blob') {
    // Drop `blob` + the embedded ref; the path is everything after.
    if (rest.length < 3) return null;
    pathSegments = rest.slice(2);
  }
  if (pathSegments.length === 0) return null;
  return { owner, repo, path: pathSegments.join('/') };
}

/** `<owner>/<repo>/<ref>/<path…>` under raw.githubusercontent.com. */
function parseRawHostSegments(segments: string[]): IGithubSourceRef | null {
  const [owner, repo, embeddedRef, ...rest] = segments;
  if (!owner || !repo || !embeddedRef || rest.length === 0) return null;
  return { owner, repo, path: rest.join('/') };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
