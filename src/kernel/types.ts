/**
 * Domain types, byte-aligned with `spec/schemas/{node,link,issue,scan-result}.schema.json`.
 *
 * The kernel is the reference consumer of the spec; these types are therefore
 * derived from the schemas, not invented. When a schema changes, this file
 * follows. Until automatic AJV-driven derivation lands, the mapping is
 * hand-maintained and the release gate is the conformance suite.
 *
 * --- Naming convention (kernel-wide) -------------------------------------
 *
 * Five categories with distinct prefix rules; the rules are deliberate
 * even though they look mixed at first read:
 *
 *   1. **Domain types**, every shape that mirrors a `spec/schemas/*.json`
 *      file: `Node`, `Link`, `Issue`, `ScanResult`, `ScanStats`,
 *      `ExecutionRecord`, `HistoryStats`, …. **No prefix.** Names track
 *      the spec verbatim because the spec is the source of truth.
 *      Renaming any of these is a spec change.
 *
 *   2. **Hexagonal ports**, the abstract boundaries the kernel calls
 *      out to (`StoragePort`, `RunnerPort`, `ProgressEmitterPort`,
 *      `FilesystemPort`, `PluginLoaderPort`). **`Port` suffix.** The
 *      suffix calls out the architectural role and avoids name clashes
 *      with the concrete adapter classes (`SqliteStorageAdapter`
 *      implements `StoragePort`).
 *
 *   3. **Runtime extension contracts**, what a plugin author
 *      implements: `IProvider`, `IExtractor`, `IAnalyzer`, `IFormatter`,
 *      `IExtensionBase`. **`I` prefix.** The prefix flags "this is a
 *      contract you supply, not a value the kernel hands you", same
 *      reading as the rest of TypeScript's plugin ecosystems where a
 *      shape is implementable.
 *
 *   4. **Internal interfaces**, option bags, result records, config
 *      slices, anything declared as `interface` and passed across
 *      function boundaries inside the kernel / CLI but not part of the
 *      spec: `IPluginRuntimeBundle`, `IPruneResult`, `IMigrationFile`,
 *      `IDbLocationOptions`. **`I` prefix.** The prefix matches
 *      category 3 because both are "shapes that live in TypeScript
 *      only, never in JSON".
 *
 *   5. **Internal type aliases**, anything declared as `type` (string-
 *      literal unions, function types, mapped/derived types) that lives
 *      only in TS: `TLogLevel`, `TLogMethodLevel`, `TProgressListener`,
 *      `TLogFormatter`, `TActionWrite`, `TExecutionMode`, `TGranularity`,
 *      `THookFilter`, `THookTrigger`, `TNodeChangeReason`,
 *      `TPluginLoadStatus`, `TPluginStorage`, `TWatchEventKind`. **`T`
 *      prefix.** Use this bucket when `interface` is the wrong shape
 *      (a union, a callback signature, an `Exclude<…>` derivation).
 *
 * Edge cases worth knowing:
 *   - The following category-4 names lack the `I` prefix because
 *     they are part of the public kernel surface and renaming is a
 *     breaking change for downstream consumers. The list is closed:
 *       option bags / records: `RunScanOptions`, `RenameOp`;
 *       TS-only exports from `kernel/index.ts` / `kernel/ports/*`:
 *         `Kernel`, `ProgressEvent`, `LogRecord`, `NodeStat`.
 *     New public option bags MUST still use `I*`; new public type
 *     aliases MUST still use `T*`. Removing a name from this list is a
 *     breaking change.
 *   - `IDatabase` (SQLite schema) is category 4 but lives in
 *     `adapters/sqlite/schema.ts`, not here. Same rule applies.
 *
 * If you find yourself wanting to add a new type and aren't sure which
 * bucket it falls in: ask "does this shape exist in the spec?". If
 * yes, no prefix and align the name with the schema. If no, `I` prefix
 * for `interface`, `T` prefix for `type` aliases.
 */

/**
 * The four node kinds the **built-in Claude Provider** declares, `skill`,
 * `agent`, `command`, `note`. **NOT** the kernel-wide kind type.
 *
 * `Node.kind` is `string`. An external Provider (Cursor, Obsidian, …)
 * MAY classify into its own kinds (e.g. `'cursorRule'`, `'daily'`); the
 * orchestrator, persistence layer, and AJV `node.schema.json` accept any
 * non-empty string. Per `spec/db-schema.md` § scan_nodes and
 * `node.schema.json#/properties/kind`, the contract is open-by-design
 * (matches `IProvider.kinds` "open by design" docstring).
 *
 * Step 9.5 dropped `hook` from the catalog: `.claude/hooks/*.md` is NOT
 * an Anthropic-defined node type, hooks live in `settings.json` or as
 * sub-objects of agent / skill frontmatter (see
 * https://code.claude.com/docs/en/hooks.md). Files at the old path
 * classify as `markdown` via the Provider's fallback. The fallback is
 * named after the *format* because the file is generic markdown with
 * no specific role; format-named kinds apply only as the generic
 * fallback, a file that matches a specific role (agent / command /
 * skill) classifies under that role, not under `markdown`.
 *
 * This alias survives because:
 *   - claude-specific code legitimately wants to switch on the four
 *     hard-coded values (filter widgets, kind-aware UI cards, the
 *     `schema-violation` built-in rule that maps each kind to its
 *     frontmatter schema);
 *   - sorting helpers want a stable `KIND_ORDER` for the canonical
 *     catalog;
 *   - tests expect to enumerate the four kinds when seeding fixtures.
 *
 * For "any kind a Provider could declare", use plain `string`. Only use
 * `NodeKind` when the code is intentionally claude-catalog-specific.
 */
export type NodeKind = 'skill' | 'agent' | 'command' | 'markdown';

export type LinkKind = 'invokes' | 'references' | 'mentions' | 'supersedes';

/**
 * Extractor's self-assessed confidence, normalized to `[0..1]`. Drives
 * UI edge opacity in the graph view (more confident = more opaque edge).
 * Migrated from the legacy `'high' | 'medium' | 'low'` string union to
 * a numeric range so callers can express finer granularity than three
 * buckets. The named tiers below (`ConfidenceTier`) preserve the
 * legacy buckets as constants for callers that prefer bucket-thinking.
 *
 * Reference scoring (guideline, not contract):
 *
 *   `1.0`  structured input (sidecar `supersedes`)
 *   `0.95` unambiguous syntax (`[text](file.md)`, `https://…`)
 *   `0.85` strong signal with one inference (`@file.md`)
 *   `0.5`  genuine ambiguity (`@bare-handle`)
 *
 * Validation: the orchestrator's `validateLink` rejects values outside
 * `[0..1]` with an `extension.error` event, mirroring the LinkKind
 * enum check. Missing confidence defaults to `ConfidenceTier.MEDIUM`.
 */
export type Confidence = number;

/**
 * Named buckets for the numeric Confidence range. Use these instead of
 * raw literals when the extractor genuinely thinks in tiers (e.g. the
 * rename heuristic: body-hash match = HIGH, frontmatter-hash match =
 * MEDIUM). For finer granularity, use raw numbers (e.g. `0.85` for an
 * `@file.md` that has an extension but no path prefix).
 */
export const ConfidenceTier = Object.freeze({
  HIGH: 0.9,
  MEDIUM: 0.6,
  LOW: 0.3,
}) as { readonly HIGH: 0.9; readonly MEDIUM: 0.6; readonly LOW: 0.3 };

export type Severity = 'error' | 'warn' | 'info';

export type Stability = 'experimental' | 'stable' | 'deprecated';

/**
 * Execution mode of an analytical extension. Mirrors the per-kind capability
 * matrix in `spec/architecture.md` §Execution modes:
 *
 *   - `deterministic`, pure code, runs synchronously inside `sm scan` /
 *     `sm check`. Same input → same output, every run.
 *   - `probabilistic`, calls an LLM through `RunnerPort`, dispatches only
 *     as a queued job (`sm job submit <kind>:<id>`); never participates in
 *     scan-time pipelines.
 *
 * Extractor / Rule / Action declare it directly (default `deterministic` when
 * omitted in the manifest). Provider / Formatter are deterministic-only and
 * MUST NOT carry the field.
 */
export type TExecutionMode = 'deterministic' | 'probabilistic';

export interface TripleSplit {
  frontmatter: number;
  body: number;
  total: number;
}

export interface LinkTrigger {
  originalTrigger: string;
  normalizedTrigger: string;
}

export interface LinkLocation {
  line: number;
  column?: number;
  offset?: number;
}

/**
 * One syntactic site in the source node's body that contributed to a
 * `Link`. Multiple occurrences accumulate when the same edge is detected
 * by more than one extractor (e.g. `@./foo.md` from `at-directive` and
 * `[label](./foo.md)` from `markdown-link` both resolve to the same
 * target), or when the same extractor walks an extractor-internal
 * dedup boundary. Today the merged edge's `trigger` / `location`
 * mirror the FIRST occurrence; the array carries every site so the
 * `core/reference-redundant` analyzer can flag multi-form
 * references and rename operations can find every author surface.
 */
export interface LinkOccurrence {
  /**
   * Extractor id that observed this occurrence. Matches an entry of
   * the parent `Link.sources[]` (extractor + occurrence are not 1:1,
   * the same extractor can produce multiple occurrences when the
   * intra-extractor dedup is relaxed in the future).
   */
  extractor: string;
  /**
   * Original substring as it appeared in the body (`@./real-agent.md`,
   * `[deploy](./deploy.md)`, `/help`, `@team-lead`). Preserves author
   * casing and the leading sigil so the analyzer can surface it
   * verbatim in fix-up messages.
   */
  originalTrigger: string;
  /**
   * Position of the occurrence in the body. Optional, an extractor
   * that does not track line numbers yet (legacy emit paths) omits
   * this field; the analyzer falls back to "unknown line" in messages.
   */
  location?: LinkLocation | null;
}

/**
 * External URL referenced from a node's body. Populated by the
 * `core/external-url-counter` extractor and surfaced on the node so
 * the inspector can list every outgoing http(s) reference without
 * re-walking the body. Distinct from internal `Link` (which connects
 * nodes inside the graph), external refs are leaf metadata: no
 * counterparty node, no resolution.
 */
export interface IExternalRef {
  /** Normalised URL (lowercased host, fragment stripped). */
  url: string;
  /** 1-indexed line of the occurrence in the source body, when known. */
  line?: number;
  /** Verbatim author substring (sigil-free; usually equals `url`). */
  originalTrigger?: string;
}

export interface Node {
  path: string;
  /**
   * Provider-declared category. Open string (matches
   * `node.schema.json#/properties/kind`): the built-in Claude Provider
   * emits one of `NodeKind`'s values, but external Providers MAY emit
   * their own. Code that intentionally switches on the claude catalog
   * narrows via `if (kind === 'skill' \| ... )`; everything else
   * accepts the open string and treats unknown values as opaque labels.
   */
  kind: string;
  provider: string;
  bodyHash: string;
  frontmatterHash: string;
  bytes: TripleSplit;
  linksOutCount: number;
  linksInCount: number;
  externalRefsCount: number;
  /**
   * Distinct external URLs referenced from this node's body, in
   * extractor-order (first-seen wins, dedup is by normalised URL).
   * Empty / absent when the body has no http(s) URLs. The denormalised
   * `externalRefsCount` MUST equal `externalRefs.length` whenever
   * both are present. Surfaced via `/api/nodes` so the inspector can
   * list each URL without an extra round-trip.
   */
  externalRefs?: IExternalRef[];
  frontmatter?: Record<string, unknown>;
  tokens?: TripleSplit;
  /**
   * Step 9.6.2, sidecar denormalisation surface. Populated by the
   * orchestrator at scan time; absent when the orchestrator did not
   * inspect sidecars (legacy code paths) or when no sidecar accompanies
   * the node. Read by `annotation-stale` rule and the persistence layer.
   */
  sidecar?: ISidecarOverlay | null;
  /**
   * Per-user "favorite" flag, decorated by the BFF on `/api/nodes` and
   * `/api/nodes/:pathB64` responses via in-memory `Set` lookup against
   * `state_node_favorites`. Absent on emissions that don't carry per-user
   * state (e.g. `sm export --json`); consumers that don't recognise the
   * field MUST treat the absence as "unknown" rather than "false", a
   * truthy `isFavorite` only ever lands when the BFF set it.
   */
  isFavorite?: boolean;
  /**
   * When `true`, the node is synthetic / derived: it does not correspond
   * to a single file on disk. Reconstructed on every scan from the
   * file(s) listed in `derivedFrom`. Synthetic nodes use a non-filesystem
   * path scheme (e.g. `mcp://github`) so the identifier is stable and
   * visibly non-physical. See
   * [`node.schema.json`](../../spec/schemas/node.schema.json) for the
   * normative contract. Absent / `false` for ordinary filesystem-backed
   * entities. Stability: experimental.
   */
  virtual?: boolean;
  /**
   * Paths of the source files this node was derived from. Required (and
   * only meaningful) when `virtual === true`. Drives invalidation: any
   * change to a listed source between scans propagates into the virtual
   * node's hashes. Empty / absent when the node is a regular filesystem
   * entity (the `path` itself is the source).
   */
  derivedFrom?: string[];
}

/**
 * Drift status of a co-located `.sm` sidecar relative to the live
 * node hashes. Mirrors `TSidecarStatus` on the SQLite schema.
 */
export type SidecarStatus = 'fresh' | 'stale-body' | 'stale-frontmatter' | 'stale-both';

/**
 * Sidecar overlay attached to a `Node` after the orchestrator parses
 * `<basename>.sm`. `present === false` is the empty overlay (no
 * sidecar accompanies the node); the other fields are absent or null
 * in that case. When `present === true` and parse + validation
 * succeeded, `status` carries the drift state and `annotations` carries
 * the parsed (typed) `annotations:` block.
 */
export interface ISidecarOverlay {
  present: boolean;
  status?: SidecarStatus | null;
  /**
   * Parsed `annotations:` block. Untyped object, schema lives in
   * `spec/schemas/annotations.schema.json`. Null when no sidecar or
   * the block is empty/absent.
   */
  annotations?: Record<string, unknown> | null;
  /**
   * R15 closure (2026-05-07), full parsed YAML root of the sidecar
   * (the entire `.sm` payload, mirroring `sidecar.schema.json`). Surfaced
   * so the UI inspector can render `for:`, `audit:`, `settings:`, and
   * `<plugin-id>:` namespace blocks without re-reading the file. NULL
   * when no sidecar is present, or when the sidecar exists but failed
   * to parse / validate. The `annotations` field above stays, it
   * duplicates `root.annotations` intentionally so existing consumers
   * keep working unchanged.
   */
  root?: Record<string, unknown> | null;
}

export interface Link {
  /** The originating node, the path of the file the extractor was reading
   *  when it emitted this link. Singular, NOT to be confused with
   *  `sources` (plural) below. */
  source: string;
  target: string;
  kind: LinkKind;
  confidence: Confidence;
  /** Identifiers of the extractors / extensions that contributed evidence
   *  for this link (one link can be confirmed by multiple extractors).
   *  Plural; NOT the same as `source` (singular) above, which is the
   *  originating node path. Naming is unfortunate but spec-frozen. */
  sources: string[];
  trigger?: LinkTrigger | null;
  location?: LinkLocation | null;
  /**
   * Every syntactic site in the source body that contributed to this
   * edge. Populated by extractors at emit time (one entry per emission)
   * and accumulated by `dedupeLinks` when two extractors converge on the
   * same `(source, target, kind, normalizedTrigger)` key. Empty / absent
   * for legacy emits or for synthetic links (frontmatter-driven
   * references, sidecar annotations) that have no body position. The
   * `core/reference-redundant` analyzer walks this array to
   * detect multi-form references to the same target from one body.
   */
  occurrences?: LinkOccurrence[];
  /**
   * Node path the link resolves to, when the post-walk
   * `liftResolvedLinkConfidence` transform succeeded in matching the
   * (trigger-style or path-style) target against the live graph. Equal
   * to `link.target` for path-style links that hit a node directly;
   * different from `link.target` for trigger-style links (a Claude
   * `@real-agent` mention resolves to `.claude/agents/real-agent.md`,
   * but `link.target` keeps the authored trigger). Absent when the
   * link is unresolved (broken). The BFF `/api/links?to=<path>` uses
   * this field to surface incoming edges that reach the node by name,
   * not just by literal path.
   */
  resolvedTarget?: string | null;
  raw?: string | null;
}

/**
 * Scope of a `Signal` within its originating node. Mirrors
 * `signal.schema.json#/properties/scope`.
 *
 *   - `body` = markdown body or equivalent prose payload.
 *   - `frontmatter` = parsed metadata block at the top of the file.
 *   - `sidecar` = co-located `.sm` overlay.
 */
export type SignalScope = 'body' | 'frontmatter' | 'sidecar';

/**
 * Surface context for a body-scope `Signal`. Mirrors
 * `signal.schema.json#/properties/context/enum`. Null when the signal is in
 * normal prose or when the context concept does not apply (frontmatter /
 * sidecar scopes).
 */
export type SignalContext = 'code-block' | 'inline-code' | 'escaped';

/**
 * Byte-range location for a body-scope `Signal`. `start` is inclusive,
 * `end` is exclusive (one past the last char). `line` is the optional
 * 1-indexed line number containing `start`, populated by extractors
 * that already compute line tracking via `computeLineStarts` so the
 * resolver's materialised `Link` preserves `link.location.line`
 * without re-walking the body.
 */
export interface SignalRange {
  start: number;
  end: number;
  line?: number;
}

/**
 * One alternative interpretation of a `Signal`. The resolver picks the
 * winning candidate per Signal and materialises it as a `Link`; the
 * rejected candidates remain on `IAnalyzerContext.signals` for
 * collision-detection and conflict-visualisation analyzers.
 *
 * `confidence` is numeric `[0..1]`, identical shape to the `Link`'s
 * `Confidence` type after the Phase 4 migration. No conversion needed
 * when the resolver materialises a winning candidate.
 */
export interface SignalCandidate {
  extractorId: string;
  kind: LinkKind;
  target: string;
  /** `[0..1]`. Reference scoring guideline lives in `signal.schema.json`. */
  confidence: number;
  rationale?: string;
  trigger?: LinkTrigger | null;
}

/**
 * Intermediate Representation (IR) emitted by extractors via
 * `ctx.emitSignal(signal)`. The kernel's resolver phase consumes
 * `Signal[]` and produces final `Link[]` per the active Provider's
 * `resolverRules`. Opt-in: extractors with unambiguous detections keep
 * using `ctx.emitLink(link)` directly. See
 * [`signal.schema.json`](../../spec/schemas/signal.schema.json) for the
 * normative contract.
 */
export interface Signal {
  /** `node.path` of the originating node. */
  source: string;
  scope: SignalScope;
  /**
   * Byte-range location within the source. Required for `scope: 'body'`,
   * optional otherwise. Powers collision detection between extractors
   * (overlapping ranges) and code-block awareness (the orchestrator can
   * mark ranges that fall inside code spans).
   */
  range?: SignalRange | null;
  /**
   * Structured-data location for `frontmatter` / `sidecar` scopes. Each
   * entry is a step of the path: object keys are strings, array indices
   * are integers serialised as strings. Example: `['tools', '0']`. Null
   * for body scope or when the extractor does not track field locations.
   */
  fieldPath?: string[] | null;
  /** Verbatim matched text (body) or stringified value (frontmatter / sidecar). */
  raw: string;
  /** Surface context. Null when in normal prose or when not applicable. */
  context?: SignalContext | null;
  /** One or more alternative interpretations. At least one. */
  candidates: SignalCandidate[];
  /**
   * Resolver outcome annotation, populated by `resolveSignals`. Absent on
   * raw extractor emissions (before the resolver runs). When
   * `outcome === 'materialised'`, `winnerIndex` points into `candidates[]`
   * of the candidate the resolver chose; a corresponding `Link` was added
   * to the graph. When `outcome === 'rejected'`, one of `rejectedBy` /
   * `extractorDisabled` / `belowFloor` is set and no Link materialised.
   * Both materialised and rejected Signals remain on
   * `IAnalyzerContext.signals` so the `core/signal-collision` analyzer can
   * surface losers as `warn` issues. Mirrors
   * `signal.schema.json#/properties/resolution`.
   */
  resolution?: ISignalResolution;
}

/**
 * Why the resolver chose to materialise or reject a `Signal`. Populated by
 * `resolveSignals`; carries no meaning before that pass.
 */
export interface ISignalResolution {
  outcome: 'materialised' | 'rejected';
  /** Index into `Signal.candidates[]` of the winner. Set when `outcome === 'materialised'`. */
  winnerIndex?: number;
  /**
   * Set when the Signal lost a cross-extractor range-overlap collision
   * against another Signal at the same `source`. Names the winning Signal
   * so an analyzer (or the operator drilling into the sidecar) can see WHO
   * won and WHY.
   */
  rejectedBy?: {
    source: string;
    range: SignalRange;
    /** Qualified id (`<plugin>/<extractor>`) of the winning candidate's extractor. */
    extractorId: string;
    reason: 'kind-priority' | 'higher-confidence' | 'longer-range' | 'earlier-declaration';
  };
  /**
   * Phase 4+ stub: populated when every candidate of this Signal came from
   * an extractor the operator disabled via
   * `plugins.<id>.extensions.<extId>.enabled`. Today the resolver never
   * sets this; documented so analyzer surfaces can be built when the filter
   * lands.
   */
  extractorDisabled?: { extractorId: string };
  /**
   * Phase 4+ stub: populated when every candidate's `confidence` fell below
   * the configured floor. Today the resolver materialises every Signal that
   * survives overlap regardless of confidence.
   */
  belowFloor?: { threshold: number };
}

export interface IssueFix {
  summary?: string;
  autofixable?: boolean;
}

export interface Issue {
  analyzerId: string;
  severity: Severity;
  nodeIds: string[];
  message: string;
  linkIndices?: number[];
  detail?: string | null;
  fix?: IssueFix | null;
  data?: Record<string, unknown>;
}

export interface ScanStats {
  /**
   * Files visited by the Provider walkers. With a single Provider this
   * matches `nodesCount`; with multiple Providers running on overlapping
   * roots it can diverge (each yielded `IRawNode` is one walked file).
   */
  filesWalked: number;
  /**
   * Files walked but not classified by any Provider. Today every walked
   * file is classified by its Provider (the `claude` Provider falls back to
   * `'markdown'`), so this is always 0; the field will matter once
   * multiple Providers can claim the same file.
   */
  filesSkipped: number;
  nodesCount: number;
  linksCount: number;
  issuesCount: number;
  durationMs: number;
}

export interface ScanScannedBy {
  name: string;
  version: string;
  specVersion: string;
}

export type ExecutionKind = 'action';
export type ExecutionStatus = 'completed' | 'failed' | 'cancelled';
export type ExecutionFailureReason =
  | 'runner-error'
  | 'report-invalid'
  | 'timeout'
  | 'abandoned'
  | 'job-file-missing'
  | 'user-cancelled';
export type ExecutionRunner = 'cli' | 'skill' | 'in-process';

/**
 * One row of execution history (`state_executions`). Matches
 * `spec/schemas/execution-record.schema.json`. `nodeIds` is the camelCased
 * domain field name; storage flattens it to `node_ids_json`.
 */
export interface ExecutionRecord {
  id: string;
  kind: ExecutionKind;
  extensionId: string;
  extensionVersion: string;
  nodeIds?: string[];
  contentHash?: string | null;
  status: ExecutionStatus;
  failureReason?: ExecutionFailureReason | null;
  exitCode?: number | null;
  runner?: ExecutionRunner | null;
  startedAt: number;
  finishedAt: number;
  durationMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  reportPath?: string | null;
  jobId?: string | null;
}

export interface HistoryStatsTotals {
  executionsCount: number;
  completedCount: number;
  failedCount: number;
  tokensIn: number;
  tokensOut: number;
  durationMsTotal: number;
}

export interface HistoryStatsTokensPerAction {
  actionId: string;
  actionVersion: string;
  executionsCount: number;
  tokensIn: number;
  tokensOut: number;
  durationMsMean: number | null;
  durationMsMedian: number | null;
}

export interface HistoryStatsExecutionsPerPeriod {
  periodStart: string; // ISO-8601
  periodUnit: 'day' | 'week' | 'month';
  executionsCount: number;
  tokensIn: number;
  tokensOut: number;
}

export interface HistoryStatsTopNode {
  nodePath: string;
  executionsCount: number;
  lastExecutedAt: number;
}

export interface HistoryStatsPerActionRate {
  actionId: string;
  rate: number;
  executionsCount: number;
  failedCount: number;
}

export interface HistoryStatsErrorRates {
  global: number;
  perAction: HistoryStatsPerActionRate[];
  perFailureReason: Record<ExecutionFailureReason, number>;
}

/**
 * `sm history stats --json` payload, conforming to
 * `spec/schemas/history-stats.schema.json`. `elapsedMs` is the command's
 * own wall-clock per `cli-contract.md` §Elapsed time.
 */
export interface HistoryStats {
  schemaVersion: 1;
  range: { since: string | null; until: string };
  totals: HistoryStatsTotals;
  tokensPerAction: HistoryStatsTokensPerAction[];
  executionsPerPeriod: HistoryStatsExecutionsPerPeriod[];
  topNodes: HistoryStatsTopNode[];
  errorRates: HistoryStatsErrorRates;
  elapsedMs: number;
}

export interface ScanResult {
  schemaVersion: 1;
  /** Unix milliseconds when the scan started. */
  scannedAt: number;
  /**
   * Filesystem roots that were walked during this scan. Spec requires
   * `minItems: 1`, `runScan` throws if `roots: []` is supplied.
   */
  roots: string[];
  /** Provider ids that participated in classification. Empty if no Provider matched. */
  providers: string[];
  /** Implementation metadata. Populated by `runScan` for self-describing output. */
  scannedBy?: ScanScannedBy;
  nodes: Node[];
  links: Link[];
  issues: Issue[];
  stats: ScanStats;
}
