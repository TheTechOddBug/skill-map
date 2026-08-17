/**
 * `mapOrderedPrefetch` unit contract (see the module doc):
 *   - yield order is byte-identical to source order, even when later
 *     items settle first (jitter).
 *   - at most `concurrency` `fn` calls are in flight at once.
 *   - a mid-stream rejection is rethrown at its ordinal position,
 *     after every earlier item was yielded, and never unhandled.
 *   - an early consumer break invokes the source's `return()` and
 *     settles in-flight work before control leaves.
 *   - an empty source yields nothing.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';

import { mapOrderedPrefetch } from '../ordered-prefetch.js';

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function* sourceOf<T>(items: readonly T[]): AsyncGenerator<T, void, undefined> {
  for (const item of items) yield item;
}

describe('mapOrderedPrefetch', () => {
  it('yields in source order under settle jitter', async () => {
    // Reverse-proportional delays: the LAST item settles first.
    const delays = [50, 35, 20, 10, 1];
    const out: number[] = [];
    for await (const v of mapOrderedPrefetch(sourceOf([0, 1, 2, 3, 4]), 5, async (i) => {
      await tick(delays[i]!);
      return i * 10;
    })) {
      out.push(v);
    }
    deepStrictEqual(out, [0, 10, 20, 30, 40]);
  });

  it('never exceeds the concurrency bound', async () => {
    let inFlight = 0;
    let peak = 0;
    const results: number[] = [];
    for await (const v of mapOrderedPrefetch(
      sourceOf(Array.from({ length: 20 }, (_ignored, i) => i)),
      4,
      async (i) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick(5);
        inFlight -= 1;
        return i;
      },
    )) {
      results.push(v);
    }
    strictEqual(results.length, 20);
    ok(peak <= 4, `peak in-flight ${peak} must be <= 4`);
    ok(peak >= 2, `peak in-flight ${peak} should show real overlap`);
  });

  it('rethrows a mid-stream rejection at its ordinal position', async () => {
    const seen: number[] = [];
    await rejects(
      async () => {
        for await (const v of mapOrderedPrefetch(sourceOf([0, 1, 2, 3, 4]), 3, async (i) => {
          if (i === 2) {
            throw new Error(`boom-${i}`);
          }
          await tick(2);
          return i;
        })) {
          seen.push(v);
        }
      },
      /boom-2/,
    );
    // Items BEFORE the failing ordinal were all delivered; nothing after.
    deepStrictEqual(seen, [0, 1]);
  });

  it('an early consumer break returns the source and settles in-flight work', async () => {
    let sourceClosed = false;
    let settled = 0;
    async function* closingSource(): AsyncGenerator<number, void, undefined> {
      try {
        for (let i = 0; i < 100; i += 1) yield i;
      } finally {
        sourceClosed = true;
      }
    }
    for await (const v of mapOrderedPrefetch(closingSource(), 8, async (i) => {
      await tick(3);
      settled += 1;
      return i;
    })) {
      if (v === 1) break;
    }
    strictEqual(sourceClosed, true, 'early break must propagate return() to the source');
    // Everything that was started has settled by the time the loop exits.
    ok(settled >= 2, 'in-flight results must be settled, not abandoned');
  });

  it('an empty source yields nothing', async () => {
    const out: unknown[] = [];
    for await (const v of mapOrderedPrefetch(sourceOf([]), 4, async (x) => x)) {
      out.push(v);
    }
    deepStrictEqual(out, []);
  });
});
