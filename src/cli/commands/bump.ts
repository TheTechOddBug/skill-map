/**
 * `sm bump <node.path>` — single-node sidecar bump.
 * `sm bump --pending [--staged] [--force]` — batch bump.
 *
 * Step 9.6.4 (Decision #125). Wraps the built-in deterministic
 * `core/bump` Action: the verb hydrates a `Node` from the persisted
 * scan (so the sidecar overlay produced by the 9.6.2 reader rides
 * along), invokes `bumpAction.invoke()`, then materialises any
 * returned `{ kind: 'sidecar', path, changes }` writes through
 * `FilesystemSidecarStore`.
 *
 * Behaviour matrix:
 *
 *   - Single-node, fresh, no `--force`     → refusal (exit 2). The
 *     Action returns `{ ok: false, reason: 'fresh' }`; the verb prints
 *     a human-readable hint pointing at `--force`.
 *   - Single-node, fresh, with `--force`   → silent no-op (exit 0).
 *     The Action returns `{ ok: true, noop: true }`; the verb prints
 *     nothing on the `data` channel.
 *   - Single-node, stale (or no sidecar)   → bump (exit 0). Version
 *     increments, hashes refresh, audit fills.
 *   - `--pending`                          → walk every node whose
 *     sidecar overlay reports drift, bump each in `node.path` ASC
 *     order. `--force` flips the fresh-node branch from refusal to
 *     silent no-op (matches the Action's `force` semantics).
 *   - `--pending --staged`                 → same as `--pending` plus
 *     `git add <sidecar-path>` after each successful bump. Requires a
 *     git binary on PATH and a parent `.git/`; missing repo → exit 5,
 *     missing binary → exit 2. `git add` failures degrade to a
 *     warning and the batch continues.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok / silent no-op
 *   1  batch summary contains at least one error
 *   2  refused (fresh, no --force) / operational failure /
 *      `git` binary missing on PATH for `--staged`
 *   5  node not in persisted scan / `--staged` outside a git repo
 *
 * Per Decision A5 the verb passes `invoker: 'cli'` (literal — no
 * per-verb granularity). The Action stamps `audit.lastBumpedBy: 'cli'`
 * (and `audit.createdBy: 'cli'` on first creation).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import {
  bumpAction,
  type IBumpInput,
  type IBumpReport,
} from '../../built-in-plugins/actions/bump/index.js';
import { sidecarPathFor } from '../../kernel/sidecar/parse.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import type { Node } from '../../kernel/types.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { BUMP_TEXTS } from '../i18n/bump.texts.js';
import { ansiFor } from '../util/ansi.js';
import { resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { assertContained } from '../util/path-guard.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { tryWithSqlite } from '../util/with-sqlite.js';

/**
 * Per-node outcome accumulated by the batch flow. `--json` envelope
 * partitions these into `bumped` / `refused` / `skipped` / `errors[]`.
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

/**
 * `sm bump` — entry-point command. Mutex: `--pending` and the
 * positional `<node.path>` are mutually exclusive.
 */
export class BumpCommand extends SmCommand {
  static override paths = [['bump']];

  static override usage = Command.Usage({
    category: 'Actions',
    description:
      'Bump a node\'s sidecar (`<basename>.sm`) — increment annotations.version, refresh hashes, stamp audit.',
    details: `
      Wraps the built-in deterministic \`core/bump\` Action. Single-node
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
      \`.git/\` — missing repo exits 5, missing binary exits 2.
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

  // The remaining cyclomatic count is from CLI ergonomics — argument
  // validation guards (3) + dispatch (1) + JSON-vs-pretty branch.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    if (this.pending && this.nodePath !== undefined) {
      this.printer!.error(BUMP_TEXTS.nodeAndPendingMutex);
      return ExitCode.Error;
    }
    if (!this.pending && this.nodePath === undefined) {
      this.printer!.error(BUMP_TEXTS.noTargetSpecified);
      return ExitCode.Error;
    }
    if (this.staged && !this.pending) {
      this.printer!.error(BUMP_TEXTS.stagedRequiresPending);
      return ExitCode.Error;
    }

    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...ctx });

    const persisted = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (adapter) => adapter.scans.load(),
    );
    if (!persisted) {
      this.printer!.error(
        tx(BUMP_TEXTS.nodeNotFound, { nodePath: this.nodePath ?? '<pending>' }),
      );
      return ExitCode.NotFound;
    }

    if (this.pending) {
      return this.#runPending(persisted.nodes, ctx.cwd);
    }
    return this.#runSingle(persisted.nodes, ctx.cwd);
  }

  // --- single-node --------------------------------------------------------

  // Complexity is from CLI ergonomics: not-found / abs-path-resolve /
  // refusal / no-op / write-loop / json-vs-pretty / first-time-vs-
  // bump branches. Each branch is a direct return; inner work is
  // already hoisted into `invokeBumpFor` + `FilesystemSidecarStore`.
  // eslint-disable-next-line complexity
  async #runSingle(nodes: Node[], cwd: string): Promise<number> {
    const node = nodes.find((n) => n.path === this.nodePath);
    if (!node) {
      this.printer!.error(
        tx(BUMP_TEXTS.nodeNotFound, { nodePath: this.nodePath! }),
      );
      return ExitCode.NotFound;
    }

    let absPath: string;
    try {
      assertContained(cwd, node.path);
      absPath = resolve(cwd, node.path);
    } catch (err) {
      this.printer!.error(
        tx(BUMP_TEXTS.bumpFailed, {
          message: tx(BUMP_TEXTS.resolveAbsPathFailed, {
            nodePath: node.path,
            message: formatErrorMessage(err),
          }),
        }),
      );
      return ExitCode.Error;
    }

    const result = invokeBumpFor(node, absPath, this.force);

    if (result.report.ok === false && result.report.reason === 'fresh') {
      this.printer!.error(tx(BUMP_TEXTS.refusedFresh, { nodePath: node.path }));
      return ExitCode.Error;
    }
    if (result.report.ok === true && result.report.noop === true) {
      // Silent no-op — fresh node + --force in single-node mode is
      // legal but produces no output.
      return ExitCode.Ok;
    }

    // Stale / first-time: materialise the writes.
    const store = new FilesystemSidecarStore();
    let sidecarPath: string | undefined;
    try {
      for (const w of result.writes ?? []) {
        if (w.kind === 'sidecar') {
          await store.applyPatch(w.path, w.changes);
          sidecarPath = w.path;
        }
      }
    } catch (err) {
      this.printer!.error(
        tx(BUMP_TEXTS.bumpFailed, {
          message: tx(BUMP_TEXTS.storeFailedDetail, {
            path: sidecarPath ?? sidecarPathFor(absPath),
            message: formatErrorMessage(err),
          }),
        }),
      );
      return ExitCode.Error;
    }

    if (this.json) {
      this.printer!.data(JSON.stringify(result.report) + '\n');
      return ExitCode.Ok;
    }

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const okGlyph = ansi.green('✓');
    if (result.report.createdSidecar === true) {
      this.printer!.data(
        tx(BUMP_TEXTS.bumpedCreated, {
          glyph: okGlyph,
          sidecarPath: sidecarPath ?? sidecarPathFor(absPath),
          nodePath: node.path,
          version: result.report.version ?? 1,
        }),
      );
    } else {
      this.printer!.data(
        tx(BUMP_TEXTS.bumped, {
          glyph: okGlyph,
          nodePath: node.path,
          version: result.report.version ?? 1,
        }),
      );
    }
    return ExitCode.Ok;
  }

  // --- batch (--pending) --------------------------------------------------

  // Complexity is from CLI ergonomics: --staged preflight (3 branches),
  // empty-set / json / pretty branches, per-node loop with
  // git-add side effect. Inner work lives in `bumpOnePending` and
  // `ensureGitForStaged`.
  // eslint-disable-next-line complexity
  async #runPending(nodes: Node[], cwd: string): Promise<number> {
    // Preflight git checks for --staged BEFORE we start writing files.
    // Per Decision A6: missing binary → ExitCode.Error (2);
    // missing .git/ → ExitCode.NotFound (5).
    if (this.staged) {
      const gitOk = ensureGitForStaged(cwd);
      if (gitOk === 'no-repo') {
        this.printer!.error(tx(BUMP_TEXTS.notInGitRepo, { cwd }));
        return ExitCode.NotFound;
      }
      if (gitOk === 'no-binary') {
        this.printer!.error(BUMP_TEXTS.gitBinaryMissing);
        return ExitCode.Error;
      }
    }

    const stale = nodes
      .filter((n) => n.sidecar?.present === true && n.sidecar.status !== null && n.sidecar.status !== 'fresh')
      // Decision A7 — iteration order: node.path ASC.
      .sort((a, b) => a.path.localeCompare(b.path));

    if (stale.length === 0) {
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

    if (!this.json) {
      this.printer!.info(tx(BUMP_TEXTS.pendingBanner, { count: stale.length }));
    }

    const store = new FilesystemSidecarStore();
    const outcomes: IBumpOutcome[] = [];
    for (const node of stale) {
      const outcome = await bumpOnePending(node, cwd, this.force, store);
      outcomes.push(outcome);
      if (outcome.status === 'bumped' && this.staged && outcome.sidecarPath !== undefined) {
        const addErr = stageSidecar(cwd, outcome.sidecarPath);
        if (addErr !== null && !this.json) {
          this.printer!.warn(
            tx(BUMP_TEXTS.gitAddFailed, {
              path: outcome.sidecarPath,
              message: addErr,
            }),
          );
        }
      }
    }

    return this.#renderPendingOutcome(outcomes);
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
 * Invoke the built-in `core/bump` Action against `node`. Returns the
 * full `IActionResult<IBumpReport>` so the caller decides whether to
 * materialise the writes or inspect the report.
 */
function invokeBumpFor(
  node: Node,
  absPath: string,
  force: boolean,
): { report: IBumpReport; writes?: import('../../kernel/extensions/index.js').TActionWrite[] } {
  if (!bumpAction.invoke) {
    throw new Error('built-in bump action is missing its invoke()');
  }
  const input: IBumpInput = {};
  if (force) input.force = true;
  return bumpAction.invoke<IBumpInput, IBumpReport>(input, {
    node,
    nodeAbsolutePath: absPath,
    invoker: 'cli',
    now: () => new Date(),
  });
}

/**
 * Bump a single node inside the `--pending` loop. Folds the
 * resolve-abs-path / Action-invoke / store-apply pipeline into one
 * `IBumpOutcome` so the caller can render summary lines uniformly.
 *
 * Inside `--pending`, fresh nodes (overlay says `status: 'fresh'`)
 * never reach this function — the caller filters them out. This
 * function still handles the Action's refusal branch defensively in
 * case the overlay disagrees with the live hashes (mid-flight edits).
 */
// Complexity is from the four early-return branches (resolve / invoke
// / refusal / noop / write-loop) plus the optional createdSidecar
// flag. Each path returns directly; flattening would require a
// state-machine helper that hurts readability.
// eslint-disable-next-line complexity
async function bumpOnePending(
  node: Node,
  cwd: string,
  force: boolean,
  store: FilesystemSidecarStore,
): Promise<IBumpOutcome> {
  let absPath: string;
  try {
    assertContained(cwd, node.path);
    absPath = resolve(cwd, node.path);
  } catch (err) {
    return {
      nodePath: node.path,
      status: 'error',
      message: formatErrorMessage(err),
    };
  }

  let result: ReturnType<typeof invokeBumpFor>;
  try {
    result = invokeBumpFor(node, absPath, force);
  } catch (err) {
    return {
      nodePath: node.path,
      status: 'error',
      message: formatErrorMessage(err),
    };
  }

  if (result.report.ok === false && result.report.reason === 'fresh') {
    return { nodePath: node.path, status: 'refused' };
  }
  if (result.report.ok === true && result.report.noop === true) {
    return { nodePath: node.path, status: 'skipped', reason: 'noop' };
  }

  let sidecarPath: string | undefined;
  try {
    for (const w of result.writes ?? []) {
      if (w.kind === 'sidecar') {
        await store.applyPatch(w.path, w.changes);
        sidecarPath = w.path;
      }
    }
  } catch (err) {
    return {
      nodePath: node.path,
      status: 'error',
      message: tx(BUMP_TEXTS.storeFailedDetail, {
        path: sidecarPath ?? sidecarPathFor(absPath),
        message: formatErrorMessage(err),
      }),
    };
  }

  const outcome: IBumpOutcome = {
    nodePath: node.path,
    status: 'bumped',
    sidecarPath: sidecarPath ?? sidecarPathFor(absPath),
  };
  if (result.report.version !== undefined) outcome.version = result.report.version;
  if (result.report.createdSidecar === true) outcome.createdSidecar = true;
  return outcome;
}

// --- git helpers ---------------------------------------------------------

/**
 * Walk up from `cwd` looking for a `.git/` entry (file or directory —
 * worktrees use a `.git` file). Returns true on first hit, false when
 * the walk reaches the filesystem root.
 */
function isInsideGitRepo(cwd: string): boolean {
  let current = cwd;
  // Bound the walk by the root: `dirname('/')` returns `'/'` so the
  // loop terminates without hitting an infinite check.
  while (true) {
    if (existsSync(resolve(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Combined preflight for `--staged`. Returns `'ok'` when both checks
 * pass, `'no-repo'` when no `.git/` parent is found, `'no-binary'`
 * when the `git` binary is not on PATH (spawn ENOENT).
 */
function ensureGitForStaged(cwd: string): 'ok' | 'no-repo' | 'no-binary' {
  if (!isInsideGitRepo(cwd)) return 'no-repo';
  const probe = spawnSync('git', ['--version'], { stdio: 'ignore' });
  if (probe.error !== undefined) {
    const code = (probe.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'no-binary';
    // Other spawn errors are unexpected — treat as no-binary so the
    // caller surfaces the missing-binary message; the underlying
    // error stays in `probe.error.message` for debugging.
    return 'no-binary';
  }
  return 'ok';
}

/**
 * `git add <abs sidecar path>`. Returns `null` on success or the
 * stderr message on failure. Failures degrade to a warning — the
 * batch keeps running.
 */
function stageSidecar(cwd: string, sidecarAbsPath: string): string | null {
  const result = spawnSync('git', ['add', '--', sidecarAbsPath], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.error !== undefined) return formatErrorMessage(result.error);
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    return stderr.length > 0 ? stderr : `git add exited with code ${result.status}`;
  }
  return null;
}

export const BUMP_COMMANDS = [BumpCommand];
