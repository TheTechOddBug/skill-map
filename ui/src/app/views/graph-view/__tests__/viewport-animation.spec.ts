import { describe, expect, it } from 'vitest';

import { computeCenterTransform } from '../viewport-animation';

// Node card dimensions baked into the fit math (kept in sync with
// `viewport-animation.ts`). Centre offset is half of each.
const NODE_W = 260;
const NODE_H = 120;

describe('computeCenterTransform', () => {
  it('keeps the scale untouched (pan only, no zoom)', () => {
    const result = computeCenterTransform({
      point: { x: 100, y: 200 },
      wrap: { width: 1000, height: 800 },
      panelW: 0,
      scale: 0.7,
    });
    expect(result.scale).toBe(0.7);
  });

  it('lands the node centre at the middle of the wrap when no panel is open', () => {
    const wrap = { width: 1000, height: 800 };
    const scale = 1;
    const point = { x: 100, y: 200 };
    const result = computeCenterTransform({ point, wrap, panelW: 0, scale });

    // Screen position of the node centre after applying the transform.
    const nodeCenterScreenX = result.position.x + (point.x + NODE_W / 2) * scale;
    const nodeCenterScreenY = result.position.y + (point.y + NODE_H / 2) * scale;
    expect(nodeCenterScreenX).toBeCloseTo(wrap.width / 2);
    expect(nodeCenterScreenY).toBeCloseTo(wrap.height / 2);
  });

  it('centres in the VISIBLE half when the inspector panel reserves width', () => {
    const wrap = { width: 1000, height: 800 };
    const panelW = 400;
    const scale = 1;
    const point = { x: 100, y: 200 };
    const result = computeCenterTransform({ point, wrap, panelW, scale });

    const nodeCenterScreenX = result.position.x + (point.x + NODE_W / 2) * scale;
    // Visible area is the wrap minus the right-edge panel.
    expect(nodeCenterScreenX).toBeCloseTo((wrap.width - panelW) / 2);
  });

  it('applies the current zoom to the centring offset', () => {
    const wrap = { width: 1200, height: 900 };
    const scale = 1.5;
    const point = { x: 80, y: 40 };
    const result = computeCenterTransform({ point, wrap, panelW: 0, scale });

    const nodeCenterScreenX = result.position.x + (point.x + NODE_W / 2) * scale;
    const nodeCenterScreenY = result.position.y + (point.y + NODE_H / 2) * scale;
    expect(nodeCenterScreenX).toBeCloseTo(wrap.width / 2);
    expect(nodeCenterScreenY).toBeCloseTo(wrap.height / 2);
  });
});
