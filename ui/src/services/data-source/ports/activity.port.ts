/**
 * `IActivityPort`, the live-activity surface
 * (`spec/provider-activity.md`): hook install management, execution
 * stats, per-node activity detail, spawn records, and the
 * conversation-capture gate. Mirrors the `/api/activity/*` routes.
 *
 * One of the domain ports composed into `IDataSourcePort`
 * (`../data-source.port.ts`).
 */

import type {
  IActivityCaptureStatusApi,
  IActivityInstallStatusApi,
  IActivityNodeDetailApi,
  IActivitySpawnDetailApi,
  IActivitySummaryApi,
  IActivityUninstallEnvelopeApi,
} from '../../../models/api';

export interface IActivityPort {
  /**
   * Probe the live-activity hook install state for one provider.
   * Mirrors `GET /api/activity/install?provider=<id>`
   * (`spec/provider-activity.md` §Install management over HTTP).
   * Unknown provider id rejects with `code: 'not-found'`. Demo mode
   * returns a baked "supported but not installed" envelope for
   * `claude` and `supported: false` for everything else.
   */
  getActivityInstallStatus(provider: string): Promise<IActivityInstallStatusApi>;

  /**
   * Install the provider's live-activity hook (bridge + hook config
   * wiring). Mirrors `POST /api/activity/install`. The server enforces
   * consent: without `confirm: true` it rejects 412
   * (`code: 'confirm-required'`) and touches nothing; the caller shows
   * the consent dialog and retries with `{ confirm: true }`. Returns
   * the refreshed status envelope. Demo mode rejects with
   * `code: 'demo-readonly'`.
   */
  installActivityHook(
    provider: string,
    opts?: { confirm?: boolean },
  ): Promise<IActivityInstallStatusApi>;

  /**
   * Uninstall the provider's live-activity hook (exact reversal of
   * install; operator hooks untouched). Mirrors
   * `POST /api/activity/uninstall`, consent-gated like install.
   * Returns the refreshed status envelope plus `removed`
   * (`false` = nothing was wired, idempotent no-op). Demo mode rejects
   * with `code: 'demo-readonly'`.
   */
  uninstallActivityHook(
    provider: string,
    opts?: { confirm?: boolean },
  ): Promise<IActivityUninstallEnvelopeApi>;

  /**
   * Snapshot of the BFF's per-node execution stats
   * (`GET /api/activity/summary`, `spec/provider-activity.md`
   * §Execution stats). Used to hydrate counters on boot / reconnect /
   * re-enable; the WS `node.activity` `stats` field carries the deltas
   * afterwards. Demo mode returns an empty snapshot (no live BFF).
   */
  getActivitySummary(): Promise<IActivitySummaryApi>;

  /**
   * Per-node activity detail for the inspector's Activity section
   * (`GET /api/activity/node/<pathB64>`): stats + recent executions +
   * spawn records touching the node. Returns `null` on 404 (unknown
   * path), mirroring `getNode`. Demo mode returns the empty shape.
   */
  getNodeActivity(path: string): Promise<IActivityNodeDetailApi | null>;

  /**
   * One spawn record by id (`GET /api/activity/spawns/<spawnId>`), the
   * spawn-edge click surface. Metadata always; conversation content
   * only while the capture gate is on. Returns `null` on 404 (unknown
   * or evicted id). Demo mode returns `null`.
   */
  getSpawnRecord(spawnId: string): Promise<IActivitySpawnDetailApi | null>;

  /**
   * Conversation-capture gate state (`GET /api/activity/capture`).
   * Demo mode reports `{ enabled: false }`.
   */
  getActivityCapture(): Promise<IActivityCaptureStatusApi>;

  /**
   * Flip the conversation-capture gate (`POST /api/activity/capture`).
   * The server enforces consent: without `confirm: true` it refuses
   * with 412 `confirm-required` and changes nothing, so the UI settles
   * consent in its own dialog first and always sends `confirm: true`.
   * Turning the gate off clears the in-memory store immediately. Demo
   * mode rejects with `code: 'demo-readonly'`.
   */
  setActivityCapture(body: {
    enabled: boolean;
    confirm?: boolean;
  }): Promise<IActivityCaptureStatusApi>;
}
