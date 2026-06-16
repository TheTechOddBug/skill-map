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
   * Effective recommended cap on the number of classified nodes for
   * this scan, mirror of `scan.maxNodes` (default 256). Used by the
   * oversized banner to decide whether to surface the persistent
   * "your graph exceeds the recommended limit" notice. Absent on
   * legacy / synthetic envelopes.
   */
  recommendedNodeLimit?: number;
  /**
   * Per-invocation override applied via `--max-nodes <N>` on the verb
   * that ran this scan, or `null` when no override was passed. The
   * banner uses it to phrase the body copy ("running with `--max-nodes
   * 1000`" vs "default `scan.maxNodes`").
   */
  overrideMaxNodes?: number | null;
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
 * `ProjectConfig` from `project-config.schema.json`. Shape is open at the
 * UI boundary today, the SPA reads only the fields it needs and treats
 * unknowns as inert.
 */
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
  | 'scan';

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
  /** Suppress the per-card chip (universal `markdown` fallback). */
  hideChip?: boolean;
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
  /** Host-enforced lock (BFF `src/server/locked-plugins.ts`). When true,
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
   * `true` when the BFF is running from a local checkout of the
   * `skill-map` repo (detected via the helper's own filesystem path,
   * see `src/kernel/util/dev-mode.ts`). Omitted from the wire shape
   * when `false` so a published install carries no extra noise; the
   * SPA branches on presence and renders a `dev` chip in the topbar.
   */
  dev?: true;
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
  };
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
  };
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
 *   - `activeProvider`: persisted value (or null when neither config
 *     nor auto-detect produced one).
 *   - `detected`: every provider id the filesystem heuristic matched
 *     against, deduped + in detection order. Empty when no markers
 *     were found (.claude/, .gemini/, .codex/, AGENTS.md, .cursor/).
 *   - `source`: where the value came from (`'config'` when persisted
 *     in settings.json, `'autodetect'` when derived from filesystem,
 *     `'none'` when neither source produced a value).
 *   - `selectable`: registered-Provider ids enabled right now (the
 *     subset of `providerRegistry` eligible to become the lens). The
 *     active-lens dropdown greys out and refuses to select any entry
 *     absent from this set, so a disabled Provider can never be chosen.
 */
export interface IActiveProviderApi {
  activeProvider: string | null;
  detected: readonly string[];
  source: 'config' | 'autodetect' | 'none';
  selectable: readonly string[];
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
