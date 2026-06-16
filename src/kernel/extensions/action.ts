/**
 * Action runtime contract. The fourth plugin kind (spec § A.4 +
 * `spec/schemas/extensions/action.schema.json`).
 *
 * Actions operate on one or more nodes in one of two execution modes:
 *
 *   - `deterministic` (default), code runs in-process; the action computes
 *     the report synchronously and returns it. No job file, no runner.
 *   - `probabilistic`, the kernel renders `<action-dir>/prompt.md` + preamble
 *     into a job file; a runner executes it via `RunnerPort` against an
 *     LLM; `sm record` closes the job and validates the report against
 *     `<action-dir>/report.schema.json`.
 *
 * **Structure-as-truth file conventions**: every Action carries
 * `<action-dir>/report.schema.json` (the JSON Schema for the report, MUST
 * extend `report-base.schema.json`). Probabilistic Actions additionally
 * carry `<action-dir>/prompt.md` (the prompt template). The loader resolves
 * both by convention; missing or mis-placed files surface as `load-error`.
 * The `reportSchemaRef` / `promptTemplateRef` manifest fields were retired
 * with the same refactor.
 *
 * **`prob*` prefix convention**: manifest fields that only apply when
 * `mode=probabilistic` start with `prob`. Today only
 * `probExpectedDurationSeconds` follows this convention.
 *
 * **Deferred runtime invocation**: the dispatcher (`Action.invoke(input, ctx)`
 * for deterministic; the `RunnerPort` + `sm record` round-trip for
 * probabilistic) lands fully with the job subsystem (Decision #114 in
 * `ROADMAP.md`). The kernel today still validates manifests and surfaces
 * the precondition gating to the UI; the runtime entry point stays
 * optional until the job subsystem ships.
 */

import type { IExtensionBase } from './base.js';
import type { TExecutionMode, Link, Node } from '../types.js';
import type { IViewContribution } from '../types/view-catalog.js';

export type TActionWrite =
  | {
      kind: 'sidecar';
      path: string;
      changes: Record<string, unknown>;
    };

/**
 * The discriminant kinds an Action may emit through `IActionResult.writes`.
 * Today the union has a single member (`'sidecar'`); the alias keeps the
 * manifest `writes` capability (`IAction.writes`) in lock-step with the
 * runtime write union so a new write kind only has to be added in one place.
 */
export type TActionWriteKind = TActionWrite['kind'];

export interface IActionResult<TReport = unknown> {
  report: TReport;
  writes?: TActionWrite[];
}

export interface IActionContext {
  node: Node;
  nodeAbsolutePath: string;
  invoker: string;
  now: () => Date;
  /**
   * Resolved values of the Action's declared `settings`. Empty when no
   * settings are declared on the manifest.
   */
  settings: Record<string, unknown>;
}

/**
 * Read-only graph context handed to an Action's scan-time `project()`
 * method. Mirrors the Analyzer emit path (`IAnalyzerContext`): the
 * Action sees the full merged graph (`nodes` + `links`) and emits its
 * own per-node view contributions via `emitContribution`, supplying the
 * target node path explicitly because, like the Analyzer, it walks the
 * whole graph rather than running per-node.
 *
 * The contribution is declared in the Action's manifest `ui` map and
 * passed BY REFERENCE (same object-identity model as Extractor /
 * Analyzer emit). The orchestrator validates the payload against the
 * slot's schema at call time, dropping invalid emissions with an
 * `extension.error` event.
 *
 * `project()` is strictly DETERMINISTIC and side-effect-free: no writes,
 * no runner, no IO. It runs during the scan's contribution phase on
 * EVERY scan, exactly like an Analyzer's emit path, so its cost is the
 * same per-scan cost as today's projector analyzers. Even an Action
 * whose `invoke` is `mode: 'probabilistic'` MUST keep `project()`
 * deterministic, only `invoke` may be probabilistic.
 */
export interface IActionProjectionContext {
  readonly nodes: readonly Node[];
  readonly links: readonly Link[];
  emitContribution(nodePath: string, ref: IViewContribution, payload: unknown): void;
}

/**
 * Declarative filter applied by `--all` fan-out, UI button gating, and
 * `sm actions show`. Same shape used by Extractor and Analyzer so the
 * kernel ships a single matcher; the `analyzerIds` field is unique to
 * Action and powers Modelo B (Action declares which Analyzer findings
 * it resolves; replaces the deprecated `Analyzer.recommendedActions`).
 */
export interface IActionPrecondition {
  /**
   * Qualified node kinds this action accepts, written as
   * `<provider-plugin>/<kindName>` (e.g. `claude/agent`). Unknown
   * qualified kinds load OK but surface a `precondition-kind-unknown`
   * warning in `sm plugins doctor`.
   */
  kind?: string[];
  /** Provider ids whose nodes this action accepts. */
  provider?: string[];
  /**
   * Qualified analyzer ids whose findings this action resolves
   * (`<plugin>/<analyzer>` or `<plugin>/<analyzer>:<sub-id>` when the
   * analyzer emits sub-typed issues). The UI matches against this list
   * to surface "Resolve this issue" affordances. Dangling references
   * warn via `recommended-action-missing` in `sm plugins doctor` but
   * do NOT block load.
   */
  analyzerIds?: string[];
}

export interface IAction extends IExtensionBase {
  /** Discriminant injected by the loader from the folder structure. */
  kind: 'action';
  /**
   * Execution mode. Optional with default `deterministic` since the
   * structure-as-truth refactor.
   */
  mode?: TExecutionMode;
  /**
   * Best-effort estimate of wall-clock duration in seconds when
   * `mode=probabilistic`. Drives TTL
   * (`ttl = max(probExpectedDurationSeconds × graceMultiplier,
   * minimumTtlSeconds)`). Required by the schema's conditional for
   * probabilistic Actions; ignored otherwise. Renamed from
   * `expectedDurationSeconds` with the `prob*` prefix convention.
   */
  probExpectedDurationSeconds?: number;
  /**
   * Declared persistent-write capability. Mirrors the `kind`s this
   * Action's `invoke()` may return in `IActionResult.writes`. Today the
   * only kind is `'sidecar'` (the Action creates / modifies a `.sm`
   * annotation sidecar). An Action that returns a sidecar write MUST
   * declare `['sidecar']` here: the manifest declaration is what
   * consumers gate on WITHOUT invoking the action, so the
   * `allowSidecarWriters: false` project policy can drop every
   * sidecar-writer from the scan composer (its `inspector.action.button`
   * never projects) and the sidecar store can refuse the write. Absent =
   * the Action performs no persistent writes (read-only / report-only).
   */
  writes?: TActionWriteKind[];
  /**
   * Optional declarative filter; absent → applies to every node.
   */
  precondition?: IActionPrecondition;
  /**
   * Deterministic invocation entry point. Optional on the runtime
   * contract until the job subsystem ships; Actions that ship for the
   * future probabilistic runner / record path leave it absent.
   * Implementations MUST stay pure (no IO inside `invoke()`); the
   * kernel materialises any returned `writes` after the call.
   */
  invoke?: <TInput, TReport>(
    input: TInput,
    ctx: IActionContext,
  ) => IActionResult<TReport>;
  /**
   * Optional scan-time self-projection. When present, the orchestrator
   * calls it during the contribution phase (right after the analyzer
   * pass) with read-only graph access, and the Action emits its OWN
   * `inspector.action.button` (or any declared `ui` contribution) per
   * node. This replaces the former "projector analyzer" pattern: the
   * button now lives with the Action that dispatches it, not in a
   * sibling Analyzer.
   *
   * MUST be deterministic and side-effect-free (no writes, no runner,
   * no IO), exactly like an Analyzer's emit path. The button declares
   * its own qualified id as `actionId` in the payload. Actions that ship
   * for the future probabilistic runner / record path leave it absent;
   * an Action MAY declare both `project` and `invoke` (advertiser +
   * executor), or only one.
   */
  project?(ctx: IActionProjectionContext): void;
}
