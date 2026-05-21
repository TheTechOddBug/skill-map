/**
 * Bootstrap the active provider lens at scan entry.
 *
 *   1. Read `activeProvider` from project config + filesystem markers
 *      under `cwd`, with a fallback to scanning the effective scan
 *      roots so out-of-tree invocations still find a lens.
 *   2. When the lens came from filesystem auto-detect (no settings
 *      value), branch on `detected.length`:
 *
 *      - 0 detected → no provider markers anywhere. Emit a soft
 *        warning and return `null`. Provider-specific extractors will
 *        silently no-op for this scan; the universal `core/*`
 *        extractors keep running so plain-markdown projects scan fine.
 *      - 1 detected → persist the detected id to
 *        `.skill-map/settings.json` (project layer) so subsequent
 *        scans pick it up from config without re-detecting. Print a
 *        one-liner so the operator sees the side effect.
 *      - 2+ detected (ambiguous) → under `yes: true`, exit non-zero
 *        with instructions to set the lens manually. Under
 *        `yes: false` (default), prompt the operator interactively to
 *        pick one; persist the choice and continue.
 *
 *   3. When the lens came from settings, no-op (return it verbatim).
 *
 * Returns `null` only when no marker is present anywhere; in that
 * case the orchestrator's gate skips every provider-specific
 * extractor for the scan.
 *
 * Side effects: may write `.skill-map/settings.json` in the project
 * layer, may read stdin, may exit the process. Callers that want
 * pure resolution without these side effects should use
 * `resolveActiveProvider` directly.
 */

import { createInterface } from 'node:readline';
import { isAbsolute, join } from 'node:path';

import { resolveActiveProvider } from '../config/active-provider.js';
import { writeConfigValue } from '../config/helper.js';

import { SCAN_RUNNER_TEXTS } from './i18n/scan-runner.texts.js';
import type { IPrinter } from './printer.js';
import { tx } from '../../kernel/util/tx.js';

export interface IBootstrapActiveProviderOpts {
  cwd: string;
  effectiveRoots: readonly string[];
  /**
   * Non-interactive mode. When `true` and the detection is ambiguous,
   * the caller does NOT prompt; instead `outcome.kind === 'ambiguous'`
   * is returned so the caller can exit with code 2. When `false`
   * (default), an interactive prompt selects the lens.
   */
  yes: boolean;
  /**
   * Stream to read the operator's interactive lens choice from. The
   * `NodeJS.*Stream` widenings match the shape Clipanion's BaseContext
   * exposes (`context.stdin` / `context.stderr`) so CLI verbs can hand
   * them in verbatim; the same width also accommodates `Readable.from`
   * test fixtures.
   */
  stdin: NodeJS.ReadableStream;
  stderr: NodeJS.WritableStream;
  printer: IPrinter;
}

export type IBootstrapActiveProviderOutcome =
  | { kind: 'ok'; activeProvider: string | null; source: 'config' | 'autodetect' | 'none' }
  | {
      kind: 'ambiguous';
      detected: readonly string[];
    };

/**
 * Top-level bootstrap. Returns the lens (string | null) when the call
 * is allowed to continue; returns `{ kind: 'ambiguous', ... }` when
 * the caller must exit non-zero under `--yes`.
 */
export async function bootstrapActiveProvider(
  opts: IBootstrapActiveProviderOpts,
): Promise<IBootstrapActiveProviderOutcome> {
  const fromCwd = resolveActiveProvider(opts.cwd);
  if (fromCwd.source === 'config') {
    return { kind: 'ok', activeProvider: fromCwd.resolved, source: 'config' };
  }
  // Settings absent. Aggregate detection across cwd + effective roots
  // so out-of-tree scans find markers in the scan tree even when cwd
  // is unrelated (tests, ad-hoc invocations).
  const detected = aggregateDetected(opts.cwd, opts.effectiveRoots, fromCwd.detected);
  if (detected.length === 0) {
    opts.printer.warn(SCAN_RUNNER_TEXTS.activeProviderNoMarkerWarning);
    return { kind: 'ok', activeProvider: null, source: 'none' };
  }
  if (detected.length === 1) {
    const picked = detected[0]!;
    persistActiveProvider(opts.cwd, picked, opts.printer);
    return { kind: 'ok', activeProvider: picked, source: 'autodetect' };
  }
  // Ambiguous: 2+ detected.
  if (opts.yes) {
    return { kind: 'ambiguous', detected };
  }
  const picked = await promptForLens(detected, opts.stdin, opts.stderr);
  if (picked === null) {
    return { kind: 'ambiguous', detected };
  }
  persistActiveProvider(opts.cwd, picked, opts.printer);
  return { kind: 'ok', activeProvider: picked, source: 'autodetect' };
}

/**
 * Merge filesystem detection from `cwd` with detection from each
 * effective root. Preserves cwd order first, then appends new ids
 * from the roots. Deduplicates.
 */
function aggregateDetected(
  cwd: string,
  effectiveRoots: readonly string[],
  cwdDetected: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of cwdDetected) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const root of effectiveRoots) {
    const absRoot = isAbsolute(root) ? root : join(cwd, root);
    const r = resolveActiveProvider(absRoot);
    for (const id of r.detected) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function persistActiveProvider(cwd: string, id: string, printer: IPrinter): void {
  try {
    writeConfigValue('activeProvider', id, { target: 'project', cwd });
    printer.info(tx(SCAN_RUNNER_TEXTS.activeProviderAutodetected, { id }));
  } catch (err) {
    // Non-fatal: if persistence fails (e.g. permission), the scan
    // continues using the in-memory value. The next scan will redo
    // the auto-detect; the user can also `sm config set` manually.
    const message = err instanceof Error ? err.message : String(err);
    printer.warn(
      tx(SCAN_RUNNER_TEXTS.activeProviderPersistFailed, { id, message }),
    );
  }
}

/**
 * Numbered-list interactive prompt. Returns the picked provider id,
 * or `null` if the operator entered something invalid (caller treats
 * `null` as ambiguous → exit non-zero with instructions).
 */
async function promptForLens(
  detected: readonly string[],
  stdin: NodeJS.ReadableStream,
  stderr: NodeJS.WritableStream,
): Promise<string | null> {
  const lines: string[] = [SCAN_RUNNER_TEXTS.activeProviderPromptHeader];
  for (let i = 0; i < detected.length; i += 1) {
    lines.push(
      tx(SCAN_RUNNER_TEXTS.activeProviderPromptOption, {
        index: i + 1,
        id: detected[i]!,
      }),
    );
  }
  stderr.write(lines.join('\n') + '\n');
  const rl = createInterface({ input: stdin, output: stderr });
  try {
    const answer = await new Promise<string>((resolveP) =>
      rl.question(SCAN_RUNNER_TEXTS.activeProviderPromptInput, resolveP),
    );
    const trimmed = answer.trim();
    const asNumber = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= detected.length) {
      return detected[asNumber - 1]!;
    }
    const asId = detected.find((d) => d.toLowerCase() === trimmed.toLowerCase());
    return asId ?? null;
  } finally {
    rl.close();
  }
}
