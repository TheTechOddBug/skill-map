/**
 * GUARD 2, every enumerated flag VALUE the contract spells out is
 * actually accepted at runtime.
 *
 * Guard 1 checks that `--format` exists. It cannot see that
 * `--format mermaid` was documented for months with no such formatter
 * registered, because the flag was there and only one of its documented
 * VALUES was missing. So this guard takes every `--flag <a|b|c>` form in
 * `spec/cli-contract.md` and RUNS each branch against a real seeded
 * project.
 *
 * Running matters. `sm graph --format <x>` is not validated by the
 * argument parser (the contract keeps that set OPEN so plugin formatters
 * can extend it); the value is resolved against the formatter registry
 * during execution. A parse-only check would have passed happily while
 * `mermaid` resolved to nothing.
 *
 * Telling a real rejection from an unrelated failure: exit code alone is
 * useless here (a missing DB and a bogus value both exit 2), so the
 * guard matches the CLI's own rejection wording. To keep that
 * discriminator honest, every case first runs a NEGATIVE CONTROL with a
 * deliberately bogus value and asserts it IS recognised as a rejection.
 * If the CLI ever rephrases those messages, the control fails loudly
 * instead of the guard quietly accepting everything forever.
 */

import { strict as assert } from 'node:assert';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  type IContractSurface,
  SCRATCH_ROOT,
  enumeratedFlags,
  loadHelpSurface,
  parseContractSurface,
  readContract,
  seedScannedScope,
  sm,
} from './helpers/cli-contract.js';

/**
 * How the CLI says "that is not one of the values I know".
 *
 * One alternative per wording in use today, each annotated with the verb
 * that produces it. They are separate messages on purpose (each verb
 * enumerates its own set in the error), so this union is the honest
 * shape rather than an invented common format.
 */
const VALUE_REJECTED_RE = new RegExp(
  [
    'no formatter registered for', // sm graph --format
    'unsupported format', //          sm export --format
    'invalid value', //               sm help --format, sm history stats --period
    'unknown --', //                  sm conformance run --scope
    'unknown option', //              any unknown flag (Clipanion)
  ].join('|'),
  'i',
);

/** Value no verb can ever legitimately accept. */
const BOGUS_VALUE = '__contract-guard-bogus__';

/**
 * How to invoke each enumerated flag so the verb reaches the code that
 * resolves the value.
 *
 * A contract that grows a NEW `--flag <a|b|c>` form with no recipe here
 * fails the coverage test below rather than being skipped, so the guard
 * cannot quietly stop checking as the CLI grows.
 */
const RECIPES: ReadonlyMap<string, (value: string) => string[]> = new Map([
  ['help --format', (v) => ['help', '--format', v]],
  ['graph --format', (v) => ['graph', '--format', v]],
  // Empty query positional: export requires one, and "" selects everything.
  ['export --format', (v) => ['export', '', '--format', v]],
  ['history stats --period', (v) => ['history', 'stats', '--period', v]],
  [
    // `--case <no-such-id>` makes the run resolve the scope and then stop
    // before executing a single case. Without it a real conformance run
    // takes minutes and spawns `sm serve` children, and killing it
    // mid-flight would orphan them; this reaches the exact code path the
    // guard cares about (scope resolution) in a few milliseconds.
    'conformance run --scope',
    (v) => ['conformance', 'run', '--scope', v, '--case', '__contract-guard-no-such-case__'],
  ],
]);

let contract: IContractSurface;
let cwd: string;

before(() => {
  cwd = join(SCRATCH_ROOT, 'flag-values');
  seedScannedScope(cwd);
  contract = parseContractSurface(readContract(), new Set(loadHelpSurface(cwd).verbs.map((v) => v.name)));
});

after(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('Guard 2 · every enumerated flag value in the contract runs', () => {
  it('the contract still spells out enumerated flag values (vacuity tripwire)', () => {
    const found = enumeratedFlags(contract);
    assert.ok(
      found.length >= 4,
      `the contract parser matched almost nothing, its assumptions broke: `
        + `${found.length} enumerated flags (expected >= 4). The \`--flag <a|b|c>\` form in `
        + 'spec/cli-contract.md was probably reshaped; fix helpers/cli-contract.ts.',
    );
  });

  it('every enumerated flag in the contract has an invocation recipe', () => {
    const orphans = enumeratedFlags(contract)
      .map((e) => `${e.verb} ${e.flag}`)
      .filter((key) => !RECIPES.has(key));
    assert.deepEqual(
      orphans,
      [],
      `the contract documents enumerated values with no recipe in this guard, so they are `
        + `going unchecked. Add them to RECIPES:\n  ${orphans.join('\n  ')}`,
    );
  });

  it('the rejection discriminator still matches a bogus value (negative control)', () => {
    const unrecognised: string[] = [];
    for (const entry of enumeratedFlags(contract)) {
      const recipe = RECIPES.get(`${entry.verb} ${entry.flag}`);
      if (recipe === undefined) continue;
      const result = sm(recipe(BOGUS_VALUE), { cwd });
      if (!VALUE_REJECTED_RE.test(result.stderr)) {
        unrecognised.push(`sm ${entry.verb} ${entry.flag} ${BOGUS_VALUE} -> ${result.stderr.trim()}`);
      }
    }
    assert.deepEqual(
      unrecognised,
      [],
      'the CLI rejected a bogus value in wording this guard does not recognise, so every '
        + `positive case below is now meaningless. Update VALUE_REJECTED_RE:\n  ${unrecognised.join('\n  ')}`,
    );
  });

  it('every documented value is accepted by the verb that documents it', () => {
    const rejected: string[] = [];
    for (const entry of enumeratedFlags(contract)) {
      const recipe = RECIPES.get(`${entry.verb} ${entry.flag}`);
      if (recipe === undefined) continue;
      for (const value of entry.values) {
        const result = sm(recipe(value), { cwd });
        if (VALUE_REJECTED_RE.test(result.stderr)) {
          rejected.push(
            `sm ${entry.verb} ${entry.flag} ${value}: ${result.stderr.trim().split('\n')[0]}`,
          );
        }
      }
    }
    assert.deepEqual(
      rejected,
      [],
      `the contract documents values the CLI does not accept:\n  ${rejected.join('\n  ')}`,
    );
  });
});
