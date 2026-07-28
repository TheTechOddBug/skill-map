/**
 * CLI adapter over the shared extension-runtime builder for the job
 * verbs. The composition itself (`IActionRuntime`, `buildActionRuntime`,
 * the qualified-id -> on-disk-dir maps) lives in
 * `core/jobs/action-runtime.ts` so the BFF can reuse it with its
 * boot-cached plugin runtime (audit M3, `src/server/` never imports
 * `src/cli/`); this file keeps the CLI-shaped entry point:
 *
 *   - `loadActionRuntime`, loads a FRESH plugin runtime for this
 *     invocation (the CLI is one-shot, so a per-call discovery walk is
 *     the correct lifetime), adapts `IPrinter` to the core builder's
 *     warning sink, and threads the conformance kill-switch env reads
 *     (`cli/util/conformance-env.ts`, the env boundary stays at the CLI
 *     adapter).
 *   - `resolveAction`, qualified-or-bare-id action lookup for the CLI
 *     verbs (`sm actions`, the record outcome path).
 *
 * Lives in its own module (extracted from `job-queue.ts`) because TWO
 * CLI consumers share it, `sm jobs submit` (job-queue.ts) and `sm record`
 * (record.ts via record-outcome.ts), and record-outcome.ts +
 * job-queue.ts would otherwise import each other in a cycle.
 */

import { buildActionRuntime, type IActionRuntime } from '../../core/jobs/action-runtime.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { loadPluginRuntime } from '../../core/runtime/plugin-runtime.js';
import type { IPrinter } from '../../core/runtime/printer.js';

/**
 * Load the composed extension catalogs (built-ins + enabled plugins) for
 * this CLI invocation: one fresh plugin-runtime discovery walk, warnings
 * forwarded through `printer.warn`, then the shared core builder.
 *
 * Shared by `sm jobs submit` (resolves `prompt.md` + node bodies) and
 * `sm record` (resolves `report.schema.json`), both of which resolve an
 * extension against the same composed runtime.
 */
export async function loadActionRuntime(printer: IPrinter): Promise<IActionRuntime> {
  const runtime = await loadPluginRuntime();
  return buildActionRuntime(
    runtime,
    (line) => printer.warn(`${line}\n`),
    readConformanceKillSwitches(),
  );
}

// `resolveAction` (qualified-or-bare-id Action lookup) moved down to
// `core/jobs/action-runtime.ts` so the record engine can share it without a
// `core/ -> cli/` import; re-exported here for the CLI verbs that consume it.
export { resolveAction } from '../../core/jobs/action-runtime.js';
