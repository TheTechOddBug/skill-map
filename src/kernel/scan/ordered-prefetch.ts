/**
 * Ordered bounded read-ahead over an async source.
 *
 * `mapOrderedPrefetch` pulls `source` SERIALLY (async generators are
 * single-cursor, and the walker's generator mutates shared traversal
 * context between pulls), starts `fn` on each item immediately, keeps
 * up to `concurrency` results in flight, and yields the settled heads
 * in EXACT source order. The consumer sees the same sequence a plain
 * `for await` + sequential `await fn(item)` loop would produce; only
 * the wall-clock overlaps.
 *
 * Failure semantics: a rejected `fn` result is rethrown when its
 * ordinal position is reached (never earlier, never reordered). Every
 * queued promise carries a pre-attached no-op catch so a rejection
 * behind the current head can never surface as an unhandled rejection
 * while the head is being awaited.
 *
 * Early termination: when the consumer breaks (or the generator is
 * otherwise returned), the source iterator's `return()` is invoked so
 * upstream `finally` blocks run, and all in-flight results are settled
 * before control leaves, no work is left dangling.
 */
export async function* mapOrderedPrefetch<T, R>(
  source: AsyncIterable<T>,
  concurrency: number,
  fn: (item: T) => Promise<R>,
): AsyncGenerator<R, void, undefined> {
  const iterator = source[Symbol.asyncIterator]();
  const queue: Promise<R>[] = [];
  let sourceDone = false;
  // 1 while a shifted head is still unsettled; it counts toward the
  // concurrency bound (its `fn` is in flight even though it left the
  // queue), so the refill condition includes it.
  let headPending = 0;

  // Serial refill: at most one runs at a time (see `refilling` below);
  // each pull awaits the previous one, preserving the source's own
  // sequencing while `fn` results overlap.
  const refill = async (): Promise<void> => {
    while (!sourceDone && queue.length + headPending < concurrency) {
      const next = await iterator.next();
      if (next.done) {
        sourceDone = true;
        break;
      }
      const pending = fn(next.value);
      pending.catch(() => {
        /* Pre-attached no-op: the rejection still surfaces when the
           head is awaited (the original promise is what's queued). */
      });
      queue.push(pending);
    }
  };

  try {
    let refilling = refill();
    refilling.catch(() => {
      /* No-op: the loop-top await surfaces the source error. */
    });
    for (;;) {
      // Surface source errors at the pull position, then check the queue.
      await refilling;
      const head = queue.shift();
      if (head === undefined) break;
      // Top the queue back up CONCURRENTLY with awaiting the head; the
      // loop-top await re-serialises before the next shift.
      headPending = 1;
      refilling = refill();
      refilling.catch(() => {
        /* No-op: the loop-top await surfaces the source error. */
      });
      const value = await head;
      headPending = 0;
      yield value;
    }
  } finally {
    if (!sourceDone) {
      try {
        await iterator.return?.();
      } catch {
        // Source cleanup errors are secondary to the primary outcome.
      }
    }
    await Promise.allSettled(queue);
  }
}
