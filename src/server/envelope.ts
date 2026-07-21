/**
 * REST envelope shapes for `/api/*` responses.
 *
 * Two response shapes coexist:
 *
 *   1. **List envelope**, used by `/api/nodes`, `/api/links`, `/api/issues`,
 *      `/api/plugins`. Carries an `items` array, the `filters` echoed back
 *      to help the client correlate the response with the request, and
 *      `counts` for pagination / totals.
 *
 *   2. **Single-resource envelope**, used by `/api/nodes/:pathB64` and
 *      `/api/config`. Carries either `item` (the resource) or `value`
 *      (a config object).
 *
 * The `/api/scan` response is exempt, it returns a `ScanResult` shape
 * 1:1 with `scan-result.schema.json` (byte-equal to `sm scan --json`).
 * Wrapping it in an envelope would break that contract. The `/api/graph`
 * response is also exempt, it returns the formatter's native output
 * directly (text/plain or text/markdown), with the JSON formatter shape
 * left to the formatter itself.
 *
 * `schemaVersion` is hardcoded to `'1'` and tracks the spec's
 * `rest-envelope.schema.json#/properties/schemaVersion/const`. Step
 * 14.5.d adds the required `kindRegistry` field on every payload-bearing
 * envelope (so the UI can render Provider-declared kinds without
 * hardcoding a closed kind enum) but does NOT bump the version, the
 * BFF is greenfield, no released consumers depend on the previous
 * shape, so a versioned migration buys nothing.
 */

import type { TProviderKindIcon } from '../kernel/extensions/index.js';

export const REST_ENVELOPE_SCHEMA_VERSION = '1';

/**
 * `kind` discriminator. Each route picks the kind matching its resource
 * shape so the SPA can branch on a single field instead of inferring
 * from URL or HTTP status.
 */
export type TEnvelopeKind =
  | 'nodes'
  | 'links'
  | 'issues'
  | 'plugins'
  | 'config'
  // `/api/config/resolution`, the settings-hierarchy viewer's flattened
  // effective config with per-key layer provenance (value shape).
  | 'config.resolution'
  | 'graph'
  | 'node'
  | 'health'
  | 'scan'
  // `/api/folders`, lightweight full-corpus projection (one item per
  // scanned node, `{ path, kind, errorCount, warnCount }`). `/api/branch`
  // is exempt from the envelope (direct shape, like `/api/scan`), so its
  // `kind: 'branch'` discriminator is NOT a `TEnvelopeKind`.
  | 'folders'
  // Step 16 piece 1 (the findings workbench, inspector half):
  //   - `findings`, list shape from `GET /api/nodes/:pathB64/findings`
  //     (`counts` additionally carries the `dismissedExcluded` /
  //     `fixedExcluded` honesty pair).
  //   - `node.prob-extensions`, single shape from
  //     `GET /api/nodes/:pathB64/prob-extensions` (the launcher catalog).
  //   - `job.submitted`, action-result shape from
  //     `POST /api/nodes/:pathB64/jobs` (`value` + `elapsedMs`, no
  //     registries; built locally by `routes/node-jobs.ts` like
  //     `action.applied`).
  | 'findings'
  | 'node.prob-extensions'
  | 'job.submitted'
  // Cross-corpus job-queue list from `GET /api/jobs` (read side of the UI
  // queue inspector). A registry-less list shape: the queue projection is
  // orthogonal to the kind / provider / contribution catalogs (like the
  // action-result and catalog envelopes), so it embeds none of them and the
  // route serving it keeps a narrow deps bag (dbPath only). Built by
  // `buildJobsEnvelope` below.
  | 'jobs';

export interface IPageInfo {
  offset: number;
  limit: number;
}

export interface IEnvelopeCounts {
  /** Total rows after filtering, before pagination is applied. */
  total: number;
  /** Rows actually carried in `items` (≤ `limit`). */
  returned: number;
  /** Pagination window. Present only when the endpoint paginates. */
  page?: IPageInfo;
  /**
   * Findings the default view held back as DISMISSED (their class matches
   * an active sidecar suppression, top precedence). REQUIRED on
   * `kind: 'findings'` envelopes, absent elsewhere; always 0 under an
   * explicit bucket filter (`rest-envelope.schema.json`).
   */
  dismissedExcluded?: number;
  /**
   * Findings the default view held back as `fixed` (a fixed+stale row
   * counts here; a suppressed one counts as dismissed). Same presence
   * rules.
   */
  fixedExcluded?: number;
}

/**
 * Per-provider visuals for one kind contribution. Mirrors the wire
 * shape from `spec/schemas/api/rest-envelope.schema.json#/properties/kindRegistry/additionalProperties/properties/providers/additionalProperties`.
 */
export interface IKindRegistryProviderUi {
  label: string;
  color: string;
  colorDark?: string;
  emoji?: string;
  icon?: TProviderKindIcon;
}

/**
 * One entry in the kindRegistry, keyed by kind name. Carries
 * contributions from every Provider that declared the same kind name;
 * `primaryProviderId` points at the one whose visuals drive the kind's
 * primary CSS var (`--sm-kind-<kind>`). The kernel separately surfaces
 * `provider-ambiguous` issues when two Providers also matched the same
 * file; the registry stays coherent during the conflict window so the
 * UI keeps rendering.
 */
export interface IKindRegistryEntry {
  primaryProviderId: string;
  providers: Record<string, IKindRegistryProviderUi>;
}

/**
 * Catalog of kinds active in the current scope, keyed by kind name.
 * Built once per server boot from every enabled Provider's `kinds` map
 * and embedded into every payload-bearing envelope so the UI can render
 * kind tags / palette swatches / graph nodes against Provider-declared
 * visuals without ever hardcoding a closed kind enum.
 */
export type TKindRegistry = Record<string, IKindRegistryEntry>;

/**
 * One entry in the providerRegistry, keyed by Provider id. Carries the
 * Provider's OWN identity (distinct from its kinds' visuals). Mirrors
 * the wire shape from
 * `spec/schemas/api/rest-envelope.schema.json#/properties/providerRegistry/additionalProperties`.
 */
export interface IProviderRegistryEntry {
  label: string;
  color: string;
  colorDark?: string;
  emoji?: string;
  icon?: TProviderKindIcon;
  /**
   * True when this Provider is a selectable lens (projected from
   * `gatedByActiveLens`). The active-lens dropdown lists only `isLens`
   * entries; the non-gated `markdown` base is `false` and never appears
   * there. Independent of the dynamic `selectable` set (which marks which
   * lenses are enabled right now).
   */
  isLens: boolean;
  /** Suppress the per-card chip (universal `markdown` base). */
  hideChip?: boolean;
  /**
   * Name of the parsed-frontmatter field that carries this Provider's node
   * body, projected from `read.bodyField`. Present only for Providers whose
   * prompt lives inside structured frontmatter (Codex sub-agents are pure
   * TOML whose markdown prompt is `developer_instructions`). The UI renders
   * that field as the node body and omits it from the metadata dump; absent
   * for ordinary frontmatter-fence Providers.
   */
  bodyField?: string;
  /**
   * Single glyph this lens's runtime uses to invoke a skill / command,
   * projected from `presentation.invocationSigil`. The UI joins it against
   * the active lens to paint the `invokes` edge-kind glyph in the link-kind
   * palette (`/` for claude / antigravity, `$` for codex). Absent for lenses
   * with no invocation channel (`agent-skills`, `markdown`).
   */
  invocationSigil?: string;
}

/**
 * Catalog of Providers registered in the current scope, keyed by
 * Provider id. Sibling to `TKindRegistry`. Built once per server boot
 * from every registered Provider's `ui` block and embedded into every
 * payload-bearing envelope so the UI renders the active-lens dropdown,
 * the topbar lens chip, and the per-node provider chip from the real
 * Provider set instead of a hardcoded list. The dynamic active lens
 * (current value + filesystem-detected candidates) is served separately
 * by `GET /api/active-provider`.
 */
export type TProviderRegistry = Record<string, IProviderRegistryEntry>;

/**
 * Phase 3 / View contribution system, sibling to `TKindRegistry`. Every
 * payload-bearing envelope embeds it; the UI consumes it once at boot
 * to build its slot host. Keyed by qualified id
 * (`<pluginId>/<extensionId>/<contributionId>`); shape mirrors the
 * `contributionsRegistry` field in `rest-envelope.schema.json`. Built
 * by `buildContributionsRegistry(kernel)` in
 * `server/contributions-registry.ts`.
 */
export type TContributionsRegistry = Record<string, IContributionsRegistryEntry>;

export interface IContributionsRegistryEntry {
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
   * Optional ordering hint (default 100 when omitted). Slots whose
   * `order` is `'priority'` sort contributions ASC by this value with
   * alphabetical tie-break by qualified id. Mirror of
   * `IRegisteredViewContribution.priority` (kernel side); propagated to
   * the UI so the slot host can apply the manifest-declared order
   * without a second round-trip. Authored in
   * `server/contributions-registry.ts:entryFromRegistered`.
   */
  priority?: number;
  /**
   * Inspector-only ordering hint, denormalised from the owning plugin's
   * `plugin.json` `order` (default 100). Orders the per-plugin inspector
   * body sections. Same value on every contribution of a plugin.
   */
  pluginOrder?: number;
  /**
   * Inspector-only ordering hint, denormalised from the owning
   * extension's `order` (default 100). Orders the bricks within a
   * plugin's inspector section. Same value on every contribution of an
   * extension.
   */
  extensionOrder?: number;
}

export interface IListEnvelope<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKind;
  items: TItem[];
  /** Echo of the filters the server applied (URL params normalized). */
  filters: Record<string, unknown>;
  counts: IEnvelopeCounts;
  kindRegistry: TKindRegistry;
  providerRegistry: TProviderRegistry;
  contributionsRegistry: TContributionsRegistry;
}

/**
 * Registry-less list envelope for `GET /api/jobs` (`kind: 'jobs'`). Unlike
 * `IListEnvelope`, it carries no kind / provider / contribution registries:
 * a job-queue projection is orthogonal to those catalogs (same rationale as
 * the action-result and annotation / contribution catalog variants in
 * `rest-envelope.schema.json`), and dropping them lets the route stay on a
 * narrow deps bag. The endpoint does not paginate, so `counts.total` equals
 * `counts.returned` equals `items.length`.
 */
export interface IJobsEnvelope<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'jobs';
  items: TItem[];
  /** Echo of the applied filters (`status` / `extension` / `node`). */
  filters: Record<string, unknown>;
  counts: { total: number; returned: number };
}

export interface ISingleEnvelope<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKind;
  item: TItem;
  kindRegistry: TKindRegistry;
  providerRegistry: TProviderRegistry;
  contributionsRegistry: TContributionsRegistry;
}

export interface IValueEnvelope<TValue> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKind;
  value: TValue;
  kindRegistry: TKindRegistry;
  providerRegistry: TProviderRegistry;
  contributionsRegistry: TContributionsRegistry;
}

export interface IBuildListEnvelopeOpts<TItem> {
  kind: TEnvelopeKind;
  items: TItem[];
  filters: Record<string, unknown>;
  /**
   * Total rows after filtering, before pagination is applied. When the
   * endpoint does NOT paginate, callers pass `items.length` here, the
   * `counts.total` field stays meaningful in both modes.
   */
  total: number;
  /** Pagination window. Omit when the endpoint does not paginate. */
  page?: IPageInfo;
  /**
   * The `kind: 'findings'` honesty pair (`counts.dismissedExcluded` /
   * `counts.fixedExcluded`, REQUIRED on that kind per
   * `rest-envelope.schema.json`; stale rows ride the item list inline
   * flagged since 2026-07-20). Omit on every other kind.
   */
  excluded?: { dismissedExcluded: number; fixedExcluded: number };
  /** Active kindRegistry, every payload-bearing envelope embeds it. */
  kindRegistry: TKindRegistry;
  /** Active providerRegistry, every payload-bearing envelope embeds it. */
  providerRegistry: TProviderRegistry;
  /** Active contributionsRegistry, every payload-bearing envelope embeds it. */
  contributionsRegistry: TContributionsRegistry;
}

/**
 * Build the canonical list envelope for `/api/{nodes,links,issues,plugins}`.
 * `counts.returned` is derived from `items.length` so a caller can't drift
 * the two values apart by accident.
 */
export function buildListEnvelope<TItem>(opts: IBuildListEnvelopeOpts<TItem>): IListEnvelope<TItem> {
  const counts: IEnvelopeCounts = {
    total: opts.total,
    returned: opts.items.length,
  };
  if (opts.page) counts.page = opts.page;
  if (opts.excluded) {
    counts.dismissedExcluded = opts.excluded.dismissedExcluded;
    counts.fixedExcluded = opts.excluded.fixedExcluded;
  }
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind: opts.kind,
    items: opts.items,
    filters: opts.filters,
    counts,
    kindRegistry: opts.kindRegistry,
    providerRegistry: opts.providerRegistry,
    contributionsRegistry: opts.contributionsRegistry,
  };
}

/**
 * Build the registry-less `kind: 'jobs'` list envelope for `GET /api/jobs`.
 * `counts.total` / `counts.returned` are both derived from `items.length`
 * (the endpoint does not paginate) so a caller cannot drift them apart.
 */
export function buildJobsEnvelope<TItem>(
  items: TItem[],
  filters: Record<string, unknown>,
): IJobsEnvelope<TItem> {
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind: 'jobs',
    items,
    filters,
    counts: { total: items.length, returned: items.length },
  };
}

/**
 * Build a single-resource envelope. Used for `/api/nodes/:pathB64`
 * (kind: `'node'`).
 */
export function buildSingleEnvelope<TItem>(
  kind: TEnvelopeKind,
  item: TItem,
  kindRegistry: TKindRegistry,
  providerRegistry: TProviderRegistry,
  contributionsRegistry: TContributionsRegistry,
): ISingleEnvelope<TItem> {
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind,
    item,
    kindRegistry,
    providerRegistry,
    contributionsRegistry,
  };
}

/**
 * Build a value envelope (object payload, no `item` semantics). Used for
 * `/api/config` where the resource is the config object itself.
 */
export function buildValueEnvelope<TValue>(
  kind: TEnvelopeKind,
  value: TValue,
  kindRegistry: TKindRegistry,
  providerRegistry: TProviderRegistry,
  contributionsRegistry: TContributionsRegistry,
): IValueEnvelope<TValue> {
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind,
    value,
    kindRegistry,
    providerRegistry,
    contributionsRegistry,
  };
}
