/**
 * `scanMutex`, process-level latch that lets the BFF reject overlapping
 * `POST /api/scan` clicks with a `409 scan-busy` envelope while the
 * previous scan is still running.
 *
 * Scope (intentional): only the manual POST route holds the latch. The
 * watcher's debounced batches are not gated through this mutex, they
 * already serialize internally inside `createWatcherRuntime`, and a
 * watcher × POST race is benign at the storage layer (SQLite WAL
 * serializes transactions; `persist()` is one transaction). The
 * latch's job is to give the user honest feedback when their second
 * click arrives before the first scan resolved, not to globally
 * serialize every scan source.
 *
 * Reset semantics: the latch is cleared in `finally` so a thrown error
 * during the scan does not leave the BFF stuck in `busy: true`.
 */

let inFlight: Promise<void> | null = null;

export function isScanBusy(): boolean {
  return inFlight !== null;
}

/**
 * Run `fn` under the latch. Throws `ScanBusyError` immediately when
 * the latch is held; otherwise awaits `fn`, resolving its return value
 * to the caller, and clears the latch on completion (success or
 * failure). The route translates `ScanBusyError` to `HTTPException(409)`.
 */
export async function withScanMutex<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight !== null) {
    throw new ScanBusyError();
  }
  let resolve!: () => void;
  inFlight = new Promise<void>((r) => {
    resolve = r;
  });
  try {
    return await fn();
  } finally {
    resolve();
    inFlight = null;
  }
}

export class ScanBusyError extends Error {
  constructor(message = 'scan-busy: another scan is already in flight.') {
    super(message);
    this.name = 'ScanBusyError';
  }
}
