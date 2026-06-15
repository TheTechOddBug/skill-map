/**
 * Coverage for the confidence-fold algebra
 * (`kernel/orchestrator/confidence-score.ts`). The fold is the pure
 * combination engine: the kernel seeds the 1.0 confidence baseline and the
 * built-in score-phase detectors (`core/name-reserved`,
 * `core/reference-broken`) apply penalty deltas on top, while third-party
 * scorers compose arbitrary `set` / `delta` / `floor` / `ceil` ops. These
 * cases pin every op-kind path and the deterministic, clamp-once fold
 * across all four buckets, independent of which analyzer emits the op.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { foldConfidence, type TConfidenceOp } from '../confidence-score.js';

describe('foldConfidence, per-op-kind paths', () => {
  it('`set 1.0` overrides the base (a scorer that pins full confidence)', () => {
    assert.equal(foldConfidence(0.85, [{ kind: 'set', value: 1.0 }]), 1.0);
    assert.equal(foldConfidence(0.5, [{ kind: 'set', value: 1.0 }]), 1.0);
  });

  it('`set 0.1` overrides the base (a scorer that pins a low value)', () => {
    assert.equal(foldConfidence(0.8, [{ kind: 'set', value: 0.1 }]), 0.1);
  });

  it('`ceil 0.5` caps but never raises (matches `min`)', () => {
    // High base lowered to the cap.
    assert.equal(foldConfidence(0.95, [{ kind: 'ceil', value: 0.5 }]), 0.5);
    assert.equal(foldConfidence(0.5, [{ kind: 'ceil', value: 0.5 }]), 0.5);
    // Base already below the cap keeps its lower value.
    assert.equal(foldConfidence(0.3, [{ kind: 'ceil', value: 0.5 }]), 0.3);
  });

  it('not-bumped / virtual: no op leaves the emit base untouched', () => {
    assert.equal(foldConfidence(0.8, []), 0.8);
    assert.equal(foldConfidence(0.6, []), 0.6);
  });
});

describe('foldConfidence, third-party deltas + combinations', () => {
  it('sums deltas additively', () => {
    assert.equal(
      foldConfidence(0.5, [
        { kind: 'delta', value: 0.2 },
        { kind: 'delta', value: -0.1 },
      ]),
      0.6,
    );
  });

  it('clamps to [0,1] once at the end (opposing deltas round-trip)', () => {
    // Without intermediate clamping, -0.4 then +0.4 returns to base.
    assert.equal(
      foldConfidence(0.3, [
        { kind: 'delta', value: -0.4 },
        { kind: 'delta', value: 0.4 },
      ]),
      0.3,
    );
    // Overshoot clamps.
    assert.equal(foldConfidence(0.9, [{ kind: 'delta', value: 0.5 }]), 1.0);
    assert.equal(foldConfidence(0.2, [{ kind: 'delta', value: -0.5 }]), 0);
  });

  it('applies a `set`, then deltas layer on top', () => {
    // set 0.1 replaces the 0.85 base, then +0.2 → ~0.3 (float tolerance).
    const result = foldConfidence(0.85, [
      { kind: 'set', value: 0.1 },
      { kind: 'delta', value: 0.2 },
    ]);
    assert.ok(Math.abs(result - 0.3) < 1e-9, `expected ~0.3, got ${result}`);
  });

  it('ceil dominates a colliding floor (cap wins)', () => {
    assert.equal(
      foldConfidence(0.8, [
        { kind: 'floor', value: 0.9 },
        { kind: 'ceil', value: 0.5 },
      ]),
      0.5,
    );
  });

  it('floor raises a low value', () => {
    assert.equal(foldConfidence(0.2, [{ kind: 'floor', value: 0.6 }]), 0.6);
  });

  it('last `set` in canonical order wins', () => {
    const ops: TConfidenceOp[] = [
      { kind: 'set', value: 0.1 },
      { kind: 'set', value: 0.9 },
    ];
    assert.equal(foldConfidence(0.5, ops), 0.9);
  });

  it('is order-independent across buckets (set/delta/floor/ceil)', () => {
    const a = foldConfidence(0.4, [
      { kind: 'set', value: 0.7 },
      { kind: 'delta', value: 0.1 },
      { kind: 'ceil', value: 0.95 },
      { kind: 'floor', value: 0.2 },
    ]);
    const b = foldConfidence(0.4, [
      { kind: 'floor', value: 0.2 },
      { kind: 'ceil', value: 0.95 },
      { kind: 'delta', value: 0.1 },
      { kind: 'set', value: 0.7 },
    ]);
    assert.equal(a, b);
    assert.ok(Math.abs(a - 0.8) < 1e-9);
  });
});
