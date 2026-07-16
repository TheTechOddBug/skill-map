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
import type { IAgentSkillInstallStatusApi } from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
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
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);

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
    void this.runSkillMutation('install');
  }

  protected onSkillUninstallClick(): void {
    const status = this.skillStatus();
    if (status === null || !status.supported || !status.installed) return;
    void this.runSkillMutation('uninstall');
  }

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
      await this.dispatchSkill(op, providerId, false);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'confirm-required') {
        this.confirmSkillDialog(op, async () => {
          try {
            await this.dispatchSkill(op, providerId, true);
          } catch (innerErr) {
            this.skillError.set(formatErr(innerErr));
          }
        });
      } else {
        this.skillError.set(formatErr(err));
      }
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
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
      this.skillStatus.set(envelope);
      this.skillAnnouncement.set(
        envelope.outcome === 'installed'
          ? t.installed
          : envelope.outcome === 'updated'
            ? t.updated
            : t.alreadyUpToDate,
      );
    } else {
      const envelope = await this.dataSource.uninstallAgentSkill(providerId, opts);
      this.skillStatus.set(envelope);
      this.skillAnnouncement.set(envelope.removed ? t.uninstalled : t.nothingToUninstall);
    }
  }

  private confirmSkillDialog(op: 'install' | 'uninstall', onAccept: () => Promise<void>): void {
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
        void onAccept();
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
      this.skillStatus.set(await this.dataSource.getAgentSkillInstallStatus(providerId));
    } catch (err) {
      this.skillError.set(formatErr(err));
      this.skillStatus.set(null);
    }
  }
}
