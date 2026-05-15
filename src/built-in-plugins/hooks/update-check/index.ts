/**
 * `core/update-check` hook. First built-in concrete consumer of the
 * Hook kind. Subscribes to `boot` and runs the once-per-day "update
 * available" probe + banner that lived inline on the CLI entry path
 * before the kind had a real consumer.
 *
 * Why `boot` and not `shutdown`:
 *   - The user's choice (Phase 3 design call), the banner appears
 *     ABOVE the verb's output instead of below it. Most runs only
 *     read the local cache row from `~/.skill-map/settings.json`
 *     (under `updateCheck.*`) and are instantaneous; the registry
 *     fetch (1500 ms timeout)
 *     only fires when the cache is stale (>24h since last probe),
 *     which is once per day. The cost on the cold path is bounded
 *     by the timeout; the cost on the warm path is a single file
 *     read.
 *   - The dispatcher AWAITS subscribed hooks for `boot`, so a slow
 *     hook delays the first verb paint. The dispatcher catches every
 *     hook error so the verb still runs and exits cleanly even if
 *     this hook crashes, `maybeRunUpdateCheck` is itself
 *     defensively silent, so the catch path is the secondary safety
 *     net.
 *
 * Why the import crosses into `cli/util/`:
 *   - `maybeRunUpdateCheck` orchestrates env reads (`SM_NO_UPDATE_CHECK`,
 *     `CI`), the `~/.skill-map/settings.json` read, ANSI
 *     resolution, and TTY detection. Those must NOT live in `kernel/`
 *     or `core/` per the kernel-boundary lint rules; the CLI util
 *     layer is the only place they're allowed today. The hook therefore
 *     re-exports the call rather than re-deriving the boundary
 *     handling, and the lint config explicitly does not restrict
 *     `built-in-plugins/**` from importing CLI helpers (built-ins are
 *     bundled in the same binary). The day a non-CLI driver (BFF
 *     command, library SDK) needs the same banner, the orchestrator
 *     pattern moves to a shared module, but with no second consumer
 *     today, the indirection would be premature.
 *
 * Payload contract: the CLI entry dispatches `boot` with
 * `event.data: { argv, stderr, noColorFlag }`. The hook reads those
 * fields out of the payload and forwards them to `maybeRunUpdateCheck`
 * verbatim, same interface that the inline call site used previously
 * minus `dbPath` / `cwd` / `homedir` (the update-check store reads
 * `os.homedir()` directly per the documented exception).
 */

import type { IHook, IHookContext } from '../../../kernel/extensions/index.js';
import { maybeRunUpdateCheck } from '../../../cli/util/update-check-banner.js';

interface IBootPayload {
  stderr?: NodeJS.WriteStream;
  noColorFlag?: boolean;
}

export const updateCheckHook: IHook = {
  id: 'update-check',
  pluginId: 'core',
  kind: 'hook',
  version: '1.0.0',
  description:
    'Checks daily for a newer skill-map version on npm. Shows an `update available` banner when one is found.',
  stability: 'stable',
  mode: 'deterministic',
  triggers: ['boot'],

  async on(ctx: IHookContext): Promise<void> {
    const payload = (ctx.event.data ?? {}) as IBootPayload;
    if (!payload.stderr) {
      // Defensive, a misconfigured driver dispatches `boot` without
      // the contracted fields. The hook is a no-op rather than a
      // throw; the dispatcher would catch a throw anyway, but a
      // silent skip is the more correct response for "this driver
      // doesn't wire up the banner."
      return;
    }
    await maybeRunUpdateCheck({
      stderr: payload.stderr,
      noColorFlag: payload.noColorFlag === true,
    });
  },
};
