/**
 * Built-in deterministic `node-supersede` Action.
 *
 * Per-node Action the user invokes to *declare* that the current node
 * is superseded by another. The companion `core/node-superseded`
 * analyzer reads the resulting `supersededBy` field and surfaces it as
 * an `info` issue, while `core/supersede` projects the inspector button
 * that dispatches this Action.
 *
 * Conceptually parallel to `nodeBumpAction`: the Action stays pure (no
 * IO inside `invoke()`), computes a sidecar write payload
 * (`TActionWrite { kind: 'sidecar', ... }`) that sets
 * `annotations.supersededBy` on the current node and stamps the audit
 * block, and returns it for the kernel to materialise through
 * `ISidecarStore` after the call returns.
 *
 * Behaviour:
 *
 *   - Self-supersede (`input.supersededBy === ctx.node.path`) -> refuse.
 *     Return `{ ok: false, reason: 'self' }`, no `writes`. The BFF maps
 *     the refusal to a `self`-coded envelope; tests assert on the shape.
 *   - Otherwise -> write. Deep-merge `annotations.supersededBy`, refresh
 *     the identity hashes, and stamp `audit.lastBumpedAt` /
 *     `lastBumpedBy`. Return `{ ok: true, supersededBy }` + the write.
 *
 * The Action does NOT validate that `input.supersededBy` exists in the
 * live node set: the Action context only sees the one node it operates
 * on, and a dangling target is caught downstream by
 * `core/reference-broken`.
 *
 * **NOT listed in `core/node-superseded.recommendedActions`**: when the
 * analyzer fires, the user already declared the supersession on
 * purpose; there is nothing to "fix". `node-supersede` is a *declarer*,
 * surfaced in the inspector via the `core/supersede` analyzer's button
 * contribution, not as a fix for the issue.
 */

import type {
  IAction,
  IActionContext,
  IActionResult,
  IBuiltInManifest,
  TActionWrite,
} from '../../../../kernel/extensions/index.js';
import { sidecarPathFor } from '../../../../kernel/sidecar/parse.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

/**
 * Input parameters accepted by `node-supersede`.
 *
 *   - `supersededBy`, repo-relative path to the node that replaces the
 *     current one. The Action writes this verbatim into the current
 *     node's `annotations.supersededBy`.
 */
export interface INodeSupersedeInput {
  supersededBy: string;
}

/**
 * Report shape returned by the deterministic `invoke`. Parallels
 * `node-bump`'s in-process report (`ok` + payload), distinct from the
 * probabilistic-record contract in `report.schema.json`.
 *
 *   - refusal: `{ ok: false, reason: 'self' }`.
 *   - success: `{ ok: true, supersededBy }`.
 */
export interface INodeSupersedeReport {
  ok: boolean;
  reason?: 'self';
  supersededBy?: string;
}

const ID = 'node-supersede';

export const nodeSupersedeAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Declares the current node as superseded by another (writes `supersededBy` to the sidecar).',
  // Ships disabled by default (the declarer feature is still settling its
  // node-picker UX). Gates as a unit with its button projector
  // `core/supersede`, which is experimental for the same reason.
  stability: 'experimental',
  mode: 'deterministic',

  // The runtime contract uses generic <TInput, TReport>; supersede
  // narrows both. The cast is the standard pattern for built-ins that
  // want typed local I/O while staying compatible with the open generic.
  invoke<TInput, TReport>(
    rawInput: TInput,
    ctx: IActionContext,
  ): IActionResult<TReport> {
    const input = (rawInput ?? {}) as INodeSupersedeInput;
    return invokeSupersede(input, ctx) as IActionResult<TReport>;
  },
};

function invokeSupersede(
  input: INodeSupersedeInput,
  ctx: IActionContext,
): IActionResult<INodeSupersedeReport> {
  const supersededBy = input.supersededBy;

  // Self-supersede is a no-op declaration ("A is superseded by A"); the
  // Action refuses rather than write a meaningless edge. The context
  // only sees this one node, so a dangling target is NOT validated here
  // (caught downstream by `core/reference-broken`).
  if (supersededBy === ctx.node.path) {
    return { report: { ok: false, reason: 'self' } };
  }

  const timestamp = ctx.now().toISOString();
  const write: TActionWrite = {
    kind: 'sidecar',
    path: sidecarPathFor(ctx.nodeAbsolutePath),
    changes: {
      identity: {
        path: ctx.node.path,
        bodyHash: ctx.node.bodyHash,
        frontmatterHash: ctx.node.frontmatterHash,
      },
      annotations: { supersededBy },
      audit: {
        lastBumpedAt: timestamp,
        lastBumpedBy: ctx.invoker,
      },
    },
  };

  const report: INodeSupersedeReport = { ok: true, supersededBy };
  return { report, writes: [write] };
}
