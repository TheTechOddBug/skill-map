/**
 * Connector-side resolution for the graph view's `<f-connection>` +
 * `<div fNode>` bindings.
 *
 * The side pair flows two places:
 *   - `<f-connection>` via `[fOutputSide]` / `[fInputSide]`.
 *   - `<div fNode>` via `[fInputConnectableSide]` /
 *     `[fOutputConnectableSide]` (same-element connector pattern, so
 *     each card edge becomes its own geometric anchor).
 *
 * Why a helper instead of inline in `graph-view.ts`: the
 * direction -> side table is a four-row truth table with one branch
 * (force layout falls back to Foblex's `CALCULATE` mode). Pulling it
 * out keeps the view component focused on rendering + drag state, and
 * lets the table grow a unit-test surface without dragging the
 * view's Angular setup along.
 *
 * The four direction -> side pairs match Foblex's reference example
 * (`libs/f-examples/plugins/f-layout/utils/layout-connection-sides`).
 */

import { EFConnectionConnectableSide } from '@foblex/flow';

import { algorithmUsesDirection, type TLayoutAlgorithm, type TLayoutDirection } from './layout-controls';

export interface IConnectionSides {
  readonly input: EFConnectionConnectableSide;
  readonly output: EFConnectionConnectableSide;
}

/**
 * Connector-side pairs per layout direction. Mirrors Foblex's
 * `getDirectionalLayoutConnectionSides` reference helper: in a
 * top-to-bottom layout the source's output sits at the bottom of the
 * card and the target's input at the top; left-to-right swaps the
 * axis.
 */
export const CONNECTION_SIDES_BY_DIRECTION: Readonly<Record<TLayoutDirection, IConnectionSides>> = {
  TOP_BOTTOM: {
    output: EFConnectionConnectableSide.BOTTOM,
    input: EFConnectionConnectableSide.TOP,
  },
  BOTTOM_TOP: {
    output: EFConnectionConnectableSide.TOP,
    input: EFConnectionConnectableSide.BOTTOM,
  },
  LEFT_RIGHT: {
    output: EFConnectionConnectableSide.RIGHT,
    input: EFConnectionConnectableSide.LEFT,
  },
  RIGHT_LEFT: {
    output: EFConnectionConnectableSide.LEFT,
    input: EFConnectionConnectableSide.RIGHT,
  },
};

/**
 * Resolve the connector-side pair for the active algorithm + direction.
 *
 * Force layout has no consistent flow direction, every edge can shoot
 * in any direction. Returns Foblex's `CALCULATE` mode so the engine
 * picks the side per-connection from the actual geometry (line angle
 * between connector centres), arrows always point away from the node
 * instead of getting pinned to a fixed edge.
 */
export function resolveConnectionSides(
  algorithm: TLayoutAlgorithm,
  direction: TLayoutDirection,
): IConnectionSides {
  if (!algorithmUsesDirection(algorithm)) {
    return {
      input: EFConnectionConnectableSide.CALCULATE,
      output: EFConnectionConnectableSide.CALCULATE,
    };
  }
  return CONNECTION_SIDES_BY_DIRECTION[direction];
}
