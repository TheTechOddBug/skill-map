/**
 * Typed reader + auto-detect heuristic for the active provider lens
 * (`activeProvider` in `<cwd>/.skill-map/settings.json`). Lives under
 * `src/core/config/` next to the other config helpers so both `cli/`
 * and `server/` (BFF) import from one place. Receives `cwd` as an
 * explicit parameter, no `process.env` / `process.cwd()` reads, per
 * the kernel-boundary lint rule.
 *
 * Three states the consumer needs to handle:
 *
 *   1. Setting present in `settings.json`, return that string.
 *   2. Setting absent, run the filesystem auto-detect heuristic:
 *      check for `.claude/`, `.gemini/`, `.codex/`, root `AGENTS.md`,
 *      and `.cursor/` in that order. Multiple matches return the
 *      first detected entry plus the full list so the CLI / UI can
 *      prompt the operator to pick. No match returns `null` for both.
 *   3. Setting absent AND no filesystem signal, the consumer falls
 *      back to its own default (today: prompt the operator; under
 *      `--yes` exit 2).
 *
 * The reader does NOT persist the auto-detect result. Persistence is
 * a separate, explicit step the consumer takes (typically via
 * `writeConfigValue('activeProvider', <id>)` after the operator
 * confirms) so the side-effect surface remains in the writer.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readConfigValue } from './helper.js';

/**
 * Detection heuristic, kept declarative so the same table can drive
 * the UI's "we detected X" hint and the CLI's prompt list. The order
 * is significant: when multiple signals are present the first match
 * wins as the default suggestion, but the full list of matched
 * provider ids is also returned for prompting.
 */
const DETECTION_RULES: ReadonlyArray<{
  providerId: string;
  /** Relative path under `cwd` that signals this provider's presence. */
  marker: string;
}> = [
  { providerId: 'claude', marker: '.claude' },
  // `gemini` retired 2026-05-22: Google replaced the Gemini CLI with the
  // Antigravity CLI (released 2026-05-19; Gemini CLI sunsets 2026-06-18).
  // Antigravity adopted the open-standard `.agents/` instead of a
  // vendor-specific directory, so detection of a Google CLI project
  // falls through to the universal `agent-skills` lens (`.agents/`
  // already classifies via that neutral provider). The lens can still
  // be set manually via `sm config set activeProvider antigravity`.
  { providerId: 'openai', marker: '.codex' },
  { providerId: 'openai', marker: 'AGENTS.md' },
  { providerId: 'cursor', marker: '.cursor' },
];

export interface IActiveProviderResolution {
  /**
   * The persisted `activeProvider` value when present in settings,
   * otherwise the first auto-detected provider id, otherwise `null`.
   */
  resolved: string | null;
  /**
   * `'config'` when the value came from `settings.json`, `'autodetect'`
   * when the filesystem heuristic supplied it, `'none'` when neither
   * source produced a result.
   */
  source: 'config' | 'autodetect' | 'none';
  /**
   * All provider ids the filesystem heuristic matched, deduped, in
   * detection order. Empty when nothing matched. Populated even when
   * `source === 'config'` (so the consumer can detect drift between
   * the saved value and the on-disk reality).
   */
  detected: readonly string[];
}

/**
 * Read `activeProvider` from project config, falling back to a
 * filesystem auto-detect heuristic. See `IActiveProviderResolution`
 * for the return shape. Pure-ish: reads config + checks `existsSync`
 * for marker paths; no writes, no prompts.
 */
export function resolveActiveProvider(cwd: string): IActiveProviderResolution {
  const detected = detectProvidersFromFilesystem(cwd);
  const fromConfig = readConfigValue('activeProvider', { cwd });
  if (typeof fromConfig === 'string' && fromConfig.length > 0) {
    return { resolved: fromConfig, source: 'config', detected };
  }
  if (detected.length > 0) {
    return { resolved: detected[0]!, source: 'autodetect', detected };
  }
  return { resolved: null, source: 'none', detected };
}

/**
 * Walk the detection rules and return the unique provider ids whose
 * marker exists under `cwd`. Multiple rules may map to the same
 * provider (Codex matches both `.codex/` and root `AGENTS.md`); the
 * result deduplicates while preserving rule order, so the first
 * triggering marker per provider determines its position.
 */
function detectProvidersFromFilesystem(cwd: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rule of DETECTION_RULES) {
    if (seen.has(rule.providerId)) continue;
    if (!existsSync(join(cwd, rule.marker))) continue;
    seen.add(rule.providerId);
    out.push(rule.providerId);
  }
  return out;
}

/**
 * Decide whether a given extension should run under the active lens.
 * Used by the orchestrator to gate provider walkers and per-provider
 * extractors when `activeProvider` is set.
 *
 *   - Active lens absent → every extension runs (legacy behaviour,
 *     pre-lens).
 *   - Extension declares no provider precondition → runs always
 *     (universal extension, e.g. `core/markdown-link`).
 *   - Extension declares one or more provider preconditions → runs
 *     only if the active lens is in the declared set.
 */
export function isExtensionActiveUnderLens(
  preconditionProviders: readonly string[] | undefined,
  activeProvider: string | null,
): boolean {
  if (activeProvider === null) return true;
  if (!preconditionProviders || preconditionProviders.length === 0) return true;
  return preconditionProviders.includes(activeProvider);
}
