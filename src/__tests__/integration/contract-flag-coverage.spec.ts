/**
 * GUARD 1, every flag `spec/cli-contract.md` documents actually exists.
 *
 * The defect class: a contract row promises a verb or a flag, the code
 * never grew it (or grew it under a different spelling / arity), and no
 * unit test notices, because unit tests assert what the code DOES, never
 * what the document PROMISES. `--format mermaid` was documented for
 * months with no such formatter registered; `sm scan -n <node.path>` is
 * documented today and does not exist.
 *
 * The oracle is `sm help --format json`, the runtime's own surface dump.
 * It is COMPLETE by contract (`spec/cli-contract.md` §`sm help`: "flags
 * is COMPLETE ... MUST list every option the verb accepts") and a
 * separate test fails if it drifts from the code, so it is a faithful
 * mirror of what the binary really accepts. Diffing the contract against
 * it costs one spawn instead of one spawn per documented flag.
 *
 * Directions:
 *   - FORWARD (contract -> CLI) is GATED. A documented flag that does
 *     not exist is a broken promise to every reader of the spec.
 *   - REVERSE (CLI -> contract) is REPORTED, not gated. It currently
 *     finds ~75 undocumented flags, a real documentation backlog that
 *     nobody has triaged; failing on it today would just get the guard
 *     disabled. It prints a summary every run and the full inventory
 *     under `SM_CONTRACT_REPORT=1`.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import {
  type IContractSurface,
  type IHelpFlag,
  type IHelpSurface,
  SCRATCH_ROOT,
  enumeratedFlags,
  flagSpellings,
  loadHelpSurface,
  parseContractSurface,
  readContract,
  sm,
} from './helpers/cli-contract.js';

/**
 * Vacuity tripwire. The CLI publishes 79 verbs and the contract's verb
 * tables cover nearly all of them; anything under this floor means the
 * markdown was reshaped and the parser is now matching noise. Failing
 * loudly here beats passing green while checking nothing.
 */
const MIN_CONTRACT_VERBS = 50;

/**
 * Same idea for the flag axis. The parser extracts 122 today; the floor
 * sits below that with room for ordinary doc edits, but far above the
 * near-zero a broken parser would return.
 */
const MIN_CONTRACT_FLAGS = 100;

/**
 * Forward-direction exclusions. Each entry is a REAL defect that needs a
 * product decision rather than a mechanical fix, so it is parked here
 * with its reasoning instead of being papered over by loosening the
 * check. Adding an entry to shut up a fresh failure is exactly the
 * silent narrowing this guard exists to prevent.
 */
const DEFERRED: ReadonlyMap<string, string> = new Map([
  [
    'scan -n',
    // The contract's Scan table documents `sm scan -n <node.path>` as a
    // partial single-node scan. No such flag exists: `-n` on `sm scan`
    // is the `--dry-run` alias, so a reader following the doc silently
    // runs a dry run instead of scanning one node. Resolving it means
    // either implementing partial scan or deleting the table row, both
    // product calls (the row has been there since the first draft).
    'documented as taking <node.path>; -n is really the --dry-run alias, and partial scan does not exist',
  ],
  [
    'serve --ui-dist',
    // The Server table documents `[--ui-dist <path>]` while `serve.ts`
    // declares it `hidden: true`, and the same contract mandates that
    // hidden options be omitted from `sm help --format json`. The two
    // clauses disagree with each other: publishing a dev-only flag and
    // amending a shipped contract row are both user calls.
    'documented in the Server table but declared hidden:true, so the contract forbids publishing it',
  ],
]);

let help: IHelpSurface;
let contract: IContractSurface;
let cwd: string;

before(() => {
  cwd = join(SCRATCH_ROOT, 'flag-coverage');
  mkdirSync(cwd, { recursive: true });
  help = loadHelpSurface(cwd);
  contract = parseContractSurface(readContract(), new Set(help.verbs.map((v) => v.name)));
});

/**
 * Clipanion derives a `--no-x` negation for every boolean `--x` it
 * declares, and does not publish the derived spelling (publishing all of
 * them would double every verb's flag list). So a documented `--no-x` is
 * satisfied by a published boolean `--x`. The assumption is proved
 * against the real binary below rather than trusted.
 */
function negationTargetOf(flag: string): string | null {
  return flag.startsWith('--no-') ? `--${flag.slice('--no-'.length)}` : null;
}

function isSatisfied(spellings: Map<string, IHelpFlag>, flag: string): boolean {
  if (spellings.has(flag)) return true;
  const target = negationTargetOf(flag);
  return target !== null && spellings.get(target)?.type === 'boolean';
}

describe('Guard 1 · spec/cli-contract.md documents only flags the CLI has', () => {
  it('the contract parser still matches the contract (vacuity tripwire)', () => {
    const flagCount = [...contract.verbs.values()].reduce((n, v) => n + v.flags.size, 0);
    assert.ok(
      contract.verbs.size >= MIN_CONTRACT_VERBS,
      `the contract parser matched almost nothing, its assumptions broke: `
        + `${contract.verbs.size} verbs from ${contract.cellCount} command cells `
        + `(expected >= ${MIN_CONTRACT_VERBS}). The verb tables in spec/cli-contract.md `
        + `were probably reshaped; fix helpers/cli-contract.ts, do not lower this floor.`,
    );
    assert.ok(
      flagCount >= MIN_CONTRACT_FLAGS,
      `the contract parser matched almost no flags, its assumptions broke: `
        + `${flagCount} flags (expected >= ${MIN_CONTRACT_FLAGS}).`,
    );
  });

  it('every verb the contract documents exists in the CLI', () => {
    const missing = [...contract.verbs.values()]
      .filter((entry) => !entry.resolved)
      .map((entry) => `sm ${entry.verb} (from: ${entry.sources[0]})`);
    assert.deepEqual(missing, [], `contract documents verbs the CLI does not expose:\n  ${missing.join('\n  ')}`);
  });

  it('every flag the contract documents is accepted by that verb', () => {
    const missing: string[] = [];
    for (const entry of contract.verbs.values()) {
      const verb = help.verbs.find((v) => v.name === entry.verb);
      if (verb === undefined) continue;
      const spellings = flagSpellings(verb);
      for (const flag of entry.flags.keys()) {
        if (DEFERRED.has(`${entry.verb} ${flag}`)) continue;
        if (!isSatisfied(spellings, flag)) missing.push(`sm ${entry.verb} ${flag}`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `documented flags absent from \`sm help --format json\`:\n  ${missing.join('\n  ')}`,
    );
  });

  it('every documented flag that takes an argument is a value flag in the CLI', () => {
    const mismatched: string[] = [];
    for (const entry of contract.verbs.values()) {
      const verb = help.verbs.find((v) => v.name === entry.verb);
      if (verb === undefined) continue;
      const spellings = flagSpellings(verb);
      for (const [name, flag] of entry.flags) {
        if (DEFERRED.has(`${entry.verb} ${name}`)) continue;
        const live = spellings.get(name);
        if (live === undefined) continue;
        const documentedTakesValue = flag.argument !== null;
        if (documentedTakesValue !== (live.type === 'string')) {
          mismatched.push(
            `sm ${entry.verb} ${name}: contract shows ${flag.argument ?? '(no argument)'}, `
              + `CLI type is "${live.type}"`,
          );
        }
      }
    }
    assert.deepEqual(mismatched, [], `flag arity disagrees with the contract:\n  ${mismatched.join('\n  ')}`);
  });

  it('Clipanion really accepts the auto-derived --no-<flag> negation', () => {
    // Backs the allowance in `isSatisfied`. `sm list --issue` is a
    // published boolean, so `--no-issue` must parse; if Clipanion ever
    // drops auto-negation this fails here instead of silently making
    // every documented `--no-*` flag unverified.
    const result = sm(['list', '--no-issue'], { cwd });
    assert.doesNotMatch(
      result.stderr,
      /unknown command/i,
      `Clipanion rejected an auto-derived negation; the --no-<flag> allowance is no longer sound:\n${result.stderr}`,
    );
  });

  it('reports undocumented CLI surface (reverse direction, not gated)', () => {
    const globals = new Set(help.globalFlags.map((f) => f.name));
    const undocumentedVerbs: string[] = [];
    const undocumentedFlags: string[] = [];
    for (const verb of help.verbs) {
      const entry = contract.verbs.get(verb.name);
      if (entry === undefined) {
        undocumentedVerbs.push(verb.name);
        continue;
      }
      for (const flag of verb.flags) {
        if (globals.has(flag.name)) continue;
        const spelled = [flag.name, ...flag.aliases];
        if (!spelled.some((s) => entry.flags.has(s))) {
          undocumentedFlags.push(`sm ${verb.name} ${flag.name}`);
        }
      }
    }

    const summary = `contract gap: ${undocumentedVerbs.length} verb(s) and `
      + `${undocumentedFlags.length} flag(s) exist in the CLI but are absent from the `
      + `verb tables of spec/cli-contract.md (set SM_CONTRACT_REPORT=1 for the inventory)`;
    process.stderr.write(`${summary}\n`);
    if (process.env['SM_CONTRACT_REPORT'] === '1') {
      process.stderr.write(`  verbs: ${undocumentedVerbs.join(', ') || '(none)'}\n`);
      for (const flag of undocumentedFlags) process.stderr.write(`  flag:  ${flag}\n`);
    }

    // Deliberately NOT gated, see the file header. What IS asserted is
    // that the comparison ran at all: if the reverse pass ever reports a
    // gap for every verb, the parser broke rather than the docs.
    assert.ok(
      undocumentedVerbs.length < help.verbs.length / 2,
      `reverse check degenerated: ${undocumentedVerbs.length}/${help.verbs.length} verbs `
        + `look undocumented, which means the parser broke, not the docs`,
    );
  });

  it('finds the enumerated flag values guard 2 executes', () => {
    // Structural link between the two guards: guard 2 can only be
    // meaningful if this extraction keeps working, so its floor is
    // asserted here too (`--format`, `--period`, `--scope`, ...).
    const enumerated = enumeratedFlags(contract);
    assert.ok(
      enumerated.length >= 4,
      `expected the contract to spell out at least 4 enumerated flags, found ${enumerated.length}; `
        + 'the `--flag <a|b|c>` form is no longer being parsed',
    );
  });
});
