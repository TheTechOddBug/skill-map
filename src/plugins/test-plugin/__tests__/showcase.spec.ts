/**
 * The settings-showcase invariant: `test-plugin/showcase` declares
 * EXACTLY one setting per input-type in the closed catalog. A 13th
 * catalog member fails this suite until the showcase (the operator's
 * living test surface for every control) learns it, and a stray
 * declaration outside the catalog can never ship.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { showcaseExtractor } from '../extractors/showcase/index.js';
import { ALL_INPUT_TYPE_NAMES } from '../../../kernel/types/view-catalog.js';

describe('test-plugin/showcase', () => {
  it('covers every input-type in the closed catalog, exactly once each', () => {
    const declared = Object.values(showcaseExtractor.settings ?? {}).map((d) => d.type);
    assert.deepEqual(
      [...declared].sort(),
      [...ALL_INPUT_TYPE_NAMES].sort(),
      'the showcase must declare one setting per catalog input-type',
    );
  });

  it('ships disabled by default WITHOUT the experimental badge', () => {
    assert.equal(showcaseExtractor.defaultEnabled, false);
    assert.equal(showcaseExtractor.stability, undefined, 'no maturity mislabel');
  });

  it('is a graph no-op: no ui contributions, nothing emitted', () => {
    assert.equal(showcaseExtractor.ui, undefined);
    assert.doesNotThrow(() =>
      (showcaseExtractor.extract as unknown as () => void)(),
    );
  });
});
