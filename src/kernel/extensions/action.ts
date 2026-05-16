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
import type { TExecutionMode, Node } from '../types.js';

export type TActionWrite =
  | {
      kind: 'sidecar';
      path: string;
      changes: Record<string, unknown>;
    };

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
}
