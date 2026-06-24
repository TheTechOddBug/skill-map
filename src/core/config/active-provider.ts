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
 *      check each Provider's `detect.markers` in registration order.
 *      Multiple matches return the first detected entry plus the full
 *      list so the CLI / UI can prompt the operator to pick.
 *   3. Setting absent AND no filesystem signal, resolve to the
 *      universal markdown lens (`MARKDOWN_LENS_ID`) with source
 *      `'default'`. The resolver never yields a null lens.
 *
 * The reader does NOT persist the auto-detect result. Persistence is
 * a separate, explicit step the consumer takes (typically via
 * `writeConfigValue('activeProvider', <id>)` after the operator
 * confirms) so the side-effect surface remains in the writer.
 */

import {
  detectProvidersFromFilesystem,
  type IProviderDetectInput,
} from '../../kernel/scan/detect-providers.js';
import { readConfigValue } from './helper.js';

// `IProviderDetectInput` and the pure filesystem detector now live in
// the kernel (`kernel/scan/detect-providers.ts`); re-export the type so
// the scan runner / bootstrap consumers keep importing it from this
// module. The kernel is the innermost layer, so `core/` composing the
// kernel detector with a config read is the sanctioned direction.
export type { IProviderDetectInput };

/**
 * The universal markdown lens id, the resolver's fallback when no vendor
 * marker is present. This is the SHORT provider id (`coreMarkdownProvider.id`),
 * NOT the qualified `core/markdown`: the active lens is compared against
 * `provider.id` everywhere (walk gate, detect, BFF `selectable`). A unit test
 * asserts this equals `coreMarkdownProvider.id` so the short-vs-qualified
 * mismatch can never regress.
 */
export const MARKDOWN_LENS_ID = 'markdown';

export interface IActiveProviderResolution {
  /**
   * The persisted `activeProvider` value when present in settings,
   * otherwise the first auto-detected provider id, otherwise the
   * universal markdown lens (`MARKDOWN_LENS_ID`). Never `null`.
   */
  resolved: string;
  /**
   * `'config'` when the value came from `settings.json`, `'autodetect'`
   * when the filesystem heuristic supplied it, `'default'` when neither
   * source produced a result and the universal markdown lens applies.
   */
  source: 'config' | 'autodetect' | 'default';
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
  return { resolved: MARKDOWN_LENS_ID, source: 'default', detected };
}
