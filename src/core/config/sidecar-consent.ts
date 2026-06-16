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
 * `IRuntimeContext` bag (`cwd`) plus the operator's two-tier consent
 * signal:
 *
 *   - `confirm`, one-shot grant: the operator allowed THIS write but
 *     did NOT ask to be remembered. The write proceeds; nothing is
 *     persisted, so the next write re-asks.
 *   - `always`, persistent grant: the operator ticked "allow always".
 *     The flag is flipped to `true` on disk (`project-local`) and the
 *     project never re-asks. `always` implies `confirm` (a strong
 *     grant), so a body with `always: true` is allowed regardless of
 *     `confirm`.
 *
 * Before the split (Step 17, Decision #5) `confirm: true` did BOTH,
 * grant AND persist, with no way to allow a single write without
 * remembering forever.
 */
export interface IEnsureSidecarWritesAllowedOpts {
  /**
   * One-shot consent signal. `true` lets THIS write through WITHOUT
   * persisting anything; the next write re-asks. `false` (and
   * `always` not true) throws `EConsentRequiredError` unless the flag
   * was already true on disk.
   */
  confirm: boolean;
  /**
   * Persistent consent signal. `true` flips `allowEditSmFiles` to
   * `true` in `project-local` settings (gitignored) and returns, the
   * project never re-asks. Implies `confirm` (strong grant). Optional
   * (defaults to one-shot semantics when absent).
   */
  always?: boolean;
  cwd: string;
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
 * Thrown when the project's `allowSidecarWriters` policy is `false` and a
 * sidecar write is attempted anyway. Distinct from
 * `EConsentRequiredError`: this is a team-level POLICY denial committed in
 * `<cwd>/.skill-map/settings.json`, not a missing per-machine consent.
 * It is a HARD gate, it wins over `allowEditSmFiles` and is NOT bypassable
 * with `--yes` / `{ confirm: true }`, so the message carries no
 * grant-on-the-fly hint. The CLI prints it verbatim; the BFF maps it to
 * `403 sidecar-writers-forbidden`.
 */
export class ESidecarWritersForbiddenError extends Error {
  readonly key: string;

  constructor(init: { key: string }) {
    super(
      `Sidecar-writing extensions are disabled in this project ` +
        `('${init.key}' is false in .skill-map/settings.json). ` +
        `This is a team-level project policy and cannot be overridden.`,
    );
    this.name = 'ESidecarWritersForbiddenError';
    this.key = init.key;
  }
}

/**
 * Project-policy gate for sidecar writers. Reads the committed
 * `allowSidecarWriters` policy (default `true`); when `false` it throws
 * `ESidecarWritersForbiddenError`. Exported so the invoke surfaces (BFF
 * action dispatch, `sm bump`) can refuse a sidecar-writing action EARLY
 * (before invoking) with a clean error, in addition to the backstop call
 * inside `ensureSidecarWritesAllowed` at the store chokepoint.
 */
export function assertSidecarWritersAllowed(cwd: string): void {
  const allowed = readConfigValue<boolean>('allowSidecarWriters', {
    cwd,
    default: true,
  });
  if (allowed === false) {
    throw new ESidecarWritersForbiddenError({ key: 'allowSidecarWriters' });
  }
}

/**
 * Pre-flight gate for any `.sm` write. Reads `allowEditSmFiles` from
 * the layered config; the decision ladder (Step 17, Decision #5):
 *
 *   1. Flag already `true` on disk      -> return (no re-ask).
 *   2. `always === true`                -> persist the flag to
 *      `project-local` (gitignored) and return. Strong grant; checked
 *      BEFORE `confirm` so `always` implies `confirm`.
 *   3. `confirm === true`               -> return WITHOUT persisting.
 *      One-shot grant; the next write re-asks.
 *   4. otherwise                        -> throw `EConsentRequiredError`.
 *
 * `allowEditSmFiles` is project-scoped (a "yes" in project A must not
 * implicitly extend to project B). The `PROJECT_LOCAL_ONLY_KEYS`
 * machinery in `kernel/config/loader.ts` enforces this strictly: the
 * key is stripped from every non-`project-local` layer with a
 * warning, only `project-local` (gitignored) is allowed to persist
 * it.
 */
export function ensureSidecarWritesAllowed(
  opts: IEnsureSidecarWritesAllowedOpts,
): void {
  // Rung 0, project policy: a committed `allowSidecarWriters: false`
  // forbids every sidecar write outright. Checked BEFORE the consent
  // ladder so the team policy is a HARD gate that wins over a local
  // `allowEditSmFiles: true` and cannot be bypassed with `--yes` /
  // `{ confirm: true }`.
  assertSidecarWritersAllowed(opts.cwd);
  const allowed = readConfigValue<boolean>('allowEditSmFiles', {
    cwd: opts.cwd,
    default: false,
  });
  if (allowed === true) return;
  if (opts.always === true) {
    // Persistent grant: flip the flag on disk so the project never
    // re-asks. The `always` branch comes first, so it also covers the
    // case where a caller passes `always: true` with `confirm` absent
    // or false (the strong grant subsumes the one-shot signal).
    writeConfigValue('allowEditSmFiles', true, {
      target: 'project-local',
      cwd: opts.cwd,
    });
    return;
  }
  if (opts.confirm === true) {
    // One-shot grant: let THIS write through but do NOT persist, the
    // next write re-asks. This is the new default for an unticked
    // "allow always" checkbox in the UI consent dialog.
    return;
  }
  throw new EConsentRequiredError({
    key: 'allowEditSmFiles',
    hintTarget: 'project-local',
  });
}
