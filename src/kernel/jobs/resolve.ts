/**
 * TTL and priority resolution for a new job.
 *
 * TTL (`spec/job-lifecycle.md` §TTL resolution), three steps:
 *   1. Base = action manifest `probExpectedDurationSeconds` if declared,
 *      else config `jobs.ttlSeconds` (default 3600).
 *   2. Computed = `max(base * jobs.graceMultiplier, jobs.minimumTtlSeconds)`
 *      (`minimumTtlSeconds` is a floor, not an initial value).
 *   3. Overrides, later wins: config `jobs.perActionTtl[<actionId>]`
 *      replaces the computed value entirely; flag `--ttl <seconds>`
 *      replaces everything. `--ttl <= 0` (or a non-integer / a <= 0
 *      config override) is rejected with `InvalidTtlError` (exit 2).
 *
 * Priority (`spec/job-lifecycle.md` §Submit step 6), precedence low ->
 * high: action manifest default (no field on `IAction` today, so 0) ->
 * config `jobs.perActionPriority[<actionId>]` -> flag `--priority <n>`.
 * Integer, negatives permitted, default 0. A non-integer `--priority` is
 * rejected with `InvalidPriorityError` (exit 2).
 *
 * Config keys are looked up by BOTH the qualified id (`<plugin>/<id>`) and
 * the bare extension id, so an operator may key either form.
 */

import type { IAction } from '../extensions/index.js';
import type { IJobsConfig } from '../config/loader.js';
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
 * First defined value in `map` under the action's qualified id, then its
 * bare id. `undefined` when neither key is present.
 */
function lookupPerAction(
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
 * Resolve the effective TTL (seconds) frozen on `state_jobs.ttl_seconds`.
 * `flagTtl` is the parsed `--ttl` value (or `undefined` when absent).
 */
export function resolveTtl(
  action: TResolvableAction,
  jobs: IJobsConfig,
  flagTtl?: number,
): number {
  // Step 3b: `--ttl` wins outright.
  if (flagTtl !== undefined) {
    assertPositiveTtl(flagTtl);
    return flagTtl;
  }
  // Step 3a: per-action config override replaces the computed formula.
  const override = lookupPerAction(jobs.perActionTtl, action);
  if (override !== undefined) {
    assertPositiveTtl(override);
    return override;
  }
  // Steps 1-2: base duration folded through the grace multiplier + floor.
  const base = action.probExpectedDurationSeconds ?? jobs.ttlSeconds;
  return Math.max(base * jobs.graceMultiplier, jobs.minimumTtlSeconds);
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
  const override = lookupPerAction(jobs.perActionPriority, action);
  if (override !== undefined) return override;
  // Manifest default (absent today) -> 0.
  return action.defaultPriority ?? 0;
}
