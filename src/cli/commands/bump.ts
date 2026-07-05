/**
 * `sm bump <node.path>`, single-node sidecar bump.
 * `sm bump --pending [--staged] [--force]`, batch bump.
 *
 * Step 9.6.4 (Decision #125). Wraps the built-in deterministic
 * `core/node-bump` Action: the verb hydrates a `Node` from the
 * persisted scan (so the sidecar overlay produced by the 9.6.2 reader
 * rides along), invokes `nodeBumpAction.invoke()`, then materialises
 * any returned `{ kind: 'sidecar', path, changes }` writes through
 * `FilesystemSidecarStore`.
 *
 * Pure/impure split (architect-audit follow-up):
 *
 *   - `cli/commands/bump-plan.ts:computeBumpPlan`, pure compute.
 *     Iterates nodes, invokes the Action (which is itself pure),
 *     returns an `IBumpPlan` describing what to do per node WITHOUT
 *     touching disk.
 *   - `bump.ts` (this file), composition root. Validates flag
 *     combinations, opens the DB, drives the consent gate, consumes
 *     the plan, materialises writes via `FilesystemSidecarStore`,
 *     runs `git add` per item, renders.
 *   - `cli/util/git.ts`, the three `spawnSync` git helpers used by
 *     `--staged`, isolated so the only spawn site in the CLI lives
 *     in one place.
 *
 * Behaviour matrix:
 *
 *   - Single-node, fresh, no `--force`     → refusal (exit 2).
 *   - Single-node, fresh, with `--force`   → silent no-op (exit 0).
 *   - Single-node, stale (or no sidecar)   → bump (exit 0).
 *   - `--pending`                          → bump every node whose
 *     sidecar overlay reports drift, in `node.path` ASC order.
 *   - `--pending --staged`                 → same + `git add` each
 *     successfully-bumped `.sm`. Missing repo → exit 5; missing
 *     binary → exit 2. `git add` failures degrade to warnings.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok / silent no-op
 *   1  batch summary contains at least one error
 *   2  refused (fresh, no --force) / operational failure /
 *      `git` binary missing on PATH for `--staged`
 *   5  node not in persisted scan / `--staged` outside a git repo
 *
 * Per Decision A5 the verb passes `invoker: 'cli'` (literal, no
 * per-verb granularity). The Action stamps `audit.lastBumpedBy: 'cli'`
 * (and `audit.createdBy: 'cli'` on first creation).
 */

import { Command, Option } from 'clipanion';

import {
  EConsentRequiredError,
  ESidecarWritersForbiddenError,
  assertSidecarWritersAllowed,
  ensureSidecarWritesAllowed,
} from '../../core/config/sidecar-consent.js';
import { sidecarPathFor } from '../../kernel/sidecar/parse.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import type { Node } from '../../kernel/types.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { BUMP_TEXTS } from '../i18n/bump.texts.js';
import { CONSENT_TEXTS } from '../i18n/consent.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { confirm } from '../util/confirm.js';
import { resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { ensureGitForStaged, stageSidecar } from '../util/git.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { tryWithSqlite } from '../util/with-sqlite.js';

import {
  computeBumpPlan,
  type IBumpPlan,
  type TBumpPlanItem,
} from './bump-plan.js';

/**
 * Per-node outcome accumulated by the batch flow. `--json` envelope
 * partitions these into `bumped` / `refused` / `skipped` / `errors[]`.
 * Differs from `TBumpPlanItem` in that it also carries the post-write
 * sidecarPath + any error raised by `store.applyPatch`.
 */
interface IBumpOutcome {
  nodePath: string;
  status: 'bumped' | 'refused' | 'skipped' | 'error';
  version?: number;
  createdSidecar?: boolean;
  reason?: string;
  message?: string;
  sidecarPath?: string;
}

interface IPendingJsonEnvelope {
  bumped: number;
  refused: number;
  skipped: number;
  errors: Array<{ nodePath: string; message: string }>;
  elapsedMs: number;
}

interface ISidecarWriteConsent {
  confirm: boolean;
  /**
   * Persistent grant (Step 17 consent split). The CLI's accept / `--yes`
   * persists `allowEditSmFiles` to project-local (its documented
   * "never asked again" contract), so it maps to `always`, NOT the new
   * one-shot `confirm`. Kept in lock-step with the kernel
   * `ISidecarWriteConsent` (`kernel/sidecar/store.ts`).
   */
  always?: boolean;
  cwd: string;
}

/**
 * `sm bump`, entry-point command. Mutex: `--pending` and the
 * positional `<node.path>` are mutually exclusive.
 */
export class BumpCommand extends SmCommand {
  static override paths = [['bump']];

  static override usage = Command.Usage({
    category: 'Actions',
    description:
      'Bump a node\'s sidecar (`<basename>.sm`): increment annotations.version, refresh hashes, stamp audit.',
    details: `
      Wraps the built-in deterministic \`core/node-bump\` Action. Single-node
      mode bumps one path; \`--pending\` walks every node whose sidecar
      overlay reports drift and bumps them all.

      Single-node mode refuses on a fresh (non-stale) node unless
      \`--force\` is passed. Batch mode (\`--pending\`) treats fresh
      nodes as silent no-ops by default and accepts \`--force\` only as
      a passthrough to the Action's \`force\` flag (no behaviour change
      from the default in this verb).

      \`--staged\` (only valid with \`--pending\`) runs \`git add\` on
      each successfully-bumped \`.sm\` file so the new content lands in
      the same commit. Requires a git binary on PATH and a parent
      \`.git/\`: missing repo exits 5, missing binary exits 2.
    `,
    examples: [
      ['Bump a single node', '$0 bump .claude/agents/architect.md'],
      ['Bump a fresh node anyway', '$0 bump .claude/agents/architect.md --force'],
      ['Bump every stale node', '$0 bump --pending'],
      ['Bump every stale node and stage the .sm changes', '$0 bump --pending --staged'],
    ],
  });

  nodePath = Option.String({ name: 'node', required: false });
  pending = Option.Boolean('--pending', false, {
    description: 'Bump every node whose sidecar reports drift.',
  });
  staged = Option.Boolean('--staged', false, {
    description: 'After each successful --pending bump, `git add` the .sm file.',
  });
  force = Option.Boolean('--force', false, {
    description:
      'Single-node: bump even when the node is fresh. Batch: turn fresh-node refusals into silent no-ops.',
  });
  yes = Option.Boolean('--yes', false, {
    description: 'Confirm writing .sm sidecar files in this project (sets allowEditSmFiles=true on first run).',
  });

  protected async run(): Promise<number> {
    const ansi = this.ansiFor('stderr');

    const flagError = this.#validateFlagCombo(ansi);
    if (flagError !== null) return flagError;

    const ctx = defaultRuntimeContext();

    // Fail fast on the project policy: a committed `allowSidecarWriters:
    // false` forbids every `.sm` write. Checked once here (not per node)
    // so `sm bump --pending` does not repeat the same message for every
    // pending node. The store gate re-checks as the backstop.
    const policyError = this.#assertWritersAllowed(ansi, ctx.cwd);
    if (policyError !== null) return policyError;

    const dbPath = resolveDbPath({ db: this.db, ...ctx });

    const persisted = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (adapter) => adapter.scans.load(),
    );
    if (!persisted) {
      this.printer!.error(
        tx(BUMP_TEXTS.nodeNotFound, {
          glyph: ansi.red('✕'),
          nodePath: this.nodePath ?? '<pending>',
          hint: ansi.dim(BUMP_TEXTS.nodeNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    return this.#runWithConsent(
      ansi,
      () =>
        this.pending
          ? this.#runPending(persisted.nodes, ctx.cwd, ansi)
          : this.#runSingle(persisted.nodes, ctx.cwd, ansi),
    );
  }

  /**
   * Fail-fast guard for the `allowSidecarWriters: false` project policy.
   * Returns `ExitCode.Error` (after printing the policy message) when
   * sidecar writers are forbidden, or `null` when writes may proceed.
   * Re-throws any non-policy error so unexpected failures still surface.
   */
  #assertWritersAllowed(ansi: IAnsi, cwd: string): number | null {
    try {
      assertSidecarWritersAllowed(cwd);
      return null;
    } catch (err) {
      if (!(err instanceof ESidecarWritersForbiddenError)) throw err;
      this.printer!.error(`${ansi.red('✕')} ${err.message}`);
      return ExitCode.Error;
    }
  }

  /**
   * Three argument-validation guards, hoisted out of `run()` so the
   * lint complexity cap on `run()` is satisfied without an
   * `eslint-disable`. Returns the exit code on the first failed guard
   * or `null` when all three pass.
   */
  #validateFlagCombo(ansi: IAnsi): number | null {
    const errGlyph = ansi.red('✕');
    if (this.pending && this.nodePath !== undefined) {
      this.printer!.error(
        tx(BUMP_TEXTS.nodeAndPendingMutex, {
          glyph: errGlyph,
          hint: ansi.dim(BUMP_TEXTS.nodeAndPendingMutexHint),
        }),
      );
      return ExitCode.Error;
    }
    if (!this.pending && this.nodePath === undefined) {
      this.printer!.error(
        tx(BUMP_TEXTS.noTargetSpecified, {
          glyph: errGlyph,
          hint: ansi.dim(BUMP_TEXTS.noTargetSpecifiedHint),
        }),
      );
      return ExitCode.Error;
    }
    if (this.staged && !this.pending) {
      this.printer!.error(
        tx(BUMP_TEXTS.stagedRequiresPending, {
          glyph: errGlyph,
          hint: ansi.dim(BUMP_TEXTS.stagedRequiresPendingHint),
        }),
      );
      return ExitCode.Error;
    }
    return null;
  }

  /**
   * Wrap `dispatch` with the `.sm` consent gate: on the first
   * `EConsentRequiredError` thrown by `FilesystemSidecarStore.applyPatch`
   * (via `ensureSidecarWritesAllowed`), prompt the operator if stdin is
   * a TTY and `--yes` was not passed. On accept, flip `this.yes` to
   * true and re-run `dispatch` (the second pass passes `always: true`
   * to the store and the gate persists the flag to project-local, the
   * CLI's documented "never asked again" contract, Step 17 consent
   * split). On decline or non-TTY without `--yes`, print a directed
   * message and return `ExitCode.Error`.
   */
  async #runWithConsent(
    ansi: IAnsi,
    dispatch: () => Promise<number>,
  ): Promise<number> {
    try {
      return await dispatch();
    } catch (err) {
      if (!(err instanceof EConsentRequiredError)) throw err;
      const stdin = this.context.stdin as NodeJS.ReadStream;
      const stderr = this.context.stderr as NodeJS.WriteStream;
      const isTTY = stdin.isTTY === true;
      if (!isTTY || this.yes) {
        this.printer!.error(
          tx(CONSENT_TEXTS.consentRequiredNonTty, {
            glyph: ansi.red('✕'),
            verb: 'sm bump',
            hint: ansi.dim(CONSENT_TEXTS.consentRequiredNonTtyHint),
          }),
        );
        return ExitCode.Error;
      }
      const ok = await confirm(
        tx(CONSENT_TEXTS.consentPrompt, { glyph: ansi.cyan('ℹ') }),
        { stdin, stderr },
        { defaultAnswer: 'yes' },
      );
      if (!ok) {
        this.printer!.error(
          tx(CONSENT_TEXTS.consentAborted, {
            glyph: ansi.cyan('ℹ'),
            verb: 'sm bump',
          }),
        );
        return ExitCode.Error;
      }
      this.yes = true;
      return await dispatch();
    }
  }

  // --- single-node --------------------------------------------------------

  async #runSingle(nodes: Node[], cwd: string, ansi: IAnsi): Promise<number> {
    const node = nodes.find((n) => n.path === this.nodePath);
    if (!node) {
      this.printer!.error(
        tx(BUMP_TEXTS.nodeNotFound, {
          glyph: ansi.red('✕'),
          nodePath: this.nodePath!,
          hint: ansi.dim(BUMP_TEXTS.nodeNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    const item = computeBumpPlan([node], { cwd, force: this.force }).items[0]!;
    if (item.status !== 'bumped') {
      // `#renderTerminalSingle` covers the three non-bumped outcomes
      // (error / refused / skipped). The check above narrows `item`
      // so the bumped branch below sees the right type.
      return this.#renderTerminalSingle(item, node, ansi);
    }
    return await this.#applyBumpedSingle(item, node, ansi);
  }

  /**
   * Handle the three non-`bumped` outcomes for single-node mode
   * (`error`, `refused`, `skipped`). Returns the verb's exit code.
   * The caller pre-narrows on `item.status !== 'bumped'` so this
   * method's union is exhaustive, the `skipped` branch is the only
   * one that exits with `Ok` (silent no-op for fresh + --force).
   */
  #renderTerminalSingle(
    item: Exclude<TBumpPlanItem, { status: 'bumped' }>,
    node: Node,
    ansi: IAnsi,
  ): number {
    const errGlyph = ansi.red('✕');
    if (item.status === 'error') {
      this.printer!.error(
        tx(BUMP_TEXTS.bumpFailed, {
          glyph: errGlyph,
          message: tx(BUMP_TEXTS.resolveAbsPathFailed, {
            nodePath: node.path,
            message: item.message,
          }),
        }),
      );
      return ExitCode.Error;
    }
    if (item.status === 'refused') {
      this.printer!.error(
        tx(BUMP_TEXTS.refusedFresh, {
          glyph: errGlyph,
          nodePath: node.path,
          hint: ansi.dim(BUMP_TEXTS.refusedFreshHint),
        }),
      );
      return ExitCode.Error;
    }
    // status === 'skipped', silent no-op (fresh + --force in
    // single-node mode is legal but produces no output).
    return ExitCode.Ok;
  }

  /**
   * Apply the `bumped` plan item's writes and render the success line
   * (or the `--json` envelope). Single-node only; the batch flow uses
   * `#executePendingItem` which folds the result into an `IBumpOutcome`
   * for summary rendering.
   */
  async #applyBumpedSingle(
    item: Extract<TBumpPlanItem, { status: 'bumped' }>,
    node: Node,
    ansi: IAnsi,
  ): Promise<number> {
    const ctx = defaultRuntimeContext();
    const consent: ISidecarWriteConsent = {
      // Step 17 split: the CLI's accept / `--yes` persists the grant
      // (its documented "never asked again" contract), so it threads
      // `always`, not the new one-shot `confirm`.
      confirm: this.yes,
      always: this.yes,
      cwd: ctx.cwd,
    };
    const applied = await applyBumpWrites(item, consent);
    if (applied.error !== undefined) {
      // Consent failures bubble up; the outer `#runWithConsent`
      // wrapper handles the prompt/retry.
      if (applied.error instanceof EConsentRequiredError) throw applied.error;
      this.printer!.error(
        tx(BUMP_TEXTS.bumpFailed, {
          glyph: ansi.red('✕'),
          message: tx(BUMP_TEXTS.storeFailedDetail, {
            path: applied.sidecarPath ?? sidecarPathFor(item.absPath),
            message: formatErrorMessage(applied.error),
          }),
        }),
      );
      return ExitCode.Error;
    }

    if (this.json) {
      this.printer!.data(JSON.stringify(item.report) + '\n');
      return ExitCode.Ok;
    }

    const okGlyph = ansi.green('✓');
    const sidecarPath = applied.sidecarPath ?? sidecarPathFor(item.absPath);
    const version = item.report.version ?? 1;
    if (item.report.createdSidecar === true) {
      this.printer!.data(
        tx(BUMP_TEXTS.bumpedCreated, { glyph: okGlyph, sidecarPath, nodePath: node.path, version }),
      );
    } else {
      this.printer!.data(
        tx(BUMP_TEXTS.bumped, { glyph: okGlyph, nodePath: node.path, version }),
      );
    }
    return ExitCode.Ok;
  }

  // --- batch (--pending) --------------------------------------------------

  async #runPending(nodes: Node[], cwd: string, ansi: IAnsi): Promise<number> {
    const gitFailure = this.#preflightStaged(cwd, ansi);
    if (gitFailure !== null) return gitFailure;

    const stale = nodes
      .filter((n) => n.sidecar?.present === true && n.sidecar.status !== null && n.sidecar.status !== 'fresh')
      // Decision A7, iteration order: node.path ASC.
      .sort((a, b) => a.path.localeCompare(b.path));

    if (stale.length === 0) return this.#renderEmptyPending();

    if (!this.json) {
      this.printer!.info(tx(BUMP_TEXTS.pendingBanner, { count: stale.length }));
    }

    const plan = computeBumpPlan(stale, { cwd, force: this.force });
    const outcomes = await this.#executePending(plan, cwd, ansi);
    return this.#renderPendingOutcome(outcomes);
  }

  /**
   * `--staged` preflight: probe `.git/` + git binary BEFORE writing
   * anything. Per Decision A6: missing binary → ExitCode.Error (2);
   * missing `.git/` → ExitCode.NotFound (5). Returns `null` when
   * `--staged` is off or both probes pass.
   */
  #preflightStaged(cwd: string, ansi: IAnsi): number | null {
    if (!this.staged) return null;
    const errGlyph = ansi.red('✕');
    const gitOk = ensureGitForStaged(cwd);
    if (gitOk === 'no-repo') {
      this.printer!.error(
        tx(BUMP_TEXTS.notInGitRepo, {
          glyph: errGlyph,
          cwd,
          hint: ansi.dim(BUMP_TEXTS.notInGitRepoHint),
        }),
      );
      return ExitCode.NotFound;
    }
    if (gitOk === 'no-binary') {
      this.printer!.error(
        tx(BUMP_TEXTS.gitBinaryMissing, {
          glyph: errGlyph,
          hint: ansi.dim(BUMP_TEXTS.gitBinaryMissingHint),
        }),
      );
      return ExitCode.Error;
    }
    return null;
  }

  /**
   * Walk the computed plan, apply writes for `bumped` items via the
   * store, project the result into `IBumpOutcome[]` for rendering.
   * `--staged` runs `git add` per bumped item; failures degrade to a
   * warning and the loop continues (the bump itself succeeded; only
   * the staging missed).
   */
  async #executePending(plan: IBumpPlan, cwd: string, ansi: IAnsi): Promise<IBumpOutcome[]> {
    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    const ctx = defaultRuntimeContext();
    const consent: ISidecarWriteConsent = {
      // Step 17 split: CLI accept / `--yes` persists (see #runSingle).
      confirm: this.yes,
      always: this.yes,
      cwd: ctx.cwd,
    };
    const outcomes: IBumpOutcome[] = [];
    for (const item of plan.items) {
      const outcome = await this.#executePendingItem(item, store, consent, cwd, ansi);
      outcomes.push(outcome);
    }
    return outcomes;
  }

  async #executePendingItem(
    item: TBumpPlanItem,
    store: FilesystemSidecarStore,
    consent: ISidecarWriteConsent,
    cwd: string,
    ansi: IAnsi,
  ): Promise<IBumpOutcome> {
    if (item.status !== 'bumped') return terminalOutcomeFor(item);

    const applied = await applyBumpWrites(item, consent, store);
    if (applied.error !== undefined) {
      // Consent failures bubble up so the outer wrapper can prompt
      // once and re-run the whole pending sweep with the flag set.
      if (applied.error instanceof EConsentRequiredError) throw applied.error;
      return {
        nodePath: item.nodePath,
        status: 'error',
        message: tx(BUMP_TEXTS.storeFailedDetail, {
          path: applied.sidecarPath ?? sidecarPathFor(item.absPath),
          message: formatErrorMessage(applied.error),
        }),
      };
    }

    const sidecarPath = applied.sidecarPath ?? sidecarPathFor(item.absPath);
    if (this.staged) this.#maybeStageWarn(cwd, sidecarPath, ansi);
    return buildBumpedOutcome(item, sidecarPath);
  }

  /**
   * Run `git add` on the just-bumped sidecar and surface a warning on
   * failure. Failures degrade to a warning (the bump succeeded, the
   * staging missed) and the batch loop continues. Suppressed under
   * `--json` so the wire envelope stays clean.
   */
  #maybeStageWarn(cwd: string, sidecarPath: string, ansi: IAnsi): void {
    const addErr = stageSidecar(cwd, sidecarPath);
    if (addErr === null || this.json) return;
    this.printer!.warn(
      tx(BUMP_TEXTS.gitAddFailed, {
        glyph: ansi.yellow('⚠'),
        path: sidecarPath,
        message: addErr,
        hint: ansi.dim(tx(BUMP_TEXTS.gitAddFailedHint, { path: sidecarPath })),
      }),
    );
  }

  /**
   * `--pending` with no stale nodes: emit the empty envelope on the
   * data channel (`--json`) or the human "no pending" line.
   */
  #renderEmptyPending(): number {
    if (this.json) {
      const empty: IPendingJsonEnvelope = {
        bumped: 0,
        refused: 0,
        skipped: 0,
        errors: [],
        elapsedMs: this.elapsed!.ms(),
      };
      this.printer!.data(JSON.stringify(empty) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.data(BUMP_TEXTS.pendingNone);
    return ExitCode.Ok;
  }

  // Complexity is from per-status rendering (4 status values) plus
  // the json branch and the final exit-code decision. The rendering
  // itself is flat; no further extraction would help readability.
  // eslint-disable-next-line complexity
  #renderPendingOutcome(outcomes: IBumpOutcome[]): number {
    const counts = {
      bumped: outcomes.filter((o) => o.status === 'bumped').length,
      refused: outcomes.filter((o) => o.status === 'refused').length,
      skipped: outcomes.filter((o) => o.status === 'skipped').length,
      errors: outcomes.filter((o) => o.status === 'error'),
    };

    if (this.json) {
      const env: IPendingJsonEnvelope = {
        bumped: counts.bumped,
        refused: counts.refused,
        skipped: counts.skipped,
        errors: counts.errors.map((o) => ({
          nodePath: o.nodePath,
          message: o.message ?? '',
        })),
        elapsedMs: this.elapsed!.ms(),
      };
      this.printer!.data(JSON.stringify(env) + '\n');
      return counts.errors.length > 0 ? ExitCode.Issues : ExitCode.Ok;
    }

    for (const o of outcomes) {
      if (o.status === 'bumped') {
        this.printer!.data(
          tx(BUMP_TEXTS.bumpedItem, {
            nodePath: o.nodePath,
            version: o.version ?? 0,
            createdSuffix: o.createdSidecar === true ? ' (new sidecar)' : '',
          }),
        );
      } else if (o.status === 'refused') {
        this.printer!.data(tx(BUMP_TEXTS.refusedItem, { nodePath: o.nodePath }));
      } else if (o.status === 'skipped') {
        this.printer!.data(
          tx(BUMP_TEXTS.skippedItem, {
            nodePath: o.nodePath,
            reason: o.reason ?? 'unknown',
          }),
        );
      } else {
        this.printer!.data(
          tx(BUMP_TEXTS.errorItem, {
            nodePath: o.nodePath,
            message: o.message ?? '',
          }),
        );
      }
    }
    this.printer!.info(
      tx(BUMP_TEXTS.pendingSummary, {
        bumped: counts.bumped,
        refused: counts.refused,
        skipped: counts.skipped,
        errors: counts.errors.length,
      }),
    );

    return counts.errors.length > 0 ? ExitCode.Issues : ExitCode.Ok;
  }
}

/**
 * Map the three non-`bumped` plan-item statuses to a flat
 * `IBumpOutcome`. Pulled out of `#executePendingItem` so the latter's
 * happy path stays linear (early-return on terminals → apply → render).
 * Caller must NOT pass a `bumped` item, TypeScript narrowing keeps
 * this honest at the call site.
 */
function terminalOutcomeFor(item: Exclude<TBumpPlanItem, { status: 'bumped' }>): IBumpOutcome {
  if (item.status === 'refused') return { nodePath: item.nodePath, status: 'refused' };
  if (item.status === 'skipped') return { nodePath: item.nodePath, status: 'skipped', reason: 'noop' };
  return { nodePath: item.nodePath, status: 'error', message: item.message };
}

/**
 * Build the `IBumpOutcome` for a successfully-bumped plan item.
 * Folds the two optional fields (`version`, `createdSidecar`) so the
 * caller stays linear.
 */
function buildBumpedOutcome(
  item: Extract<TBumpPlanItem, { status: 'bumped' }>,
  sidecarPath: string,
): IBumpOutcome {
  const outcome: IBumpOutcome = {
    nodePath: item.nodePath,
    status: 'bumped',
    sidecarPath,
  };
  if (item.report.version !== undefined) outcome.version = item.report.version;
  if (item.report.createdSidecar === true) outcome.createdSidecar = true;
  return outcome;
}

/**
 * Apply the `writes` of a bumped plan item via the sidecar store.
 * Pulled out of the verb so both `#runSingle` and `#runPending` share
 * the same write loop + error envelope. Returns `{ sidecarPath, error? }`:
 *
 *   - `sidecarPath` is set whenever at least one `kind: 'sidecar'`
 *     write was attempted (set to the LAST path the loop touched,
 *     bump writes only one sidecar per item today, so this is
 *     unambiguous in practice).
 *   - `error` is set when `store.applyPatch` threw. Callers that
 *     catch `EConsentRequiredError` re-throw to escalate to the
 *     consent gate.
 *
 * The `store` is optional so single-node callers can pass a fresh
 * instance per call (no shared state) while the batch loop reuses one.
 */
async function applyBumpWrites(
  item: Extract<TBumpPlanItem, { status: 'bumped' }>,
  consent: ISidecarWriteConsent,
  store: FilesystemSidecarStore = new FilesystemSidecarStore(ensureSidecarWritesAllowed),
): Promise<{ sidecarPath?: string; error?: unknown }> {
  let sidecarPath: string | undefined;
  try {
    for (const w of item.writes) {
      if (w.kind === 'sidecar') {
        await store.applyPatch(w.path, w.changes, consent);
        sidecarPath = w.path;
      }
    }
  } catch (err) {
    return sidecarPath !== undefined ? { sidecarPath, error: err } : { error: err };
  }
  return sidecarPath !== undefined ? { sidecarPath } : {};
}

export const BUMP_COMMANDS = [BumpCommand];
