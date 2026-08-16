/**
 * `<sm-sessions-view>`, the workspace rail's Sessions panel: the list of
 * runtime sessions the activity recorder has on tape, each expandable
 * into its agent tree (who spawned whom) plus the INTERNAL STEPS each
 * context ran (narrow sub-rows under the main agent and under every
 * subagent: skill runs, MCP calls, reads; user request 2026-08-16),
 * with a Play control that asks the host (via `SESSION_REPLAY_INTENT`)
 * to replay that session, or one agent branch, inside the Live lens.
 *
 * Self-contained like `<sm-files-view>`: no `@Input`s; it reads the
 * recorder directly and derives everything through the pure
 * `computeSessionIndex` fold, so the list follows the tape live while
 * the tab is mounted (the tab-gated mount is what bounds the recompute
 * cost). Unlike the Queue tab, this panel stays available while the
 * lens is on: it is the lens's own front door.
 *
 * Play is HIDDEN on agent nodes whose subtree carries no owner id
 * (nothing could be attributed to them, so the scoped tape would hold
 * only their spawn frames), and DISABLED everywhere while the lens is
 * unavailable (demo mode / Real Time off), with the tooltip saying why.
 */

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import { TooltipModule } from 'primeng/tooltip';

import { SESSIONS_VIEW_TEXTS } from '../../../i18n/sessions-view.texts';
import { ActivityRecorderService } from '../../../services/activity-recorder';
import { LiveLensService } from '../../../services/live-lens';
import { pathBasenameForLink } from '../../../services/path-basename';
import {
  computeSessionIndex,
  type ISessionAgentNode,
  type ISessionEntry,
  type ISessionStep,
} from '../../../services/session-index';
import { SessionRecordControl } from '../../components/session-record-control/session-record-control';
import { SESSION_REPLAY_INTENT } from '../../slots/session-replay-intent';

/** Pinned locale, same posture as `format-count.ts`: English-only UI. */
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

@Component({
  selector: 'sm-sessions-view',
  imports: [NgTemplateOutlet, ButtonModule, PaginatorModule, TooltipModule, SessionRecordControl],
  templateUrl: './sessions-view.html',
  styleUrl: './sessions-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsView {
  protected readonly recorder = inject(ActivityRecorderService);
  private readonly liveLens = inject(LiveLensService);
  private readonly replayIntent = inject(SESSION_REPLAY_INTENT);
  protected readonly texts = SESSIONS_VIEW_TEXTS;

  protected readonly index = computed(() => computeSessionIndex(this.recorder.events()));

  /** Newest first: the session you just watched is the one you replay. */
  protected readonly sessions = computed(() => [...this.index().sessions].reverse());

  protected readonly playAvailable = this.liveLens.available;

  /**
   * Session-row pagination, the Queue tab's exact dialect (user request
   * 2026-08-16): 100 rows per page, prev / next + the compact report.
   * `first` self-clamps when the list shrinks under the cursor (a
   * deleted recording, the ring trimming old sessions away).
   */
  protected readonly pageSize = 100;
  private readonly pageFirst = signal(0);
  protected readonly first = computed(() => {
    const total = this.sessions().length;
    const first = this.pageFirst();
    if (first < total) return first;
    return total === 0 ? 0 : Math.floor((total - 1) / this.pageSize) * this.pageSize;
  });

  protected readonly pagedSessions = computed(() => {
    const first = this.first();
    return this.sessions().slice(first, first + this.pageSize);
  });

  protected onPage(event: PaginatorState): void {
    this.pageFirst.set(event.first ?? 0);
  }

  /** Expanded rows; session rows key by rootOwner, agents by spawnId. */
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  protected toggle(key: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected startTime(tMs: number): string {
    return TIME_FORMAT.format(new Date(tMs));
  }

  /**
   * The session's user-visible name everywhere (replay scope chip, aria
   * labels): the runtime session id (shortened; it matches the journal
   * filename suffix on disk), or the start time when the runtime never
   * reported one. The synthetic "Session N" ordinal survives ONLY in
   * testids, where positional stability is the point.
   */
  protected sessionName(session: ISessionEntry): string {
    const id = session.sessionId;
    return id === undefined ? this.startTime(session.firstTMs) : shortSessionId(id);
  }

  /** One internal step's label, same grammar as the replay ticker. */
  protected stepLabel(step: ISessionStep): string {
    return this.texts.step(pathBasenameForLink(step.path), step.detail);
  }

  /**
   * A session's title: the NAMES of everything it touched (user call
   * 2026-08-16, usage over identity), first-touch order, deduped by
   * display name (two paths can share a basename). A session that
   * touched nothing (only ever spawned) falls back to its counters so
   * the title line never goes blank.
   */
  protected sessionTitle(session: ISessionEntry): string {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const path of session.touchedPaths) {
      const name = pathBasenameForLink(path);
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    if (names.length === 0) {
      return this.texts.stats(session.eventCount, session.touchedPaths.size, session.agentCount);
    }
    return names.join(this.texts.touchedSeparator);
  }

  /** The subtitle's counters half (the id half renders as its own chip). */
  protected sessionStats(session: ISessionEntry): string {
    return this.texts.stats(session.eventCount, session.touchedPaths.size, session.agentCount);
  }

  /** Template access to the shared shortener (the id chip's face). */
  protected shortId(id: string): string {
    return shortSessionId(id);
  }

  protected play(session: ISessionEntry): void {
    this.replayIntent.replaySession(
      { rootOwner: session.rootOwner },
      this.sessionName(session),
    );
  }

  protected playAgent(session: ISessionEntry, agent: ISessionAgentNode): void {
    this.replayIntent.replaySession(
      { rootOwner: session.rootOwner, agentSpawnId: agent.spawnId },
      this.texts.agentLabel(this.sessionName(session), agent.name ?? this.texts.unnamedAgent),
    );
  }

  /**
   * Step deep-link (user request 2026-08-16): replay the WHOLE session
   * and land on this step's frame. Deliberately session-scoped even for
   * an agent's step, so the map narrates the full context up to that
   * moment; the intent seeks by the step's `(tMs, path)` identity.
   */
  protected playStep(session: ISessionEntry, step: ISessionStep): void {
    this.replayIntent.replaySession(
      { rootOwner: session.rootOwner },
      this.sessionName(session),
      step,
    );
  }

  /** An agent is replayable only if its subtree owns attributable frames. */
  protected replayable(agent: ISessionAgentNode): boolean {
    if (agent.owner !== undefined) return true;
    return agent.children.some((child) => this.replayable(child));
  }
}

/** Row-sized session id, 5 chars (user call 2026-08-16); the full value rides the chip tooltip. */
function shortSessionId(id: string): string {
  return id.length > 5 ? `${id.slice(0, 5)}…` : id;
}
