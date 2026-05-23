import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ChipModule } from 'primeng/chip';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { LINKED_NODES_PANEL_TEXTS } from '../../../i18n/linked-nodes-panel.texts';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { httpUrlOrNull } from '../../../services/url-guard';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import type {
  IExternalRefApi,
  IIssueApi,
  ILinkApi,
  ILinkOccurrenceApi,
  TIssueSeverityApi,
  TLinkConfidenceApi,
  TLinkKindApi,
} from '../../../models/api';
import { KIND_SEVERITY, confidenceSeverity, confidenceTier } from '../severity-map';

/**
 * Linked-nodes panel state machine. Drives the card's `@switch` block.
 *   - `idle`, no path selected (component renders nothing).
 *   - `loading`, outgoing+incoming fetch in flight.
 *   - `ready`, both lists resolved (each may be empty independently).
 *   - `error`, at least one list-links call threw.
 */
type TPanelState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'sm-linked-nodes-panel',
  imports: [CardModule, TagModule, ChipModule, ButtonModule, TooltipModule],
  templateUrl: './linked-nodes-panel.html',
  styleUrl: './linked-nodes-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkedNodesPanel {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly texts = LINKED_NODES_PANEL_TEXTS;

  /** Current node path. Falsy → component sits in `idle` (renders nothing). */
  readonly path = input<string | null | undefined>(null);

  /**
   * Emitted when the user clicks a target/source path in the rendered
   * rows. The Inspector view subscribes and routes to the chosen node.
   * The panel itself stays unaware of routing.
   */
  readonly openPath = output<string>();

  protected readonly state = signal<TPanelState>('idle');
  protected readonly outgoingRaw = signal<readonly ILinkApi[]>([]);
  protected readonly incomingRaw = signal<readonly ILinkApi[]>([]);
  /**
   * Self-loops (a link from a node to itself, by path or resolved
   * target) are hidden by default per the `core/self-loop` analyzer
   * convention. The raw lists stay populated so a future toggle can
   * surface them; today the panel renders the filtered views below.
   */
  protected readonly outgoing = computed(() => this.outgoingRaw().filter((l) => !isSelfLoop(l)));
  protected readonly incoming = computed(() => this.incomingRaw().filter((l) => !isSelfLoop(l)));
  /**
   * Full issue set fetched once per path change. Findings panel filters
   * to issues attached to the current node; per-row issue indicators
   * correlate against link endpoints (target of an outgoing edge, source
   * of an incoming edge). Fetching the entire set is cheap on real
   * fixtures (single-digit issue counts) and keeps the correlation
   * logic on the client; revisit if a project ships hundreds of issues
   * and the network round-trip starts to dominate.
   */
  protected readonly issues = signal<readonly IIssueApi[]>([]);
  /**
   * External URLs the focused node's body references. Populated by the
   * `getNode` data-source call alongside the link / issue fetches; the
   * panel renders one row per entry under the "External references"
   * section so the operator can copy / click without leaving the
   * inspector.
   *
   * Stored raw; the template reads the `externalRefs` computed which
   * narrows the list to entries whose URL scheme is `http:` or `https:`
   * (`url-guard`). Markdown bodies are author-controlled, so the
   * extractor can hand the UI any string; the `[href]` sink in the
   * template is guarded here rather than at the binding site.
   */
  protected readonly externalRefsRaw = signal<readonly IExternalRefApi[]>([]);
  protected readonly externalRefs = computed<readonly IExternalRefApi[]>(() =>
    this.externalRefsRaw().filter((r) => httpUrlOrNull(r.url) !== null),
  );

  /**
   * Monotonic fetch token. A late resolution from a previous `path()`
   * value is dropped if the user already navigated to a different node.
   * Same pattern as the body card (`inspector-view.ts`).
   */
  private fetchToken = 0;

  /**
   * Computed for the template, true while no path is set OR while
   * loading. The card itself stays mounted but the inner block
   * branches on `state()`.
   */
  protected readonly hasResults = computed(
    () => this.state() === 'ready' && (this.outgoing().length > 0 || this.incoming().length > 0),
  );

  /**
   * Issues whose `nodeIds[]` includes the currently-focused path. These
   * land in the "Findings" panel at the top of the card so the operator
   * sees, at a glance, every analyzer alert that fired against this
   * node (broken-ref, reserved-name, validate-all, etc.).
   */
  protected readonly findings = computed(() => {
    const path = this.path();
    if (!path) return [] as IIssueApi[];
    return this.issues().filter((i) => i.nodeIds.includes(path));
  });

  constructor() {
    // Reactive refresh on `scan.completed`, same trigger the
    // CollectionLoader uses. Re-running list-links keeps the panel in
    // step with watcher-driven re-scans without forcing the user to
    // hit refresh manually.
    this.wsEvents.scanCompleted$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const path = this.path();
        if (path) void this.fetch(path);
      });

    // Initial + path-change fetch.
    effect(() => {
      const path = this.path();
      if (!path) {
        this.fetchToken++;
        this.state.set('idle');
        this.outgoingRaw.set([]);
        this.incomingRaw.set([]);
        return;
      }
      void this.fetch(path);
    });
  }

  /** Manual refresh, wired to the card header's button. */
  protected refresh(): void {
    const path = this.path();
    if (path) void this.fetch(path);
  }

  protected onOpen(target: string): void {
    this.openPath.emit(target);
  }

  protected kindSeverity(kind: TLinkKindApi): 'info' | 'success' | 'warn' | 'danger' | 'secondary' {
    return KIND_SEVERITY[kind] ?? 'secondary';
  }

  protected confidenceSeverity(c: TLinkConfidenceApi): 'success' | 'info' | 'warn' {
    return confidenceSeverity(c);
  }

  protected confidenceLabel(c: TLinkConfidenceApi): string {
    return this.texts.confidence[confidenceTier(c)];
  }

  /**
   * Numeric confidence with two decimals (e.g. `1.00`, `0.85`, `0.10`).
   * Surfaced in the linked-nodes panel so the operator can tell a
   * resolved-and-lifted edge (`1.00`) apart from one stuck at the
   * extractor's emit floor (`0.80` for slash, `0.85` for at-directive
   * references, `0.50` for at-directive mentions) or downgraded by
   * `reserved-name` (`0.10`). The qualitative tier (`high` / `medium` /
   * `low`) stays available as the tag's tooltip.
   */
  protected confidenceValue(c: TLinkConfidenceApi): string {
    return c.toFixed(2);
  }

  /**
   * PrimeNG severity mapping for an issue. Mirrors the analyzer severity
   * directly: `error` → danger, `warn` → warn, `info` → info.
   */
  protected issueSeverity(s: TIssueSeverityApi): 'danger' | 'warn' | 'info' {
    if (s === 'error') return 'danger';
    if (s === 'warn') return 'warn';
    return 'info';
  }

  /**
   * Pick the most-relevant issue, if any, for an outgoing link row. Two
   * sources of evidence:
   *
   *   1. The current node's own broken-ref / link analyzer fired with
   *      `data.target === link.target`. The edge is the offender.
   *   2. The TARGET node carries any issue (e.g. `reserved-name` on a
   *      file that shadows a runtime built-in). The edge is healthy
   *      but its destination has a flag the operator should see.
   *
   * Returns `null` when neither applies. Severity drives the inline
   * chip's colour; the message goes in the tooltip.
   */
  protected issueForOutgoing(link: ILinkApi): IIssueApi | null {
    const path = this.path();
    if (!path) return null;
    // Edge-scoped lookup: a source-side issue MUST name this specific
    // edge via `data.target` (matching the link's literal target OR its
    // resolved target). Without this guard a broken-ref about an
    // UNRELATED outgoing link of the same source bleeds into every
    // row, which the operator reads as "all my edges are broken".
    const targetCandidates = [link.target, link.resolvedTarget].filter(
      (s): s is string => typeof s === 'string',
    );
    const onSource = this.issues().find((i) => {
      if (!i.nodeIds.includes(path)) return false;
      const dataTarget = i.data?.['target'];
      if (typeof dataTarget !== 'string') return false;
      return targetCandidates.includes(dataTarget);
    });
    if (onSource) return onSource;
    // Target-side attribute fallback: issues attached to the OTHER end
    // of the edge that describe the target itself (e.g. `reserved-name`
    // on a shadowed file). We accept only "no data.target" (pure node-
    // attribute) or "data.target === target path" (self-referential),
    // never "data.target === some other node" which would mean the
    // issue is about a different edge.
    const targetPath = link.resolvedTarget ?? link.target;
    const onTarget = this.issues().find((i) => {
      if (!i.nodeIds.includes(targetPath)) return false;
      const dataTarget = i.data?.['target'];
      return typeof dataTarget !== 'string' || dataTarget === targetPath;
    });
    return onTarget ?? null;
  }

  /**
   * Same idea as `issueForOutgoing` but for the incoming side: an issue
   * attached to the SOURCE of an incoming edge (broken-ref pointing at
   * us, or reserved-name on the source node itself) surfaces inline so
   * the operator does not have to navigate to the source to discover it.
   */
  /**
   * Per-occurrence display string for the row's sub-list. Picks the
   * "with line" or "no line" template based on whether the extractor
   * recorded a position. Centralised here so the template stays
   * declarative.
   */
  protected occurrenceLabel(occ: ILinkOccurrenceApi): string {
    const line = occ.location?.line;
    if (typeof line !== 'number') {
      return this.texts.occurrencesItemUnknownLine
        .replace('{{trigger}}', occ.originalTrigger)
        .replace('{{extractor}}', occ.extractor);
    }
    return this.texts.occurrencesItem
      .replace('{{line}}', String(line))
      .replace('{{trigger}}', occ.originalTrigger)
      .replace('{{extractor}}', occ.extractor);
  }

  protected issueForIncoming(link: ILinkApi): IIssueApi | null {
    const path = this.path();
    if (!path) return null;
    // Edge-scoped only: a source-side issue MUST name this specific
    // incoming edge by `data.target` matching either the literal
    // `link.target` (a trigger-style target the operator wrote), the
    // `link.resolvedTarget` (what the post-walk lift bound it to), or
    // our own path. Any other issue on the source describes a
    // DIFFERENT outgoing edge of theirs and does not belong on our
    // incoming row.
    const targetCandidates = [link.target, link.resolvedTarget, path].filter(
      (s): s is string => typeof s === 'string',
    );
    const onSource = this.issues().find((i) => {
      if (!i.nodeIds.includes(link.source)) return false;
      const dataTarget = i.data?.['target'];
      if (typeof dataTarget !== 'string') return false;
      return targetCandidates.includes(dataTarget);
    });
    return onSource ?? null;
  }

  /**
   * Fetch the two link lists in parallel. The token guard discards a
   * stale resolution if the user navigated mid-flight.
   */
  private async fetch(path: string): Promise<void> {
    const token = ++this.fetchToken;
    this.state.set('loading');
    try {
      // Four parallel calls fanned through `allSettled` so a per-call
      // rejection (most often `getNode` on a stale BFF / unstubbed
      // mock) leaves THAT slot empty without taking the panel down.
      // `allSettled` resolves in a single microtask, which matches the
      // existing two-tick `flush()` helper in the spec; promoting the
      // call to a sequential `await` would add a tick and silently
      // break every panel test.
      const [outRes, inRes, issuesRes, nodeRes] = await Promise.allSettled([
        this.dataSource.listLinks({ from: path }),
        this.dataSource.listLinks({ to: path }),
        this.dataSource.listIssues(),
        this.dataSource.getNode(path),
      ]);
      if (token !== this.fetchToken) return;
      // The three load-bearing calls (links + issues) MUST succeed; if
      // any rejected the panel lands in `error`. `getNode` is optional
      // (external refs decoration); a rejection there is silently
      // mapped to an empty list.
      if (
        outRes.status !== 'fulfilled' ||
        inRes.status !== 'fulfilled' ||
        issuesRes.status !== 'fulfilled'
      ) {
        this.outgoingRaw.set([]);
        this.incomingRaw.set([]);
        this.issues.set([]);
        this.externalRefsRaw.set([]);
        this.state.set('error');
        return;
      }
      this.outgoingRaw.set(outRes.value.items);
      this.incomingRaw.set(inRes.value.items);
      this.issues.set(issuesRes.value.items);
      this.externalRefsRaw.set(
        nodeRes.status === 'fulfilled' ? (nodeRes.value?.item?.externalRefs ?? []) : [],
      );
      this.state.set('ready');
    } catch {
      if (token !== this.fetchToken) return;
      this.outgoingRaw.set([]);
      this.incomingRaw.set([]);
      this.issues.set([]);
      this.externalRefsRaw.set([]);
      this.state.set('error');
    }
  }
}

/**
 * Self-loop predicate: a link whose source equals its target (path-
 * style) or its resolved target (trigger-style the post-walk lift
 * resolved by name). Hidden from the panel by default; the `core/
 * self-loop` analyzer is the authoritative detector and emits a warn
 * per self-loop so consumers that DO want to surface them have a
 * canonical signal.
 */
function isSelfLoop(link: ILinkApi): boolean {
  if (link.source === link.target) return true;
  if (link.resolvedTarget && link.source === link.resolvedTarget) return true;
  return false;
}
