/**
 * Tiny sink that swallows every write call. The BFF uses it for
 * scan-runner channels that funnel their user-visible output through
 * the broadcaster (kernel progress events fan out over WebSocket via
 * `buildBroadcasterEmitter`) or through `log.warn` (printer's
 * diagnostic channels). Passing `process.stderr` would have the
 * server scribble on its own controlling TTY for events that already
 * reach the user via other transports.
 *
 * Lives next to `parse-body.ts` / `parse-query.ts` so the BFF's
 * leaf utilities sit in one folder.
 */

import { Writable } from 'node:stream';

export function noopWritable(): NodeJS.WritableStream {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}
