/**
 * Unit tests for TTL / priority resolution, driven by the worked-examples
 * table in `spec/job-lifecycle.md` §TTL resolution and the precedence rule
 * in §Submit step 6, plus the kind-agnostic submit-target resolution
 * (`spec/cli-contract.md` §Jobs, Submit target resolution).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual, throws } from 'node:assert';

import type { IJobsConfig } from '../../config/loader.js';
import {
  resolvePriority,
  resolveSubmitTarget,
  resolveTtl,
  type ISubmitTargetExtension,
  type TResolvableAction,
} from '../resolve.js';
import { InvalidPriorityError, InvalidTtlError } from '../errors.js';

function jobs(overrides: Partial<IJobsConfig> = {}): IJobsConfig {
  return {
    perExtensionTtl: {},
    perExtensionPriority: {},
    retention: { completed: 2592000, failed: null, cancelled: 2592000 },
    ...overrides,
  };
}

function action(overrides: Partial<TResolvableAction> = {}): TResolvableAction {
  return { id: 'skill-summarizer', pluginId: 'core', ...overrides };
}

describe('resolveTtl (opt-in, worked examples per spec §TTL resolution)', () => {
  it('no source at all -> null (jobs never expire by default)', () => {
    strictEqual(resolveTtl(action(), jobs()), null);
  });

  it('probExpectedDurationSeconds never arms a TTL (advisory only)', () => {
    strictEqual(resolveTtl(action({ probExpectedDurationSeconds: 120 }), jobs()), null);
  });

  it('jobs.ttlSeconds is the global opt-in policy', () => {
    strictEqual(resolveTtl(action(), jobs({ ttlSeconds: 3600 })), 3600);
  });

  it('perExtensionTtl arms only the matching extension (by qualified id)', () => {
    const cfg = jobs({ perExtensionTtl: { 'core/skill-summarizer': 900 } });
    strictEqual(resolveTtl(action(), cfg), 900);
    strictEqual(resolveTtl(action({ id: 'other' }), cfg), null, 'no TTL for the rest');
  });

  it('perExtensionTtl also matches the bare extension id', () => {
    const cfg = jobs({ perExtensionTtl: { 'skill-summarizer': 900 } });
    strictEqual(resolveTtl(action(), cfg), 900);
  });

  it('perExtensionTtl wins over the global jobs.ttlSeconds', () => {
    const cfg = jobs({ ttlSeconds: 3600, perExtensionTtl: { 'core/skill-summarizer': 900 } });
    strictEqual(resolveTtl(action(), cfg), 900);
  });

  it('--ttl flag wins outright over every config source', () => {
    const cfg = jobs({ ttlSeconds: 3600, perExtensionTtl: { 'core/skill-summarizer': 900 } });
    strictEqual(resolveTtl(action(), cfg, 45), 45);
  });

  it('--ttl 0 explicitly DISARMS, overriding any config policy', () => {
    const cfg = jobs({ ttlSeconds: 3600, perExtensionTtl: { 'core/skill-summarizer': 900 } });
    strictEqual(resolveTtl(action(), cfg, 0), null);
  });

  it('rejects a negative --ttl with InvalidTtlError', () => {
    throws(() => resolveTtl(action(), jobs(), -5), InvalidTtlError);
  });

  it('rejects a non-integer --ttl with InvalidTtlError', () => {
    throws(() => resolveTtl(action(), jobs(), 1.5), InvalidTtlError);
  });

  it('rejects a non-positive perExtensionTtl override (defence in depth)', () => {
    const cfg = jobs({ perExtensionTtl: { 'core/skill-summarizer': 0 } });
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

  it('config perExtensionPriority overrides the manifest default', () => {
    const cfg = jobs({ perExtensionPriority: { 'core/skill-summarizer': 5 } });
    strictEqual(resolvePriority(action({ defaultPriority: 7 }), cfg), 5);
  });

  it('--priority flag wins outright', () => {
    const cfg = jobs({ perExtensionPriority: { 'core/skill-summarizer': 5 } });
    strictEqual(resolvePriority(action({ defaultPriority: 7 }), cfg, 9), 9);
  });

  it('negative --priority is permitted', () => {
    strictEqual(resolvePriority(action(), jobs(), -3), -3);
  });

  it('rejects a non-integer --priority with InvalidPriorityError', () => {
    throws(() => resolvePriority(action(), jobs(), 1.5), InvalidPriorityError);
  });
});

describe('resolveSubmitTarget (kind-agnostic queue)', () => {
  const ext = (
    pluginId: string,
    id: string,
    mode?: 'deterministic' | 'probabilistic',
  ): ISubmitTargetExtension => ({ pluginId, id, ...(mode !== undefined ? { mode } : {}) });

  const probAction = ext('plug', 'brief', 'probabilistic');
  const probAnalyzer = ext('plug', 'finder', 'probabilistic');
  const detAction = ext('core', 'node-set-tags');

  it('resolves a probabilistic analyzer by qualified id', () => {
    const r = resolveSubmitTarget([probAction], [probAnalyzer], 'plug/finder');
    deepStrictEqual(r, { outcome: 'analyzer', extension: probAnalyzer });
  });

  it('resolves a probabilistic analyzer by bare id (suffix matching)', () => {
    const r = resolveSubmitTarget([probAction], [probAnalyzer], 'finder');
    deepStrictEqual(r, { outcome: 'analyzer', extension: probAnalyzer });
  });

  it('resolves a probabilistic action exactly as before analyzers joined', () => {
    const r = resolveSubmitTarget([probAction], [probAnalyzer], 'plug/brief');
    deepStrictEqual(r, { outcome: 'action', extension: probAction });
  });

  it('refuses a deterministic-only match with outcome deterministic (exit 2 lane)', () => {
    const r = resolveSubmitTarget([detAction], [], 'core/node-set-tags');
    deepStrictEqual(r, { outcome: 'deterministic', mode: 'deterministic' });
  });

  it('reports not-found when nothing matches at all (exit 5 lane)', () => {
    deepStrictEqual(resolveSubmitTarget([detAction], [probAnalyzer], 'no/such'), {
      outcome: 'not-found',
    });
  });

  it('the probabilistic match wins over a deterministic bare-id collision', () => {
    const detTwin = ext('core', 'finder'); // deterministic action, same bare id
    const r = resolveSubmitTarget([detTwin], [probAnalyzer], 'finder');
    deepStrictEqual(r, { outcome: 'analyzer', extension: probAnalyzer });
  });

  describe('dual extension id (one plugin, both kinds probabilistic)', () => {
    const dualAction = ext('dual', 'judge', 'probabilistic');
    const dualAnalyzer = ext('dual', 'judge', 'probabilistic');

    it('unprefixed bare form refuses with the two disambiguators', () => {
      deepStrictEqual(resolveSubmitTarget([dualAction], [dualAnalyzer], 'judge'), {
        outcome: 'ambiguous',
        actionId: 'dual/judge',
        analyzerId: 'dual/judge',
      });
    });

    it('unprefixed qualified form refuses too (the id itself is dual)', () => {
      strictEqual(
        resolveSubmitTarget([dualAction], [dualAnalyzer], 'dual/judge').outcome,
        'ambiguous',
      );
    });

    it('action: prefix always resolves the action half', () => {
      deepStrictEqual(resolveSubmitTarget([dualAction], [dualAnalyzer], 'action:dual/judge'), {
        outcome: 'action',
        extension: dualAction,
      });
    });

    it('analyzer: prefix always resolves the analyzer half (bare form too)', () => {
      deepStrictEqual(resolveSubmitTarget([dualAction], [dualAnalyzer], 'analyzer:judge'), {
        outcome: 'analyzer',
        extension: dualAnalyzer,
      });
    });
  });

  describe('kind-prefixed forms on unambiguous ids', () => {
    it('action: prefix is accepted when unambiguous', () => {
      deepStrictEqual(resolveSubmitTarget([probAction], [probAnalyzer], 'action:plug/brief'), {
        outcome: 'action',
        extension: probAction,
      });
    });

    it('analyzer: prefix is accepted when unambiguous', () => {
      deepStrictEqual(resolveSubmitTarget([probAction], [probAnalyzer], 'analyzer:plug/finder'), {
        outcome: 'analyzer',
        extension: probAnalyzer,
      });
    });

    it('a kind prefix never smuggles a deterministic extension into the queue', () => {
      deepStrictEqual(resolveSubmitTarget([detAction], [], 'action:core/node-set-tags'), {
        outcome: 'deterministic',
        mode: 'deterministic',
      });
    });

    it('a kind prefix that matches nothing in its catalog is not-found', () => {
      deepStrictEqual(resolveSubmitTarget([probAction], [probAnalyzer], 'action:plug/finder'), {
        outcome: 'not-found',
      });
    });
  });

  it('TTL config sources apply to analyzers identically to actions', () => {
    // The resolver is structural: an IAnalyzer-shaped extension threads
    // through resolveTtl exactly like an action (spec §Jobs, TTL rule).
    const finder = { id: 'finder', pluginId: 'plug' };
    strictEqual(resolveTtl(finder, jobs()), null, 'opt-in: no source, no TTL');
    strictEqual(resolveTtl(finder, jobs({ perExtensionTtl: { 'plug/finder': 300 } })), 300);
  });
});
