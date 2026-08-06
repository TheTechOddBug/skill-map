/**
 * `ProcessingAgentReadinessService`, app-level probe of the two facts
 * that decide whether an AI job can actually be drained: the processing
 * skill install state for the ACTIVE lens
 * (`GET /api/agent/install?provider=<lens>`) and drainage evidence from
 * the full-circuit check (`AgentPingService`) / observed answers.
 *
 * Nothing that submits an AI job can succeed while no agent is set up to
 * drain the queue, so every affordance that would enqueue one (the
 * inspector header's summarize button, the tag row's auto-tag button,
 * the AI Actions launchers / run-all links / per-finding fix bolts)
 * gates on the ONE `submitGateClosed` signal here instead of running its
 * own probe or re-deriving the condition. `submitGateReason` names WHICH
 * half is missing so a consumer can pick the right tooltip without a
 * second read. Refresh points, mirroring `ActivityReadinessService`:
 *
 *   - boot (constructor), so the first inspected node renders its true
 *     gate state without waiting for a scan;
 *   - every `scan.completed`, the cheapest existing "project state may
 *     have changed" tick (an install performed from the CLI shows up on
 *     the next scan without a reload);
 *   - every active-lens change (`ProjectInfoService.activeProvider`),
 *     because the skill is installed PER lens: switching lenses can open
 *     or close the gate on its own.
 *
 * The MCP session count deliberately plays NO part in the gate (user
 * decision 2026-07-28, superseding the 2026-07-25 call that closed it on
 * `connected: false`): an agent parked on the CLI `sm jobs claim --wait`
 * drains the queue while holding no MCP session, so the count reported a
 * healthy setup as blocked, the exact wrong-proxy trap
 * `GET /api/agent/presence` was built to replace server-side. Drainage
 * evidence, an answer observed on the stream or a green full-circuit
 * check, is the only signal with authority here.
 *
 * `null` = unknown (probe pending, no lens resolved yet, or the read
 * failed) and consumers FAIL OPEN: a transport hiccup must never lock
 * the whole AI surface. `false` also means open, either the skill is
 * installed or the lens declares no skill territory (`supported: false`,
 * nothing to install). Only a confirmed `true` closes the gate.
 *
 * Concurrent `refresh()` calls coalesce onto the single in-flight probe
 * FOR THE SAME LENS so a lens-switch-then-scan burst costs one
 * round-trip each, and a lens switch never adopts the previous lens's
 * answer.
 *
 * Lives in `app/services/` (not `services/`): it coordinates domain
 * reads for an app-shell concern (chrome gating), per the layering
 * rule in `context/ui.md`.
 */

import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import type { IAgentSkillInstallStatusApi } from '../../models/api';
import { DATA_SOURCE } from '../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../services/ws-event-stream';
import { ProjectInfoService } from './project-info';

/**
 * Which half of the readiness pair closes the submit gate. `null` = open.
 * Ordered by depth: with no skill installed no check can even submit, so
 * `skill-missing` wins when both are true.
 */
export type TSubmitGateReason = 'skill-missing' | 'agent-silent';

@Injectable({ providedIn: 'root' })
export class ProcessingAgentReadinessService {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly projectInfo = inject(ProjectInfoService);

  private readonly _skillMissing = signal<boolean | null>(null);
  /**
   * Full-circuit verdict of the LAST manual Check (either surface's,
   * they share `AgentPingService`): `false` after a ping nobody
   * claimed, `true` after an answer, `null` while no check ever ran.
   * `null` fails OPEN: nothing depends on running a ping, the check is
   * the operator FORCING the question (user spec 2026-07-26), and only
   * a failed one closes the gate. Healed by any observed answer or a
   * later green check.
   */
  private readonly _agentAlive = signal<boolean | null>(null);
  readonly agentAlive = this._agentAlive.asReadonly();
  /**
   * `true` = the active lens SUPPORTS a processing skill that is NOT
   * installed, i.e. no agent is set up to drain launched jobs (gate
   * CLOSED); `false` = installed, or the lens has no skill to install
   * (gate OPEN); `null` = unknown, consumers fail open.
   */
  readonly skillMissing = this._skillMissing.asReadonly();

  /**
   * `true` = the skill IS installed but this CLI ships a newer canonical
   * copy, so `sm agent install` (or the Settings button) would rewrite
   * it; `false` = installed and current, or nothing installed at all;
   * `null` = unknown.
   *
   * Deliberately NOT part of the submit gate: an outdated skill still
   * drains the queue, it just misses whatever the newer copy teaches. It
   * drives the attention dot in Settings instead (Settings > Project),
   * which is the whole reason this lives here rather than inside the
   * settings row component: the dot has to render on a section the
   * operator has not opened yet.
   *
   * "Not installed" is deliberately excluded (user decision 2026-08-03):
   * on a project that never wanted the skill the dot would be lit
   * forever, which trains people to ignore it.
   */
  private readonly _skillStale = signal<boolean | null>(null);
  readonly skillUpdateAvailable = computed<boolean>(() => this._skillStale() === true);

  /**
   * Live reading of the gate, before the check hold below is applied:
   * which half closes it right now, `null` when none does.
   */
  private readonly liveGateReason = computed<TSubmitGateReason | null>(() => {
    if (this._skillMissing() === true) return 'skill-missing';
    if (this._agentAlive() === false) return 'agent-silent';
    return null;
  });

  /**
   * Reason latched while a manual full-circuit check runs against a
   * CLOSED gate (user spec 2026-07-27): the reads that land mid-check,
   * the skill probes riding along with it and the answer heal, must not
   * reopen the AI affordances before the verdict does, so the gate
   * holds the reason it started with until the check settles.
   * `null` = no hold: no check in flight, or it started with the gate
   * already open (an open gate is never frozen open, a red verdict
   * still closes it the moment it lands).
   */
  private readonly _checkHold = signal<TSubmitGateReason | null>(null);

  /**
   * Why the submit gate is closed, or `null` while it is open. Both
   * halves fail OPEN on `null` (unknown), so only confirmed readings
   * ever disable a control. While a manual check is in flight the
   * reason it started with is latched (see `_checkHold`).
   */
  readonly submitGateReason = computed<TSubmitGateReason | null>(
    () => this._checkHold() ?? this.liveGateReason(),
  );

  /**
   * The submit gate itself: nothing can drain the queue right now, so
   * every affordance that would enqueue a job sits DISABLED (never
   * hidden) instead of accepting a click that dead-ends.
   */
  readonly submitGateClosed = computed<boolean>(() => this.submitGateReason() !== null);

  /**
   * Record a full-circuit verdict (see `_agentAlive`): the shared ping
   * service stamps every check's outcome here.
   */
  noteAgentAlive(alive: boolean): void {
    this._agentAlive.set(alive);
  }

  /**
   * A manual full-circuit check just started: latch a closed gate
   * closed until `noteCheckSettled()` (see `_checkHold`). The shared
   * ping service brackets every check with this pair.
   */
  noteCheckStarted(): void {
    this._checkHold.set(untracked(() => this.liveGateReason()));
  }

  /** The check settled (any verdict, abandoned included): drop the latch. */
  noteCheckSettled(): void {
    this._checkHold.set(null);
  }

  /** Single in-flight probe; a same-lens refresh awaits the same one. */
  private inFlight: Promise<void> | null = null;
  /**
   * Lens the in-flight (or last started) probe was launched for.
   * `undefined` before the first probe. Keeps the coalescing honest: a
   * refresh for a DIFFERENT lens must start its own round-trip.
   */
  private probedLens: string | null | undefined = undefined;

  constructor() {
    const events = inject(WsEventStreamService);
    const destroyRef = inject(DestroyRef);
    const sub = events.scanCompleted$.subscribe(() => {
      void this.refresh();
    });
    destroyRef.onDestroy(() => sub.unsubscribe());
    // Any observed ANSWER proves an agent is attending again: a failed
    // check heals live the moment any job completes or fails, no manual
    // re-check needed. A claim deliberately does not heal (same regime as
    // the presence tracker and the Check verdict): it is a receipt, the
    // agent has the work and has answered nothing yet.
    const answerSub = events.jobEvents$.subscribe((event) => {
      if (event.type === 'job.completed' || event.type === 'job.failed') {
        this._agentAlive.set(true);
      }
    });
    destroyRef.onDestroy(() => answerSub.unsubscribe());
    // Boot probe: an inspector node can mount before the first scan tick.
    void this.refresh();
    // Lens changes, including the boot resolution of `/api/health` +
    // `/api/active-provider` (a `null` -> id transition). The first run
    // is a no-op: the constructor probe above already claimed that lens.
    effect(() => {
      const lens = this.projectInfo.activeProvider();
      if (lens === this.probedLens) return;
      void this.refresh();
    });
  }

  /**
   * Re-probe the install state of the active lens. Coalescing: while a
   * probe for the SAME lens is in flight, further calls return that
   * promise instead of stacking duplicate requests.
   */
  refresh(): Promise<void> {
    // Untracked: `refresh()` is also called from effects and from the WS
    // subscription; the lens dependency belongs to the effect above, not
    // to whatever reactive context happens to call this.
    const lens = untracked(() => this.projectInfo.activeProvider());
    if (this.inFlight !== null && this.probedLens === lens) return this.inFlight;
    this.probedLens = lens;
    const probe = this.probe(lens).finally(() => {
      // Only the CURRENT probe clears the slot: a superseded one
      // (lens switched mid-flight) must not free its successor's.
      if (this.inFlight === probe) this.inFlight = null;
    });
    this.inFlight = probe;
    return probe;
  }

  /**
   * Adopt a status envelope the caller already holds, so a mutation
   * performed in the UI (the Settings install / update / uninstall
   * buttons) settles the dot immediately instead of leaving it lit until
   * the next scan tick. Same writes as `probe`, no round-trip.
   */
  noteSkillStatus(status: IAgentSkillInstallStatusApi): void {
    this._skillMissing.set(status.supported && !status.installed);
    this._skillStale.set(status.installed && status.stale);
  }

  private async probe(lens: string | null): Promise<void> {
    if (lens === null) {
      // No lens resolved yet: unknown, so the gate stays open.
      this._skillMissing.set(null);
      this._skillStale.set(null);
      return;
    }
    try {
      const status = await this.dataSource.getAgentSkillInstallStatus(lens);
      // A lens switch landed while this was in flight: the answer
      // describes the previous lens, its successor owns the write.
      if (untracked(() => this.projectInfo.activeProvider()) !== lens) return;
      this.noteSkillStatus(status);
    } catch {
      // Unknown, NOT locked: any failure (transport, demo quirks)
      // resolves to null so the gate fails open.
      this._skillMissing.set(null);
      this._skillStale.set(null);
    }
  }
}
