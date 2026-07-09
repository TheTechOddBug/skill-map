/**
 * Pure projection from live tool-invocation state
 * (`NodeActivityService.activeInvocations`, `spec/provider-activity.md`
 * §WS event: node.activity, the `detail` field) to the graph's
 * transient labeled edges: caller -> mcp target, the invoked tool as
 * the label.
 *
 * LAYERED BESIDE `graph()` like the spawn overlay: nothing here reaches
 * `fullLayout`, the reconciler, persisted positions, or the fit bbox.
 * Connector ids reuse the cards' own `-out` / `-in` anchors (Foblex
 * connections are connector-to-connector, connectors are shared with
 * the scan-link edges).
 *
 * An edge survives only when the caller is known AND both endpoints are
 * on the canvas (visible + positioned). A missing caller (a bare
 * main-session call with nothing else lit) draws no edge; the target
 * still glows on its own.
 */

import type { INodeInvocation } from '../../../services/node-activity';
import type { IPoint } from './graph-layout';

export interface IInvocationOverlayEdge {
  /** Stable track key (`<caller>>><target>`). */
  key: string;
  /** Foblex connector ids (`<caller>-out` -> `<target>-in`). */
  outputId: string;
  inputId: string;
  /** The invoked tool, rendered as the edge label. */
  label: string;
}

export const EMPTY_INVOCATION_EDGES: readonly IInvocationOverlayEdge[] = [];

export interface IResolveInvocationOverlayArgs {
  invocations: readonly INodeInvocation[];
  /** Paths currently rendered on the canvas (facet ∩ curation). */
  visiblePaths: ReadonlySet<string>;
  /**
   * EFFECTIVE rendered position resolver (user-pinned drag wins over the
   * dagre output). `undefined` when the path has no resolvable position
   * yet (layout pending), which suppresses the edge.
   */
  positionOf: (path: string) => IPoint | undefined;
}

export function resolveInvocationOverlay(
  args: IResolveInvocationOverlayArgs,
): readonly IInvocationOverlayEdge[] {
  const edges: IInvocationOverlayEdge[] = [];
  for (const inv of args.invocations) {
    const { caller, target } = inv;
    if (caller === null) continue; // no correlated caller: draw nothing
    if (caller === target) continue; // self-edge is visual noise
    if (!args.visiblePaths.has(caller) || !args.visiblePaths.has(target)) continue;
    if (!args.positionOf(caller) || !args.positionOf(target)) continue;
    edges.push({
      key: `${caller}>>${target}`,
      outputId: `${caller}-out`,
      inputId: `${target}-in`,
      label: inv.detail,
    });
  }
  return edges;
}
