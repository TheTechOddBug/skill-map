/**
 * TTL and priority resolution for a new job.
 *
 * TTL (`spec/job-lifecycle.md` §TTL resolution, Decision #139): OPT-IN.
 * Jobs do NOT expire by default; the optional TTL resolves from explicit
 * operator sources only, highest precedence first:
 *   1. Flag `--ttl <seconds>`: a positive integer arms the expiry; `0`
 *      explicitly DISARMS it (overriding any config below); a negative
 *      or non-integer value is rejected with `InvalidTtlError` (exit 2).
 *   2. Config `jobs.perExtensionTtl[<extensionId>]` (positive seconds).
 *   3. Config `jobs.ttlSeconds` (positive seconds), the global
 *      arm-everything policy. UNSET by default.
 *   4. None of the above: no TTL (`null`, the job never expires).
 * The extension's `probExpectedDurationSeconds` is ADVISORY only (the
 * `jobs-overdue` doctor check); the former grace formula and its
 * `jobs.graceMultiplier` / `jobs.minimumTtlSeconds` keys are retired.
 *
 * Priority (`spec/job-lifecycle.md` §Submit step 6), precedence low ->
 * high: action manifest default (no field on `IAction` today, so 0) ->
 * config `jobs.perExtensionPriority[<extensionId>]` -> flag
 * `--priority <n>`. Integer, negatives permitted, default 0. A
 * non-integer `--priority` is rejected with `InvalidPriorityError`
 * (exit 2).
 *
 * Config keys are looked up by BOTH the qualified id (`<plugin>/<id>`) and
 * the bare extension id, so an operator may key either form.
 */

import type { IAction } from '../extensions/index.js';
import type { IJobsConfig } from '../config/loader.js';
import type { TExecutionMode } from '../types.js';
import { qualifiedExtensionId } from '../registry.js';
import { InvalidPriorityError, InvalidTtlError } from './errors.js';

/** Minimal action shape the resolvers read (keeps unit tests light). */
export type TResolvableAction = Pick<IAction, 'id' | 'pluginId' | 'probExpectedDurationSeconds'> & {
  /**
   * Forward-compatible manifest default priority. Not part of `IAction`
   * today (`spec/job-lifecycle.md` names it but the interface has no such
   * field yet); read defensively so the day it lands the resolver already
   * honours it. Absent -> 0.
   */
  defaultPriority?: number;
};

/**
 * First defined value in `map` under the extension's qualified id, then
 * its bare id. `undefined` when neither key is present.
 */
function lookupPerExtension(
  map: Record<string, number>,
  action: Pick<IAction, 'id' | 'pluginId'>,
): number | undefined {
  const qualified = qualifiedExtensionId(action.pluginId, action.id);
  if (Object.prototype.hasOwnProperty.call(map, qualified)) return map[qualified];
  if (Object.prototype.hasOwnProperty.call(map, action.id)) return map[action.id];
  return undefined;
}

function assertPositiveTtl(value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new InvalidTtlError(value);
}

/**
 * Resolve the OPTIONAL TTL frozen on `state_jobs.ttl_seconds`
 * (`spec/job-lifecycle.md` §TTL resolution). `flagTtl` is the parsed
 * `--ttl` value (or `undefined` when absent): `0` is the explicit
 * disarm, negatives / non-integers reject with `InvalidTtlError`
 * (exit 2). Config sources require positive integers (AJV enforces the
 * shape at load; the assertion is defence in depth). Returns `null`
 * when no source arms an expiry: the job never expires, the reaper
 * skips it, and `sm doctor`'s `jobs-overdue` check advises instead.
 */
export function resolveTtl(
  action: Pick<IAction, 'id' | 'pluginId'>,
  jobs: IJobsConfig,
  flagTtl?: number,
): number | null {
  // Step 1: `--ttl` wins outright; `0` disarms over any config policy.
  if (flagTtl !== undefined) {
    if (!Number.isInteger(flagTtl) || flagTtl < 0) throw new InvalidTtlError(flagTtl);
    return flagTtl === 0 ? null : flagTtl;
  }
  // Step 2: per-extension config policy.
  const override = lookupPerExtension(jobs.perExtensionTtl, action);
  if (override !== undefined) {
    assertPositiveTtl(override);
    return override;
  }
  // Step 3: the global arm-everything policy (unset by default).
  if (jobs.ttlSeconds !== undefined) {
    assertPositiveTtl(jobs.ttlSeconds);
    return jobs.ttlSeconds;
  }
  // Step 4: no source, no TTL.
  return null;
}

// ---------------------------------------------------------------------------
// Submit target resolution (`spec/cli-contract.md` §Jobs)
// ---------------------------------------------------------------------------

/**
 * Minimal extension shape the submit-target resolver reads. Both
 * `IAction` and `IAnalyzer` satisfy it structurally.
 */
export interface ISubmitTargetExtension {
  id: string;
  pluginId: string;
  mode?: TExecutionMode;
}

/**
 * Outcome of `resolveSubmitTarget` over the composed catalogs:
 *
 *   - `action` / `analyzer`, exactly one probabilistic extension
 *     matched; carries the matched instance.
 *   - `ambiguous`, the UNPREFIXED input matched a probabilistic Action
 *     AND a probabilistic Analyzer; carries the two qualified
 *     disambiguators (`action:<id>` / `analyzer:<id>` always resolve).
 *   - `deterministic`, nothing probabilistic matched but a deterministic
 *     extension did; the caller refuses with exit 2 and the pinned
 *     "only probabilistic extensions are queued" advisory.
 *   - `not-found`, the input matched nothing at all (exit 5).
 */
export type TSubmitTargetResolution<
  A extends ISubmitTargetExtension,
  N extends ISubmitTargetExtension,
> =
  | { outcome: 'action'; extension: A }
  | { outcome: 'analyzer'; extension: N }
  | { outcome: 'ambiguous'; actionId: string; analyzerId: string }
  | { outcome: 'deterministic'; mode: TExecutionMode }
  | { outcome: 'not-found' };

/** Qualified-then-bare lookup (the `sm jobs list --extension` matching rule). */
function findByQualifiedOrBareId<T extends ISubmitTargetExtension>(
  catalog: readonly T[],
  id: string,
): T | null {
  for (const ext of catalog) {
    if (qualifiedExtensionId(ext.pluginId, ext.id) === id) return ext;
  }
  for (const ext of catalog) {
    if (ext.id === id) return ext;
  }
  return null;
}

/**
 * Probabilistic gate (`spec/cli-contract.md` §Jobs): only probabilistic
 * extensions are queue-eligible; deterministic ones run in-process.
 * Exported so the launcher-classification surfaces (the BFF's
 * `GET /api/nodes/:pathB64/prob-extensions`) apply the same predicate
 * the submit target resolution does.
 */
export function isProbabilistic(ext: ISubmitTargetExtension): boolean {
  return (ext.mode ?? 'deterministic') === 'probabilistic';
}

/**
 * Resolve a `sm jobs submit <extension>` target across probabilistic
 * Actions AND probabilistic Analyzers (`spec/cli-contract.md` §Jobs,
 * Submit target resolution). The queue is kind-agnostic; the input is a
 * qualified id (`<plugin>/<ext>`), a bare extension id (suffix
 * matching), or a `<kind>:` prefixed disambiguator
 * (`action:<plugin>/<ext>` / `analyzer:<plugin>/<ext>`), which is ALWAYS
 * accepted, also when the unprefixed form would be unambiguous.
 *
 * Resolution scans the PROBABILISTIC subset of each catalog. When the
 * unprefixed input matches a probabilistic extension in BOTH catalogs
 * (one plugin shipping an Action and an Analyzer under the same
 * extension id, or a bare id colliding across plugins), the resolution
 * is `ambiguous` and the caller refuses with the `<kind>:` advisory.
 * A deterministic-only match reports `deterministic` (exit 2, pinned
 * refusal); no match at all reports `not-found` (exit 5).
 */
export function resolveSubmitTarget<
  A extends ISubmitTargetExtension,
  N extends ISubmitTargetExtension,
>(
  actions: readonly A[],
  analyzers: readonly N[],
  target: string,
): TSubmitTargetResolution<A, N> {
  if (target.startsWith('action:')) {
    const prefixed = resolvePrefixed(actions, target.slice('action:'.length));
    return prefixed.outcome === 'match'
      ? { outcome: 'action', extension: prefixed.extension }
      : prefixed;
  }
  if (target.startsWith('analyzer:')) {
    const prefixed = resolvePrefixed(analyzers, target.slice('analyzer:'.length));
    return prefixed.outcome === 'match'
      ? { outcome: 'analyzer', extension: prefixed.extension }
      : prefixed;
  }
  return resolveUnprefixed(actions, analyzers, target);
}

/**
 * Unprefixed form: scan the probabilistic subsets of both catalogs, then
 * fall back to a deterministic match for the directed refusal.
 */
function resolveUnprefixed<
  A extends ISubmitTargetExtension,
  N extends ISubmitTargetExtension,
>(
  actions: readonly A[],
  analyzers: readonly N[],
  target: string,
): TSubmitTargetResolution<A, N> {
  const probAction = findByQualifiedOrBareId(actions.filter(isProbabilistic), target);
  const probAnalyzer = findByQualifiedOrBareId(analyzers.filter(isProbabilistic), target);
  if (probAction !== null && probAnalyzer !== null) {
    return {
      outcome: 'ambiguous',
      actionId: qualifiedExtensionId(probAction.pluginId, probAction.id),
      analyzerId: qualifiedExtensionId(probAnalyzer.pluginId, probAnalyzer.id),
    };
  }
  if (probAction !== null) return { outcome: 'action', extension: probAction };
  if (probAnalyzer !== null) return { outcome: 'analyzer', extension: probAnalyzer };

  const deterministic =
    findByQualifiedOrBareId(actions, target) ?? findByQualifiedOrBareId(analyzers, target);
  if (deterministic !== null) {
    return { outcome: 'deterministic', mode: deterministic.mode ?? 'deterministic' };
  }
  return { outcome: 'not-found' };
}

/**
 * `<kind>:` prefixed form: resolve within the named catalog only. The
 * probabilistic gate still applies (a `<kind>:` prefix never smuggles a
 * deterministic extension into the queue).
 */
function resolvePrefixed<T extends ISubmitTargetExtension>(
  catalog: readonly T[],
  id: string,
):
  | { outcome: 'match'; extension: T }
  | { outcome: 'deterministic'; mode: TExecutionMode }
  | { outcome: 'not-found' } {
  const match = findByQualifiedOrBareId(catalog, id);
  if (match === null) return { outcome: 'not-found' };
  if (!isProbabilistic(match)) {
    return { outcome: 'deterministic', mode: match.mode ?? 'deterministic' };
  }
  return { outcome: 'match', extension: match };
}

/**
 * Resolve the effective priority frozen on `state_jobs.priority`.
 * `flagPriority` is the parsed `--priority` value (or `undefined`).
 */
export function resolvePriority(
  action: TResolvableAction,
  jobs: IJobsConfig,
  flagPriority?: number,
): number {
  // Highest precedence: the `--priority` flag.
  if (flagPriority !== undefined) {
    if (!Number.isInteger(flagPriority)) throw new InvalidPriorityError(flagPriority);
    return flagPriority;
  }
  // Config override next.
  const override = lookupPerExtension(jobs.perExtensionPriority, action);
  if (override !== undefined) return override;
  // Manifest default (absent today) -> 0.
  return action.defaultPriority ?? 0;
}
