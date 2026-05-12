/**
 * Consent gate for `.sm` sidecar writes (per `spec/architecture.md`
 * §Annotation system · Write consent).
 *
 * Skill-map materialises annotation sidecars next to the user's source
 * files. That's intrusive, so the first time a verb or BFF route tries
 * to write a `.sm` file in a project, the kernel raises
 * `EConsentRequiredError` unless the operator has already granted
 * consent (the `allowEditSmFiles` flag is `true` in any of the layers
 * that survive the per-project-locality strip, typically
 * `project-local`).
 *
 * The CLI surfaces the error as an interactive `confirm()` prompt
 * (or a `--yes` bypass); the BFF returns 412 `confirm-required` so
 * the UI can open a `ConfirmationService` dialog. On accept the flag
 * is persisted to `<cwd>/.skill-map/settings.local.json` (gitignored,
 * per-checkout) and never asked again. On decline the operation
 * aborts WITHOUT persisting "no", the next attempt re-asks.
 *
 * Single chokepoint: `FilesystemSidecarStore.applyPatch` is the only
 * function that performs `.sm` writes. Every consumer (CLI, BFF) goes
 * through it, so wiring the gate here means every surface inherits the
 * same first-write prompt.
 *
 * Lives under `core/config/` (next to `helper.ts`) because both the
 * CLI and the BFF consume it, and it reads / writes the layered
 * config the same way the helper does.
 */

import {
  readConfigValue,
  writeConfigValue,
} from './helper.js';

/**
 * Inputs for `ensureSidecarWritesAllowed`. Mirrors the
 * `IRuntimeContext` bag (`cwd`, `homedir`) plus the operator's
 * confirmation signal, `true` when the call site already secured
 * consent (`--yes` on the CLI, `confirm: true` in the BFF body) and
 * `false` otherwise.
 */
export interface IEnsureSidecarWritesAllowedOpts {
  /**
   * Operator-supplied consent signal. `true` flips the flag to `true`
   * on disk and returns; `false` throws `EConsentRequiredError` unless
   * the flag was already true.
   */
  confirm: boolean;
  cwd: string;
  homedir: string;
}

/**
 * Thrown by `ensureSidecarWritesAllowed` when consent is required and
 * the operator has not supplied it. Carries the dot-key (`allowEditSmFiles`)
 * and the target the writer SHOULD use to persist consent so the CLI /
 * BFF error mapper can phrase the next-step hint without hardcoding
 * the literal.
 *
 * Name prefix `E` matches the existing kernel convention for typed
 * errors that travel through the orchestrator / BFF surface
 * (`ExportQueryError`, `ConfigValidationError`).
 */
export class EConsentRequiredError extends Error {
  readonly key: string;
  readonly hintTarget: 'project-local';

  constructor(init: { key: string; hintTarget: 'project-local' }) {
    super(
      `Skill-map needs your consent to create .sm sidecars in this project. ` +
        `Set '${init.key}' to true in .skill-map/settings.local.json (gitignored), ` +
        `or pass --yes / { confirm: true } to grant on the fly.`,
    );
    this.name = 'EConsentRequiredError';
    this.key = init.key;
    this.hintTarget = init.hintTarget;
  }
}

/**
 * Pre-flight gate for any `.sm` write. Reads `allowEditSmFiles` from
 * the layered config; returns silently when it is already `true`,
 * flips it to `true` (persisted to `project-local`) when `confirm`
 * is true, or throws `EConsentRequiredError` otherwise.
 *
 * Always consults `scope: 'project'` because `allowEditSmFiles` is
 * project-scoped (a "yes" in project A must not implicitly extend to
 * project B). The `PROJECT_LOCAL_ONLY_KEYS` machinery in
 * `kernel/config/loader.ts` enforces this strictly: the key is
 * stripped from EVERY non-project-local layer (`defaults` is hard
 * `false`; `user`, `user-local`, `project`, and `override` get
 * stripped with a warning). So a stray `~/.skill-map/settings.json`
 * value cannot leak the gate open across projects.
 */
export function ensureSidecarWritesAllowed(
  opts: IEnsureSidecarWritesAllowedOpts,
): void {
  const allowed = readConfigValue<boolean>('allowEditSmFiles', {
    scope: 'project',
    cwd: opts.cwd,
    homedir: opts.homedir,
    default: false,
  });
  if (allowed === true) return;
  if (opts.confirm === true) {
    writeConfigValue('allowEditSmFiles', true, {
      target: 'project-local',
      cwd: opts.cwd,
      homedir: opts.homedir,
    });
    return;
  }
  throw new EConsentRequiredError({
    key: 'allowEditSmFiles',
    hintTarget: 'project-local',
  });
}
