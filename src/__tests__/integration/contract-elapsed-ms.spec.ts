/**
 * GUARD 4, object-shaped `--json` payloads carry `elapsedMs`.
 *
 * `spec/cli-contract.md` §Elapsed time §JSON output: "When the verb's
 * `--json` output is a top-level object, the schema includes an
 * `elapsedMs` top-level field (integer, milliseconds)." The sibling
 * `elapsed-invariant.spec.ts` already pins the `done in <…>` line on
 * stderr; nothing pinned the field inside the document, and five verbs
 * quietly shipped without it.
 *
 * The in-scope verb list is READ FROM THE CONTRACT (§Elapsed time
 * §Scope, the "Examples:" enumeration) rather than copied here, so the
 * guard follows the spec instead of drifting away from it.
 *
 * The contract's own exemptions are honoured, and each is asserted
 * rather than assumed:
 *   - Array and ndjson payloads are exempt ("there is no object to
 *     attach it to"). The guard checks the shape at runtime, so a verb
 *     that changes from array to object starts being required to carry
 *     the field.
 *   - Schemas that already express the wall clock under a nested field
 *     (`scan-result.schema.json` -> `stats.durationMs`) keep using it.
 *     Those verbs are not skipped: the nested field is asserted instead.
 */

import { strict as assert } from 'node:assert';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  type IElapsedScope,
  SCRATCH_ROOT,
  parseElapsedScope,
  readContract,
  seedScannedScope,
  sm,
} from './helpers/cli-contract.js';

/** How to invoke each in-scope verb so it produces its payload. */
const RECIPES: ReadonlyMap<string, string[]> = new Map([
  ['scan', ['scan', '--yes', '--json']],
  ['check', ['check', '--json']],
  ['list', ['list', '--json']],
  ['show', ['show', 'AGENTS.md', '--json']],
  ['findings', ['findings', '--json']],
  ['history', ['history', '--json']],
  ['history stats', ['history', 'stats', '--json']],
  // `sm graph` ignores the global --json by contract; its machine
  // surface is the json formatter.
  ['graph', ['graph', '--format', 'json']],
  ['export', ['export', '', '--json']],
  ['doctor', ['doctor', '--json']],
  ['db backup', ['db', 'backup', '--json']],
  ['db migrate', ['db', 'migrate', '--no-backup', '--json']],
  ['plugins list', ['plugins', 'list', '--json']],
  ['plugins doctor', ['plugins', 'doctor', '--json']],
]);

/**
 * Verbs whose wall clock rides a NESTED field by contract, so a missing
 * top-level `elapsedMs` is correct rather than a defect. Named
 * explicitly, and still asserted (on the nested field) so they are
 * guarded, not skipped.
 *
 * `sm scan` is the case the contract calls out. `sm graph --format json`
 * is the same document: its row says the output is "byte-equivalent to
 * `sm scan --json` modulo whitespace".
 */
const NESTED_ELAPSED: ReadonlyMap<string, string[]> = new Map([
  ['scan', ['stats', 'durationMs']],
  ['graph', ['stats', 'durationMs']],
]);

/** In-scope verbs this guard cannot drive, each with the reason. */
const EXCLUDED: ReadonlyMap<string, string> = new Map([
  ['jobs submit', 'needs an enabled probabilistic extension to queue against'],
  ['jobs claim', 'needs a queued job; on an empty queue it exits 1 with no payload'],
  ['jobs preview', 'needs an existing job id'],
  ['record', 'ndjson stream (already exempt by shape) and needs a running job plus its nonce'],
  ['db restore', 'destructive DB swap; needs a prepared backup, covered by the db-restore specs'],
  [
    'db dump',
    // Same parked defect guard 3 records: the verb writes SQL on stdout
    // under --json, so there is no object to carry `elapsedMs` until the
    // user decides whether `--json` should wrap the dump or be
    // documented as ignored (as `sm graph` does).
    'DEFERRED DEFECT: emits SQL on stdout under --json, so it has no object payload yet',
  ],
  ['init', 'requires a pristine cwd; would clobber the shared seeded scope'],
  ['conformance run', 'takes minutes and spawns `sm serve` children that a kill would orphan'],
]);

interface IPayloadShape {
  kind: 'object' | 'array' | 'ndjson' | 'empty' | 'unparseable';
  value: unknown;
}

function readShape(stdout: string): IPayloadShape {
  const trimmed = stdout.trim();
  if (trimmed === '') return { kind: 'empty', value: null };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return { kind: Array.isArray(parsed) ? 'array' : 'object', value: parsed };
  } catch {
    return { kind: 'unparseable', value: trimmed.slice(0, 120) };
  }
}

function nestedNumber(payload: unknown, path: string[]): number | null {
  let cursor: unknown = payload;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'number' ? cursor : null;
}

let scope: IElapsedScope;
let cwd: string;

before(() => {
  cwd = join(SCRATCH_ROOT, 'elapsed-ms');
  seedScannedScope(cwd);
  scope = parseElapsedScope(readContract());
});

after(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('Guard 4 · object-shaped --json payloads carry elapsedMs', () => {
  it('the §Elapsed time scope is still parseable from the contract (vacuity tripwire)', () => {
    assert.ok(
      scope.inScope.length >= 15,
      `the contract parser matched almost nothing, its assumptions broke: `
        + `${scope.inScope.length} in-scope verbs (expected >= 15). The "**In scope**" `
        + 'enumeration under §Elapsed time §Scope was reshaped; fix helpers/cli-contract.ts.',
    );
    assert.ok(
      scope.exempt.length >= 4,
      `expected the contract to enumerate exempt verbs, found ${scope.exempt.length}`,
    );
  });

  it('every in-scope verb has a recipe or an explicit exclusion', () => {
    const unaccounted = scope.inScope.filter((v) => !RECIPES.has(v) && !EXCLUDED.has(v));
    assert.deepEqual(
      unaccounted,
      [],
      'the contract lists these verbs as owing a wall-clock report, but this guard neither '
        + `runs nor excuses them:\n  ${unaccounted.join('\n  ')}`,
    );
  });

  it('object payloads carry a top-level elapsedMs', () => {
    const missing: string[] = [];
    const shapes: string[] = [];
    for (const verb of scope.inScope) {
      const argv = RECIPES.get(verb);
      if (argv === undefined) continue;
      const shape = readShape(sm(argv, { cwd }).stdout);
      shapes.push(`${verb}=${shape.kind}`);

      const nested = NESTED_ELAPSED.get(verb);
      if (nested !== undefined) {
        const value = nestedNumber(shape.value, nested);
        if (value === null) missing.push(`sm ${verb}: no nested ${nested.join('.')} (${shape.kind})`);
        continue;
      }
      // Array / ndjson / absent payloads are exempt by contract: there
      // is no object to attach the field to.
      if (shape.kind !== 'object') continue;
      const elapsed = nestedNumber(shape.value, ['elapsedMs']);
      if (elapsed === null || !Number.isInteger(elapsed) || elapsed < 0) {
        missing.push(`sm ${verb}: object payload without a valid top-level elapsedMs`);
      }
    }
    assert.ok(shapes.length >= 10, `only ${shapes.length} verbs ran; the matrix was gutted`);
    assert.deepEqual(
      missing,
      [],
      `these verbs return an object under --json but omit elapsedMs (§Elapsed time §JSON output):`
        + `\n  ${missing.join('\n  ')}`,
    );
  });

  it('no recipe or exclusion outlives the contract entry it serves', () => {
    // Keeps this guard's two maps pinned to the contract: an entry for a
    // verb the contract no longer lists is dead weight that reads like
    // coverage.
    const listed = new Set(scope.inScope);
    const stale = [...RECIPES.keys(), ...EXCLUDED.keys()].filter((v) => !listed.has(v));
    assert.deepEqual(
      stale,
      [],
      `these verbs are no longer in the contract's §Elapsed time scope: ${stale.join(', ')}`,
    );
  });

  it('the contract-exempt verbs really are the cheap informational ones', () => {
    // Sanity check on the other half of the parse: `sm version` and the
    // `sm config` readers are excused, and none of them may also appear
    // as in-scope (the two lists must stay disjoint).
    const overlap = scope.exempt.filter((v) => scope.inScope.includes(v));
    assert.deepEqual(overlap, [], `verbs listed as both in-scope and exempt: ${overlap.join(', ')}`);
  });
});
