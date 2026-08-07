/**
 * Node-construction helpers: hash a body, canonicalise frontmatter /
 * sidecar annotations, resolve the sidecar overlay for a given relative
 * path, and produce a fresh `Node` (validating its frontmatter on the
 * way out). Also hosts `mergeNodeWithEnrichments` + `IPersistedEnrichment`
 * the read-time merge of author frontmatter with the A.8 enrichment
 * layer.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';

// js-tiktoken ships CJS subpaths without explicit `.cjs` in the import
// specifier, the lint rule's hard-coded extension matrix doesn't model
// dual-package CJS subpath exports.
// eslint-disable-next-line import-x/extensions
import { Tiktoken } from 'js-tiktoken/lite';
import { dump as yamlDump, CORE_SCHEMA } from 'js-yaml';

import type { IProvider, IRawNode } from '../extensions/index.js';
import type { IProviderFrontmatterValidator } from '../adapters/schema-validators.js';
import {
  computeDriftStatus,
  readSidecarFor,
} from '../sidecar/index.js';
import type { Issue, Node, TripleSplit } from '../types.js';
import { stripPrototypePollution } from '../util/strip-prototype-pollution.js';
import {
  detectEarlyCloseFrontmatter,
  detectMalformedFrontmatter,
  validateFrontmatter,
} from './frontmatter.js';
import { detectUnclosedBacktick } from './body-syntax.js';

export interface IBuildNodeArgs {
  path: string;
  kind: Node['kind'];
  providerId: string;
  frontmatterRaw: string;
  body: string;
  frontmatter: Record<string, unknown>;
  bodyHash: string;
  frontmatterHash: string;
  encoder: Tiktoken | null;
  /**
   * File mtime (Unix ms) from the walker's `lstat`. Accepts `undefined`
   * (not just absent) so the pass-through from `IRawNode.modifiedAtMs`
   * compiles under `exactOptionalPropertyTypes`; `buildNode` only
   * attaches it to the Node when it is a real number.
   */
  modifiedAtMs?: number | undefined;
}

export function buildNode(args: IBuildNodeArgs): Node {
  const bytesFrontmatter = Buffer.byteLength(args.frontmatterRaw, 'utf8');
  const bytesBody = Buffer.byteLength(args.body, 'utf8');
  // The Node surface no longer carries `title` / `description` /
  // `stability` / `version` denormalisations. Consumers that need
  // them read from the canonical sources directly:
  //   - title / description → `node.frontmatter.{name,description}`
  //   - stability / version → `node.sidecar.annotations.{stability,version}`
  // The persistence layer keeps these as denormalised SQL columns on
  // `scan_nodes` (used for `--sort-by`, faceted listings) and projects
  // them at write time from the same canonical sources.
  const node: Node = {
    path: args.path,
    kind: args.kind,
    provider: args.providerId,
    bodyHash: args.bodyHash,
    frontmatterHash: args.frontmatterHash,
    bytes: {
      frontmatter: bytesFrontmatter,
      body: bytesBody,
      total: bytesFrontmatter + bytesBody,
    },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: args.frontmatter,
  };
  // Guarded so `exactOptionalPropertyTypes` keeps the field absent (not
  // `undefined`) for sources that never supply an mtime.
  if (args.modifiedAtMs !== undefined) node.modifiedAtMs = args.modifiedAtMs;
  if (args.encoder) {
    node.tokens = countTokens(args.encoder, args.frontmatterRaw, args.body);
  }
  return node;
}

export function countTokens(encoder: Tiktoken, frontmatterRaw: string, body: string): TripleSplit {
  // Tokenize the raw frontmatter bytes (not the parsed object) so the
  // count stays reproducible from on-disk content.
  const frontmatter = frontmatterRaw.length > 0 ? encoder.encode(frontmatterRaw).length : 0;
  const bodyTokens = body.length > 0 ? encoder.encode(body).length : 0;
  return { frontmatter, body: bodyTokens, total: frontmatter + bodyTokens };
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Canonical-form rationale, canonical YAML form for frontmatter hashing.
 *
 * Goal: two `.md` files whose frontmatter parses to the same logical
 * value MUST produce the same `frontmatter_hash`, even if the raw bytes
 * differ in indentation, key order, quote style, or trailing whitespace.
 * Without this canonicalisation, a YAML formatter pass on the user's
 * editor (Prettier YAML, IDE autoformat, manual indent fix) silently
 * breaks the medium-confidence rename heuristic.
 *
 * Strategy:
 *   1. Take the parsed object the Provider already produced.
 *   2. Re-emit via `yaml.dump` with `sortKeys: true`, `lineWidth: -1`
 *      (no auto-wrap), `noRefs: true` (no `*alias` shorthand),
 *      `schema: CORE_SCHEMA` (js-yaml v5's modern YAML 1.2 output; the
 *      v4 `noCompatMode: true` equivalent, no 1.1-compat quoting).
 *   3. Hash the result.
 *
 * Fallback: when `parsed` is the empty object `{}` BUT `raw` is
 * non-empty, the Provider's parse failed silently. We fall back to
 * hashing the raw text, a malformed-YAML file should still hash
 * deterministically against itself across rescans, even if the
 * canonical form would be empty.
 */
export function canonicalFrontmatter(
  parsed: Record<string, unknown>,
  raw: string,
): string {
  const hasParsedKeys = Object.keys(parsed).length > 0;
  const hasRawText = raw.length > 0;
  if (!hasParsedKeys && hasRawText) {
    // Parse failed but raw text exists. Hash the raw, preserves
    // identity for malformed-YAML files across scans.
    return raw;
  }
  return yamlDump(parsed, {
    sortKeys: true,
    lineWidth: -1,
    noRefs: true,
    schema: CORE_SCHEMA,
  });
}

/**
 * Canonical-form rationale, same deterministic-across-formatters story
 * as `canonicalFrontmatter`, applied to the `node.sidecar.annotations`
 * block. Used to hash the sidecar contribution that participates in
 * the per-`(node, extractor)` cache key alongside `bodyHash`.
 *
 *   - Absent sidecar / present but no `annotations` block / annotations
 *     literally `{}` all canonicalise to `{}` so the hash is stable
 *     across "no sidecar" → "empty annotations" transitions and a
 *     plain sidecar-less node never accidentally invalidates the cache.
 *   - Object keys are sorted by `yamlDump({ sortKeys: true })` so a
 *     hand-edit that only re-orders keys produces the same hash.
 */
export function canonicalSidecarAnnotations(
  annotations: Record<string, unknown> | null | undefined,
): string {
  if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) {
    return yamlDump({}, { sortKeys: true, lineWidth: -1, noRefs: true, schema: CORE_SCHEMA });
  }
  return yamlDump(annotations, {
    sortKeys: true,
    lineWidth: -1,
    noRefs: true,
    schema: CORE_SCHEMA,
  });
}

/**
 * Canonical form of an extension's resolved settings bag, the third
 * contribution to the per-`(node, extractor)` cache key (alongside the
 * body hash and the sidecar-annotations hash). Same determinism story
 * as `canonicalSidecarAnnotations` above: absent / empty settings
 * canonicalise to `{}` (an extension without settings never
 * invalidates), and keys sort so an equivalent bag always hashes the
 * same. Settings are JSON scalars/arrays by contract
 * (`extensions/base.schema.json` §settings), so the YAML dump is
 * stable.
 */
export function canonicalResolvedSettings(
  settings: Record<string, unknown> | null | undefined,
): string {
  return canonicalSidecarAnnotations(settings);
}

/**
 * Pure overlay-resolution step (Step 9.6.2): tries each scan root in
 * order to find the absolute `.md` path the sidecar should accompany;
 * reads the `.sm`, validates it against the spec schemas, computes
 * drift, and produces an overlay value the caller then attaches to
 * the Node.
 *
 * Pulled apart from the original `resolveAndApplySidecar` so the
 * orchestrator can hash `overlay.annotations` BEFORE the cache
 * decision (the cache key includes the sidecar hash alongside body
 * and frontmatter). The previous "all-in-one" mutator survives as a
 * thin wrapper for call sites that don't need the hash early.
 *
 * Schema-invalid or YAML-malformed sidecars yield an `invalid-sidecar`
 * issue but do not crash the scan: the node still scans with `present`
 * = true and `status` = null. On parse success, `annotations` lands
 * on the overlay along with the full parsed root.
 */
interface ISidecarResolution {
  overlay: NonNullable<Node['sidecar']>;
  issues: Issue[];
  parsedRoot: Record<string, unknown> | null;
}

export function resolveSidecarOverlay(
  relativePath: string,
  nodePathForIssue: string,
  roots: readonly string[],
  liveBodyHash: string,
  liveFrontmatterHash: string,
): ISidecarResolution {
  const issues: Issue[] = [];
  const mdAbs = resolveAbsoluteMdPath(relativePath, roots);
  if (mdAbs === null) {
    return { overlay: { present: false }, issues, parsedRoot: null };
  }

  const result = readSidecarFor(mdAbs);
  if (!result.present) {
    return { overlay: { present: false }, issues, parsedRoot: null };
  }

  // A sidecar file exists. Even if parsing failed we mark `present`
  // true so `scan_nodes.sidecar_present = 1`; status stays null.
  if (result.parsed === null) {
    for (const parseIssue of result.issues) {
      issues.push({
        analyzerId: 'invalid-sidecar',
        severity: 'error',
        nodeIds: [nodePathForIssue],
        message: parseIssue.message,
        data: { sidecarPath: relativePathFromRoots(mdAbs, roots) },
      });
    }
    return {
      overlay: { present: true, status: null, annotations: null, root: null },
      issues,
      parsedRoot: null,
    };
  }

  const status = computeDriftStatus({
    storedBodyHash: result.parsed.identityBodyHash,
    storedFrontmatterHash: result.parsed.identityFrontmatterHash,
    liveBodyHash,
    liveFrontmatterHash,
  });
  return {
    // R15 closure (2026-05-07), surface the full parsed root on the
    // overlay so BFF consumers (UI inspector audit / plugin-contributions
    // / debug panels) can read `for.*`, `audit.*`, `settings.*`, and
    // plugin-namespaced sub-keys without re-reading the file. The
    // `annotations` field above stays, it duplicates `root.annotations`
    // by design so existing consumers keep working unchanged.
    overlay: {
      present: true,
      status,
      annotations: result.parsed.annotations,
      root: result.parsed.raw,
    },
    issues,
    parsedRoot: result.parsed.raw,
  };
}

// `applyAnnotationsOverlay` was previously responsible for projecting
// `annotations.{stability,version}` onto `node.{stability,version}`.
// Those fields no longer exist on the Node surface, consumers read
// from `node.sidecar.annotations.*` directly, and the persistence
// layer projects to indexed SQL columns at write time. The function
// is gone; the orchestrator's main loop attaches the overlay
// in-place via `attachSidecar`.

function resolveAbsoluteMdPath(
  relativePath: string,
  roots: readonly string[],
): string | null {
  if (isAbsolute(relativePath)) {
    return existsSync(relativePath) ? relativePath : null;
  }
  for (const root of roots) {
    const candidate = resolvePath(root, relativePath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function relativePathFromRoots(
  absolutePath: string,
  roots: readonly string[],
): string {
  for (const root of roots) {
    const abs = resolvePath(root);
    if (absolutePath.startsWith(`${abs}/`) || absolutePath.startsWith(`${abs}\\`)) {
      return absolutePath.slice(abs.length + 1).split(/[\\/]/).join('/');
    }
  }
  return absolutePath;
}

/**
 * Append `issue` to `list` when a detector actually produced one. The
 * frontmatter / body-syntax detectors (`detectFrontmatterIssue`,
 * `detectUnclosedBacktick`) all return `Issue | null`; routing them
 * through this helper keeps the nullable-push branch out of
 * `buildFreshNodeAndValidateFrontmatter`, so adding a new body-syntax
 * check never re-trips its cyclomatic-complexity budget.
 */
function pushIssue(list: Issue[], issue: Issue | null): void {
  if (issue) list.push(issue);
}

/**
 * Route the node's frontmatter into exactly ONE diagnostic lane:
 *
 *   1. A parse error already surfaced (parser `IParseIssue`): no further
 *      issue. A declared block that FAILED to parse is unknown, not
 *      incomplete; validating the `{}` fallback would report fields that
 *      ARE present in the source as "missing required property",
 *      pointing the author away from the real defect, and the
 *      malformed-fence heuristics are equally moot (a fence was found;
 *      its content is what broke).
 *   2. A declared block (parser flag, or non-empty raw as the fallback
 *      for custom-walk Providers that never set the flag): the
 *      early-close detector runs first (a stray `---` inside the block
 *      truncated it; its verdict names the cause and the leaked keys,
 *      where the AJV pass would misleadingly report fields present
 *      below the stray close as "missing"), then the per-kind AJV
 *      validation. The flag beats the length check so a declared but
 *      EMPTY block (`---`, blank line, `---`) validates exactly like a
 *      whitespace-only one instead of being conflated with "no
 *      frontmatter at all".
 *   3. No block, but one of the malformed-fence heuristics fires
 *      (indent / BOM / leading blank line / missing close): that verdict
 *      wins, it names the exact authoring accident rather than its
 *      downstream symptom.
 *   4. No block at all: the per-kind AJV pass still runs, against the
 *      empty frontmatter. A kind whose schema REQUIRES fields (claude /
 *      codex agents, the open-standard skill) flags the absent block as
 *      `frontmatter-invalid`, closing the asymmetry where a PARTIAL
 *      block warned about a missing `description` but a fully absent
 *      one said nothing. Every all-optional kind (plain markdown,
 *      claude command / skill) validates `{}` clean and stays silent.
 *      This also covers a fence pushed off byte 0 by preceding prose:
 *      the parser sees no fence, so the required fields surface instead
 *      of the metadata silently parsing as body.
 */
function detectFrontmatterIssue(opts: {
  raw: IRawNode;
  kind: string;
  provider: IProvider;
  providerFrontmatter: IProviderFrontmatterValidator;
  strict: boolean;
}): Issue | null {
  const parseFailed = (opts.raw.parseIssues ?? []).some(
    (pi) => pi.code === 'frontmatter-parse-error',
  );
  if (parseFailed) return null;
  const shape = detectFrontmatterShapeIssue(opts);
  if (shape) return shape;
  return validateFrontmatter(
    opts.providerFrontmatter,
    opts.provider,
    opts.kind,
    opts.raw.frontmatter,
    opts.raw.path,
    opts.strict,
  );
}

/**
 * The fence-shape half of `detectFrontmatterIssue`'s routing: the
 * malformed-fence heuristics when no block was declared, the
 * early-close detector when one was. `null` hands the verdict to the
 * per-kind AJV pass. Split for the lint complexity cap.
 */
function detectFrontmatterShapeIssue(opts: {
  raw: IRawNode;
  kind: string;
  provider: IProvider;
  strict: boolean;
}): Issue | null {
  if (opts.raw.frontmatterDeclared !== true && opts.raw.frontmatterRaw.length === 0) {
    return detectMalformedFrontmatter(opts.raw.body, opts.raw.path, opts.strict);
  }
  return detectEarlyCloseFrontmatter(
    opts.raw.body,
    opts.raw.path,
    opts.provider.kinds?.[opts.kind]?.schemaJson,
    opts.strict,
  );
}

/**
 * Build a brand-new `Node` row from raw provider output and validate
 * its frontmatter. Used by the "no cache hit" branch of
 * `walkAndExtract`. The frontmatter diagnostic lanes live in
 * `detectFrontmatterIssue` (parse-error short-circuit, per-kind AJV for
 * declared AND absent blocks, malformed-fence heuristics).
 *
 * Severity defaults to `warn`; `strict` promotes everything to `error`.
 */
export function buildFreshNodeAndValidateFrontmatter(opts: {
  raw: IRawNode;
  kind: string;
  provider: IProvider;
  bodyHash: string;
  frontmatterHash: string;
  encoder: Tiktoken | null;
  providerFrontmatter: IProviderFrontmatterValidator;
  strict: boolean;
}): { node: Node; frontmatterIssues: Issue[] } {
  const node = buildNode({
    path: opts.raw.path,
    kind: opts.kind,
    providerId: opts.provider.id,
    frontmatterRaw: opts.raw.frontmatterRaw,
    body: opts.raw.body,
    frontmatter: opts.raw.frontmatter,
    bodyHash: opts.bodyHash,
    frontmatterHash: opts.frontmatterHash,
    encoder: opts.encoder,
    // Thread the walker's mtime through; `buildNode` only attaches it
    // when present, so virtual / walk()-without-stat sources stay absent.
    modifiedAtMs: opts.raw.modifiedAtMs,
  });

  const frontmatterIssues: Issue[] = [];
  // Audit L1: parser-emitted diagnostics (e.g. malformed YAML) surface
  // here as warn-level kernel issues. Strict mode lifts them to error
  // alongside the existing schema-validation / malformed-fence paths.
  for (const pi of opts.raw.parseIssues ?? []) {
    frontmatterIssues.push({
      analyzerId: pi.code,
      severity: opts.strict ? 'error' : 'warn',
      nodeIds: [opts.raw.path],
      message: pi.message,
    });
  }
  pushIssue(frontmatterIssues, detectFrontmatterIssue(opts));

  // Body-syntax: an unclosed backtick (fenced block / inline span)
  // corrupts the code-strip policy. Kernel-stamped here (body is live)
  // and cached across incremental scans alongside the frontmatter ids,
  // so the warning survives a clean re-scan without re-reading the file.
  pushIssue(
    frontmatterIssues,
    detectUnclosedBacktick(opts.raw.body, opts.raw.path, opts.strict),
  );

  return { node, frontmatterIssues };
}

/**
 * Spec § A.8, produce the merged read-time view of a Node.
 *
 * Rules / `sm check` / `sm export` consume `node.frontmatter` directly
 * (deterministic CI-safe baseline, author intent, byte-stable). UI / future
 * rules that opt into enrichment context call this helper to merge the
 * author frontmatter with the live enrichment layer.
 *
 * Algorithm:
 *
 *   1. Filter `enrichments` down to rows targeting this node AND not
 *      flagged `stale`. With Extractors deterministic-only no row is
 *      stale-flagged in this revision; the filter is preserved for the
 *      future Action-issued enrichment revision (queued LLM jobs whose
 *      output must survive body changes), where stale visibility
 *      belongs to the UI layer next to the value.
 *   2. Sort the survivors by `enrichedAt` ASC so iteration order is
 *      "oldest first". This makes the spread merge below
 *      last-write-wins per field, the freshest Extractor's value
 *      stomps the older one for any conflicting key.
 *   3. Spread-merge each row's `value` over `node.frontmatter`. The
 *      author's keys are the base; enrichment keys overlay them.
 *
 * The returned object is a fresh shallow copy, mutating it does not
 * touch the caller's node. The original `node.frontmatter` reference
 * remains accessible via `node.frontmatter` for callers that want the
 * pristine author baseline.
 *
 * @param node          Node to merge against; `node.frontmatter` is the base.
 * @param enrichments   Per-(node, extractor) enrichment records, typically
 *                      loaded via `loadNodeEnrichments(db, node.path)` or
 *                      pre-filtered to this node by the caller.
 * @param opts.includeStale  When true, include rows flagged stale. Defaults
 *                            to false (the safe, CI-deterministic default).
 *                            UIs that want to display "stale (last value: …)"
 *                            pass `true` and consult `enrichment.stale`
 *                            on the source rows.
 */
export function mergeNodeWithEnrichments(
  node: Node,
  enrichments: IPersistedEnrichment[],
  opts: { includeStale?: boolean } = {},
): Record<string, unknown> {
  const includeStale = opts.includeStale === true;
  const applicable = enrichments
    .filter((e) => e.nodePath === node.path)
    .filter((e) => includeStale || !e.stale)
    .sort((a, b) => a.enrichedAt - b.enrichedAt);
  // `assignSafe` strips `__proto__` / `constructor` / `prototype` from
  // every source before copying, so a hostile enrichment value
  // (plugin-authored, persisted as JSON) cannot replace the merged
  // object's prototype via the `__proto__` setter. Prototype stays
  // normal so consumers can `deepStrictEqual` the result against
  // JSON-parse-shaped baselines.
  const base: Record<string, unknown> = {};
  assignSafe(base, node.frontmatter ?? {});
  for (const row of applicable) {
    assignSafe(base, row.value as Record<string, unknown>);
  }
  return base;
}

/**
 * Copy every own enumerable property of `source` onto `target`, with a
 * deep prototype-pollution strip (audit M2). The shallow filter we used
 * to host inline would skip a root-level `__proto__` key, but
 * `meta: { __proto__: { polluted: true } }` survived because the nested
 * `__proto__` still landed on `target.meta`. Routing `source` through
 * `stripPrototypePollution` first removes the forbidden names at every
 * depth and returns a fresh own-property-clean object, so the subsequent
 * own-key copy is safe.
 *
 * The deep clone runs once per source per merge, the cost is O(size of
 * source) but bounded by the AJV-validated frontmatter / enrichment row
 * shapes, which the spec already caps below the K-key range.
 */
function assignSafe(target: Record<string, unknown>, source: Record<string, unknown>): void {
  const safe = stripPrototypePollution(source);
  for (const [k, v] of Object.entries(safe)) {
    target[k] = v;
  }
}

/**
 * A persisted enrichment row, post-load. Mirrors the DB row shape
 * but with `value` already deserialised from JSON and `stale` /
 * `isProbabilistic` already decoded from `0 | 1`. Surfaced via
 * `loadNodeEnrichments` (driven adapter) and consumed by
 * `mergeNodeWithEnrichments` and the `sm enrich` command.
 */
export interface IPersistedEnrichment {
  nodePath: string;
  extractorId: string;
  bodyHashAtEnrichment: string;
  value: Partial<Node>;
  stale: boolean;
  enrichedAt: number;
  isProbabilistic: boolean;
}
