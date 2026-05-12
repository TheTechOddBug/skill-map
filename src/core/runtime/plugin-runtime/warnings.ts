/**
 * Warning emission + plumbing helpers — runtime-context / search-path
 * resolution that the entry point threads through plugin discovery, and
 * the diagnostic-line renderer (with sanitisation + display caps) the
 * load loop pushes onto `bundle.warnings`.
 */

import { resolve } from 'node:path';

import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { truncateHead } from '../../../kernel/util/text.js';
import {
  defaultProjectPluginsDir,
  defaultUserPluginsDir,
} from '../../paths/db-path.js';
import type { IPrinter } from '../printer.js';
import { PLUGIN_RUNTIME_TEXTS } from '../i18n/plugin-runtime.texts.js';
import { defaultRuntimeContext, type IRuntimeContext } from '../runtime-context.js';

import type {
  ILoadPluginRuntimeOptions,
  IPluginRuntimeBundle,
} from './index.js';

// Caps for interpolated values in the warning template. The plugin id
// passes through the loader's regex validator (short, well-shaped) but
// is bounded as defence-in-depth. The reason string is plugin-authored
// (manifest fragments + AJV `instancePath`/`message`, `describe(err)`
// return values) and unbounded — a hostile or buggy plugin could emit
// kilobytes of payload that drown the user's terminal.
export const PLUGIN_ID_DISPLAY_CAP = 200;
export const PLUGIN_REASON_DISPLAY_CAP = 1000;

/**
 * Forward every warning row through `printer.warn`. Each warning is
 * already a complete diagnostic line (rendered by `formatWarning`); we
 * append the trailing newline here so the catalogue stays
 * trailing-newline-free (matches the convention in
 * `cli/util/printer.ts`).
 */
export function emitWarnings(bundle: IPluginRuntimeBundle, printer: IPrinter): void {
  for (const warn of bundle.warnings) {
    printer.warn(`${warn}\n`);
  }
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
 * `test/plugin-runtime.test.ts` — production callers reach it through
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

/** Project + user search paths, or the explicit override. */
export function resolveSearchPaths(
  opts: ILoadPluginRuntimeOptions,
  ctx: IRuntimeContext,
): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  const project = defaultProjectPluginsDir(ctx);
  const user = defaultUserPluginsDir(ctx);
  return opts.scope === 'global' ? [user] : [project, user];
}
