/**
 * `IAgentPort`, the agent-drain-skill surface (`spec/cli-contract.md`
 * §HTTP API, `/api/agent/*`; CLI counterpart: `sm agent
 * status/install/uninstall`): probe + install management for the
 * sm-run-queue skill that teaches the operator's agent to drain the
 * skill-map job queue.
 *
 * One of the domain ports composed into `IDataSourcePort`
 * (`../data-source.port.ts`).
 */

import type {
  IAgentSkillInstallEnvelopeApi,
  IAgentSkillInstallStatusApi,
  IAgentSkillUninstallEnvelopeApi,
} from '../../../models/api';

export interface IAgentPort {
  /**
   * Probe the drain-skill install state for one provider. Mirrors
   * `GET /api/agent/install?provider=<id>`. `supported: false` (with
   * `skillDir: null`) when the Provider declares no `scaffold.skillDir`
   * (the Settings row hides then); `stale: true` when installed but
   * the CLI ships a newer canonical copy. Unknown provider id rejects
   * with `code: 'not-found'`. Demo mode returns a baked "supported but
   * not installed" envelope for the lenses that declare a skill dir.
   */
  getAgentSkillInstallStatus(provider: string): Promise<IAgentSkillInstallStatusApi>;

  /**
   * Materialise (or refresh) the canonical sm-run-queue skill under
   * the provider's `scaffold.skillDir`. Mirrors
   * `POST /api/agent/install`. The server enforces consent: without
   * `confirm: true` it rejects 412 (`code: 'confirm-required'`) and
   * writes nothing; the caller shows the consent dialog and retries
   * with `{ confirm: true }`. Returns the refreshed status envelope
   * plus the three-state `outcome`. Demo mode rejects with
   * `code: 'demo-readonly'`.
   */
  installAgentSkill(
    provider: string,
    opts?: { confirm?: boolean },
  ): Promise<IAgentSkillInstallEnvelopeApi>;

  /**
   * Remove the installed sm-run-queue skill folder (exact reversal of
   * install). Mirrors `POST /api/agent/uninstall`, consent-gated like
   * install. Returns the refreshed status envelope plus `removed`
   * (`false` = nothing was installed, idempotent no-op). Demo mode
   * rejects with `code: 'demo-readonly'`.
   */
  uninstallAgentSkill(
    provider: string,
    opts?: { confirm?: boolean },
  ): Promise<IAgentSkillUninstallEnvelopeApi>;
}
