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
export type TLinkKindApi = 'invokes' | 'references' | 'mentions' | 'supersedes';
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
  };
}

/**
 * `ProjectConfig` from `project-config.schema.json`. Shape is open at the
 * UI boundary today, the SPA reads only the fields it needs and treats
 * unknowns as inert.
 */
export interface IProjectConfigApi {
  schemaVersion?: number;
  autoMigrate?: boolean;
  tokenizer?: string;
  providers?: string[];
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

export interface IPluginExtensionApi {
  id: string;
  kind: string;
  version: string;
  enabled: boolean;
  /** Per-extension manifest description. Surfaced as muted secondary
   *  text in Settings; included in the substring search. */
  description?: string;
  /** Host-enforced lock (BFF `src/server/locked-plugins.ts`). When true,
   *  Settings renders the toggle disabled with a "locked" tag and the
   *  PATCH route returns 403. */
  locked?: boolean;
}

export interface IPluginItemApi {
  id: string;
  version: string | null;
  kinds: string[];
  status: TPluginStatusApi;
  reason: string | null;
  source: TPluginSourceApi;
  /** Bundle-level manifest description. Surfaced as muted secondary
   *  text in Settings; included in the substring search. */
  description?: string;
  /** Present whenever the bundle declares any extension AND the plugin
   *  loaded. Every extension is independently toggle-able; the bundle
   *  itself is a presentational grouping. */
  extensions?: IPluginExtensionApi[];
  /** Host-enforced lock at the bundle level (mirrors the BFF
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
 */
export interface IActiveProviderApi {
  activeProvider: string | null;
  detected: readonly string[];
  source: 'config' | 'autodetect' | 'none';
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
