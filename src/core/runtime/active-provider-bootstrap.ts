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
 *        `.skill-map/settings.json` (project layer) alongside a
 *        `activeProviderMarkers` snapshot of the detected set, so
 *        subsequent scans pick the value up from config without
 *        re-detecting and can compare disk reality against the
 *        moment-of-choice snapshot. Print a one-liner so the operator
 *        sees the side effect.
 *      - 2+ detected (ambiguous) → under `yes: true`, exit non-zero
 *        with instructions to set the lens manually. Under
 *        `yes: false` (default), prompt the operator interactively to
 *        pick one; persist the choice + the ambiguous detected set as
 *        the markers snapshot, and continue.
 *
 *   3. When the lens came from settings, re-detect markers and diff
 *      against the persisted `activeProviderMarkers` snapshot. Emit
 *      ONE soft warn before the scan when the diff is non-empty
 *      (added / removed markers). The warn is INFORMATIONAL and never
 *      blocks the scan; the run continues with the cached lens.
 *      Legacy projects (no snapshot) lazily backfill silently on the
 *      first scan, so the warn only fires when reality drifts from a
 *      known-good snapshot.
 *
 * Returns `null` only when no marker is present anywhere; in that
 * case the orchestrator's gate skips every provider-specific
 * extractor for the scan.
 *
 * Side effects: may write `.skill-map/settings.json` in the project
 * layer (twice, `activeProvider` then `activeProviderMarkers`), may
 * read stdin, may exit the process. Callers that want pure resolution
 * without these side effects should use `resolveActiveProvider`
 * directly.
 */

import { createInterface } from 'node:readline';
import { isAbsolute, join } from 'node:path';

import {
  resolveActiveProvider,
  type IProviderDetectInput,
} from '../config/active-provider.js';
import { readConfigValue, writeConfigValue } from '../config/helper.js';

import { SCAN_RUNNER_TEXTS } from './i18n/scan-runner.texts.js';
import type { IPrinter } from './printer.js';
import { tx } from '../../kernel/util/tx.js';

export interface IBootstrapActiveProviderOpts {
  cwd: string;
  effectiveRoots: readonly string[];
  /**
   * Registered Providers, source of the `detect.markers` used for
   * filesystem auto-detection. `IProvider` is assignable to the
   * structural `IProviderDetectInput`, so the scan runner passes its
   * composed provider list verbatim.
   */
  providers: readonly IProviderDetectInput[];
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
  /**
   * Pre-rendered glyphs for the human-mode prompt + error blocks per
   * `context/cli-output-style.md`. Optional: when absent, the bootstrap
   * falls back to the bare characters (`⚠`, `✕`) so the bytes still
   * print but colour is lost. The CLI verb resolves colour at its own
   * boundary (via `ansiFor`) and threads the result through here,
   * keeping `core/runtime/` free of `process.env` reads per the boundary
   * lint. `style.dim` wraps the secondary-line hint in error blocks
   * (3.1b); when absent the hint prints undimmed.
   */
  style?: {
    warnGlyph?: string;
    errorGlyph?: string;
    dim?: (s: string) => string;
  };
}

export type TBootstrapActiveProviderOutcome =
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
// Pre-existing complexity: the bootstrap walks four branches (cached
// lens, single-marker auto-detect, multi-marker prompt, no-marker
// continue) plus the diff-against-markers fork. Splitting the
// dispatch scatters the lens-resolution algorithm without clarifying
// it; tracked as tech-debt rather than refactored under the
// eliminate-bundle-toggle change.
// eslint-disable-next-line complexity
export async function bootstrapActiveProvider(
  opts: IBootstrapActiveProviderOpts,
): Promise<TBootstrapActiveProviderOutcome> {
  const fromCwd = resolveActiveProvider(opts.cwd, opts.providers);
  if (fromCwd.source === 'config') {
    // Lens came from settings. Re-detect markers and diff against the
    // snapshot persisted alongside `activeProvider`. When the diff is
    // non-empty, emit ONE soft warn before the scan and continue with
    // the cached lens. When the snapshot is absent (legacy project),
    // lazily backfill the current markers and stay silent the first
    // time, so the operator only ever sees the warn when the markers
    // actually drift relative to a known-good snapshot.
    const currentMarkers = aggregateDetected(
      opts.cwd,
      opts.effectiveRoots,
      fromCwd.detected,
      opts.providers,
    );
    handleDrift(opts, fromCwd.resolved, currentMarkers);
    return { kind: 'ok', activeProvider: fromCwd.resolved, source: 'config' };
  }
  // Settings absent. Aggregate detection across cwd + effective roots
  // so out-of-tree scans find markers in the scan tree even when cwd
  // is unrelated (tests, ad-hoc invocations).
  const detected = aggregateDetected(
    opts.cwd,
    opts.effectiveRoots,
    fromCwd.detected,
    opts.providers,
  );
  if (detected.length === 0) {
    const warnGlyph = opts.style?.warnGlyph ?? '⚠';
    const dim = opts.style?.dim ?? ((s: string) => s);
    opts.printer.warn(
      tx(SCAN_RUNNER_TEXTS.activeProviderNoMarkerWarning, {
        glyph: warnGlyph,
        hint: dim(SCAN_RUNNER_TEXTS.activeProviderNoMarkerWarningHint),
      }),
    );
    return { kind: 'ok', activeProvider: null, source: 'none' };
  }
  if (detected.length === 1) {
    const picked = detected[0]!;
    persistActiveProvider(opts.cwd, picked, detected, opts.printer);
    return { kind: 'ok', activeProvider: picked, source: 'autodetect' };
  }
  // Ambiguous: 2+ detected.
  if (opts.yes) {
    return { kind: 'ambiguous', detected };
  }
  const picked = await promptForLens(
    detected,
    opts.stdin,
    opts.stderr,
    opts.style?.warnGlyph ?? '⚠',
  );
  if (picked === null) {
    return { kind: 'ambiguous', detected };
  }
  persistActiveProvider(opts.cwd, picked, detected, opts.printer);
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
  providers: readonly IProviderDetectInput[],
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
    const r = resolveActiveProvider(absRoot, providers);
    for (const id of r.detected) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function persistActiveProvider(
  cwd: string,
  id: string,
  markers: readonly string[],
  printer: IPrinter,
): void {
  try {
    writeConfigValue('activeProvider', id, { target: 'project', cwd });
    // Snapshot the detected set alongside the lens so the next scan
    // can diff against reality. Persisted as a fresh array (the
    // value travels through AJV which expects a plain JSON array).
    writeConfigValue('activeProviderMarkers', [...markers], {
      target: 'project',
      cwd,
    });
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
 * Drift detection at scan entry when the lens came from config.
 *
 *   - `activeProviderMarkers` MISSING (legacy project) → lazily backfill
 *     the current set as the snapshot and stay silent. The first scan
 *     after the project upgraded to a version that knows about the
 *     snapshot has nothing to compare against, so warning here would
 *     be noise.
 *   - `activeProviderMarkers` PRESENT and equal to the current set →
 *     no drift, no warn.
 *   - `activeProviderMarkers` PRESENT and different from the current
 *     set → ONE warn (yellow `⚠`, dim hint) naming the added /
 *     removed ids + the current lens, so the operator sees what they
 *     are using vs the alternatives. The scan continues with the
 *     cached lens; the snapshot is NOT refreshed automatically (the
 *     operator chooses whether to switch via `sm config set` or
 *     accept the drift).
 *
 * One warn per scan, never per drift entry. Runs once at bootstrap,
 * never inside the per-node walk loop.
 */
function handleDrift(
  opts: IBootstrapActiveProviderOpts,
  resolvedLens: string | null,
  currentMarkers: readonly string[],
): void {
  const snapshot = readConfigValue<readonly string[]>('activeProviderMarkers', {
    cwd: opts.cwd,
  });
  if (snapshot === undefined) {
    // Legacy project, no snapshot yet. Backfill with the current set
    // and stay silent. The next scan diffs against this snapshot.
    backfillMarkersSnapshot(opts.cwd, currentMarkers);
    return;
  }
  const diff = diffMarkers(snapshot, currentMarkers);
  if (diff.added.length === 0 && diff.removed.length === 0) return;
  emitDriftWarn(opts, resolvedLens, diff);
}

function emitDriftWarn(
  opts: IBootstrapActiveProviderOpts,
  resolvedLens: string | null,
  diff: { added: readonly string[]; removed: readonly string[] },
): void {
  const warnGlyph = opts.style?.warnGlyph ?? '⚠';
  const dim = opts.style?.dim ?? ((s: string) => s);
  const hint = tx(SCAN_RUNNER_TEXTS.activeProviderDriftWarnHint, {
    added: diff.added.length === 0 ? '(none)' : diff.added.join(', '),
    removed: diff.removed.length === 0 ? '(none)' : diff.removed.join(', '),
    currentLens: resolvedLens ?? '(none)',
  });
  opts.printer.warn(
    tx(SCAN_RUNNER_TEXTS.activeProviderDriftWarn, {
      glyph: warnGlyph,
      hint: dim(hint),
    }),
  );
}

function backfillMarkersSnapshot(cwd: string, markers: readonly string[]): void {
  try {
    writeConfigValue('activeProviderMarkers', [...markers], {
      target: 'project',
      cwd,
    });
  } catch {
    // Non-fatal: if backfill fails (permission, disk full), the next
    // scan tries again. Silent because the user has no actionable step
    // here, and a noisy warn on every scan would defeat the purpose.
  }
}

function diffMarkers(
  snapshot: readonly string[],
  current: readonly string[],
): { added: string[]; removed: string[] } {
  const snapSet = new Set(snapshot);
  const currSet = new Set(current);
  const added: string[] = [];
  const removed: string[] = [];
  for (const id of current) {
    if (!snapSet.has(id)) added.push(id);
  }
  for (const id of snapshot) {
    if (!currSet.has(id)) removed.push(id);
  }
  return { added, removed };
}

/**
 * Surface a warning when the resolved active lens points at a bundle
 * the operator has disabled (via `sm plugins disable <id>` or the
 * Settings UI). Classification still runs (provider-driven), but the
 * lens-gated extractors for the disabled bundle silently no-op, so
 * without this hint the graph quietly differs from what the lens
 * implies (the bd-23c finding from the providers-test-plan re-pass).
 * Pure: receives `resolveEnabled` as a function so callers thread their
 * own mid-session override when relevant (BFF fresh resolver, watcher
 * batch resolver).
 */
export function warnIfLensBundleDisabled(args: {
  activeProvider: string | null;
  resolveEnabled: (id: string) => boolean;
  printer: IPrinter;
}): void {
  if (args.activeProvider === null) return;
  if (args.resolveEnabled(args.activeProvider)) return;
  args.printer.warn(
    tx(SCAN_RUNNER_TEXTS.activeProviderBundleDisabledWarning, {
      id: args.activeProvider,
    }),
  );
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
  warnGlyph: string,
): Promise<string | null> {
  const lines: string[] = [
    tx(SCAN_RUNNER_TEXTS.activeProviderPromptHeader, { glyph: warnGlyph }),
  ];
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
