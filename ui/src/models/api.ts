/**
 * Local TypeScript mirrors of the JSON shapes returned by the BFF
 * (`src/server/routes/*`) and persisted by `@skill-map/spec`.
 *
 * Temporary. The canonical sources of truth are:
 *   - `spec/schemas/scan-result.schema.json`
 *   - `spec/schemas/node.schema.json`
 *   - `spec/schemas/link.schema.json`
 *   - `spec/schemas/issue.schema.json`
 *   - `spec/schemas/project-config.schema.json`
 *   - `src/server/envelope.ts` (REST envelope shapes)
 *
 * These mirrors live in the UI only until ROADMAP §DTO gap (Step 1b/2)
 * lands a typed bridge from `@skill-map/spec`. Drift risk is accepted for
 * Step 14.3.a; the BFF is the authoritative producer and any mismatch
 * surfaces immediately at fetch-time during integration smoke tests.
 *
 * DO NOT extend with UI-specific fields. Compose UI state separately
 * (see `models/node.ts:INodeView` for the equivalent pattern).
 */

import type { TFrontmatter } from './node';

/**
 * `Node` from `node.schema.json`. Persisted shape returned by the BFF
 * over `/api/scan`, `/api/nodes`, and `/api/nodes/:pathB64`.
 *
 * `body` is opt-in: present only on `/api/nodes/:pathB64?include=body`
 * (Step 14.5.a). The body is read from disk on demand because the
 * kernel persists `bodyHash` only, see `src/server/node-body.ts`.
 * `null` means the file disappeared from disk between the last scan
 * and this request; `undefined` means the caller did not opt in.
 */
export interface IExternalRefApi {
  /** Normalised URL (lowercased host, fragment stripped). */
  url: string;
  /** 1-indexed line of the occurrence in the source body, when known. */
  line?: number;
  /** Author substring (almost always equals `url`). */
  originalTrigger?: string;
}

export interface INodeApi {
  path: string;
  kind: string;
  provider: string;
  /**
   * Title / description / stability / version are no longer carried
   * on the wire shape as denormalised fields. The canonical sources
   * are `frontmatter.{name,description}` (for title / description) and
   * `sidecar.annotations.{stability,version}` (for stability /
   * version). The DB keeps these as indexed columns on `scan_nodes`
   * for SQL sorting / faceting only; consumers that previously read
   * `INodeApi.title` etc. now project from the canonical surfaces.
   */
  frontmatter?: TFrontmatter;
  bodyHash: string;
  frontmatterHash: string;
  bytes: ITripleSplit;
  tokens?: ITripleSplit;
  /**
   * File modification time (`mtime`) in Unix milliseconds, captured at
   * scan time. NULL / absent for virtual / derived nodes (no backing
   * file). Mirrors `node.schema.json#/properties/modifiedAtMs`; drives
   * the files-view "Modified" sortable column.
   */
  modifiedAtMs?: number | null;
  linksOutCount: number;
  linksInCount: number;
  externalRefsCount: number;
  /**
   * Distinct external URLs the node's body references (`http(s)://`).
   * Empty / absent when none. The denormalised `externalRefsCount`
   * equals `externalRefs.length` when both are present.
   */
  externalRefs?: IExternalRefApi[];
  body?: string | null;
  /**
   * Step 9.6.2, co-located `.sm` sidecar overlay. Carries presence flag,
   * drift status (null when no sidecar or when the sidecar exists but
   * failed to parse), and the parsed `annotations:` block (null when
   * absent or empty). Mirrors `node.schema.json#/properties/sidecar`.
   */
  sidecar?: ISidecarOverlayApi;
  /**
   * Per-user "favorite" flag. Decorated by the BFF on `/api/nodes`
   * payloads from `state_node_favorites` (see
   * `node.schema.json#/properties/isFavorite`). Absent on emissions
   * that don't carry per-user state (static fixtures, `sm export`).
   */
  isFavorite?: boolean;
  /**
   * Phase 3 / View contribution system, per-node typed data emitted
   * by extensions via `ctx.emitContribution(id, payload)`. Always
   * present on single-node responses; present on bulk-list responses
   * when `limit ≤ bff.maxBulkContributions` (default 200), absent
   * otherwise (UI falls back to lazy
   * `/api/contributions/:pluginId/:contributionId?path=` per node).
   */
  contributions?: IContributionApi[];
  /**
   * Tags · single-source. Decorated by the BFF on `/api/nodes` and
   * `/api/scan` payloads from the `scan_node_tags` table: the flat
   * set of tags written into `sidecar.annotations.tags` by the
   * curator. Sorted ascending and deduplicated. The former author
   * source (`frontmatter.tags`) was retired. Absent on emissions that
   * don't run through the BFF (e.g. `sm export`); a missing field MUST
   * be treated as "unknown" rather than empty.
   */
  tags?: readonly string[];
}

/**
 * Phase 3 / View contribution system, single per-node contribution
 * row carried on `INodeApi.contributions[]` and on the lazy lookup
 * envelope. Mirror of `IPersistedContribution` from the kernel.
 *
 * `payload` is `unknown` because the slot space is open at the
 * type layer; the UI's renderer dispatch maps `slot` → renderer
 * component, and the renderer narrows the payload at the call site.
 */
export interface IContributionApi {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  slot: string;
  payload: unknown;
}

/**
 * Step 9.6.2 sidecar overlay drift status. Mirrors the enum in
 * `node.schema.json#/$defs/sidecarOverlay/properties/status`. The set
 * `'stale-body' | 'stale-frontmatter' | 'stale-both'` is the canonical
 * "stale" set surfaced in the UI.
 */
export type TSidecarStatusApi =
  | 'fresh'
  | 'stale-body'
  | 'stale-frontmatter'
  | 'stale-both'
  | null;

export interface ISidecarOverlayApi {
  present: boolean;
  status?: TSidecarStatusApi;
  annotations?: Record<string, unknown> | null;
  /**
   * R15 closure (2026-05-07), full parsed YAML root of the sidecar
   * (mirrors `sidecar.schema.json`). The BFF surfaces it so the UI
   * inspector audit / plugin-contributions / debug panels can read
   * `for.*`, `audit.*`, `settings.*`, and `<plugin-id>:` namespace
   * blocks without re-reading the file. Null when no sidecar is
   * present or when the sidecar failed to parse / validate. The
   * top-level `annotations` field above is intentionally duplicated
   * with `root.annotations` so existing consumers keep working
   * unchanged; do NOT remove it.
   */
  root?: Record<string, unknown> | null;
}

export interface ITripleSplit {
  frontmatter: number;
  body: number;
  total: number;
}

/**
 * `Link` from `link.schema.json`. Persisted shape returned over `/api/scan`,
 * `/api/links`, and the `links` payload of `/api/nodes/:pathB64`.
 */
export type TLinkKindApi = 'invokes' | 'references' | 'mentions' | 'points';
/**
 * Numeric `[0..1]` after the Phase 4 confidence migration. The wire
 * shape from the BFF carries a number; UI helpers bucket it into tier
 * labels (`'high' | 'medium' | 'low'`) at render time when a
 * categorical presentation is wanted. See `severity-map.ts` for the
 * tier / severity projection helpers.
 */
export type TLinkConfidenceApi = number;

export interface ILinkOccurrenceApi {
  /** Extractor id that observed this occurrence (matches `sources[]`). */
  extractor: string;
  /** Original substring as written in the body (sigil + path / handle). */
  originalTrigger: string;
  /** Position of the occurrence in the body, when the extractor records it. */
  location?: { line: number; column?: number; offset?: number } | null;
}

export interface ILinkApi {
  source: string;
  target: string;
  kind: TLinkKindApi;
  confidence: TLinkConfidenceApi;
  sources: string[];
  trigger?: { originalTrigger: string; normalizedTrigger: string } | null;
  location?: { line: number; column?: number; offset?: number } | null;
  /**
   * Every syntactic site in the source body that contributed to this
   * edge (one entry per detection). Populated by extractors; the
   * `dedupeLinks` post-walk transform accumulates them when two
   * extractors converge on the same `(source, target, kind,
   * normalizedTrigger)` key. Empty / absent on legacy emits.
   */
  occurrences?: ILinkOccurrenceApi[];
  /**
   * Node path the link resolves to, per the post-walk lift transform.
   * NULL when the link is unresolved (broken). Equal to `target` for
   * path-style links; differs for trigger-style links (`@foo`, `/cmd`)
   * where `target` keeps the authored trigger.
   */
  resolvedTarget?: string | null;
  raw?: string | null;
}

/**
 * `Issue` from `issue.schema.json`.
 */
export type TIssueSeverityApi = 'error' | 'warn' | 'info';

export interface IIssueApi {
  analyzerId: string;
  severity: TIssueSeverityApi;
  nodeIds: string[];
  linkIndices?: number[];
  message: string;
  detail?: string | null;
  fix?: { summary?: string; autofixable?: boolean } | null;
  data?: Record<string, unknown>;
}

/**
 * `ScanResult` from `scan-result.schema.json`. 1:1 with the BFF
 * `/api/scan` response (no envelope wrap).
 */
export interface IScanResultApi {
  schemaVersion: 1;
  scannedAt: number;
  scannedBy?: { name?: string; version?: string; specVersion?: string } | null;
  roots: string[];
  providers?: string[];
  /**
   * Tokenizer id the scan used (`gpt`, `claude`, …), surfaced on the
   * `?meta=1` envelope so the header can name it. Absent on legacy /
   * synthetic envelopes that never recorded one.
   */
  tokenizer?: string | null;
  /**
   * Scan-wide file ceiling (`scan.maxScan`): the maximum number of
   * files the walker was allowed to read this scan. The scan-truncated
   * banner phrases its copy against it. Absent on legacy / synthetic
   * envelopes ("absent on synthetic fixtures").
   */
  scanCeiling?: number;
  /**
   * `true` when the walker hit `scanCeiling` and dropped files from the
   * corpus. Drives the single-mode scan-truncated banner. Absent on
   * legacy / synthetic envelopes.
   */
  scanTruncated?: boolean;
  /**
   * Effective render cap (`scan.maxNodes`, design default 256): the
   * maximum number of nodes the graph map draws per branch. The
   * `/api/branch` route clamps its `cap` to this. Absent on legacy /
   * synthetic envelopes.
   */
  maxRenderNodes?: number;
  /**
   * Files the walker refused to read because their size exceeded
   * `scan.maxFileSizeBytes`. Each entry carries the root-relative path
   * and the file's byte size. Used by the skipped-files banner to name
   * the offenders. Empty / absent when nothing was skipped for size.
   */
  oversizedFiles?: { path: string; bytes: number }[];
  nodes: INodeApi[];
  links: ILinkApi[];
  issues: IIssueApi[];
  stats: {
    filesWalked: number;
    filesSkipped: number;
    nodesCount: number;
    linksCount: number;
    issuesCount: number;
    durationMs: number;
    /**
     * Count of files skipped because they exceeded
     * `scan.maxFileSizeBytes`. Equals `oversizedFiles.length`; the
     * skipped-files banner reads this as the canonical count. Absent on
     * legacy / synthetic envelopes.
     */
    filesOversized?: number;
  };
}

/**
 * One row of `GET /api/folders` (`kind: 'folders'` list envelope). A
 * lightweight per-node projection over the WHOLE corpus (no frontmatter
 * / body / links / signals, no pagination), feeding the SPA folders
 * tree, text search, kind filter, the per-folder severity badges, and
 * the files-view rail's leaf data columns (links in / out, tokens,
 * modified).
 *
 * `errorCount` / `warnCount` are the count of error / warn issues whose
 * `nodeIds` include this path; rolled up across each folder's
 * descendants for the tree badges. The `info` severity is excluded
 * server-side (the tree badges only error / warn).
 *
 * `linksInCount` / `linksOutCount` are the cheap scalar edge counters;
 * `tokensTotal` / `modifiedAtMs` mirror `INodeApi.tokens.total` /
 * `INodeApi.modifiedAtMs` (both `null` for virtual / derived nodes with
 * no backing file). The endpoint supplies these so the rail's leaf
 * columns render real values without hydrating the full node payload.
 */
export interface IFolderNodeLite {
  path: string;
  kind: string;
  linksInCount: number;
  linksOutCount: number;
  tokensTotal: number | null;
  modifiedAtMs: number | null;
  errorCount: number;
  warnCount: number;
  /**
   * Sidecar drift status (`scan_nodes.sidecar_status`), or `null` when
   * the node has no parseable sidecar. Threaded so the files rail renders
   * its per-row stale-clock icon corpus-wide without hydrating the
   * sidecar-carrying branch payload (the rail builds from this lite list).
   * Same role as `errorCount` / `warnCount` for the error / warn badges.
   */
  sidecarStatus: string | null;
}

/**
 * `GET /api/branch?path=<prefix>&path=<prefix>&...&limit=<n>` response.
 * Direct shape (NO envelope wrap, like `/api/scan`): the SPA branches on
 * `schemaVersion` + `kind`. The graph map renders this; the whole corpus
 * is never hydrated in one payload.
 *
 * The `path` query param is REPEATABLE: the response is the UNION of the
 * subtrees under every requested prefix (plus any exact leaf paths),
 * capped at the scan's `maxRenderNodes`. No prefixes = whole-corpus root.
 *
 *   - `branch.paths`: the requested prefixes / leaf paths (empty =
 *     whole-corpus root).
 *   - `branch.total`: union node count BEFORE the cap.
 *   - `branch.rendered`: nodes actually returned (`min(total, cap)`).
 *   - `branch.truncated`: `total > cap` (drives the branch-cap banner).
 *   - `branch.cap`: the effective render cap for this branch.
 *   - `nodes`: the first `rendered` nodes of the union, in stable
 *     path order, capped at the scan's `maxRenderNodes`.
 *   - `links`: only edges whose source AND target are both in `nodes`.
 *   - `issues`: only issues whose `nodeIds` intersect `nodes`.
 */
export interface IBranchResponseApi {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'branch';
  branch: {
    paths: string[];
    total: number;
    rendered: number;
    truncated: boolean;
    cap: number;
  };
  nodes: INodeApi[];
  links: ILinkApi[];
  issues: IIssueApi[];
}

/**
 * `ProjectConfig` from `project-config.schema.json`. Shape is open at the
 * UI boundary today, the SPA reads only the fields it needs and treats
 * unknowns as inert.
 */
/**
 * One row of `GET /api/nodes/:pathB64/summary` (direct shape, no
 * envelope): a stored semantic summary recorded by a summarizer Action,
 * with `stale` derived server-side against the node's live body hash.
 * `report` follows `summaries/markdown.schema.json` (`whatItCovers`,
 * `topics`, `keyFacts`, `relatedNodes`, `qualityNotes`, `confidence`).
 */
export interface INodeSummaryRowApi {
  summarizerActionId: string;
  generatedAt: number;
  stale: boolean;
  report: Record<string, unknown>;
}

/**
 * One row of `GET /api/config/resolution` (the Settings > About
 * settings-hierarchy viewer): a flattened effective-config LEAF key,
 * its resolved value, and the config layer that last wrote it.
 * `secret: true` means the BFF masked the value server-side (a
 * plugin-extension setting declared `type: 'secret'`).
 */
export interface IConfigResolutionRowApi {
  key: string;
  value: unknown;
  layer: 'defaults' | 'project' | 'project-local' | 'override';
  secret: boolean;
}

export interface IProjectConfigApi {
  schemaVersion?: number;
  tokenizer?: string;
  roots?: string[];
  ignore?: string[];
  scan?: Record<string, unknown>;
  [extra: string]: unknown;
}

/**
 * REST envelope shapes mirroring `src/server/envelope.ts`.
 */
export const REST_ENVELOPE_SCHEMA_VERSION = '1';

export type TEnvelopeKindApi =
  | 'nodes'
  | 'links'
  | 'issues'
  | 'plugins'
  | 'config'
  | 'graph'
  | 'node'
  | 'health'
  | 'scan'
  | 'folders'
  | 'branch';

export interface IPageInfoApi {
  offset: number;
  limit: number;
}

export interface IEnvelopeCountsApi {
  total: number;
  returned: number;
  page?: IPageInfoApi;
}

/**
 * Wire shape of one entry in the BFF's `kindRegistry` (Step 14.5.d).
 * Mirrors `spec/schemas/api/rest-envelope.schema.json#/properties/kindRegistry/additionalProperties`.
 * The UI's runtime `KindRegistryService` enriches this with the kind
 * name (key from the parent map) so iteration preserves order without a
 * separate Map.
 */
export type TKindIconApi =
  | { kind: 'pi'; id: string }
  | { kind: 'svg'; path: string };

/**
 * Per-provider visuals for one kind contribution. When two Providers
 * declare the same kind name (e.g. Claude `agent` and Gemini `agent`),
 * the entry's `providers` map carries both, the UI paints a node with
 * its own Provider's color via `entry.providers[node.provider]`.
 */
export interface IKindRegistryProviderUiApi {
  label: string;
  color: string;
  colorDark?: string;
  emoji?: string;
  icon?: TKindIconApi;
}

/**
 * Wire shape of one entry in the BFF's `kindRegistry`. Mirrors
 * `spec/schemas/api/rest-envelope.schema.json#/properties/kindRegistry/additionalProperties`.
 * `primaryProviderId` drives the kind's primary CSS var (`--sm-kind-<kind>`);
 * `providers` keeps every contribution so per-node painting can pick
 * the right Provider's color.
 */
export interface IKindRegistryEntryApi {
  primaryProviderId: string;
  providers: Record<string, IKindRegistryProviderUiApi>;
}

export type IKindRegistryApi = Record<string, IKindRegistryEntryApi>;

/**
 * Wire shape of one entry in the BFF's `providerRegistry`, keyed by
 * Provider id. Mirrors
 * `spec/schemas/api/rest-envelope.schema.json#/properties/providerRegistry/additionalProperties`.
 * Carries the Provider's own identity (label, color, optional dark
 * variant / emoji / icon, and `hideChip` for the universal `markdown`
 * fallback). Distinct from `IKindRegistryProviderUiApi` (per-kind
 * visuals); the UI's `ProviderRegistryService` enriches this with the
 * Provider id from the parent map key.
 */
export interface IProviderRegistryEntryApi {
  label: string;
  color: string;
  colorDark?: string;
  emoji?: string;
  icon?: TKindIconApi;
  /**
   * True when this Provider is a selectable lens (projected from
   * `gatedByActiveLens`). The active-lens dropdown lists only `isLens`
   * entries; the non-gated `markdown` base is `false` and never appears
   * there. Independent of the `selectable` set (which marks enabled lenses).
   */
  isLens: boolean;
  /** Suppress the per-card chip (universal `markdown` base). */
  hideChip?: boolean;
  /**
   * Name of the parsed-frontmatter field that carries this Provider's node
   * body (projected from `read.bodyField`). Present only for Providers whose
   * prompt lives inside structured frontmatter (Codex sub-agents are pure
   * TOML whose markdown prompt is `developer_instructions`). The inspector
   * renders that field as the node body and omits it from the metadata dump.
   */
  bodyField?: string;
  /**
   * Single glyph this lens's runtime uses to invoke a skill / command
   * (projected from `presentation.invocationSigil`). The link-kind palette
   * paints it as the `invokes` edge glyph (and tooltip example) for the
   * active lens: `/` for claude / antigravity, `$` for codex. Absent for
   * lenses with no invocation channel (`agent-skills`, `markdown`).
   */
  invocationSigil?: string;
}

export type IProviderRegistryApi = Record<string, IProviderRegistryEntryApi>;

/**
 * Plugin row shape returned by `GET /api/plugins` and `PATCH /api/plugins/:id`.
 * Mirrors `IPluginListItem` in `src/server/routes/plugins.ts`. Status / source /
 * granularity values are documented in `spec/cli-contract.md` §`GET /api/plugins`.
 */
export type TPluginStatusApi =
  | 'enabled'
  | 'disabled'
  | 'incompatible-spec'
  | 'invalid-manifest'
  | 'load-error'
  | 'id-collision';

export type TPluginSourceApi = 'built-in' | 'project';

/**
 * One rejected view-contribution emission recorded by the last scan,
 * embedded per plugin on the `GET /api/plugins` list items. Mirrors the
 * BFF's `IPluginListItem.runtimeContributionErrors[]` element. A plugin
 * can load cleanly (status `enabled`) yet still have its extensions
 * emit contributions the kernel refused at scan time (an undeclared
 * slot ref, or a payload that failed the slot's AJV schema), so this is
 * surfaced separately from the load-status failure badge.
 */
export interface IPluginRuntimeContributionErrorApi {
  /** Qualified extension id (`<pluginId>/<extensionId>`) that emitted. */
  extensionId: string;
  /** Node path the rejected emission targeted. */
  nodePath: string;
  /** Either the literal `undeclared-contribution-ref` or an AJV error
   *  string describing why the payload was rejected. */
  reason: string;
  /** Display-ready diagnostic line (pre-formatted by the BFF). */
  message: string;
  /** Contribution id the emission used, when the rejection carries it. */
  contributionId?: string;
  /** Slot the emission targeted, when the rejection carries it. */
  slot?: string;
}

/**
 * Lifecycle label an extension manifest may declare. Mirrors the BFF's
 * `TExtensionStabilityApi` (spec `extensions/base.schema.json#/properties/
 * stability`). Missing on the wire means `stable` (the default).
 */
export type TExtensionStabilityApi = 'experimental' | 'beta' | 'stable' | 'deprecated';

/**
 * Closed catalog of input-type names for an extension setting. Mirrors
 * the kernel's `TInputTypeName` (generated from
 * `spec/schemas/input-types.schema.json`). The 11-member set is the v1
 * surface; the UI's `<sm-input-type-control>` renders one PrimeNG widget
 * per member.
 */
export type TSettingTypeApi =
  | 'string-list'
  | 'single-string'
  | 'boolean-flag'
  | 'integer'
  | 'number'
  | 'enum-pick'
  | 'enum-multipick'
  | 'path-glob'
  | 'regex'
  | 'secret'
  | 'key-value-list';

/** A single `{ value, label }` choice for the enum input-types. */
export interface ISettingEnumOptionApi {
  value: string;
  label: string;
}

/** A single `{ key, value }` row for the `key-value-list` input-type. */
export interface ISettingKeyValueEntryApi {
  key: string;
  value: string;
}

/**
 * Fields shared by every setting declaration shape. The discriminated
 * union `TSettingDeclarationApi` extends one of these per `type`.
 */
interface ISettingCommonApi {
  /** Short human-readable label. English-only. */
  label: string;
  /** Optional helper text shown below the control. English-only. */
  description?: string;
}

export interface ISettingStringListApi extends ISettingCommonApi {
  type: 'string-list';
  default?: string[];
  min?: number;
  max?: number;
  itemMaxLength?: number;
}

export interface ISettingSingleStringApi extends ISettingCommonApi {
  type: 'single-string';
  default?: string;
  minLength?: number;
  maxLength?: number;
  /** ECMAScript regex pattern (no flags). */
  pattern?: string;
}

export interface ISettingBooleanFlagApi extends ISettingCommonApi {
  type: 'boolean-flag';
  default?: boolean;
}

export interface ISettingIntegerApi extends ISettingCommonApi {
  type: 'integer';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface ISettingNumberApi extends ISettingCommonApi {
  type: 'number';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface ISettingEnumPickApi extends ISettingCommonApi {
  type: 'enum-pick';
  options: ISettingEnumOptionApi[];
  default?: string;
}

export interface ISettingEnumMultipickApi extends ISettingCommonApi {
  type: 'enum-multipick';
  options: ISettingEnumOptionApi[];
  default?: string[];
  min?: number;
  max?: number;
}

export interface ISettingPathGlobApi extends ISettingCommonApi {
  type: 'path-glob';
  default?: string;
  /** When true, the value is `string[]`; when false (default), a single string. */
  multiple?: boolean;
}

export interface ISettingRegexApi extends ISettingCommonApi {
  type: 'regex';
  default?: string;
  /** Subset of `gimsuy`. Shown as a static suffix, never edited. */
  flags?: string;
}

export interface ISettingSecretApi extends ISettingCommonApi {
  type: 'secret';
  /** Optional uppercase-ASCII env var that overrides any stored value. */
  envVar?: string;
}

export interface ISettingKeyValueListApi extends ISettingCommonApi {
  type: 'key-value-list';
  keyLabel?: string;
  valueLabel?: string;
  default?: ISettingKeyValueEntryApi[];
  min?: number;
  max?: number;
}

/**
 * Discriminated union of every setting declaration shape, mirror of the
 * kernel's `TSettingDeclaration` (`view-catalog.ts`). The author picks a
 * `type` and supplies per-type params; the UI never reads JSON Schema.
 */
export type TSettingDeclarationApi =
  | ISettingStringListApi
  | ISettingSingleStringApi
  | ISettingBooleanFlagApi
  | ISettingIntegerApi
  | ISettingNumberApi
  | ISettingEnumPickApi
  | ISettingEnumMultipickApi
  | ISettingPathGlobApi
  | ISettingRegexApi
  | ISettingSecretApi
  | ISettingKeyValueListApi;

/**
 * One declared setting on the `GET /api/plugins` extension projection:
 * the full manifest declaration plus its `id` (the settingId key).
 * Mirror of the BFF's `ISettingDeclarationApi`.
 */
export type IPluginExtensionSettingApi = TSettingDeclarationApi & { id: string };

/**
 * Runtime value a setting can hold, derived from its declaration. The
 * buffer stores values of these shapes; the apply payload ships them as
 * real JSON. `secret`-typed settings carry a `string` (blank = unchanged).
 */
export type TSettingValueApi =
  | string
  | string[]
  | boolean
  | number
  | ISettingKeyValueEntryApi[];

export interface IPluginExtensionApi {
  id: string;
  kind: string;
  version: string;
  enabled: boolean;
  /** Per-extension manifest description. Surfaced as muted secondary
   *  text in Settings; included in the substring search. */
  description?: string;
  /** Per-extension lifecycle label. Missing means `stable`. Settings
   *  badges only the non-default values (`experimental` / `beta` /
   *  `deprecated`); `stable` renders nothing. */
  stability?: TExtensionStabilityApi;
  /** Host-enforced lock (the extension manifest's `locked` flag). When true,
   *  Settings renders the toggle disabled with a "locked" tag and the
   *  PATCH route returns 403. */
  locked?: boolean;
  /**
   * Operator-configurable settings declared by the extension manifest,
   * in manifest order, each carrying its `id` (the settingId). Omitted
   * (not `[]`) when the extension declares none. The Settings panel
   * renders one control per entry from `type` + the per-type params.
   */
  settings?: IPluginExtensionSettingApi[];
  /**
   * Resolved EFFECTIVE values keyed by settingId (manifest default
   * overlaid by the merged config). `secret`-typed settings are NEVER
   * present here (their value never crosses the wire); their stored-ness
   * is signalled via `secretSettingsSet`. Omitted when the extension
   * declares no settings.
   */
  settingValues?: Record<string, unknown>;
  /**
   * settingIds of `secret`-typed settings that currently hold a stored
   * value, so the panel can show "set" vs "empty" without the secret
   * value crossing the wire. Present only when at least one secret is
   * set; omitted otherwise.
   */
  secretSettingsSet?: string[];
}

export interface IPluginItemApi {
  id: string;
  version: string | null;
  kinds: string[];
  status: TPluginStatusApi;
  reason: string | null;
  source: TPluginSourceApi;
  /** Plugin-level manifest description. Surfaced as muted secondary
   *  text in Settings; included in the substring search. */
  description?: string;
  /** Present whenever the plugin declares any extension AND the plugin
   *  loaded. Every extension is independently toggle-able; the plugin
   *  itself is a presentational grouping. */
  extensions?: IPluginExtensionApi[];
  /** Host-enforced lock at the plugin level (mirrors the BFF
   *  `IPluginListItem.locked`). */
  locked?: boolean;
  /**
   * Presentation position stamped by the BFF listing (0-based; single
   * source `src/plugins/presentation-order.ts`). The Settings list
   * sorts by it; absent on older fixtures, which fall to the end.
   */
  order?: number;
  /**
   * Local import-trust grant (security axis, per-plugin). Stamped `true`
   * on a drop-in (`source: 'project'`) plugin the operator has trusted on
   * THIS machine (a `config_plugins` DB trust row, written by
   * `sm plugins trust <id>` / `sm plugins trust --all` or the Trust
   * button). OMITTED when false, so an
   * untrusted project-local plugin reads `trusted` absent. Built-ins are
   * never trust-gated and never carry it. A plugin runs only when it is
   * both enabled (config) AND trusted (this flag); an untrusted plugin is
   * discovered but never imported, so it carries NO `extensions[]` and the
   * Settings row surfaces a plugin-level Trust action instead of toggles.
   */
  trusted?: boolean;
  /**
   * Mirrors `IPluginListItem.startsAsDisabled` on the BFF. Stamped
   * `true` for drop-in plugins whose discovery-time `status` was
   * `'disabled'` (the user had them disabled at `sm serve` boot, so
   * their handlers were never bucketed into the runtime). Re-enabling
   * them via the buffered Settings modal persists the override but
   * requires `sm serve` restart for the change to take effect; the
   * modal surfaces this as a per-row hint when the user toggles such
   * a row back on. Built-ins never carry the flag.
   */
  startsAsDisabled?: boolean;
  /**
   * View-contribution emissions the kernel rejected during the last
   * scan, grouped per plugin and stable-sorted by the BFF. ABSENT (not
   * `[]`) when the plugin had zero rejections in the last scan (the
   * common case). Distinct from a load failure: a plugin can be
   * `enabled` (clean load) yet still appear here when one of its
   * extensions emitted a contribution against an undeclared slot or
   * with a payload that failed the slot's schema. Settings surfaces it
   * as a warning-toned count + a collapsible list of the diagnostics.
   */
  runtimeContributionErrors?: IPluginRuntimeContributionErrorApi[];
}

export interface IListEnvelopeApi<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKindApi;
  items: TItem[];
  filters: Record<string, unknown>;
  counts: IEnvelopeCountsApi;
  kindRegistry: IKindRegistryApi;
  providerRegistry?: IProviderRegistryApi;
  contributionsRegistry?: IContributionsRegistryApi;
}

export interface ISingleEnvelopeApi<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKindApi;
  item: TItem;
  kindRegistry: IKindRegistryApi;
  providerRegistry?: IProviderRegistryApi;
  contributionsRegistry?: IContributionsRegistryApi;
}

export interface IValueEnvelopeApi<TValue> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKindApi;
  value: TValue;
  kindRegistry: IKindRegistryApi;
  providerRegistry?: IProviderRegistryApi;
  contributionsRegistry?: IContributionsRegistryApi;
}

/**
 * Phase 3 / View contribution system, runtime catalog of plugin-declared
 * view contributions. Mirror of `IContributionsRegistry` on the BFF.
 * Keyed by qualified id `<pluginId>/<extensionId>/<contributionId>`.
 *
 * Surfaced on every payload-bearing envelope (sibling to `kindRegistry`).
 * The UI consumes it once at boot via the contributions-registry
 * service and uses it to drive the slot → renderer dispatch.
 */
export type IContributionsRegistryApi = Record<string, IContributionsRegistryEntryApi>;

export interface IContributionsRegistryEntryApi {
  pluginId: string;
  extensionId: string;
  contributionId: string;
  slot: string;
  label?: string;
  tooltip?: string;
  icon?: string;
  emptyText?: string;
  emitWhenEmpty: boolean;
  /**
   * Optional ordering hint (default 100). Slots with `order: 'priority'`
   * sort contributions ASC by this value, tie-breaking alphabetically
   * by qualified id. Stable across plugins so the UI surface stays
   * predictable.
   */
  priority?: number;
  /**
   * Inspector-only ordering hint (default 100), denormalised from the
   * owning plugin's `plugin.json` `order`. Orders the per-plugin
   * inspector body sections. Same value on every contribution of a plugin.
   */
  pluginOrder?: number;
  /**
   * Inspector-only ordering hint (default 100), denormalised from the
   * owning extension's `order`. Orders the bricks inside a plugin's
   * inspector section. Same value on every contribution of an extension.
   */
  extensionOrder?: number;
}

/**
 * `/api/nodes/:pathB64` response, single envelope augmented with a
 * `links` bundle and `issues` array for the inspector view.
 */
export interface INodeDetailApi {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'node';
  item: INodeApi;
  links: { incoming: ILinkApi[]; outgoing: ILinkApi[] };
  issues: IIssueApi[];
  kindRegistry: IKindRegistryApi;
  providerRegistry?: IProviderRegistryApi;
  contributionsRegistry?: IContributionsRegistryApi;
}

/**
 * `/api/health` response (mirrors `src/server/health.ts:IHealthResponse`).
 */
export interface IHealthResponseApi {
  ok: true;
  schemaVersion: string;
  specVersion: string;
  implVersion: string;
  db: 'present' | 'missing' | 'error';
  /** Absolute project root the BFF resolves against. */
  cwd: string;
  /** Absolute path to the project DB file. */
  dbPath: string;
  /**
   * `true` when the read-only MCP server is mounted at `/mcp` right now
   * (resolved `IServerOptions.mcpServer`). Distinct from the
   * `mcpServerEnabled` project preference (opt-in intent); this is the
   * LIVE endpoint state the Setup panel reads. Always present.
   */
  mcp: boolean;
  /**
   * `true` when the BFF is running from a local checkout of the
   * `skill-map` repo (detected via the helper's own filesystem path,
   * see `src/kernel/util/dev-mode.ts`). Omitted from the wire shape
   * when `false` so a published install carries no extra noise; the
   * SPA branches on presence and renders a `dev` chip in the topbar.
   */
  dev?: true;
}

/**
 * `/api/mcp/status` response (mirrors the BFF's live MCP-session probe).
 * `enabled` is whether skill-map exposes `/mcp` (the `mcp.server.enabled`
 * preference); `connected` is TRUE when at least one client is currently
 * connected to `/mcp` (scope-agnostic, any live MCP session); `clients`
 * is the live session count.
 */
export interface IMcpStatusApi {
  enabled: boolean;
  connected: boolean;
  clients: number;
  /**
   * The endpoint a client registers (e.g. `http://127.0.0.1:4242/mcp`),
   * built by the server from its OWN bind. Authoritative: the page origin
   * is NOT a substitute, because under the dev setup the SPA is served by a
   * separate dev server that proxies `/api`, so its origin names the proxy's
   * port instead of the one `/mcp` listens on. A wildcard bind is reported
   * as loopback, which is what a local agent can actually dial.
   */
  url: string;
}

/**
 * `/api/agent/presence` response, the honest "is a processing agent
 * attending this project's queue?" probe (`spec/cli-contract.md` §Serve
 * route table).
 *
 * `attending` is TRUE once a processing agent has been OBSERVED claiming
 * work since this server started. It counts BOTH claim paths, the MCP
 * `claim_job` tool and the CLI `sm jobs claim` (which pushes its
 * `job.claimed` to the server), so an agent parked on the CLI counts even
 * though it holds no MCP session.
 *
 * STICKY by design: `false` until the first observed claim, then `true`
 * for the rest of that server's lifetime. Silence never flips it back, a
 * parked agent only claims when work arrives, so a TTL would manufacture
 * false negatives. This is why it replaced the live MCP session count as
 * the inspector's "nothing will drain the queue" signal.
 */
export interface IAgentPresenceApi {
  schemaVersion: string;
  kind: 'agent-presence';
  /** A claim has been observed since this server booted (sticky). */
  attending: boolean;
  /** Epoch ms of the most recent observed claim; `null` before the first. */
  lastClaimAt: number | null;
}

/**
 * `/api/update-status` response (mirrors
 * `src/server/routes/update-status.ts:IUpdateStatusResponse`). The
 * endpoint always returns 200; `isOutdated: true` is the only signal
 * the UI uses to surface the topbar "update available" chip.
 */
export interface IUpdateStatusResponseApi {
  /** CLI version this server is running. */
  current: string;
  /** Last `latestVersion` recorded by the CLI's post-run hook, or `null`. */
  latest: string | null;
  /** True iff `latest` is set AND `latest > current`. */
  isOutdated: boolean;
  /** Epoch ms of the last successful registry probe, or `null`. */
  checkedAt: number | null;
  /** Epoch ms of the last banner emission, or `null`. */
  shownAt: number | null;
}

/**
 * Per-machine preferences envelope returned by `GET /api/preferences`
 * and persisted via `PATCH /api/preferences`. Both sub-keys live in
 * `~/.skill-map/settings.json` (the documented `$HOME`-reads
 * exception); the wire shape is intentionally extensible, new
 * per-machine settings (locale, theme) land as additional optional
 * sub-keys under their own namespace.
 *
 *   - `updateCheck.enabled`: npm update-check toggle.
 *   - `telemetry.errorsEnabled` / `usageCliEnabled` / `usageUiEnabled`:
 *     the three opt-in telemetry toggles (`spec/telemetry.md`). All OFF by
 *     default; each is independently togglable in the Settings General
 *     section after first run.
 *   - `telemetry.anonymousId`: read-only PostHog `distinct_id` shared by CLI
 *     and UI usage. `null` until usage is first enabled; never patchable.
 */
export interface IPreferencesApi {
  updateCheck: {
    enabled: boolean;
  };
  telemetry: {
    errorsEnabled: boolean;
    usageCliEnabled: boolean;
    usageUiEnabled: boolean;
    anonymousId: string | null;
    /** `dev` for dev / dogfooding runs, `prod` otherwise. */
    environment: 'dev' | 'prod';
  };
}

/**
 * Patch shape for `PATCH /api/preferences`. Every sub-key is optional
 * so a client that wants to flip just one preference can omit the
 * rest. The BFF rejects an entirely-empty body so a typoed key never
 * silently no-ops.
 */
export interface IPreferencesPatchApi {
  updateCheck?: {
    enabled?: boolean;
  };
  telemetry?: {
    errorsEnabled?: boolean;
    usageCliEnabled?: boolean;
    usageUiEnabled?: boolean;
  };
}

/**
 * Project-scope preferences envelope returned by
 * `GET /api/project-preferences`. Today carries the privacy-
 * sensitive `scan.referencePaths` key; shape extends additively as
 * more project-scope settings land.
 */
export interface IProjectPreferencesApi {
  /**
   * Committed (team-shared) project policy. When `false`, every
   * sidecar-writing extension is disabled and `.sm` writes are refused.
   * Default `true`.
   */
  allowSidecarWriters: boolean;
  scan: {
    referencePaths: readonly string[];
    /**
     * Project-local opt-in: when `true`, the scanner follows symbolic
     * links whose target escapes the project root (a security opt-in).
     * Default `false`. Surface-expanding (it re-enables reading
     * out-of-tree files), so flipping it ON goes through the same
     * `confirm-required` (412) gate as `scan.referencePaths`. Persisted
     * in `settings.local.json` (project-local only, never committed).
     */
    followExternalSymlinks: boolean;
    /**
     * Committed (team-shared) policy: when `true`, the project root
     * `.gitignore` participates in the scan's ignore stack. Default
     * `false` (a fresh project does not read `.gitignore`). Written to
     * the committed `settings.json` like `allowSidecarWriters`; not
     * surface-expanding, so no confirm gate. The BFF always emits a
     * concrete boolean.
     */
    respectGitignore: boolean;
  };
  /**
   * Project-local UI preference: which topbar reminder message is shown
   * to a first-time user, advanced one step at a time by its dismiss
   * button. `0` (default): the Quick Start nudge. `1`: the `sm tutorial`
   * nudge. `2`: fully dismissed. Optional only to tolerate an older BFF
   * envelope that predates it; the current BFF always emits a concrete
   * integer.
   */
  tutorialReminderStep?: number;
  /**
   * Project-local web-UI preferences (Settings > General), persisted per
   * checkout in `settings.local.json`. `liveUpdates`: keep the map in sync
   * with `sm serve` (default `true`). `realtimeActivity`: light up
   * executing nodes (default `true`, subordinate to `liveUpdates`).
   * Optional only to tolerate an older BFF envelope that predates it.
   */
  ui?: {
    liveUpdates: boolean;
    realtimeActivity: boolean;
  };
  /**
   * Project-local opt-in for the MCP server (`mcp.server.enabled`).
   * When `true`, `sm serve` mounts the MCP endpoint at `/mcp` (map reads plus
   * the queue + findings tools). Default `false`. The mount happens at serve boot, so a change
   * only takes effect on the next `sm serve` restart. Optional only to
   * tolerate an older BFF envelope that predates it; the current BFF always
   * emits a concrete boolean.
   */
  mcpServerEnabled?: boolean;
}

/**
 * Patch shape for `PATCH /api/project-preferences`. Sub-keys are
 * optional. Writes that EXPAND the scan's disk-access surface
 * (adding out-of-project paths) require `confirm: true` in the body
 *, the BFF rejects with 412 `confirm-required` otherwise and lists
 * the paths the client would expose so the UI can show a confirm
 * dialog.
 */
export interface IProjectPreferencesPatchApi {
  confirm?: boolean;
  /** Flip the committed sidecar-writer policy (team-shared). */
  allowSidecarWriters?: boolean;
  scan?: {
    referencePaths?: string[];
    /**
     * Flip the project-local follow-external-symlinks opt-in. Setting it
     * `true` EXPANDS the scan's disk-access surface (it re-enables
     * following links that escape the project root), so it requires
     * `confirm: true` in the body; the BFF rejects with 412
     * `confirm-required` otherwise. Setting it `false` narrows the
     * surface and needs no confirm.
     */
    followExternalSymlinks?: boolean;
    /** Flip the committed `.gitignore` opt-in (team-shared). No confirm gate. */
    respectGitignore?: boolean;
  };
  /** Advance (or restore) the topbar tutorial reminder step (project-local). */
  tutorialReminderStep?: number;
  /** Flip the project-local web-UI live-channel preferences. No confirm gate. */
  ui?: {
    liveUpdates?: boolean;
    realtimeActivity?: boolean;
  };
  /**
   * Flip the project-local read-only MCP server opt-in (`mcp.server.enabled`).
   * No confirm gate. Boot-time: the change persists immediately but the `/mcp`
   * mount only reflects it on the next `sm serve` restart.
   */
  mcpServerEnabled?: boolean;
}

/**
 * Project-scope ignore-patterns envelope returned by
 * `GET /api/project-ignore`. Backing is the project-root
 * `.skillmapignore` file (gitignore-syntax). Comments and blank
 * lines are NOT exposed on the wire; the UI shows a flat list of
 * patterns and any comment in the file is preserved on write.
 */
export interface IProjectIgnoreApi {
  patterns: readonly string[];
}

/**
 * Patch shape for `PATCH /api/project-ignore`. The replacement list
 * is canonical: every entry must be a single non-empty line with no
 * control characters, duplicates rejected after trim. Patterns
 * narrow the scan surface (they only EXCLUDE), so this route never
 * triggers the privacy / 412 confirm-required flow.
 */
export interface IProjectIgnorePatchApi {
  patterns: string[];
}

/**
 * Active provider lens envelope returned by
 * `GET /api/active-provider`. The lens selects which provider's
 * extractors / classifiers / resolution rules apply to the whole
 * project (see `spec/architecture.md` §Active Provider Lens).
 *
 *   - `activeProvider`: the resolved lens. Always a concrete provider
 *     id, never null: a vendor id, or `markdown` (the universal default
 *     view) when neither config nor a filesystem marker produced one.
 *   - `detected`: every provider id the filesystem heuristic matched
 *     against, deduped + in detection order. Empty when no markers
 *     were found (.claude/, .gemini/, .codex/, AGENTS.md, .cursor/).
 *   - `source`: where the value came from (`'config'` when persisted
 *     in settings.json, `'autodetect'` when derived from filesystem,
 *     `'default'` when no marker was present and the universal markdown
 *     lens applies, unpersisted).
 *   - `selectable`: registered-Provider ids enabled right now (the
 *     subset of `providerRegistry` eligible to become the lens). The
 *     active-lens dropdown greys out and refuses to select any entry
 *     absent from this set, so a disabled Provider can never be chosen.
 */
export interface IActiveProviderApi {
  activeProvider: string;
  detected: readonly string[];
  source: 'config' | 'autodetect' | 'default';
  selectable: readonly string[];
  /**
   * Non-null only when the filesystem-detected provider markers diverge
   * from the project's persisted `activeProviderMarkers` snapshot (e.g. a
   * `.claude/` directory appeared after the lens was pinned to
   * `opencode`). `added` lists the newly-appeared marker ids (the text the
   * drift notice surfaces), `removed` the ones that disappeared, and
   * `detected` the full current marker set. `null` when the snapshot is in
   * sync. A lens switch (`setActiveProvider`) or an explicit accept
   * (`acceptActiveProviderMarkers`) reconciles the snapshot and clears it.
   */
  markerDrift: IActiveProviderMarkerDriftApi | null;
}

/**
 * Provider-marker drift descriptor carried by `IActiveProviderApi`. All
 * three fields are marker-id lists; `added` is the one the drift notice
 * renders (the markers that newly appeared on disk).
 */
export interface IActiveProviderMarkerDriftApi {
  added: readonly string[];
  removed: readonly string[];
  detected: readonly string[];
}

/**
 * `GET /api/activity/install?provider=<id>` envelope (and the base of
 * both mutation responses); see `spec/provider-activity.md` §Install
 * management over HTTP. `supported` is `false` for providers without
 * an installable activity hook (every field then degrades);
 * `installed` requires BOTH halves (`configWired && bridgePresent`).
 */
export interface IActivityInstallStatusApi {
  provider: string;
  supported: boolean;
  installed: boolean;
  configPath: string | null;
  configWired: boolean;
  bridgePresent: boolean;
  events: number;
}

/**
 * `POST /api/activity/uninstall` response: the refreshed status plus
 * whether anything was actually removed (`false` = idempotent no-op).
 */
export interface IActivityUninstallEnvelopeApi extends IActivityInstallStatusApi {
  removed: boolean;
}

/**
 * `GET /api/agent/install?provider=<id>` envelope (and the base of
 * both mutation responses); see `spec/cli-contract.md` §HTTP API
 * (`/api/agent/*`). Probes the sm-process-jobs process skill of the ACTIVE
 * lens: `supported` is `false` (with `skillDir: null`) when the
 * Provider declares no `scaffold.skillDir` (no skill territory);
 * `stale` means the skill is installed but the CLI ships a newer
 * canonical copy, which drives the button's Update state.
 */
export interface IAgentSkillInstallStatusApi {
  provider: string;
  supported: boolean;
  skillDir: string | null;
  installed: boolean;
  stale: boolean;
}

/**
 * `POST /api/agent/install` response: the refreshed status plus the
 * three-state outcome the feedback wording branches on (`'up-to-date'`
 * = the bytes already matched, nothing was written).
 */
export interface IAgentSkillInstallEnvelopeApi extends IAgentSkillInstallStatusApi {
  outcome: 'installed' | 'updated' | 'up-to-date';
}

/**
 * `POST /api/agent/uninstall` response: the refreshed status plus
 * whether anything was actually removed (`false` = idempotent no-op).
 */
export interface IAgentSkillUninstallEnvelopeApi extends IAgentSkillInstallStatusApi {
  removed: boolean;
}

/**
 * Per-node execution stats accumulated by the BFF while `sm serve`
 * runs (`spec/provider-activity.md` §Execution stats). Ephemeral,
 * process-lifetime, reset on every server boot. The server is the
 * single source of truth: clients overwrite from the summary snapshot
 * and the WS `stats` field, never accumulate counts themselves.
 */
export interface INodeActivityStatsApi {
  count: number;
  /** Unix ms of the most recent counted start. */
  lastStartAt: number;
  /** Opaque owner key of the most recent counted start. */
  lastOwner?: string;
  /** Distinct executing contexts seen (saturating server-side). */
  distinctOwners: number;
  /**
   * OPTIONAL execution aggregates (spec §Execution stats): sums of the
   * per-run summaries reported by spawn completions (agent nodes, sync
   * spawns). `toolUses` / `tokens` sum across the contributing runs and
   * `summarizedRuns` says how many runs contributed, so consumers can
   * contextualize the sums. All three absent on nodes that never
   * received a summary (skills, markdowns, async-only agents).
   */
  toolUses?: number;
  tokens?: number;
  summarizedRuns?: number;
}

/**
 * Aggregate execution summary of one completed child run, as the
 * runtime reported it on the spawn completion (spec §capability
 * `execution` block). Sync completions only; async runs simply lack
 * it. Every field is independently optional.
 */
export interface IActivityExecutionSummaryApi {
  durationMs?: number;
  tokens?: number;
  toolUses?: number;
}

/**
 * One per-pair spawn counter (`spec/provider-activity.md` §Execution
 * stats): how many spawns crossed a directional parent-child pair.
 * Rides the summary snapshot under `pairs` and, as a bare `pairCount`,
 * every broadcast `agent.spawn` frame. Overwrite semantics, like every
 * other server-side accumulator value.
 */
export interface IActivityPairStatsApi {
  count: number;
  /** Unix ms of the most recent counted spawn of the pair. */
  lastStartAt: number;
}

/**
 * Directional pair key of the summary's `pairs` record
 * (`"<parent>>><childNodePath>"`, spec §`GET /api/activity/summary`).
 * The parent identity is `parentNodePath` for agent parents and
 * `parentOwner` (the session key) for session parents, mirroring the
 * server accumulator. The graph view's `edgePairKey` delegates here so
 * the wire convention has a single source.
 */
export function activityPairKeyOf(parent: string, child: string): string {
  return `${parent}>>${child}`;
}

/**
 * True when a pair key names `nodePath` on either side (parent or
 * child). Both identities are separator-free (spec §`GET
 * /api/activity/summary`), so a plain prefix/suffix match is exact.
 */
export function activityPairKeyTouches(key: string, nodePath: string): boolean {
  return key.startsWith(`${nodePath}>>`) || key.endsWith(`>>${nodePath}`);
}

/**
 * `GET /api/activity/summary` response, the client hydration snapshot
 * (connect, reconnect, re-enable). Stats-only by design: no live claim
 * or spawn state rides it, those rebuild from the WS stream.
 */
export interface IActivitySummaryApi {
  /** Unix ms the accumulator started counting (server boot). */
  since: number;
  nodes: Record<string, INodeActivityStatsApi>;
  /** Per-pair spawn counters, keyed via `activityPairKeyOf`. */
  pairs: Record<string, IActivityPairStatsApi>;
  /**
   * Distinct node paths with persistent AI-run history
   * (`state_executions`): the counters above reset on server restart,
   * this list does not, so Activity visibility survives a reboot.
   */
  runNodes: string[];
}

/** One entry of a node's recent-executions ring (most recent first). */
export interface IActivityRecentExecutionApi {
  at: number;
  owner: string;
  /**
   * Which tool this frame represents when the node is a tool-shaped unit
   * (e.g. the invoked MCP tool name on an `mcp://<server>` node). Absent
   * for units whose activity carries no tool identity. Shared by both
   * ends of an MCP invocation (the caller row and the target row).
   */
  detail?: string;
  /**
   * INCOMING invocation: the invoker node path, present on the invoked
   * node's own entry ("invoked by X"). Mutually exclusive with `target`.
   */
  caller?: string;
  /**
   * OUTGOING invocation: the invoked node path, present on the invoker's
   * mirrored entry ("invoked ... on Y"). Mutually exclusive with `caller`.
   */
  target?: string;
  /**
   * Invocation kind for the directional entries (those carrying
   * `caller` / `target`): `'mcp'` is a tool call (has `detail`, the
   * tool), `'read'` is a file read (has NO `detail`). Absent on a plain
   * execution of the node itself (no `caller` / `target`).
   */
  kind?: 'mcp' | 'read';
}

/**
 * One spawn record (`spec/provider-activity.md` §Conversation
 * capture). Metadata is always present; the conversation halves
 * (`prompt` / `response`) ride ONLY while the capture gate is on. An
 * async spawn's final report does not travel through hooks, so async
 * conversations carry the `prompt` half only.
 */
export interface IActivitySpawnRecordApi {
  spawnId: string;
  parentOwner: string;
  /** Absent when the spawner is a session (the main context). */
  parentNodePath?: string;
  childKind?: string;
  childName?: string;
  childNodePath?: string;
  childOwner?: string;
  /** Parent -> child content, capture gate only. */
  prompt?: string;
  /** Child -> parent content (sync spawns), capture gate only. */
  response?: string;
  startedAt: number;
  endedAt?: number;
  /** Server-owned lifecycle label (e.g. `running` / `ended`); opaque here. */
  status: string;
  /**
   * Aggregate execution summary of the child run (duration / tokens /
   * tool uses), attached on sync completions when the runtime reported
   * one. Absent on async runs and on records that never completed.
   */
  execution?: IActivityExecutionSummaryApi;
}

/**
 * One entry of a node's AI-run history (`spec/provider-activity.md`
 * §GET /api/activity/node/<pathB64>, `runs`): skill-map's own runs for
 * the node read from `state_executions`, persistent unlike the
 * ephemeral runtime stats. Newest-first, capped at 20 server-side; a
 * missing DB degrades to `runs: []`.
 */
export interface IActivityRunApi {
  executionId: string;
  /** Qualified extension id (e.g. `core/ai-redundancy-analyzer`). */
  extensionId: string;
  /** Lifecycle label from the executions table; opaque here. */
  status: string;
  model: string | null;
  durationMs: number | null;
  /** Unix ms; `null` while the run has not finished. */
  finishedAt: number | null;
  failureReason: string | null;
}

/**
 * `GET /api/activity/node/<pathB64>` response: per-node detail for the
 * inspector's Activity section. A scanned node with no recorded
 * activity returns empty stats, not 404.
 */
export interface IActivityNodeDetailApi {
  stats: INodeActivityStatsApi;
  recent: IActivityRecentExecutionApi[];
  /** Spawn records touching the node (as parent or child). */
  spawns: IActivitySpawnRecordApi[];
  captureEnabled: boolean;
  /**
   * The OTHER provenance the Activity timeline interleaves (user
   * decision 2026-07-17): persistent AI-run history for the node.
   */
  runs: IActivityRunApi[];
}

/**
 * `GET /api/activity/spawns/<spawnId>` response (the edge-click
 * surface): one record plus the capture gate state, which rides the
 * response either way so the dialog can explain a metadata-only view.
 */
export interface IActivitySpawnDetailApi extends IActivitySpawnRecordApi {
  captureEnabled: boolean;
}

/**
 * `GET|POST /api/activity/capture` envelope. The POST body adds
 * `{ enabled, confirm }`; without `confirm: true` the server refuses
 * with 412 `confirm-required` and changes nothing.
 */
export interface IActivityCaptureStatusApi {
  enabled: boolean;
}

/**
 * Body shape for `PUT /api/active-provider`. Switching the lens
 * triggers an atomic drop of the scan_* DB zone server-side (see
 * `spec/db-schema.md` §Active-provider lens change), the response
 * envelope's `switch.dropped` field reports what was cleared so the
 * UI can prompt for a re-scan.
 */
export interface IActiveProviderPatchApi {
  activeProvider: string;
}

/**
 * Extended envelope returned by `PUT /api/active-provider`, the base
 * `IActiveProviderApi` plus a `switch` object describing the
 * destructive side effect that fired alongside the write. `dropped`
 * is `null` when no DB file existed yet (fresh project that has
 * never run `sm scan`).
 */
export interface IActiveProviderPutEnvelopeApi extends IActiveProviderApi {
  switch: {
    dropped: { tableCount: number; tableNames: readonly string[] } | null;
  };
}

/**
 * BFF error envelope shape returned on any 4xx/5xx.
 */
/**
 * Successful 200 envelope returned by `POST /api/sidecar/bump`.
 * Mirrors `src/server/routes/sidecar.ts:ISidecarBumpedEnvelope`.
 */
export interface ISidecarBumpedEnvelopeApi {
  schemaVersion: '1';
  kind: 'sidecar.bumped';
  value: {
    nodePath: string;
    version: number | null;
    status: 'fresh';
  };
  elapsedMs: number;
}

/**
 * Successful 200 envelope returned by `POST /api/actions/:qualifiedId`
 * (the generic action-dispatch endpoint that generalised the dedicated
 * `/api/sidecar/bump`). Mirrors the BFF's `action.applied` envelope.
 * The matching WS event (`type: 'action.applied'`) carries the same
 * `value` so the in-memory node store updates via the loader's
 * subscription rather than a manual patch here.
 */
export interface IActionAppliedEnvelopeApi {
  schemaVersion: '1';
  kind: 'action.applied';
  value: {
    actionId: string;
    nodePath: string;
    /** Action-defined result payload (per the action's report schema). */
    report?: unknown;
  };
  elapsedMs: number;
}

/**
 * One `state_findings` row as projected by `GET /api/nodes/:pathB64/findings`
 * (Step 16 piece 1). Mirrors the finding-row item locked in
 * `spec/schemas/api/rest-envelope.schema.json` (the `sm findings --json`
 * row shape plus the derived `stale` boolean; the internal
 * `bodyHashAtGeneration` is never exposed).
 */
export interface IFindingApi {
  /** `state_findings.id`, the handle for `sm findings resolve/dismiss`. */
  id: number;
  nodeId: string;
  extensionId: string;
  extensionVersion: string;
  /**
   * Who AUTHORED the judgment this row carries, which is not always who
   * `extensionId` names:
   * - `extension`: the finder lane, the named extension's own verdict.
   * - `kernel`: the safety lane, synthesized by the kernel from the
   *   `safety` block any probabilistic report carries (reserved slugs
   *   `injection-detected` / `content-suspicious` / `content-malformed`).
   *   Here `extensionId` names the RUN that surfaced it (whatever
   *   extension happened to be reading the node), NOT the author of the
   *   judgment, so the UI must mark these rows or the operator reads
   *   them as that extension's own finding.
   */
  origin: 'extension' | 'kernel';
  type: string;
  severity: TIssueSeverityApi;
  message: string;
  detail: string | null;
  /** AI-action confidence in `[0, 1]`. */
  confidence: number;
  /** Recording agent's self-reported model id; `null` when undeclared. */
  model: string | null;
  /** Lifecycle state; `null` = open (`db-schema.md` §state_findings). */
  resolution: 'fixed' | 'human-decision' | 'dismissed' | null;
  resolutionActor: 'human' | 'fixer' | null;
  resolutionNote: string | null;
  resolutionBy: string | null;
  resolutionAt: number | null;
  /** Derived: the node body changed since the AI action (or left the scan). */
  stale: boolean;
  generatedAt: number;
  jobId: string | null;
}

/**
 * `counts` block of the `findings` envelope: the list pair plus the
 * REQUIRED default-view honesty pair (`dismissedExcluded` /
 * `fixedExcluded`, what the default view held back; dismissed = the
 * class matches an active sidecar suppression, top precedence; both 0
 * under an explicit bucket filter, mirroring `sm findings --json`).
 * Stale rows are never held back: they ride `items` inline with their
 * per-row `stale` flag (user call 2026-07-20).
 */
export interface IFindingsCountsApi extends IEnvelopeCountsApi {
  dismissedExcluded: number;
  fixedExcluded: number;
}

/**
 * `GET /api/nodes/:pathB64/findings` response (kind `findings`), the
 * per-node AI-actions tray. List shape with the honesty counts delta.
 */
export interface IFindingsEnvelopeApi {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'findings';
  items: IFindingApi[];
  filters: Record<string, unknown>;
  counts: IFindingsCountsApi;
  kindRegistry: IKindRegistryApi;
  providerRegistry?: IProviderRegistryApi;
  contributionsRegistry?: IContributionsRegistryApi;
}

/** Live queue state for a (node, extension) pair, from `state_jobs`. */
export type TProbExtensionStateApi = 'idle' | 'queued' | 'running';

/**
 * One launcher entry of the `node.prob-extensions` catalog (the
 * inspector's two-state finder buttons). Mirrors
 * `rest-envelope.schema.json#/$defs/ProbExtensionEntry`. `fixerIds` is
 * the finder's matching fixers (non-empty ONLY on `finders`-bucket
 * entries; empty for `standalone`) and `hasOpenFindings` drives the
 * Detect ⇄ Fix morph.
 */
export interface IProbExtensionEntryApi {
  /** Qualified extension id (`<plugin>/<extension>`), the submit target. */
  id: string;
  /** Manifest `description`, rendered as the launcher tooltip. */
  description: string;
  state: TProbExtensionStateApi;
  /**
   * The ACTIVE queued/running job's id, `null` when idle. The
   * server-confirmed handle the stop/restart affordance cancels via
   * `POST /api/jobs/:jobId/cancel`.
   */
  jobId: string | null;
  /** Latest recorded execution for the pair; `null` when never judged. */
  lastJudged: { at: number; model: string | null } | null;
  /**
   * Qualified ids of the fixer Actions whose `precondition.analyzerIds`
   * name this finder (the inverse Modelo B lookup). Non-empty ONLY on
   * `finders`-bucket entries; empty for `standalone`. In manual mode the
   * button's Fix state submits each of these; in automatic mode the
   * finder is submitted with `autoFix: true` and the kernel chains them.
   */
  fixerIds: string[];
  /**
   * True when the node currently carries at least one UNRESOLVED,
   * non-stale finding emitted by THIS finder's extension id. Drives the
   * two-state button: `false` → Detect state (submit the finder), `true`
   * → Fix state (submit the `fixerIds`). Always `false` for `standalone`.
   */
  hasOpenFindings: boolean;
  /**
   * Frozen finding targets of the ACTIVE fixer jobs for this finder:
   * `all: true` when a whole-node fixer job is active, `findingIds` the
   * union of the active subset jobs' ids. The tray derives each row's
   * fix-button busy state from it so fixing one finding no longer spins
   * every row. `null` when no fixer job is active.
   */
  fixerBusy: { all: boolean; findingIds: number[] } | null;
}

/**
 * One `issueFixers` entry: a probabilistic Action fixing a
 * DETERMINISTIC analyzer's issues (e.g. `core/ai-reference-action` over
 * `core/reference-broken`), listed only while the node carries at least
 * one matching open Issue. Rendered as a fix button ON each matching
 * deterministic issue row (matched via the SHORT `analyzerIds`), never
 * as a launcher button (user decision 2026-07-22). One submit fixes
 * every matching issue of the node, so all matching rows share the
 * entry's busy state.
 */
export interface IIssueFixerEntryApi {
  /** Qualified action id, the submit target. */
  id: string;
  /** Manifest `description`, rendered as the fix button's tooltip. */
  description: string;
  state: TProbExtensionStateApi;
  /** The ACTIVE queued/running job's id, `null` when idle. */
  jobId: string | null;
  /** Latest recorded execution for the pair; `null` when never judged. */
  lastJudged: { at: number; model: string | null } | null;
  /**
   * SHORT analyzer ids (as persisted on `scan_issues.analyzerId`): the
   * row-match key against each issue's `analyzerId`.
   */
  analyzerIds: string[];
}

/**
 * The `item` of the `node.prob-extensions` envelope: the node's
 * probabilistic launcher catalog, classified manifest-mechanically
 * (ROADMAP §Step 16). `finders` are probabilistic Analyzers matching the
 * node that HAVE at least one fixer (rendered as two-state Detect ⇄ Fix
 * buttons); `standalone` are finders WITHOUT a fixer plus probabilistic
 * Actions with no `analyzerIds` (single-action buttons); `issueFixers`
 * are deterministic-analyzer fixers rendered on the matching issue rows.
 * The former `fixers` bucket is retired: a fixer paired with a
 * probabilistic finder is the second state of its finder's button,
 * never a standalone launcher.
 */
export interface IProbExtensionsApi {
  finders: IProbExtensionEntryApi[];
  standalone: IProbExtensionEntryApi[];
  issueFixers: IIssueFixerEntryApi[];
}

/**
 * `GET /api/nodes/:pathB64/prob-extensions` response
 * (kind `node.prob-extensions`), single shape.
 */
export interface INodeProbExtensionsEnvelopeApi {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'node.prob-extensions';
  item: IProbExtensionsApi;
  kindRegistry: IKindRegistryApi;
  providerRegistry?: IProviderRegistryApi;
  contributionsRegistry?: IContributionsRegistryApi;
}

/**
 * Successful 200 envelope returned by `POST /api/nodes/:pathB64/jobs`
 * (kind `job.submitted`, action-result shape like `sidecar.bumped`).
 * NO nonce ever travels here: the record credential belongs to the
 * processing agent (`sm jobs claim --json`).
 */
export interface IJobSubmittedEnvelopeApi {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'job.submitted';
  value: {
    jobId: string;
    nodePath: string;
    /** The qualified id the submit resolved to (may differ from the bare request id). */
    extensionId: string;
    /** Stale queued sibling ids a FIXER submit cancelled in the same transaction. */
    supersededIds: string[];
  };
  elapsedMs: number;
}

/**
 * Queue job lifecycle state, mirror of the kernel's `JobStatus`
 * (`src/kernel/types.ts`). The queue inspector tints / glyphs each state:
 * `queued` / `running` are non-terminal (cancellable); `completed` /
 * `failed` / `cancelled` are terminal.
 */
export type TJobStatusApi = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * One `state_jobs` row as projected by `GET /api/jobs` (`kind: 'jobs'`).
 * Mirror of the BFF's `PublicJob` (`src/kernel/jobs/public-job.ts`): every
 * `Job` field EXCEPT the record credential `nonce`, which never crosses a
 * read surface. Timestamps are Unix ms.
 */
export interface IJobApi {
  /** `d-YYYYMMDD-HHMMSS-XXXX`, human-readable + sortable. */
  id: string;
  extensionId: string;
  extensionVersion: string;
  /** `action` | `analyzer`, frozen at submit. */
  extensionKind: string;
  /** Per-job auto-fix opt-in (a finder job chains its fixers on completion). */
  autoFix: boolean;
  /** Target `node.path`. */
  nodeId: string;
  contentHash: string;
  priority: number;
  status: TJobStatusApi;
  /** Populated on a failed job; `null` otherwise. */
  failureReason: string | null;
  /** `agent` | `in-process`; `null` until claimed. */
  runner: string | null;
  /** Optional TTL in seconds; `null` = never expires (the default). */
  ttlSeconds: number | null;
  createdAt: number;
  /** `null` until a processing agent claims the job. */
  claimedAt: number | null;
  /** `null` until the job reaches a terminal state. */
  finishedAt: number | null;
  /** Reaper deadline; `null` when the job never expires. */
  expiresAt: number | null;
  /** Free-form submitter tag; `null` when unset. */
  submittedBy: string | null;
}

/**
 * Registry-less `GET /api/jobs` list envelope (`kind: 'jobs'`). Mirror of
 * the BFF's `IJobsEnvelope` (`src/server/envelope.ts`): unlike the other
 * list envelopes it carries NO kind / provider / contributions registries
 * (a queue projection is orthogonal to those catalogs). The endpoint does
 * not paginate, so `counts.total` equals `counts.returned`.
 */
export interface IJobsEnvelopeApi<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'jobs';
  items: TItem[];
  /** Echo of the applied filters (`status` / `extension` / `node`). */
  filters: Record<string, unknown>;
  counts: { total: number; returned: number };
}

/**
 * One registered annotation contribution declared by a plugin manifest
 * and surfaced by `GET /api/annotations/registered`. Mirror of the
 * kernel's `IRegisteredAnnotationKey`.
 */
export interface IRegisteredAnnotationKeyApi {
  pluginId: string;
  key: string;
  location: 'namespaced' | 'root';
  ownership: 'exclusive' | 'shared';
  schema: Record<string, unknown>;
}

/**
 * `/api/annotations/registered` response envelope.
 */
export interface IRegisteredAnnotationsEnvelopeApi {
  schemaVersion: '1';
  kind: 'annotations.registered';
  items: IRegisteredAnnotationKeyApi[];
  counts: { total: number };
}

export type TErrorCodeApi =
  | 'not-found'
  | 'bad-query'
  | 'db-missing'
  | 'internal'
  | string;

export interface IErrorEnvelopeApi {
  ok: false;
  error: {
    code: TErrorCodeApi;
    message: string;
    details?: unknown;
  };
}
