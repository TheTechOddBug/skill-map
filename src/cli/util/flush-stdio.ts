/**
 * Drain stdout / stderr before the process exits.
 *
 * `process.exit()` terminates the process immediately and DISCARDS
 * anything still queued on an asynchronous stream. `process.stdout` is
 * synchronous only when it points at a file or a TTY; over a **pipe** it
 * is asynchronous. So every `sm <verb> | <consumer>` invocation whose
 * payload exceeded one pipe buffer (65_536 bytes) was silently
 * truncated at exactly that boundary:
 *
 *   sm help --format json > file.json   # 212 KB, complete
 *   sm help --format json | jq          # 64 KB, invalid JSON
 *
 * The same cut hits `sm scan --json`, `sm graph --format json`,
 * `sm export --json` and `sm db dump` on any project big enough to
 * cross 64 KB. Redirecting to a file hid it, which is why it survived:
 * a consumer only sees it when piping, and the JSON parse error it
 * produces reads like a malformed payload rather than a truncated one.
 *
 * `spec/cli-contract.md` §Machine-readable output requires stdout to
 * carry the JSON document; two thirds of a document is not the
 * document, so this is a contract violation, not a nicety.
 *
 * The fix waits for the queue to reach the OS rather than guessing a
 * delay. `process.exitCode` plus a natural exit would also flush, but
 * `process.exit()` is deliberate here: it guarantees the CLI returns
 * even when a plugin, a socket, or a stray timer left a handle open.
 */

/**
 * Upper bound on the wait. A blocked reader (`sm ... | head -1`, a
 * consumer that died) must not hang the CLI, so the drain is best
 * effort past this point.
 */
const DRAIN_TIMEOUT_MS = 5_000;

/**
 * Resolve once `stream` has no bytes queued, or once it fails, or once
 * the timeout elapses. `drain` is the stream's own "the buffer emptied"
 * signal, so there is nothing to poll; `error` and `close` cover the
 * consumer that walked away mid-write.
 */
function flushStream(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.writableLength === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      for (const event of ['drain', 'error', 'close']) stream.removeListener(event, finish);
      resolve();
    };
    // Deliberately NOT unref'd. An unref'd timer would let the event
    // loop empty out while this promise is still pending, so Node would
    // exit naturally with the default code and the verb's real exit code
    // would never be applied. Kept referenced, the worst case is a
    // bounded wait that still reaches `process.exit(exitCode)`; the
    // timer is cleared the moment the stream drains, so a normal run
    // never pays for it.
    const timer = setTimeout(finish, DRAIN_TIMEOUT_MS);
    for (const event of ['drain', 'error', 'close']) stream.once(event, finish);
  });
}

/** Await both stdio queues before an explicit `process.exit()`. */
export async function flushStdio(): Promise<void> {
  await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
}

/**
 * Swallow `EPIPE` on the stdio streams.
 *
 * A downstream consumer is entitled to stop reading (`sm ... | head -1`,
 * a pager the user quit). The kernel then fails our writes with `EPIPE`,
 * Node surfaces it as an `error` event, and an UNHANDLED `error` event
 * kills the process with a stack trace where the user expected a clean
 * pipeline. Ignoring it is the conventional CLI behaviour: the consumer
 * already read as much as it wanted.
 *
 * This became necessary once the CLI started awaiting the stdio drain
 * (see `flushStdio`). The previous immediate `process.exit()` raced past
 * the error event, so the case was never handled, only outrun.
 */
export function ignoreEpipe(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') return;
      throw err;
    });
  }
}
