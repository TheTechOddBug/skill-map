import { describe, expect, it } from 'vitest';
import { EFConnectionConnectableSide } from '@foblex/flow';

import {
  CONNECTION_SIDES_BY_DIRECTION,
  resolveConnectionSides,
} from '../connection-sides';

describe('connection-sides, CONNECTION_SIDES_BY_DIRECTION', () => {
  it('maps each layout direction to a complementary input/output pair', () => {
    // Same-element connectors anchor to opposite card edges, so the
    // output side ALWAYS faces the input side across the four
    // directions. This table-driven check catches a regression where
    // a future edit flips a sign and breaks the geometry contract.
    const opposites: ReadonlyArray<[EFConnectionConnectableSide, EFConnectionConnectableSide]> = [
      [EFConnectionConnectableSide.TOP, EFConnectionConnectableSide.BOTTOM],
      [EFConnectionConnectableSide.BOTTOM, EFConnectionConnectableSide.TOP],
      [EFConnectionConnectableSide.LEFT, EFConnectionConnectableSide.RIGHT],
      [EFConnectionConnectableSide.RIGHT, EFConnectionConnectableSide.LEFT],
    ];
    function isOpposite(a: EFConnectionConnectableSide, b: EFConnectionConnectableSide): boolean {
      return opposites.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
    }
    for (const dir of Object.keys(CONNECTION_SIDES_BY_DIRECTION) as Array<
      keyof typeof CONNECTION_SIDES_BY_DIRECTION
    >) {
      const { input, output } = CONNECTION_SIDES_BY_DIRECTION[dir];
      expect(isOpposite(input, output), `direction ${dir}`).toBe(true);
    }
  });

  it('places the output side along the layout flow direction', () => {
    // The output is where the edge LEAVES the source card, so it
    // should sit on the edge the layout flows toward.
    expect(CONNECTION_SIDES_BY_DIRECTION.TOP_BOTTOM.output).toBe(EFConnectionConnectableSide.BOTTOM);
    expect(CONNECTION_SIDES_BY_DIRECTION.BOTTOM_TOP.output).toBe(EFConnectionConnectableSide.TOP);
    expect(CONNECTION_SIDES_BY_DIRECTION.LEFT_RIGHT.output).toBe(EFConnectionConnectableSide.RIGHT);
    expect(CONNECTION_SIDES_BY_DIRECTION.RIGHT_LEFT.output).toBe(EFConnectionConnectableSide.LEFT);
  });
});

describe('connection-sides, resolveConnectionSides', () => {
  it('returns the directional pair for dagre-based algorithms', () => {
    expect(resolveConnectionSides('network-simplex', 'TOP_BOTTOM')).toEqual({
      input: EFConnectionConnectableSide.TOP,
      output: EFConnectionConnectableSide.BOTTOM,
    });
    expect(resolveConnectionSides('longest-path', 'LEFT_RIGHT')).toEqual({
      input: EFConnectionConnectableSide.LEFT,
      output: EFConnectionConnectableSide.RIGHT,
    });
  });

  it('falls back to CALCULATE mode under force layout', () => {
    // Force has no flow direction; Foblex's CALCULATE mode picks the
    // side per-connection from the actual geometry so the arrow head
    // always points away from the node.
    const sides = resolveConnectionSides('force', 'TOP_BOTTOM');
    expect(sides).toEqual({
      input: EFConnectionConnectableSide.CALCULATE,
      output: EFConnectionConnectableSide.CALCULATE,
    });
  });

  it('ignores the direction argument under force layout', () => {
    // All four directions should collapse to the same CALCULATE pair
    // when the algorithm does not honour direction. Belt-and-braces
    // assertion against a future edit that branches on direction
    // before checking the algorithm gate.
    const directions: ReadonlyArray<Parameters<typeof resolveConnectionSides>[1]> = [
      'TOP_BOTTOM',
      'BOTTOM_TOP',
      'LEFT_RIGHT',
      'RIGHT_LEFT',
    ];
    for (const dir of directions) {
      expect(resolveConnectionSides('force', dir)).toEqual({
        input: EFConnectionConnectableSide.CALCULATE,
        output: EFConnectionConnectableSide.CALCULATE,
      });
    }
  });
});
