/**
 * Built-in deterministic `mark-superseded` Action (STUB).
 *
 * Companion declarer for the `core/superseded` analyzer. The analyzer
 * surfaces nodes whose sidecar already declares `supersededBy`; this
 * Action is how the user *writes* that field in the first place.
 *
 * Conceptually parallel to `bumpAction`: the real implementation will
 * compute a sidecar write payload (`TActionWrite { kind: 'sidecar',
 * ... }`) that sets `annotations.supersededBy` on the current node
 * and stamps the audit block. The kernel materialises the write
 * through `ISidecarStore` after the call returns.
 *
 * **Today this is a stub** that returns `{ ok: true, noop: true }`
 * unconditionally. The real implementation needs:
 *
 *   1. Validation: `input.supersededBy` exists in the live node set.
 *   2. Cycle check: the target does not transitively supersede the
 *      current node (no `A supersededBy B supersededBy A`).
 *   3. Sidecar write: deep-merge `annotations.supersededBy` and
 *      stamp `audit`.
 *   4. Report schema: dedicated
 *      `mark-superseded-report.schema.json` carrying the previous
 *      value (if any) for "undo".
 *
 * Pairs textually with `core/superseded`. No formal
 * `IAnalyzer → IAction` wire exists in the spec yet (no `fixAction`
 * field on `IAnalyzer` or `Issue`); the link lives in this docstring
 * and the analyzer's.
 */

import type {
  IAction,
  IActionContext,
  IActionResult,
} from '../../../kernel/extensions/index.js';

/**
 * Input parameters accepted by `mark-superseded`.
 *
 *   - `supersededBy` — repo-relative path to the node that replaces
 *     the current one. The Action writes this verbatim into the
 *     current node's `annotations.supersededBy`.
 */
export interface IMarkSupersededInput {
  supersededBy: string;
}

/**
 * Report shape for the stub. Mirrors the `ok` field from the
 * deterministic base. A real `previousSupersededBy` lands with the
 * implementation so callers can offer "undo".
 */
export interface IMarkSupersededReport {
  ok: boolean;
  noop?: boolean;
}

const ID = 'mark-superseded';
const PLUGIN_ID = 'core';

export const markSupersededAction: IAction = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  version: '0.0.0',
  description:
    'Declares the current node as superseded by another (writes `supersededBy` to the sidecar). Paired with the `core/superseded` analyzer.',
  stability: 'experimental',
  mode: 'deterministic',
  reportSchemaRef: 'https://skill-map.dev/spec/v0/report-base-deterministic.schema.json',

  invoke<TInput, TReport>(
    _input: TInput,
    _ctx: IActionContext,
  ): IActionResult<TReport> {
    const report: IMarkSupersededReport = { ok: true, noop: true };
    return { report: report as unknown as TReport };
  },
};
