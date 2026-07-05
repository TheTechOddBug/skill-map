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
 *     this hook crashes, the injected probe is itself defensively
 *     silent, so the catch path is the secondary safety net.
 *
 * Why the probe is INJECTED instead of imported:
 *   - The probe (`maybeRunUpdateCheck`, `cli/util/update-check-banner.ts`)
 *     orchestrates env reads (`SM_NO_UPDATE_CHECK`, `CI`), the
 *     `~/.skill-map/settings.json` read, ANSI resolution, and TTY
 *     detection. Those must NOT live in `kernel/` or `core/` per the
 *     kernel-boundary lint rules; the CLI util layer is the only place
 *     they're allowed today.
 *   - Importing it here would pull CLI presentation code into
 *     `plugins/built-ins.ts`, which the core runtime
 *     (`core/watcher/runtime.ts`, plugin-runtime composer) and the BFF
 *     (`server/index.ts`) both import, silently defeating the
 *     `core/ must not import cli/` boundary. The lint config bans
 *     `plugins/** → cli/` imports for the same reason.
 *   - So the dependency is inverted: the driver that dispatches `boot`
 *     (today `cli/entry.ts`) supplies the probe via the event payload
 *     (`runUpdateCheck`). A driver that has no banner to show (BFF,
 *     library SDK, tests) simply omits the field and the hook no-ops.
 *
 * Payload contract: the CLI entry dispatches `boot` with
 * `event.data: { argv, stderr, noColorFlag, runUpdateCheck }`. The hook
 * forwards `stderr` / `noColorFlag` into the injected `runUpdateCheck`
 * verbatim, same interface the direct call site used previously.
 */

import type { IBuiltInManifest, IHook, IHookContext } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

interface IBootPayload {
  stderr?: NodeJS.WriteStream;
  noColorFlag?: boolean;
  /**
   * Driver-injected update probe. Structurally mirrors
   * `IMaybeRunUpdateCheckOptions` from `cli/util/update-check-banner.ts`;
   * typed inline because `plugins/**` must not import from `cli/`.
   */
  runUpdateCheck?: (opts: {
    stderr: NodeJS.WriteStream;
    noColorFlag: boolean;
  }) => Promise<void>;
}

export const updateCheckHook: IBuiltInManifest<IHook> = {
  id: 'update-check',
  pluginId: CORE_PLUGIN_ID,
  kind: 'hook',
  description:
    'Checks daily for a newer `skill-map` version on npm. Shows an `update available` banner when one is found.',
  triggers: ['boot'],

  async on(ctx: IHookContext): Promise<void> {
    const payload = (ctx.event.data ?? {}) as IBootPayload;
    if (typeof payload.runUpdateCheck !== 'function' || !payload.stderr) {
      // Defensive, a driver that dispatches `boot` without wiring the
      // banner (BFF, library SDK, misconfigured test harness). The
      // hook is a no-op rather than a throw; the dispatcher would
      // catch a throw anyway, but a silent skip is the more correct
      // response for "this driver doesn't wire up the banner."
      return;
    }
    await payload.runUpdateCheck({
      stderr: payload.stderr,
      noColorFlag: payload.noColorFlag === true,
    });
  },
};
