/**
 * Pure bump-plan computation. Given a set of nodes + a `force` flag,
 * iterate, call into the `core/bump` Action, and return an
 * `IBumpPlan`, one `IBumpPlanItem` per input node describing what
 * the bump verb SHOULD do (apply writes, render a refusal, skip
 * silently, propagate an error). The Action itself is pure (returns
 * a `TActionWrite[]` without touching disk), so the whole `compute`
 * pipeline is side-effect-free and trivially testable.
 *
 * The pure / impure split mirrors the architect-audit recommendation
 * for `bump.ts`: `compute` decides, `execute` writes. The verb (the
 * `BumpCommand` class) is the composition root that wires both halves
 * together with the consent gate and rendering.
 *
 *   verb → computeBumpPlan(nodes) → plan
 *   verb → for item of plan.items:
 *            if 'bumped' → store.applyPatch(...)        (impure)
 *            if 'refused' / 'skipped' / 'error' → render only
 *
 * Why this lives next to `bump.ts` rather than under `plugins/`:
 * `computeBumpPlan` is CLI-specific glue. It consumes `Node` rows from
 * a persisted scan, wraps `bumpAction.invoke` with the `assertContained`
 * path guard, and produces a shape consumed by the CLI verb. The
 * Action itself stays self-contained in `plugins/core/actions/bump/`.
 */

import { resolve } from 'node:path';

import {
  bumpAction,
  type IBumpInput,
  type IBumpReport,
} from '../../plugins/core/actions/bump/index.js';
import { assertContained } from '../../core/paths/path-guard.js';
import type { TActionWrite } from '../../kernel/extensions/index.js';
import type { Node } from '../../kernel/types.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';

/**
 * One row of the bump plan. The status tag discriminates the union:
 *
 *   - `bumped` , the Action wants to mutate disk. `writes` is the list
 *                 the caller must apply via `FilesystemSidecarStore`.
 *                 `report` carries the Action's view (version,
 *                 createdSidecar) so the caller can render without
 *                 re-deriving them.
 *   - `refused`, fresh node without `--force` (single-node semantics).
 *                 The caller renders the refusal hint; no writes.
 *   - `skipped`, Action returned `{ ok: true, noop: true }` (fresh
 *                 node with `--force` in batch mode, where the verb
 *                 treats fresh-with-force as a silent skip). No writes.
 *   - `error`  , path-guard failed OR the Action's `invoke()` threw.
 *                 `message` carries the rendered string the caller
 *                 will emit on the error channel.
 *
 * `absPath` is populated for every variant except `error` triggered by
 * the path-guard itself (where the path could not be resolved).
 */
export type TBumpPlanItem =
  | {
      nodePath: string;
      status: 'bumped';
      absPath: string;
      writes: readonly TActionWrite[];
      report: IBumpReport;
    }
  | {
      nodePath: string;
      status: 'refused';
      absPath: string;
    }
  | {
      nodePath: string;
      status: 'skipped';
      absPath: string;
      reason: 'noop';
    }
  | {
      nodePath: string;
      status: 'error';
      message: string;
    };

export interface IBumpPlan {
  items: readonly TBumpPlanItem[];
}

export interface IBumpPlanOptions {
  /** Scope-relative cwd the persisted `node.path` rows resolve against. */
  cwd: string;
  /** Passes through to the Action's `force` flag. */
  force: boolean;
}

/**
 * Build the plan for a batch of nodes. Side-effect free: the Action
 * is pure (returns `writes` without applying), and the path-guard +
 * `resolve` are FS-free string ops.
 *
 * The output order matches the input order, the caller is free to
 * pre-sort (`--pending` sorts by `node.path` ASC, single-node passes a
 * one-element array). No filtering of fresh-vs-stale here; that's the
 * caller's decision (the Action returns `refused` / `noop` for those
 * cases at its own level).
 */
export function computeBumpPlan(
  nodes: readonly Node[],
  options: IBumpPlanOptions,
): IBumpPlan {
  const items: TBumpPlanItem[] = [];
  for (const node of nodes) {
    items.push(planOne(node, options));
  }
  return { items };
}

function planOne(node: Node, options: IBumpPlanOptions): TBumpPlanItem {
  let absPath: string;
  try {
    assertContained(options.cwd, node.path);
    absPath = resolve(options.cwd, node.path);
  } catch (err) {
    return {
      nodePath: node.path,
      status: 'error',
      message: formatErrorMessage(err),
    };
  }

  let result: { report: IBumpReport; writes?: TActionWrite[] };
  try {
    result = invokeBumpFor(node, absPath, options.force);
  } catch (err) {
    return {
      nodePath: node.path,
      status: 'error',
      message: formatErrorMessage(err),
    };
  }

  if (result.report.ok === false && result.report.reason === 'fresh') {
    return { nodePath: node.path, status: 'refused', absPath };
  }
  if (result.report.ok === true && result.report.noop === true) {
    return { nodePath: node.path, status: 'skipped', absPath, reason: 'noop' };
  }
  return {
    nodePath: node.path,
    status: 'bumped',
    absPath,
    writes: result.writes ?? [],
    report: result.report,
  };
}

/**
 * Invoke the built-in `core/bump` Action against `node`. Returns the
 * full `IActionResult<IBumpReport>` so the caller decides whether to
 * materialise the writes or inspect the report. Exported because
 * the route-level invoker in the BFF (`server/routes/sidecar.ts`)
 * needs the same shape; the CLI verb consumes it through
 * `computeBumpPlan` above.
 */
export function invokeBumpFor(
  node: Node,
  absPath: string,
  force: boolean,
): { report: IBumpReport; writes?: TActionWrite[] } {
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
    settings: {},
  });
}
