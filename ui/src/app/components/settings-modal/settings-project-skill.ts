/**
 * `<sm-settings-project-skill>`, the agent-process-skill install row of
 * the Settings > Project section (`spec/cli-contract.md` §HTTP API,
 * `/api/agent/*`; CLI counterpart: `sm agent status/install/uninstall`).
 * Sibling of `<sm-settings-project-hook>`: same row vocabulary, same
 * lens coupling, same consent flow.
 *
 * Three states driven by the probe: not installed (primary "Install
 * skill"), installed but stale, the CLI ships a newer canonical copy
 * (primary "Update skill"), and installed + current (non-actionable
 * check indicator). Installed states also render the Uninstall
 * reversal. A lens without a `scaffold.skillDir` (`supported: false`)
 * hides the row entirely, there is no skill territory to install into.
 *
 * Both mutations first POST WITHOUT `confirm`; the BFF refuses 412
 * `confirm-required` (server-enforced consent, nothing written), which
 * surfaces the consent dialog naming the exact skill file
 * (`<skillDir>/sm-process-jobs/SKILL.md`); accepting retries with
 * `confirm: true`. The install response's three-state `outcome` drives
 * the announcement wording (installed / updated / already up to date).
 *
 * The coupling to the ACTIVE lens mirrors the hook child: the chassis
 * feeds `lensId` from the lens child's envelope, so a section open or
 * a confirmed lens switch re-probes the status for the CURRENT lens
 * declaratively (the probe effect tracks both `visible` and `lensId`).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageModule } from 'primeng/message';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { ProcessingAgentReadinessService } from '../../services/processing-agent-readiness';
import { ProviderRegistryService } from '../../../services/provider-registry';
import { UsageTrackerService } from '../../services/usage-tracker';
import type { IAgentSkillInstallStatusApi } from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { runConfirmGated } from '../confirm-gated';
import { formatErr } from './settings-project.utils';

/**
 * Project-relative path fragments of the materialised skill, fixed by
 * the spec contract (`src/core/agent-skill/skill-template.ts` on the
 * CLI side). Interpolated into the consent dialog so the operator sees
 * the exact file the install writes / the uninstall removes.
 */
const PROCESS_JOBS_SKILL_DIR = 'sm-process-jobs';
const PROCESS_JOBS_SKILL_FILE = 'SKILL.md';

@Component({
  selector: 'sm-settings-project-skill',
  imports: [ButtonModule, ConfirmDialogModule, MessageModule],
  providers: [ConfirmationService],
  templateUrl: './settings-project-skill.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectSkill {
  private readonly usageTracker = inject(UsageTrackerService);
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);
  /** App-level owner of the Settings attention dot; fed by `adoptStatus`. */
  private readonly readiness = inject(ProcessingAgentReadinessService);
  /** Resolves the active lens's label for the restart line. */
  private readonly registry = inject(ProviderRegistryService);

  readonly visible = input.required<boolean>();
  /**
   * Active lens id, fed by the chassis from the lens child's envelope
   * (`null` until it loads, `''` for "none"). Every change re-probes
   * the install status so the row always describes the CURRENT lens.
   */
  readonly lensId = input.required<string | null>();

  protected readonly texts = SETTINGS_TEXTS;

  /**
   * Install status of the ACTIVE lens's process skill
   * (`GET /api/agent/install`). `null` until the probe resolves (or
   * when it failed); re-probed whenever the section opens or the lens
   * changes.
   */
  protected readonly skillStatus = signal<IAgentSkillInstallStatusApi | null>(null);
  protected readonly skillError = signal<string | null>(null);
  protected readonly skillAnnouncement = signal<string | null>(null);
  /** Pending keys ('agent.skill' only in this child). */
  protected readonly pending = signal<Set<string>>(new Set());
  /**
   * Set by an install / update that actually wrote the skill file. The
   * agent loads its skills at startup, so a copy landing mid-session is
   * invisible until it restarts, which is the one instruction this row
   * cannot perform for the operator. Shown only after a write (an
   * already-current copy changed nothing, and a row the operator is
   * still reading has nothing to apply yet), and NOT cleared afterwards:
   * the pending restart outlives the announcement that earned it. The
   * uninstall path clears it, there is nothing left to load.
   */
  protected readonly restartPending = signal(false);

  /**
   * The row renders while the status is unknown (button disabled, like
   * the hook sibling) and hides only when the lens EXPLICITLY has no
   * skill territory (`supported: false`).
   */
  protected readonly rowVisible = computed<boolean>(() => {
    return this.skillStatus()?.supported !== false;
  });

  protected readonly skillInstalled = computed<boolean>(() => {
    return this.skillStatus()?.installed === true;
  });

  /** Installed and current: the action button gives way to the check indicator. */
  protected readonly skillUpToDate = computed<boolean>(() => {
    const status = this.skillStatus();
    return status !== null && status.installed && !status.stale;
  });

  /**
   * Installed but outdated: the state the Settings attention dot points
   * at. Drives the row's stripe, the chip and the warning-toned button.
   * Not the same as `stale` alone, which is `false` on a status that is
   * not installed at all.
   */
  protected readonly skillStale = computed<boolean>(() => {
    const status = this.skillStatus();
    return status !== null && status.installed && status.stale;
  });

  /**
   * Constructive action label: Install when absent, Update when the
   * CLI ships a newer canonical copy. Both render primary + filled
   * (action needed), mirroring the hook row's Install form.
   */
  protected readonly skillActionLabel = computed<string>(() => {
    const t = this.texts.project.agentSkill;
    return this.skillStatus()?.stale === true ? t.updateLabel : t.installLabel;
  });

  /** Disabled while unknown, unsupported, or a mutation is in flight. */
  protected readonly skillActionDisabled = computed<boolean>(() => {
    const status = this.skillStatus();
    return status === null || !status.supported || this.pending().has('agent.skill');
  });

  /**
   * Restart line naming the ACTIVE lens through the registry, so the
   * operator reads their own agent's name and not skill-map's. Worded by
   * the shared `agentRestartHint`, the same string its MCP sibling
   * renders. An id the registry does not carry falls back to the generic
   * wording rather than printing a raw id.
   */
  protected readonly restartHint = computed<string>(() => {
    const id = this.lensId();
    const label = id ? (this.registry.lookup(id)?.label ?? null) : null;
    return this.texts.project.agentRestartHint(label);
  });

  /** Project-relative path of the skill file the install writes. */
  protected readonly skillFilePath = computed<string>(() => {
    const dir = this.skillStatus()?.skillDir ?? '';
    return `${dir}/${PROCESS_JOBS_SKILL_DIR}/${PROCESS_JOBS_SKILL_FILE}`;
  });

  /** Project-relative path of the skill folder the uninstall removes. */
  protected readonly skillFolderPath = computed<string>(() => {
    const dir = this.skillStatus()?.skillDir ?? '';
    return `${dir}/${PROCESS_JOBS_SKILL_DIR}/`;
  });

  constructor() {
    // Probe on section open and on every lens change while open, the
    // same lifecycle as the hook sibling's probe.
    effect(() => {
      const id = this.lensId();
      if (!this.visible() || id === null) return;
      void this.refreshSkillStatus(id);
    });
  }

  protected onSkillInstallClick(): void {
    const status = this.skillStatus();
    if (status === null || !status.supported) return;
    // Usage analytics (opt-in, default OFF): the constructive button is
    // Install when absent and Update when installed-but-stale; stamped
    // with the surface since Quick Start exposes the same install.
    this.usageTracker.trackFeature(
      status.installed ? 'skill-update' : 'skill-install',
      undefined,
      'settings',
    );
    void this.runSkillMutation('install');
  }

  protected onSkillUninstallClick(): void {
    const status = this.skillStatus();
    if (status === null || !status.supported || !status.installed) return;
    this.usageTracker.trackFeature('skill-uninstall', undefined, 'settings');
    void this.runSkillMutation('uninstall');
  }

  /**
   * One mutation attempt through the shared `runConfirmGated` runner
   * (`components/confirm-gated.ts`), the same flow the hook sibling
   * runs: POST without `confirm`, surface the consent dialog on the
   * BFF's 412, retry with `confirm: true` on accept, settle quietly on
   * dismiss; any other failure (and a failed retry) formats into
   * `skillError`.
   */
  private async runSkillMutation(op: 'install' | 'uninstall'): Promise<void> {
    const key = 'agent.skill';
    if (this.pending().has(key)) return;
    const providerId = this.lensId() ?? '';
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.skillError.set(null);
    this.skillAnnouncement.set(null);
    try {
      await runConfirmGated({
        attempt: (confirm) => this.dispatchSkill(op, providerId, confirm),
        confirm: () =>
          new Promise<boolean>((resolve) => {
            this.confirmSkillDialog(op, () => resolve(true), () => resolve(false));
            // Busy contract of this row (pre-dating the shared runner):
            // the pending key releases once the consent dialog is up, so
            // the accepted retry runs unpended; the modal dialog overlay
            // guards re-entry while it shows. The `finally` release below
            // is then a no-op on this path.
            this.releasePending(key);
          }),
        onError: (err) => this.skillError.set(formatErr(err)),
      });
    } finally {
      this.releasePending(key);
    }
  }

  private releasePending(key: string): void {
    const after = new Set(this.pending());
    after.delete(key);
    this.pending.set(after);
  }

  /**
   * Fire one install/uninstall POST and adopt its response envelope.
   * The install envelope's `outcome` picks the announcement wording;
   * the uninstall envelope's `removed` distinguishes the idempotent
   * no-op.
   */
  private async dispatchSkill(
    op: 'install' | 'uninstall',
    providerId: string,
    confirm: boolean,
  ): Promise<void> {
    const opts = confirm ? { confirm: true } : undefined;
    const t = this.texts.project.agentSkill;
    if (op === 'install') {
      const envelope = await this.dataSource.installAgentSkill(providerId, opts);
      this.adoptStatus(envelope);
      // Only a real write asks for a restart: `already-up-to-date`
      // changed nothing on disk, so the running agent is not stale.
      if (envelope.outcome === 'installed' || envelope.outcome === 'updated') {
        this.restartPending.set(true);
      }
      this.skillAnnouncement.set(
        envelope.outcome === 'installed'
          ? t.installed
          : envelope.outcome === 'updated'
            ? t.updated
            : t.alreadyUpToDate,
      );
    } else {
      const envelope = await this.dataSource.uninstallAgentSkill(providerId, opts);
      this.adoptStatus(envelope);
      // The file is gone: whatever the running agent still holds, there
      // is nothing for a restart to pick up.
      this.restartPending.set(false);
      this.skillAnnouncement.set(envelope.removed ? t.uninstalled : t.nothingToUninstall);
    }
  }

  private confirmSkillDialog(
    op: 'install' | 'uninstall',
    onAccept: () => void,
    onReject: () => void,
  ): void {
    const t = this.texts.project.agentSkill;
    // Unlike the hook dialog (basename only), the FULL project-relative
    // skill path renders here: it is short, and the folder is the thing
    // the operator will find in their tree afterwards.
    const stale = this.skillStatus()?.stale === true;
    const header =
      op === 'uninstall'
        ? t.uninstallConfirmHeader
        : stale
          ? t.updateConfirmHeader
          : t.installConfirmHeader;
    const intro =
      op === 'uninstall'
        ? `${t.uninstallConfirmIntroPrefix} ${this.skillFolderPath()} ${t.uninstallConfirmIntroSuffix}`
        : stale
          ? `${t.updateConfirmIntroPrefix} ${this.skillFilePath()} ${t.updateConfirmIntroSuffix}`
          : `${t.installConfirmIntroPrefix} ${this.skillFilePath()} ${t.installConfirmIntroSuffix}`;
    this.confirmation.confirm({
      header,
      message: intro,
      acceptLabel: t.confirmAccept,
      rejectLabel: t.confirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        onAccept();
      },
      // Only settles the shared runner quietly; a dismissed dialog
      // performs no retry (same visible outcome as before the runner,
      // when no reject callback was wired at all).
      reject: () => {
        onReject();
      },
    });
  }

  /** Probe the process-skill install status for the given lens. */
  private async refreshSkillStatus(providerId: string): Promise<void> {
    this.skillError.set(null);
    if (providerId.length === 0) {
      this.skillStatus.set(null);
      return;
    }
    try {
      this.adoptStatus(await this.dataSource.getAgentSkillInstallStatus(providerId));
    } catch (err) {
      this.skillError.set(formatErr(err));
      this.skillStatus.set(null);
    }
  }

  /**
   * Adopt a status envelope locally AND hand it to the app-level
   * readiness service, which owns the Settings attention dot. Without
   * this the dot would survive its own fix: the service re-probes on
   * scan / lens change, so a skill updated from this row would keep the
   * sidebar lit until the next scan.
   */
  private adoptStatus(status: IAgentSkillInstallStatusApi): void {
    this.skillStatus.set(status);
    this.readiness.noteSkillStatus(status);
  }
}
