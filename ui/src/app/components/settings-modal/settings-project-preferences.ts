/**
 * `<sm-settings-project-preferences>`, the rows of the Settings >
 * Project section backed by the ONE `project preferences` envelope
 * (`GET/PATCH /api/project/preferences`):
 *
 *   1. `allowSidecarWriters` toggle, team-shared sidecar-writer policy.
 *   2. `scan.referencePaths`, privacy-sensitive list of folders the
 *      scan walks ONLY to validate broken links. Writes that EXPAND
 *      the scan's disk-access surface (paths outside the project) go
 *      through a `<p-confirmdialog>` and re-issue the PATCH with
 *      `confirm: true`. Persists in `<cwd>/.skill-map/settings.local.json`.
 *   3. `scan.followExternalSymlinks` toggle, project-local opt-in that
 *      lets the scanner follow symbolic links whose target escapes the
 *      project root. Turning it ON expands the scan's disk-access
 *      surface, so the write goes through the same confirm dialog
 *      (server-enforced 412) as the two surfaces above.
 *
 * They stay in one child because they read and PATCH the same
 * envelope; splitting them would triple-fetch the endpoint and race
 * the writes. Lifecycle mirrors the sibling children: fetch on
 * `(visible) === true`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { UsageTrackerService } from '../../services/usage-tracker';
import type {
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
} from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { runConfirmGated, type TConfirmFlow } from '../confirm-gated';
import { ToggleRowDirective } from './toggle-row.directive';
import { SettingsProjectIgnore } from './settings-project-ignore';
import { SettingsProjectMcp } from './settings-project-mcp';
import { formatErr } from './settings-project.utils';

@Component({
  selector: 'sm-settings-project-preferences',
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputTextModule,
    MessageModule,
    SettingsProjectIgnore,
    SettingsProjectMcp,
    ToggleRowDirective,
    ToggleSwitchModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './settings-project-preferences.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectPreferences {
  private readonly usageTracker = inject(UsageTrackerService);
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);

  readonly visible = input.required<boolean>();
  /**
   * Active lens id, threaded through from the chassis for the MCP
   * registration child mounted below the MCP Server row (this component
   * makes no use of it itself). Same reason the ignore child lives here:
   * row order, see the mount comments in the template.
   */
  readonly lensId = input.required<string | null>();

  protected readonly texts = SETTINGS_TEXTS;

  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly preferences = signal<IProjectPreferencesApi | null>(null);
  /** Pending patch keys ('scan.referencePaths', 'allowSidecarWriters', ...). */
  protected readonly pending = signal<Set<string>>(new Set());

  /** New-row input box for the reference-paths list. */
  protected readonly newReferencePath = signal('');

  protected readonly referencePaths = computed<readonly string[]>(() => {
    const env = this.preferences();
    return env?.scan.referencePaths ?? [];
  });

  /**
   * Committed sidecar-writer policy (team-shared). `true` (default)
   * keeps writer actions; `false` disables every sidecar-writing
   * extension and refuses `.sm` writes. Defaults to `true` before the
   * envelope loads so the switch does not flash "off".
   */
  protected readonly allowSidecarWriters = computed<boolean>(() => {
    return this.preferences()?.allowSidecarWriters ?? true;
  });

  /**
   * Project-local follow-external-symlinks opt-in
   * (`scan.followExternalSymlinks`). `false` (default) keeps the scanner
   * inside the project root; `true` follows symbolic links whose target
   * escapes it. Read defensively so an older envelope that predates the
   * field renders the switch off rather than flashing. Flipping it ON
   * expands the scan's disk-access surface, so the write goes through the
   * same confirm dialog as the plugin-trust opt-in.
   */
  protected readonly followExternalSymlinks = computed<boolean>(() => {
    return this.preferences()?.scan.followExternalSymlinks ?? false;
  });

  /**
   * Committed `.gitignore` opt-in (`scan.respectGitignore`), team-shared.
   * `false` (default) keeps `.gitignore` out of the ignore stack, so a
   * git-ignored note is still indexed; `true` folds it in. Read
   * defensively so an older envelope that predates the field renders the
   * switch off rather than flashing. Not surface-expanding, so no confirm
   * dialog (unlike the two keys above).
   */
  protected readonly respectGitignore = computed<boolean>(() => {
    return this.preferences()?.scan.respectGitignore ?? false;
  });

  /**
   * Project-local read-only MCP server opt-in (`mcp.server.enabled`).
   * `false` (default) keeps `sm serve` from mounting the experimental
   * `/mcp` endpoint; `true` mounts it. Read defensively so an older
   * envelope that predates the field renders the switch off. Not
   * surface-expanding (the server is read-only), so no confirm dialog,
   * but the mount is boot-time, so a flip shows a restart hint.
   */
  protected readonly mcpServerEnabled = computed<boolean>(() => {
    return this.preferences()?.mcpServerEnabled ?? false;
  });

  /**
   * Project-local skill-actions offering toggle (`skillActions.enabled`,
   * spec/skill-actions.md §Settings). Default `true`: skills installed
   * under `.skill-map/.agents/skills/` are offered on every node. Read
   * defensively so an older envelope that predates the field renders the
   * switch ON (the server-side default). Not surface-expanding, so no
   * confirm dialog, and the toggle is read fresh per request server-side,
   * so no restart hint either.
   */
  protected readonly skillActionsEnabled = computed<boolean>(() => {
    return this.preferences()?.skillActionsEnabled ?? true;
  });

  /**
   * View state the switches bind to, one per toggle. A plain computed
   * cannot roll a cancelled flip back: the p-toggleswitch flips its
   * internal state on click, and when the user dismisses the confirm
   * dialog (or the PATCH fails) the committed value never changed, so
   * the computed does not notify and the one-way `[ngModel]` binding
   * never rewrites the control. These `linkedSignal`s track the
   * committed value, get set optimistically by the toggle handlers,
   * and are explicitly reset to the committed value when the write
   * does not persist, which IS a value change the binding propagates.
   */
  protected readonly allowSidecarWritersView = linkedSignal(() =>
    this.allowSidecarWriters(),
  );
  protected readonly followExternalSymlinksView = linkedSignal(() =>
    this.followExternalSymlinks(),
  );
  protected readonly respectGitignoreView = linkedSignal(() =>
    this.respectGitignore(),
  );
  protected readonly mcpServerEnabledView = linkedSignal(() =>
    this.mcpServerEnabled(),
  );
  protected readonly skillActionsEnabledView = linkedSignal(() =>
    this.skillActionsEnabled(),
  );

  /**
   * Sticky "restart `sm serve`" hint for the MCP server toggle. The write
   * persists immediately, but the `/mcp` mount is resolved at serve boot,
   * so the running server does not pick up the change until it restarts.
   * Set once the operator flips the toggle in this session; it never
   * clears in-session (a restart means a fresh SPA load, which resets it),
   * mirroring the per-row restart hint the Plugins section shows for a
   * boot-time trust change.
   */
  protected readonly mcpServerRestartPending = signal(false);

  constructor() {
    effect(() => {
      if (this.visible()) void this.refresh();
    });
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  // -----------------------------------------------------------------
  // Reference-paths handlers
  // -----------------------------------------------------------------

  protected onReferencePathAdd(): void {
    // Usage analytics (opt-in, default OFF): the gesture only, NEVER the
    // path. See spec/telemetry.md §Usage event taxonomy.
    this.usageTracker.trackFeature('reference-paths-add');
    const raw = this.newReferencePath().trim();
    if (raw.length === 0) return;
    if (raw.includes(',')) {
      this.saveError.set(this.texts.project.commaForbidden);
      return;
    }
    const next = [...this.referencePaths(), raw];
    void this.runPatch(
      'scan.referencePaths',
      { scan: { referencePaths: next } },
      this.referencePathsConfirmFlow(),
    ).then(
      (ok) => {
        // Only clear the input on a successful persist; a 400 (path
        // does not exist, comma, malformed) or 412 (confirm required
        // and the user dismissed the dialog) leaves the value in
        // place so the operator can edit and retry without retyping.
        if (ok) this.newReferencePath.set('');
      },
    );
  }

  protected onReferencePathRemove(path: string): void {
    this.usageTracker.trackFeature('reference-paths-remove');
    const next = this.referencePaths().filter((p) => p !== path);
    void this.runPatch('scan.referencePaths', { scan: { referencePaths: [...next] } });
  }

  // -----------------------------------------------------------------
  // Sidecar-writer policy handler
  // -----------------------------------------------------------------

  protected onSidecarWritersToggle(next: boolean): void {
    this.usageTracker.trackFeature('allow-sidecar', next);
    this.allowSidecarWritersView.set(next);
    void this.runPatch('allowSidecarWriters', { allowSidecarWriters: next }).then(
      (ok) => {
        if (!ok) this.allowSidecarWritersView.set(this.allowSidecarWriters());
      },
    );
  }

  // -----------------------------------------------------------------
  // .gitignore opt-in handler (committed, ungated)
  // -----------------------------------------------------------------

  protected onRespectGitignoreToggle(next: boolean): void {
    this.usageTracker.trackFeature('use-gitignore', next);
    this.respectGitignoreView.set(next);
    void this.runPatch('scan.respectGitignore', { scan: { respectGitignore: next } }).then(
      (ok) => {
        if (!ok) this.respectGitignoreView.set(this.respectGitignore());
      },
    );
  }

  // -----------------------------------------------------------------
  // Read-only MCP server opt-in handler (project-local, boot-time)
  // -----------------------------------------------------------------

  /**
   * Flip the project-local `mcp.server.enabled` opt-in. Not surface-
   * expanding (the server is strictly read-only), so it persists directly
   * with no confirm dialog. On a successful persist the restart hint sticks
   * on: the `/mcp` mount is boot-time, so the running `sm serve` reflects
   * the change only after a restart. On a failed write the view signal rolls
   * back to the committed value and the hint is left untouched.
   */
  protected onMcpServerToggle(next: boolean): void {
    this.usageTracker.trackFeature('mcp-server', next, 'settings');
    this.mcpServerEnabledView.set(next);
    void this.runPatch('mcpServerEnabled', { mcpServerEnabled: next }).then((ok) => {
      if (ok) this.mcpServerRestartPending.set(true);
      else this.mcpServerEnabledView.set(this.mcpServerEnabled());
    });
  }

  // -----------------------------------------------------------------
  // Skill-actions offering handler (project-local, ungated, live)
  // -----------------------------------------------------------------

  /**
   * Sticky informational note for the skill-actions toggle, mirroring
   * the MCP row's restart hint VISUALLY but not semantically: the flip
   * itself applies on the next read (the consuming routes re-read the
   * toggle per request), so the note states that AND the one
   * restart-relevant fact, that newly installed skills load at `sm
   * serve` boot. Set once the operator flips the toggle in this session;
   * never clears in-session, like `mcpServerRestartPending`.
   */
  protected readonly skillActionsFlipNoted = signal(false);

  /**
   * Flip the project-local `skillActions.enabled` offering toggle. Not
   * surface-expanding (it only governs whether the installed catalog is
   * offered), so it persists directly with no confirm dialog; the
   * consuming routes read it fresh per request, so the change applies
   * immediately. A successful flip raises the sticky informational note
   * (`skillActionsFlipNoted`); on a failed write the view signal rolls
   * back to the committed value and the note is left untouched.
   */
  protected onSkillActionsToggle(next: boolean): void {
    this.usageTracker.trackFeature('skill-actions', next, 'settings');
    this.skillActionsEnabledView.set(next);
    void this.runPatch('skillActionsEnabled', { skillActionsEnabled: next }).then((ok) => {
      if (ok) this.skillActionsFlipNoted.set(true);
      else this.skillActionsEnabledView.set(this.skillActionsEnabled());
    });
  }

  // -----------------------------------------------------------------
  // Follow-external-symlinks opt-in handler
  // -----------------------------------------------------------------

  /**
   * Flip the project-local `scan.followExternalSymlinks` opt-in. Turning
   * it ON expands the scan's disk-access surface (it re-enables following
   * links that escape the project root), so the BFF answers 412
   * `confirm-required`; `runPatch` then surfaces the dedicated symlink
   * confirm dialog and retries with `confirm: true` on accept. Turning it
   * OFF narrows the surface and persists directly. When the write does
   * not persist (dialog dismissed, PATCH failed) the view signal is
   * reset to the committed value so the switch rolls back.
   */
  protected onFollowExternalSymlinksToggle(next: boolean): void {
    this.usageTracker.trackFeature('follow-symlinks', next, 'settings');
    this.followExternalSymlinksView.set(next);
    void this.runPatch(
      'scan.followExternalSymlinks',
      { scan: { followExternalSymlinks: next } },
      this.followExternalSymlinksConfirmFlow(),
    ).then((ok) => {
      if (!ok) this.followExternalSymlinksView.set(this.followExternalSymlinks());
    });
  }

  // -----------------------------------------------------------------
  // Refresh + dispatch helpers
  // -----------------------------------------------------------------

  /** Fetch the preferences envelope. */
  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);
    try {
      const envelope = await this.dataSource.getProjectPreferences();
      this.preferences.set(envelope);
    } catch (err) {
      this.loadError.set(formatErr(err));
      this.preferences.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Try the patch through the shared `runConfirmGated` runner
   * (`components/confirm-gated.ts`, extracted FROM this method): if the
   * BFF answers `confirm-required` AND the caller supplied a `confirm`
   * flow, that flow's dialog surfaces and user accept retries with
   * `confirm: true`. Any other error (or a 412 with no confirm flow,
   * which only narrowing callers hit, never in practice) surfaces in
   * `saveError`. The returned promise settles only after the whole flow
   * settles, INCLUDING the confirm dialog: `true` when the PATCH (or the
   * confirmed retry) actually persisted, `false` on validation errors, a
   * dismissed dialog, or a failed retry. Callers rely on that to roll
   * their view state back (toggles) or keep an input editable
   * (`onReferencePathAdd`). The key stays in `pending` while the dialog
   * is open, so the control is disabled until the user decides.
   *
   * The confirm dialog is parameterised per surface-expanding key: the
   * mechanism (try -> catch 412 -> dialog -> retry with `confirm: true`)
   * is shared, the dialog copy is not (reference-paths enumerates the
   * exposed paths; follow-external-symlinks shows its own warning).
   */
  private async runPatch(
    key: string,
    patch: IProjectPreferencesPatchApi,
    confirm?: TConfirmFlow,
  ): Promise<boolean> {
    if (this.pending().has(key)) return false;
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.saveError.set(null);
    try {
      return await runConfirmGated({
        attempt: async (withConsent) => {
          const envelope = await this.dataSource.setProjectPreferences(
            withConsent ? { ...patch, confirm: true } : patch,
          );
          this.preferences.set(envelope);
        },
        confirm,
        onError: (err) => this.saveError.set(formatErr(err)),
      });
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
  }

  /**
   * Confirm flow for `scan.referencePaths`: enumerate the exposed paths
   * (carried by the 412 envelope) in the dialog. The input box is
   * cleared by `onReferencePathAdd` when `runPatch` reports the persist.
   */
  private referencePathsConfirmFlow(): TConfirmFlow {
    return ({ exposed }) =>
      new Promise<boolean>((resolve) => {
        this.confirmDialog(exposed, () => resolve(true), () => resolve(false));
      });
  }

  /**
   * Confirm flow for `scan.followExternalSymlinks`: a dedicated warning
   * that following out-of-tree links can pull sensitive folders into the
   * graph (the exposed-paths list does not apply, so it is ignored).
   */
  private followExternalSymlinksConfirmFlow(): TConfirmFlow {
    return () =>
      new Promise<boolean>((resolve) => {
        this.confirmFollowExternalSymlinksDialog(() => resolve(true), () => resolve(false));
      });
  }

  private confirmDialog(
    paths: readonly string[],
    onAccept: () => void,
    onReject: () => void,
  ): void {
    this.confirmation.confirm({
      header: SETTINGS_TEXTS.project.confirmDialogHeader,
      message:
        SETTINGS_TEXTS.project.confirmDialogIntro +
        '\n' +
        paths.map((p) => `• ${p}`).join('\n'),
      acceptLabel: SETTINGS_TEXTS.project.confirmDialogAccept,
      rejectLabel: SETTINGS_TEXTS.project.confirmDialogReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        onAccept();
      },
      reject: () => {
        onReject();
      },
    });
  }

  private confirmFollowExternalSymlinksDialog(
    onAccept: () => void,
    onReject: () => void,
  ): void {
    this.confirmation.confirm({
      header: SETTINGS_TEXTS.project.followExternalSymlinksConfirmHeader,
      message: SETTINGS_TEXTS.project.followExternalSymlinksConfirmIntro,
      acceptLabel: SETTINGS_TEXTS.project.followExternalSymlinksConfirmAccept,
      rejectLabel: SETTINGS_TEXTS.project.followExternalSymlinksConfirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        onAccept();
      },
      reject: () => {
        onReject();
      },
    });
  }
}
