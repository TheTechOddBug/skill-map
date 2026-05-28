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
 * Structural subset of a Provider this module needs for auto-detection.
 * `IProvider` (kernel) is assignable to it, so callers pass their
 * provider list directly without a conversion step AND without this
 * module importing the kernel `IProvider` type (which would make the
 * existing kernel -> core/config dependency bidirectional). The marker
 * set is provider-owned: each Provider declares its own `detect.markers`
 * in its manifest, replacing the former hardcoded detection table.
 */
export interface IProviderDetectInput {
  id: string;
  detect?: { markers?: readonly string[] };
}

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
 * filesystem auto-detect heuristic driven by the Providers' own
 * `detect.markers`. See `IActiveProviderResolution` for the return
 * shape. Pure-ish: reads config + checks `existsSync` for marker paths;
 * no writes, no prompts.
 *
 * `providers` supplies the detection markers. When omitted (empty),
 * auto-detect yields no candidates and resolution falls back to the
 * config value alone, so callers that only need the persisted
 * `activeProvider` can skip passing it; callers that want auto-detect
 * pass their registered provider list (built-ins + user plugins).
 */
export function resolveActiveProvider(
  cwd: string,
  providers: ReadonlyArray<IProviderDetectInput> = [],
): IActiveProviderResolution {
  const detected = detectProvidersFromFilesystem(cwd, providers);
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
 * Walk each Provider's `detect.markers` and return the unique provider
 * ids whose marker exists under `cwd`. A Provider may declare several
 * markers (Codex matches both `.codex/` and root `AGENTS.md`); the
 * result deduplicates by provider id while preserving Provider
 * iteration order, so the first matching Provider determines the
 * default suggestion. Providers with no `detect` block are never
 * auto-suggested.
 */
function detectProvidersFromFilesystem(
  cwd: string,
  providers: ReadonlyArray<IProviderDetectInput>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    const markers = provider.detect?.markers;
    if (!markers || markers.length === 0) continue;
    if (!markers.some((marker) => existsSync(join(cwd, marker)))) continue;
    seen.add(provider.id);
    out.push(provider.id);
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
