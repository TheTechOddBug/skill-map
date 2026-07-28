/**
 * Warning emission + plumbing helpers, runtime-context / search-path
 * resolution that the entry point threads through plugin discovery, and
 * the diagnostic-line renderer (with sanitisation + display caps) the
 * load loop pushes onto `runtime.warnings`.
 */

import { resolve } from 'node:path';

import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { pluralSuffix, truncateHead } from '../../../kernel/util/text.js';
import { defaultProjectPluginsDir } from '../../paths/db-path.js';
import type { IPrinter } from '../printer.js';
import { PLUGIN_RUNTIME_TEXTS } from '../i18n/plugin-runtime.texts.js';
import { defaultRuntimeContext, type IRuntimeContext } from '../runtime-context.js';

import type {
  ILoadPluginRuntimeOptions,
  IPluginRuntime,
} from './index.js';

// Caps for interpolated values in the warning template. The plugin id
// passes through the loader's regex validator (short, well-shaped) but
// is bounded as defence-in-depth. The reason string is plugin-authored
// (manifest fragments + AJV `instancePath`/`message`, `describe(err)`
// return values) and unbounded, a hostile or buggy plugin could emit
// kilobytes of payload that drown the user's terminal.
export const PLUGIN_ID_DISPLAY_CAP = 200;
export const PLUGIN_REASON_DISPLAY_CAP = 1000;

/**
 * Forward every warning row through `printer.warn`. Each warning is
 * already a complete diagnostic line (rendered by `formatWarning`); we
 * append the trailing newline here so the catalogue stays
 * trailing-newline-free (matches the convention in
 * `core/runtime/printer.ts`).
 */
export function emitWarnings(runtime: IPluginRuntime, printer: IPrinter): void {
  for (const warn of runtime.warnings) {
    printer.warn(`${warn}\n`);
  }
  emitExecutedNotice(runtime, printer);
}

/**
 * Announce the project-local plugins whose code was actually imported
 * into this process. Every entry in `runtime.discovered` is a disk
 * plugin (built-ins never reach the disk loader), and `status ===
 * 'enabled'` is exactly the set that passed the import-trust gate and
 * had its module evaluated.
 *
 * Security rationale: importing a drop-in plugin executes third-party
 * code with the operator's privileges. That must never happen silently,
 * the loader already speaks up when a plugin is REFUSED, so staying mute
 * on success means the only invisible outcome is the dangerous one. One
 * line per run keeps the cost trivial while making "third-party code
 * ran" an observable event.
 *
 * Ids are sanitised + capped like every other plugin-authored value on
 * this surface (they are directory names read off disk).
 */
function emitExecutedNotice(runtime: IPluginRuntime, printer: IPrinter): void {
  const executed = runtime.discovered.filter((p) => p.status === 'enabled');
  if (executed.length === 0) return;
  const ids = executed
    .map((p) => sanitizeForTerminal(truncateHead(p.id, PLUGIN_ID_DISPLAY_CAP)))
    .join(', ');
  printer.info(
    `${tx(PLUGIN_RUNTIME_TEXTS.executedRow, {
      count: executed.length,
      plural: pluralSuffix(executed.length),
      ids,
    })}\n`,
  );
}

/**
 * Render a single-line, scannable diagnostic for a non-loaded plugin.
 * The status name doubles as the failure category so a user can grep
 * `incompatible-spec` / `invalid-manifest` / `load-error` and see the
 * full context. Template lives in `core/runtime/i18n/plugin-runtime.texts.ts`.
 *
 * Both `id` and `reason` flow from plugin-authored sources (manifest
 * fields, AJV error fragments, `describe(err)` payloads). Sanitize +
 * cap before interpolation so a hostile plugin cannot smuggle ANSI
 * control sequences into the user's terminal via its own diagnostic
 * surface.
 *
 * Exported solely for the audit H1 unit tests in
 * `test/plugin-runtime.test.ts`, production callers reach it through
 * `loadPluginRuntime` and write the rendered lines straight to stderr.
 * Renaming or removing the export is a breaking change for the test
 * suite, not for any consumer.
 */
export function formatWarning(plugin: IDiscoveredPlugin): string {
  const rawReason = plugin.reason ?? PLUGIN_RUNTIME_TEXTS.warningReasonMissing;
  return tx(PLUGIN_RUNTIME_TEXTS.warningRow, {
    id: sanitizeForTerminal(truncateHead(plugin.id, PLUGIN_ID_DISPLAY_CAP)),
    status: plugin.status,
    reason: sanitizeForTerminal(truncateHead(rawReason, PLUGIN_REASON_DISPLAY_CAP)),
  });
}

/**
 * Resolve the runtime context to use for this `loadPluginRuntime` call.
 * Honours an explicit override (the BFF or a test passing `runtimeContext`
 * to steer plugin discovery + config / DB resolution at the same tempdir),
 * else falls back to `defaultRuntimeContext()` exactly as the pre-R14
 * behaviour did.
 */
export function resolveRuntimeContext(opts: ILoadPluginRuntimeOptions): IRuntimeContext {
  return opts.runtimeContext ?? defaultRuntimeContext();
}

/** Project search path, or the explicit override. */
export function resolveSearchPaths(
  opts: ILoadPluginRuntimeOptions,
  ctx: IRuntimeContext,
): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  return [defaultProjectPluginsDir(ctx)];
}
