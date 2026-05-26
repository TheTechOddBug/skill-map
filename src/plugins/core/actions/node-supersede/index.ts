/**
 * Built-in deterministic `node-supersede` Action (STUB).
 *
 * Per-node Action the user invokes to *declare* that the current
 * node is superseded by another. The companion `core/node-superseded`
 * analyzer reads the resulting `supersededBy` field and surfaces it
 * as an `info` issue.
 *
 * Conceptually parallel to `nodeBumpAction`: the real implementation will
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
 *   5. Precondition: declare an `IActionPrecondition` that scopes the
 *      Action to non-virtual nodes (no point declaring supersession
 *      on a synthesised node) and hides it on nodes that already
 *      carry `annotations.supersededBy` (the right UX there is
 *      "remove" or "change", not a fresh declaration). Until then
 *      the Action is offered on every node, which is wrong but
 *      harmless while the stub returns noop.
 *
 * **NOT listed in `core/node-superseded.recommendedActions`**: when the
 * analyzer fires, the user already declared the supersession on
 * purpose; there is nothing to "fix". `node-supersede` is a
 * *declarer*, surfaced in the inspector's "applicable Actions" list
 * via its own `IActionPrecondition`, not as a fix for the issue.
 */

import type {
  IAction,
  IActionContext,
  IActionResult,
  IBuiltInManifest,
} from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

/**
 * Input parameters accepted by `node-supersede`.
 *
 *   - `supersededBy`, repo-relative path to the node that replaces
 *     the current one. The Action writes this verbatim into the
 *     current node's `annotations.supersededBy`.
 */
export interface INodeSupersedeInput {
  supersededBy: string;
}

/**
 * Report shape for the stub. Mirrors the `ok` field from the
 * deterministic base. A real `previousSupersededBy` lands with the
 * implementation so callers can offer "undo".
 */
export interface INodeSupersedeReport {
  ok: boolean;
  noop?: boolean;
}

const ID = 'node-supersede';

export const nodeSupersedeAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Declares the current node as superseded by another (writes `supersededBy` to the sidecar).',
  mode: 'deterministic',

  invoke<TInput, TReport>(
    _input: TInput,
    _ctx: IActionContext,
  ): IActionResult<TReport> {
    const report: INodeSupersedeReport = { ok: true, noop: true };
    return { report: report as unknown as TReport };
  },
};
