/**
 * Hook runtime contract. The sixth plugin kind (spec § A.11).
 *
 * Hooks subscribe declaratively to a curated set of kernel lifecycle
 * events and react to them. Reaction-only by design: a hook cannot
 * mutate the pipeline, block emission, or alter outputs. Use cases
 * are notification (Slack on `job.completed`), integration glue (CI
 * webhook on `job.failed`), and bookkeeping (per-extractor metrics).
 *
 * The hookable trigger set is INTENTIONALLY SMALL, ten events. Eight
 * are pipeline-driven (emitted from inside `runScan`); two
 * (`boot`, `shutdown`) are CLI-process-driven (emitted by the driving
 * binary before / after the verb runs, fire-and-forget so
 * `process.exit` is never blocked). The full `ProgressEmitterPort`
 * catalog (per-node `scan.progress`, `model.delta`, `run.*`, internal
 * job lifecycle) is deliberately not hookable: too verbose for a
 * reactive surface, internal to the runner, or covered elsewhere.
 * Declaring a trigger outside the curated set yields
 * `invalid-manifest` at load time.
 *
 * **Deterministic-only since the structure-as-truth refactor**: the
 * `mode` field was removed from the manifest. `on(ctx)` runs in-process
 * during the dispatch of the matching event, synchronously between the
 * event's emission and the next pipeline step. Errors are caught by
 * the dispatcher, logged via `extension.error`, and never block the
 * main flow. To react to a lifecycle event with an LLM call, write a
 * deterministic Hook that enqueues a probabilistic Action via
 * `ctx.queue('<plugin>/<action>', payload)`.
 *
 * Curated trigger set (per spec § A.11):
 *
 *   0. `boot`                , once per CLI process, before verb routing.
 *   1. `scan.started`        , pre-scan setup (one per scan).
 *   2. `scan.completed`      , post-scan reaction (one per scan).
 *   3. `extractor.completed` , aggregated per-Extractor outputs.
 *   4. `analyzer.completed`      , aggregated per-Rule outputs.
 *   5. `action.completed`    , Action executed on a node.
 *   6. `job.spawning`        , pre-spawn of runner subprocess.
 *   7. `job.completed`       , most common trigger.
 *   8. `job.failed`          , alerts, retry triggers.
 *   9. `shutdown`            , once per CLI process, after the verb's
 *                                exit code resolves and before
 *                                `process.exit`.
 */

import type { IExtensionBase } from './base.js';
import type { Node } from '../types.js';

/**
 * The ten hookable lifecycle events. Mirrors the `triggers[]` enum in
 * `spec/schemas/extensions/hook.schema.json`. Eight are pipeline-driven
 * (emitted from inside `runScan`); two (`boot`, `shutdown`) are
 * CLI-process-driven (emitted by the driving binary before / after the
 * verb runs). Anything outside this set is rejected at load time as
 * `invalid-manifest`.
 */
export type THookTrigger =
  | 'boot'
  | 'scan.started'
  | 'scan.completed'
  | 'extractor.completed'
  | 'analyzer.completed'
  | 'action.completed'
  | 'job.spawning'
  | 'job.completed'
  | 'job.failed'
  | 'shutdown';

/**
 * Frozen list mirror of `THookTrigger` for runtime introspection. The
 * loader validates `manifest.triggers[]` against this set; the
 * dispatcher iterates it in order when fanning an event out to
 * subscribed hooks. `boot` first / `shutdown` last so a debug log of
 * the array reads in lifecycle order.
 */
export const HOOK_TRIGGERS: readonly THookTrigger[] = Object.freeze([
  'boot',
  'scan.started',
  'scan.completed',
  'extractor.completed',
  'analyzer.completed',
  'action.completed',
  'job.spawning',
  'job.completed',
  'job.failed',
  'shutdown',
] as const);

/**
 * Context the dispatcher hands to `Hook.on()`. The shape is intentionally
 * narrow: a hook reacts to an event, it does not steer the pipeline.
 *
 * The `event` carries the raw `ProgressEvent` envelope (type, timestamp,
 * runId/jobId when applicable, data). Optional `node` / `extractorId`
 * / `analyzerId` / `actionId` are extracted from the event payload by the
 * dispatcher when present so authors don't have to walk `event.data`.
 *
 * Probabilistic hooks additionally receive `runner` for LLM dispatch.
 * Deterministic hooks SHOULD ignore the field.
 */
export interface IHookContext {
  /**
   * Resolved values of the hook's declared `settings`, populated from
   * project config + user overrides. Empty object when no settings are
   * declared.
   */
  settings: Record<string, unknown>;
  /** The raw event the dispatcher matched. */
  event: {
    type: THookTrigger;
    timestamp: string;
    runId?: string;
    jobId?: string;
    data?: unknown;
  };
  /**
   * Convenience extraction of the node payload when the event is
   * node-scoped (`action.completed`). Undefined for run-scoped or
   * scan-scoped events.
   */
  node?: Node;
  /**
   * Set on `extractor.completed` events. Qualified extension id of the
   * Extractor whose work the event aggregates.
   */
  extractorId?: string;
  /**
   * Set on `analyzer.completed` events. Qualified extension id of the Rule.
   */
  analyzerId?: string;
  /**
   * Set on `action.completed` events. Qualified extension id of the
   * Action that just ran.
   */
  actionId?: string;
  /**
   * Set on `job.*` events once the job subsystem lands. Carries the
   * report payload for `job.completed`, the failure record for
   * `job.failed`, and the spawn metadata for `job.spawning`.
   */
  jobResult?: unknown;
  /**
   * Enqueue a probabilistic Action as a deferred job. The Hook stays
   * deterministic; LLM dispatch happens via the job subsystem the
   * Action drives. Available when the job subsystem is wired in;
   * placeholder `undefined` for legacy callers.
   */
  queue?: (actionId: string, payload: unknown) => void;
  /**
   * Projection of the loaded Action catalog, supplied by the driver that
   * wires `ctx.queue` (the record path, on `job.*` dispatch). Lets a hook
   * resolve the INVERSE of Modelo B (the fixer Actions a finder's findings
   * feed, `spec/architecture.md` §Analyzer ↔ Action relationship) without
   * importing the registry: the opt-in `core/auto-fix` hook filters this
   * list by `analyzerIds` and `ctx.queue`s each match. Absent for drivers
   * that do not queue (they never dispatch a hook that needs it).
   */
  actions?: readonly IHookActionInfo[];
}

/**
 * Minimal per-Action projection the dispatcher hands a hook via
 * `IHookContext.actions`: the qualified id plus the Action's declared
 * `precondition.analyzerIds` (Modelo B, the finders whose findings it
 * resolves; empty for a non-fixer Action). Deliberately narrower than
 * `IAction` so a hook never reaches the full runtime object.
 */
export interface IHookActionInfo {
  /** Qualified extension id (`<plugin>/<id>`). */
  id: string;
  /** The Action's `precondition.analyzerIds`; empty for a non-fixer. */
  analyzerIds: readonly string[];
}

/**
 * Optional declarative filter applied by the dispatcher BEFORE
 * invoking `on(ctx)`. Keys are payload field paths (top-level only in
 * v0.x); values are the literal expected match. The dispatcher walks
 * `event.data` for the field and short-circuits the invocation if the
 * value disagrees.
 *
 * Cross-field validation against declared `triggers` is best-effort
 * at load time: when none of the declared triggers carries a given
 * filter field, the loader surfaces `invalid-manifest`. The current
 * impl performs the basic enum check but defers full payload-shape
 * cross-validation to a follow-up, the dispatcher is permissive at
 * runtime (an unknown field never matches → the hook simply never
 * fires for that event, which is a correct interpretation of "filter
 * by a field that doesn't exist").
 */
export type THookFilter = Record<string, string | number | boolean>;

export interface IHook extends IExtensionBase {
  /** Discriminant injected by the loader from the folder structure. */
  kind: 'hook';
  /**
   * Subset of the curated lifecycle trigger set this hook subscribes
   * to. MUST be non-empty; every entry MUST be a member of
   * `HOOK_TRIGGERS`. The loader validates both invariants and surfaces
   * `invalid-manifest` on violation.
   */
  triggers: THookTrigger[];
  /**
   * Optional declarative filter. Absent → invoke on every dispatched
   * event of every declared trigger.
   */
  filter?: THookFilter;
  /**
   * Hook entry point. Returns nothing; reactions are side effects.
   * Errors are caught by the dispatcher (logged as `extension.error`,
   * surfaced via `hook.failed` meta-event) and NEVER block the main
   * pipeline, a buggy hook degrades gracefully.
   */
  on(ctx: IHookContext): void | Promise<void>;
}
