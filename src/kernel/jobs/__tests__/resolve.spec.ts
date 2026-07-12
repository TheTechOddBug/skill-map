/**
 * Unit tests for TTL / priority resolution, driven by the worked-examples
 * table in `spec/job-lifecycle.md` §TTL resolution and the precedence rule
 * in §Submit step 6.
 */

import { describe, it } from 'node:test';
import { strictEqual, throws } from 'node:assert';

import type { IJobsConfig } from '../../config/loader.js';
import { resolvePriority, resolveTtl, type TResolvableAction } from '../resolve.js';
import { InvalidPriorityError, InvalidTtlError } from '../errors.js';

function jobs(overrides: Partial<IJobsConfig> = {}): IJobsConfig {
  return {
    ttlSeconds: 3600,
    graceMultiplier: 3,
    minimumTtlSeconds: 60,
    perActionTtl: {},
    perActionPriority: {},
    retention: { completed: 2592000, failed: null, cancelled: 2592000 },
    ...overrides,
  };
}

function action(overrides: Partial<TResolvableAction> = {}): TResolvableAction {
  return { id: 'skill-summarizer', pluginId: 'core', ...overrides };
}

describe('resolveTtl (worked examples)', () => {
  it('probExpectedDurationSeconds 120, defaults -> max(120*3,60) = 360', () => {
    strictEqual(resolveTtl(action({ probExpectedDurationSeconds: 120 }), jobs()), 360);
  });

  it('no manifest duration, defaults -> max(3600*3,60) = 10800', () => {
    strictEqual(resolveTtl(action(), jobs()), 10800);
  });

  it('probExpectedDurationSeconds 10, defaults -> floor bites, = 60', () => {
    strictEqual(resolveTtl(action({ probExpectedDurationSeconds: 10 }), jobs()), 60);
  });

  it('perActionTtl override replaces the formula (by qualified id)', () => {
    const cfg = jobs({ perActionTtl: { 'core/skill-summarizer': 900 } });
    strictEqual(resolveTtl(action({ probExpectedDurationSeconds: 120 }), cfg), 900);
  });

  it('perActionTtl override also matches the bare action id', () => {
    const cfg = jobs({ perActionTtl: { 'skill-summarizer': 900 } });
    strictEqual(resolveTtl(action({ probExpectedDurationSeconds: 120 }), cfg), 900);
  });

  it('--ttl flag wins outright over config + manifest', () => {
    const cfg = jobs({ perActionTtl: { 'core/skill-summarizer': 900 } });
    strictEqual(resolveTtl(action({ probExpectedDurationSeconds: 120 }), cfg, 45), 45);
  });

  it('rejects --ttl 0 with InvalidTtlError', () => {
    throws(() => resolveTtl(action(), jobs(), 0), InvalidTtlError);
  });

  it('rejects a negative --ttl with InvalidTtlError', () => {
    throws(() => resolveTtl(action(), jobs(), -5), InvalidTtlError);
  });

  it('rejects a non-positive perActionTtl override', () => {
    const cfg = jobs({ perActionTtl: { 'core/skill-summarizer': 0 } });
    throws(() => resolveTtl(action(), cfg), InvalidTtlError);
  });
});

describe('resolvePriority (precedence)', () => {
  it('defaults to 0 when nothing declares a priority', () => {
    strictEqual(resolvePriority(action(), jobs()), 0);
  });

  it('manifest defaultPriority is used when config + flag are absent', () => {
    strictEqual(resolvePriority(action({ defaultPriority: 7 }), jobs()), 7);
  });

  it('config perActionPriority overrides the manifest default', () => {
    const cfg = jobs({ perActionPriority: { 'core/skill-summarizer': 5 } });
    strictEqual(resolvePriority(action({ defaultPriority: 7 }), cfg), 5);
  });

  it('--priority flag wins outright', () => {
    const cfg = jobs({ perActionPriority: { 'core/skill-summarizer': 5 } });
    strictEqual(resolvePriority(action({ defaultPriority: 7 }), cfg, 9), 9);
  });

  it('negative --priority is permitted', () => {
    strictEqual(resolvePriority(action(), jobs(), -3), -3);
  });

  it('rejects a non-integer --priority with InvalidPriorityError', () => {
    throws(() => resolvePriority(action(), jobs(), 1.5), InvalidPriorityError);
  });
});
