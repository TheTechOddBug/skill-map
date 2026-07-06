/**
 * `StaticDataSource`, `IDataSourcePort` implementation that reads a
 * pre-baked snapshot bundled with the SPA (`web/demo/data.json` +
 * `web/demo/data.meta.json`). Wired by the factory when the runtime mode
 * is `'demo'`.
 *
 * Two assets are fetched lazily on first request:
 *
 *   - `data.json`      , full `ScanResult` (1:1 with `scan-result.schema.json`).
 *                         Used for `loadScan()`, `getNode()`, and on-the-fly
 *                         filtering when a list query carries non-default filters.
 *   - `data.meta.json` , pre-derived per-endpoint envelopes mirroring the
 *                         BFF route shapes (`nodes`/`links`/`issues`/`config`/
 *                         `plugins` list envelopes, `health` snapshot, ASCII
 *                         graph). The fast path: list queries with no filters
 *                         return the pre-derived envelope verbatim, no
 *                         re-running of the kernel filter grammar in the browser.
 *
 * Both files are fetched relative to the document base href (Angular's
 * `<base href="/demo/">` in the demo build), via a global `fetch()` so
 * the data layer doesn't depend on Angular's `HttpClient` interceptor
 * stack, the static demo never goes through `/api/*` in the first place.
 *
 * **Filter semantics**:
 *   - "No filters" list queries return the pre-derived envelope verbatim.
 *   - "Filtered" list queries derive a fresh envelope from `data.json`
 *     in the browser. The fixture is small (a few dozen nodes), so the
 *     cost is negligible. We deliberately do NOT re-implement the full
 *     kernel filter grammar (`parseExportQuery`) here; the supported
 *     filters cover what `RestDataSource` exposes via its query bags.
 *
 * **`events()`** returns `EMPTY`, the static bundle has no live changes,
 * mirroring the demo-mode contract documented on `IDataSourcePort`.
 */

import { inject } from '@angular/core';
import { EMPTY, type Observable } from 'rxjs';

import { DATA_SOURCE_TEXTS } from '../../i18n/data-source.texts';
import type {
  IBranchResponseApi,
  IContributionsRegistryApi,
  IFolderNodeLite,
  IHealthResponseApi,
  IIssueApi,
  ILinkApi,
  IListEnvelopeApi,
  INodeApi,
  INodeDetailApi,
  IPreferencesApi,
  IPreferencesPatchApi,
  IProjectConfigApi,
  IActiveProviderApi,
  IActivityCaptureStatusApi,
  IActivityInstallStatusApi,
  IActivityNodeDetailApi,
  IActivitySpawnDetailApi,
  IActivitySummaryApi,
  IActivityUninstallEnvelopeApi,
  IActiveProviderPutEnvelopeApi,
  IProjectIgnoreApi,
  IProjectIgnorePatchApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
  IRegisteredAnnotationKeyApi,
  IScanResultApi,
  ISidecarBumpedEnvelopeApi,
  IActionAppliedEnvelopeApi,
  IUpdateStatusResponseApi,
  IValueEnvelopeApi,
} from '../../models/api';
import type { IWsEvent } from '../../models/ws-event';
import { ContributionsRegistryService } from '../../app/services/contributions-registry';
import { KindRegistryService } from '../kind-registry';
import { ProviderRegistryService } from '../provider-registry';
import {
  DataSourceError,
  type IDataSourcePort,
  type IActionDispatchOpts,
  type IIssuesQuery,
  type ILinksQuery,
  type INodesQuery,
  type IPluginChange,
  type ISidecarBumpOpts,
  type TGraphFormat,
  type TPluginItem,
} from './data-source.port';

/**
 * Asset paths, relative to the document base. `data.json` and
 * `data.meta.json` sit next to `index.html` in the demo bundle.
 */
const DATA_JSON = 'data.json';
const META_JSON = 'data.meta.json';

/**
 * Shape of `data.meta.json`. Keys mirror the BFF route surface so the
 * derivation script + the consumer share one vocabulary.
 */
export interface IDemoMetaPayload {
  schemaVersion: '1';
  health: IHealthResponseApi;
  nodes: IListEnvelopeApi<INodeApi>;
  links: IListEnvelopeApi<ILinkApi>;
  issues: IListEnvelopeApi<IIssueApi>;
  config: IValueEnvelopeApi<IProjectConfigApi>;
  plugins: IListEnvelopeApi<TPluginItem>;
  graph: { ascii: string };
  /**
   * Built-ins-only contributions registry baked by
   * `web/scripts/build-demo-dataset.js`
   * (`buildBuiltInContributionsRegistry()` over the kernel). Drives the
   * ICON / LABEL of every view-contribution slot renderer; the per-node
   * contribution VALUE is embedded separately on each scan node. Optional
   * so an older bundle (pre-registry) still loads, the consumer treats a
   * missing registry as a no-op (slot renderers fall back to defaults).
   */
  contributionsRegistry?: IContributionsRegistryApi;
  /**
   * Active-provider envelope mirroring `GET /api/active-provider`, baked
   * from the lens the demo fixture was scanned under (Claude). Optional so
   * an older bundle (pre-lens) still loads; the consumer falls back to the
   * markdown default when absent.
   */
  activeProvider?: IActiveProviderApi;
}

/**
 * Providers shipping a live-activity adapter, mirrored for the demo's
 * baked install-status probe (kept in sync with each provider's
 * `activity.install` descriptor).
 */
const DEMO_ACTIVITY_DESCRIPTORS: Record<string, { configPath: string; events: number }> = {
  claude: { configPath: '.claude/settings.json', events: 5 },
  codex: { configPath: '.codex/hooks.json', events: 3 },
  antigravity: { configPath: '.agents/hooks.json', events: 2 },
  opencode: { configPath: '.opencode/plugin/skill-map-activity.js', events: 0 },
};

export class StaticDataSource implements IDataSourcePort {
  private metaPromise: Promise<IDemoMetaPayload> | null = null;
  private dataPromise: Promise<IScanResultApi> | null = null;
  private readonly kindRegistry: KindRegistryService;
  private readonly providerRegistry: ProviderRegistryService;
  private readonly contributionsRegistry: ContributionsRegistryService;

  /**
   * Optional fetch + registry-service overrides, exposed so spec files
   * can stub `fetch` and pass synthetic registry services without
   * depending on Angular DI. Production code leaves them undefined; the
   * constructor falls back to the platform `fetch` and the DI singletons.
   */
  constructor(
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    kindRegistry?: KindRegistryService,
    providerRegistry?: ProviderRegistryService,
    contributionsRegistry?: ContributionsRegistryService,
  ) {
    this.kindRegistry = kindRegistry ?? inject(KindRegistryService);
    this.providerRegistry = providerRegistry ?? inject(ProviderRegistryService);
    this.contributionsRegistry =
      contributionsRegistry ?? inject(ContributionsRegistryService);
  }

  async health(): Promise<IHealthResponseApi> {
    const meta = await this.loadMeta();
    return meta.health;
  }

  /**
   * Demo mode: the bundled `data.meta.json` carries the `kindRegistry`
   * inside every envelope (the build script bakes it in from the
   * Claude built-in). Loading the scan also primes the registries so the
   * SPA's first paint already has labels / colors / icons resolved.
   */
  async loadScan(): Promise<IScanResultApi> {
    const [scan, meta] = await Promise.all([this.loadData(), this.loadMeta()]);
    this.kindRegistry.ingest(meta.nodes.kindRegistry);
    this.providerRegistry.ingest(meta.nodes.providerRegistry);
    this.primeContributionsRegistry(meta);
    return scan;
  }

  /**
   * Demo mode: derive the lazy scan meta from the bundled `data.json`.
   * The live BFF strips `nodes` / `links` / `issues` on `?meta=1`; we
   * mirror that here so the header + banners read the same field shape.
   * The bundle predates the lazy fields (`scanCeiling`, `scanTruncated`,
   * `maxRenderNodes`), which stay absent, the consumers treat absent as
   * "no truncation" (the demo corpus is small, so this is correct).
   */
  async loadScanMeta(): Promise<IScanResultApi> {
    const scan = await this.loadScan();
    return { ...scan, nodes: [], links: [], issues: [] };
  }

  /**
   * Demo mode: derive the whole-corpus lite node list from `data.json`,
   * rolling up per-node error / warn issue incidence the same way the
   * live `/api/folders` route does (the `info` severity is excluded).
   * The cheap scalar node columns (`linksInCount` / `linksOutCount` /
   * `tokensTotal` / `modifiedAtMs`) come straight off each bundled node
   * so the rail's leaf data columns render real values in demo mode too;
   * `tokensTotal` / `modifiedAtMs` fall back to `null` (virtual / derived
   * nodes), mirroring the live endpoint's nullable shape.
   */
  async loadFolders(): Promise<IFolderNodeLite[]> {
    const scan = await this.loadScan();
    const errorByPath = new Map<string, number>();
    const warnByPath = new Map<string, number>();
    for (const issue of scan.issues) {
      const bucket =
        issue.severity === 'error'
          ? errorByPath
          : issue.severity === 'warn'
            ? warnByPath
            : null;
      if (!bucket) continue;
      for (const path of issue.nodeIds) bucket.set(path, (bucket.get(path) ?? 0) + 1);
    }
    return scan.nodes.map((n) => ({
      path: n.path,
      kind: n.kind,
      linksInCount: n.linksInCount,
      linksOutCount: n.linksOutCount,
      tokensTotal: n.tokens?.total ?? null,
      modifiedAtMs: n.modifiedAtMs ?? null,
      errorCount: errorByPath.get(n.path) ?? 0,
      warnCount: warnByPath.get(n.path) ?? 0,
      // Mirror the BFF `/api/folders` lite shape so the rail flags
      // staleness per row in demo mode too (the bundled nodes carry the
      // full sidecar overlay; project just its status).
      sidecarStatus: n.sidecar?.status ?? null,
    }));
  }

  /**
   * Demo mode: derive the branch projection from `data.json`. Scopes to
   * the UNION of nodes under ANY prefix in `paths` (a node matches when
   * its path equals a prefix verbatim or starts with `<prefix>/`); an
   * empty array = the whole corpus. Stable path order, capped at `limit`
   * (or the whole union when absent, the demo corpus is small enough
   * that no scan cap is recorded), then keeps only links whose source AND
   * resolved endpoint (`resolvedTarget`, else the raw `target` for
   * path-style links) are both in the slice, and issues touching the
   * slice, mirroring the live `/api/branch` SQL scoping.
   */
  async loadBranch(paths: string[] = [], limit?: number): Promise<IBranchResponseApi> {
    const scan = await this.loadScan();
    const prefixes = paths.filter((p) => p !== '');
    const inUnion = (nodePath: string): boolean =>
      prefixes.length === 0 ||
      prefixes.some((p) => nodePath === p || nodePath.startsWith(`${p}/`));
    const branchNodes = scan.nodes
      .filter((n) => inUnion(n.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    const total = branchNodes.length;
    const cap = limit !== undefined && limit > 0 ? limit : total;
    const nodes = branchNodes.slice(0, cap);
    const inSlice = new Set(nodes.map((n) => n.path));
    // Scope on the RESOLVED endpoint: a trigger-style link (mentions /
    // invokes) carries the raw trigger in `target` (`@agent`, `/cmd`) and
    // the real node path in `resolvedTarget`. Filtering on the raw `target`
    // dropped every resolved trigger edge from the demo map. Mirrors the
    // live SQL `loadBranch` projection (see `storage.ts` IBranchProjection).
    const links = scan.links.filter(
      (l) => inSlice.has(l.source) && inSlice.has(l.resolvedTarget ?? l.target),
    );
    const issues = scan.issues.filter((i) => i.nodeIds.some((id) => inSlice.has(id)));
    return {
      schemaVersion: '1',
      kind: 'branch',
      branch: { paths: [...prefixes], total, rendered: nodes.length, truncated: total > cap, cap },
      nodes,
      links,
      issues,
    };
  }

  /**
   * Prime `ContributionsRegistryService` from the bundled meta so
   * view-contribution slot renderers resolve their manifest-declared
   * ICON / LABEL (the per-node contribution VALUE is embedded on each
   * scan node, but the presentation lives in this registry). Mirror of
   * the live path's `ingestContributionsRegistry` in `RestDataSource`.
   * A bundle predating the registry key carries `undefined`, which the
   * service treats as a no-op.
   */
  private primeContributionsRegistry(meta: IDemoMetaPayload): void {
    this.contributionsRegistry.setRegistry(meta.contributionsRegistry);
  }

  async listNodes(q: INodesQuery = {}): Promise<IListEnvelopeApi<INodeApi>> {
    const meta = await this.loadMeta();
    if (isEmptyNodesQuery(q)) {
      this.kindRegistry.ingest(meta.nodes.kindRegistry);
      this.providerRegistry.ingest(meta.nodes.providerRegistry);
      this.primeContributionsRegistry(meta);
      return meta.nodes;
    }
    const scan = await this.loadData();
    const issues = scan.issues;
    let items = scan.nodes;
    if (q.kind && q.kind.length > 0) {
      const allowed = new Set(q.kind);
      items = items.filter((n) => allowed.has(n.kind));
    }
    if (q.path) {
      const re = globToRegExp(q.path);
      items = items.filter((n) => re.test(n.path));
    }
    if (q.hasIssues === true) {
      const withIssues = collectNodePathsWithIssues(issues);
      items = items.filter((n) => withIssues.has(n.path));
    } else if (q.hasIssues === false) {
      const withIssues = collectNodePathsWithIssues(issues);
      items = items.filter((n) => !withIssues.has(n.path));
    }
    const total = items.length;
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 1000;
    const sliced = items.slice(offset, offset + limit);
    this.kindRegistry.ingest(meta.nodes.kindRegistry);
    this.providerRegistry.ingest(meta.nodes.providerRegistry);
    this.primeContributionsRegistry(meta);
    return {
      schemaVersion: '1',
      kind: 'nodes',
      items: sliced,
      filters: {
        kind: q.kind ?? null,
        hasIssues: q.hasIssues ?? null,
        path: q.path ? [q.path] : null,
      },
      counts: {
        total,
        returned: sliced.length,
        page: { offset, limit },
      },
      kindRegistry: meta.nodes.kindRegistry,
      providerRegistry: meta.nodes.providerRegistry,
    };
  }

  async getNode(
    path: string,
    _opts: { includeBody?: boolean } = {},
  ): Promise<INodeDetailApi | null> {
    // Demo mode: bodies are pre-baked into `data.json` by
    // `web/scripts/build-demo-dataset.js` (Step 14.5.a). The static source
    // ignores `opts.includeBody` because the body is always present
    // when one was embedded, there's nothing to opt into. Nodes with
    // no body in the snapshot return `body: undefined` naturally,
    // which the inspector treats the same as the live `body: null`.
    const [scan, meta] = await Promise.all([this.loadData(), this.loadMeta()]);
    const node = scan.nodes.find((n) => n.path === path);
    if (!node) return null;
    const incoming = scan.links.filter((l) => l.target === path);
    const outgoing = scan.links.filter((l) => l.source === path);
    const issues = scan.issues.filter((i) => i.nodeIds.includes(path));
    this.kindRegistry.ingest(meta.nodes.kindRegistry);
    this.providerRegistry.ingest(meta.nodes.providerRegistry);
    this.primeContributionsRegistry(meta);
    return {
      schemaVersion: '1',
      kind: 'node',
      item: node,
      links: { incoming, outgoing },
      issues,
      kindRegistry: meta.nodes.kindRegistry,
      providerRegistry: meta.nodes.providerRegistry,
    };
  }

  async listLinks(q: ILinksQuery = {}): Promise<IListEnvelopeApi<ILinkApi>> {
    const meta = await this.loadMeta();
    if (isEmptyLinksQuery(q)) {
      this.kindRegistry.ingest(meta.links.kindRegistry);
      this.providerRegistry.ingest(meta.links.providerRegistry);
      this.primeContributionsRegistry(meta);
      return meta.links;
    }
    const scan = await this.loadData();
    let items = scan.links;
    if (q.kind && q.kind.length > 0) {
      const allowed = new Set(q.kind);
      items = items.filter((l) => allowed.has(l.kind));
    }
    if (q.from) items = items.filter((l) => l.source === q.from);
    if (q.to) items = items.filter((l) => l.target === q.to);
    this.kindRegistry.ingest(meta.links.kindRegistry);
    this.providerRegistry.ingest(meta.links.providerRegistry);
    this.primeContributionsRegistry(meta);
    return {
      schemaVersion: '1',
      kind: 'links',
      items,
      filters: { kind: q.kind ?? null, from: q.from ?? null, to: q.to ?? null },
      counts: { total: items.length, returned: items.length },
      kindRegistry: meta.links.kindRegistry,
      providerRegistry: meta.links.providerRegistry,
    };
  }

  async listIssues(q: IIssuesQuery = {}): Promise<IListEnvelopeApi<IIssueApi>> {
    const meta = await this.loadMeta();
    if (isEmptyIssuesQuery(q)) {
      this.kindRegistry.ingest(meta.issues.kindRegistry);
      this.providerRegistry.ingest(meta.issues.providerRegistry);
      this.primeContributionsRegistry(meta);
      return meta.issues;
    }
    const scan = await this.loadData();
    let items = scan.issues;
    if (q.severity) items = items.filter((i) => i.severity === q.severity);
    if (q.analyzerId) items = items.filter((i) => i.analyzerId === q.analyzerId);
    if (q.node) items = items.filter((i) => i.nodeIds.includes(q.node!));
    if (q.nodes && q.nodes.length > 0) {
      const set = new Set(q.nodes);
      items = items.filter((i) => i.nodeIds.some((n) => set.has(n)));
    }
    this.kindRegistry.ingest(meta.issues.kindRegistry);
    this.providerRegistry.ingest(meta.issues.providerRegistry);
    this.primeContributionsRegistry(meta);
    return {
      schemaVersion: '1',
      kind: 'issues',
      items,
      filters: {
        severity: q.severity ?? null,
        analyzerId: q.analyzerId ?? null,
        node: q.node ?? null,
        nodes: q.nodes && q.nodes.length > 0 ? [...q.nodes] : null,
      },
      counts: { total: items.length, returned: items.length },
      kindRegistry: meta.issues.kindRegistry,
      providerRegistry: meta.issues.providerRegistry,
    };
  }

  async loadGraph(format: TGraphFormat = 'ascii'): Promise<string> {
    if (format !== 'ascii') {
      throw new DataSourceError(
        'bad-query',
        DATA_SOURCE_TEXTS.errors.graphFormatNotInDemo(format),
      );
    }
    const meta = await this.loadMeta();
    return meta.graph.ascii;
  }

  async loadConfig(): Promise<IProjectConfigApi> {
    const meta = await this.loadMeta();
    this.kindRegistry.ingest(meta.config.kindRegistry);
    this.providerRegistry.ingest(meta.config.providerRegistry);
    this.primeContributionsRegistry(meta);
    return meta.config.value;
  }

  async listPlugins(): Promise<IListEnvelopeApi<TPluginItem>> {
    const meta = await this.loadMeta();
    this.kindRegistry.ingest(meta.plugins.kindRegistry);
    this.providerRegistry.ingest(meta.plugins.providerRegistry);
    this.primeContributionsRegistry(meta);
    return meta.plugins;
  }

  async setFavorite(_path: string): Promise<void> {
    throw new DataSourceError(
      'demo-readonly',
      'Favorites are not available in demo mode (static bundle is immutable).',
    );
  }

  async unsetFavorite(_path: string): Promise<void> {
    throw new DataSourceError(
      'demo-readonly',
      'Favorites are not available in demo mode (static bundle is immutable).',
    );
  }

  async setPluginEnabled(
    _id: string,
    _enabled: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    throw new DataSourceError(
      'demo-readonly',
      'Plugin toggles are not available in demo mode (static bundle is immutable).',
    );
  }

  async setPluginExtensionEnabled(
    _pluginId: string,
    _extensionId: string,
    _enabled: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    throw new DataSourceError(
      'demo-readonly',
      'Plugin toggles are not available in demo mode (static bundle is immutable).',
    );
  }

  async applyPluginChanges(
    _changes: ReadonlyArray<IPluginChange>,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    throw new DataSourceError(
      'demo-readonly',
      'Plugin toggles are not available in demo mode (static bundle is immutable).',
    );
  }

  async setPluginTrusted(
    _id: string,
    _trusted: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>> {
    throw new DataSourceError(
      'demo-readonly',
      'Plugin trust is not available in demo mode (static bundle is immutable).',
    );
  }

  async runScan(): Promise<IScanResultApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Manual scan is not available in demo mode (static bundle is immutable).',
    );
  }

  async getPreferences(): Promise<IPreferencesApi> {
    // Demo bundle is read-only, surface the shipped defaults so the
    // Settings UI renders the toggles in their happy state. Writes still
    // reject with `demo-readonly` so the UI surfaces a clear note.
    // Telemetry stays OFF in the demo (matching the default-OFF contract
    // in spec/telemetry.md), and the demo never initialises the SDK
    // because the UI DSN placeholder is empty.
    return {
      updateCheck: { enabled: true },
      telemetry: {
        errorsEnabled: false,
        usageCliEnabled: false,
        usageUiEnabled: false,
        anonymousId: null,
        environment: 'prod',
      },
    };
  }

  async setPreferences(_patch: IPreferencesPatchApi): Promise<IPreferencesApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Preference toggles are not available in demo mode (static bundle is immutable).',
    );
  }

  async getProjectPreferences(): Promise<IProjectPreferencesApi> {
    return {
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false },
      pluginTrust: { projectEnabled: false },
      tutorialReminderDismissed: false,
      ui: { liveUpdates: true, realtimeActivity: true },
    };
  }

  async setProjectPreferences(
    _patch: IProjectPreferencesPatchApi,
  ): Promise<IProjectPreferencesApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Project preferences are not available in demo mode (static bundle is immutable).',
    );
  }

  async getProjectIgnore(): Promise<IProjectIgnoreApi> {
    return { patterns: [] };
  }

  async setProjectIgnore(_patch: IProjectIgnorePatchApi): Promise<IProjectIgnoreApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Ignore patterns are not available in demo mode (static bundle is immutable).',
    );
  }

  async getActiveProvider(): Promise<IActiveProviderApi> {
    const meta = await this.loadMeta();
    const baked = meta.activeProvider;
    if (baked) {
      // The static snapshot never drifts (immutable bundle); default
      // `markerDrift` to null so an older, pre-drift bundle still loads.
      return { ...baked, markerDrift: baked.markerDrift ?? null };
    }
    return {
      activeProvider: 'markdown',
      detected: [],
      source: 'default',
      selectable: [],
      markerDrift: null,
    };
  }

  async setActiveProvider(_activeProvider: string): Promise<IActiveProviderPutEnvelopeApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Active provider lens is not available in demo mode (static bundle is immutable).',
    );
  }

  async acceptActiveProviderMarkers(): Promise<IActiveProviderApi> {
    // The demo bundle never drifts, so accepting markers is a harmless
    // no-op: return the baked envelope (already `markerDrift: null`).
    return this.getActiveProvider();
  }

  async getActivityInstallStatus(provider: string): Promise<IActivityInstallStatusApi> {
    // Baked snapshot: the demo bundle has no filesystem to probe, so
    // report each provider's CAPABILITY honestly (mirroring the shipped
    // activity adapters and their install descriptors) with nothing
    // installed. The Settings button renders in its Install state but
    // the mutation below rejects, matching every other demo write.
    const descriptor = DEMO_ACTIVITY_DESCRIPTORS[provider];
    return {
      provider,
      supported: descriptor !== undefined,
      installed: false,
      configPath: descriptor?.configPath ?? null,
      configWired: false,
      bridgePresent: false,
      events: descriptor?.events ?? 0,
    };
  }

  async installActivityHook(
    _provider: string,
    _opts?: { confirm?: boolean },
  ): Promise<IActivityInstallStatusApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Activity hook install is not available in demo mode (static bundle is immutable).',
    );
  }

  async uninstallActivityHook(
    _provider: string,
    _opts?: { confirm?: boolean },
  ): Promise<IActivityUninstallEnvelopeApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Activity hook uninstall is not available in demo mode (static bundle is immutable).',
    );
  }

  /**
   * Execution stats / spawn / capture surfaces: the demo bundle has no
   * live BFF (and therefore no accumulator, no spawn ring, no capture
   * store), so every read returns the honest empty / disabled shape
   * and the one write rejects like every other demo mutation.
   */
  async getActivitySummary(): Promise<IActivitySummaryApi> {
    return { since: Date.now(), nodes: {}, pairs: {} };
  }

  async getNodeActivity(_path: string): Promise<IActivityNodeDetailApi | null> {
    return {
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
    };
  }

  async getSpawnRecord(_spawnId: string): Promise<IActivitySpawnDetailApi | null> {
    return null;
  }

  async getActivityCapture(): Promise<IActivityCaptureStatusApi> {
    return { enabled: false };
  }

  async setActivityCapture(_body: {
    enabled: boolean;
    confirm?: boolean;
  }): Promise<IActivityCaptureStatusApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Conversation capture is not available in demo mode (static bundle is immutable).',
    );
  }

  /**
   * Phase 4 / View contribution system, demo mode does not ship
   * contribution fixtures yet (the static bundle is generated from
   * `sm export` which today excludes contributions). Returns `null`
   * so the slot host falls back gracefully.
   */
  async lookupContribution(): Promise<null> {
    return null;
  }

  async bumpSidecar(
    _nodePath: string,
    _opts: ISidecarBumpOpts = {},
  ): Promise<ISidecarBumpedEnvelopeApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Sidecar bump is not available in demo mode (static bundle is immutable).',
    );
  }

  async dispatchAction(
    _actionId: string,
    _nodePath: string,
    _opts: IActionDispatchOpts = {},
  ): Promise<IActionAppliedEnvelopeApi> {
    throw new DataSourceError(
      'demo-readonly',
      'Actions are not available in demo mode (static bundle is immutable).',
    );
  }

  /**
   * Demo bundle has no live BFF, surface a synthetic "up-to-date"
   * snapshot so the topbar renders without an `/api/*` round-trip.
   * The build script bakes the current CLI version into the meta
   * payload's `health` block; we reuse it so the snapshot is
   * self-identifying.
   */
  async getUpdateStatus(): Promise<IUpdateStatusResponseApi> {
    const meta = await this.loadMeta();
    return {
      current: meta.health.implVersion,
      latest: null,
      isOutdated: false,
      checkedAt: null,
      shownAt: null,
    };
  }

  /**
   * Demo bundle ships no registered annotations catalog; the consumer
   * (`<sm-plugin-contributions>`) renders every namespace as
   * "unregistered", same fallback the live path takes when the fetch
   * fails.
   */
  async getRegisteredAnnotations(): Promise<readonly IRegisteredAnnotationKeyApi[]> {
    return [];
  }

  events(): Observable<IWsEvent> {
    return EMPTY;
  }

  private loadMeta(): Promise<IDemoMetaPayload> {
    if (!this.metaPromise) {
      this.metaPromise = this.fetchJson<IDemoMetaPayload>(META_JSON);
    }
    return this.metaPromise;
  }

  private loadData(): Promise<IScanResultApi> {
    if (!this.dataPromise) {
      this.dataPromise = this.fetchJson<IScanResultApi>(DATA_JSON);
    }
    return this.dataPromise;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DataSourceError(
        'internal',
        DATA_SOURCE_TEXTS.errors.demoFetchFailed(path, msg),
      );
    }
    if (!res.ok) {
      throw new DataSourceError(
        'internal',
        DATA_SOURCE_TEXTS.errors.demoFetchFailed(path, `HTTP ${res.status}`),
      );
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DataSourceError(
        'internal',
        DATA_SOURCE_TEXTS.errors.demoParseFailed(path, msg),
      );
    }
  }
}

function isEmptyNodesQuery(q: INodesQuery): boolean {
  if (q.kind && q.kind.length > 0) return false;
  if (q.hasIssues !== undefined) return false;
  if (q.path) return false;
  if (q.offset !== undefined && q.offset !== 0) return false;
  if (q.limit !== undefined) return false;
  return true;
}

function isEmptyLinksQuery(q: ILinksQuery): boolean {
  if (q.kind && q.kind.length > 0) return false;
  if (q.from) return false;
  if (q.to) return false;
  return true;
}

function isEmptyIssuesQuery(q: IIssuesQuery): boolean {
  if (q.severity) return false;
  if (q.analyzerId) return false;
  if (q.node) return false;
  if (q.nodes && q.nodes.length > 0) return false;
  return true;
}

function collectNodePathsWithIssues(issues: IIssueApi[]): Set<string> {
  const out = new Set<string>();
  for (const i of issues) {
    for (const id of i.nodeIds) out.add(id);
  }
  return out;
}

/**
 * Translate a tiny subset of the kernel's path glob grammar (`*` → any
 * characters, `?` → single character) into a `RegExp`. Anchored end-to-
 * end so a glob without wildcards matches by exact equality. Used by
 * the demo-mode `listNodes` filter, the BFF goes through `applyExportQuery`
 * which understands a richer grammar; the demo only needs the basics.
 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`);
}
