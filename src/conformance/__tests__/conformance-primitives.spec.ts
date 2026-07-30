/**
 * The four case-format fields that make previously inexpressible
 * contracts testable: `each` and `schemaPointer` on the schema
 * assertions, `expectExit` and `capture` on staged invocations.
 *
 * Every test here asserts the NEGATIVE direction, because that is the
 * direction these fields exist for. The positive direction is already
 * covered by the shipped cases in `conformance.spec.ts`, and a primitive
 * that only ever passes is indistinguishable from one that never checks
 * anything, which is precisely the failure mode `file-matches-schema`
 * lived in for its whole life before this work.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { runConformanceCase } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(WORKSPACE, '..');
const SPEC_ROOT = resolve(REPO_ROOT, 'spec');
const BIN = resolve(WORKSPACE, 'bin', 'sm.js');

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'sm-conformance-prim-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write a throwaway case + fixtures root, returning the runner options. */
function writeCase(name: string, body: unknown): { casePath: string; fixturesRoot: string } {
  const dir = join(root, name);
  const cases = join(dir, 'cases');
  const fixtures = join(dir, 'fixtures', 'corpus');
  mkdirSync(cases, { recursive: true });
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, 'notes.md'), '# notes\n\nA one-node corpus.\n');
  writeFileSync(
    join(fixtures, 'manifest.json'),
    // A plugin manifest: valid against `$defs/PluginManifest`, and also
    // against the permissive registry ROOT, which is the point of the
    // pointer test below.
    JSON.stringify({
      version: '0.1.0',
      specCompat: '*',
      catalogCompat: '*',
      description: 'Throwaway manifest for the schemaPointer tests.',
    }),
  );
  const casePath = join(cases, `${name}.json`);
  writeFileSync(casePath, JSON.stringify(body));
  return { casePath, fixturesRoot: join(dir, 'fixtures') };
}

function run(name: string, body: unknown) {
  const { casePath, fixturesRoot } = writeCase(name, body);
  return runConformanceCase({ binary: BIN, specRoot: SPEC_ROOT, casePath, fixturesRoot });
}

/** The single failure reason, for a case expected to have exactly one. */
function soleFailure(result: ReturnType<typeof runConformanceCase>): string {
  const failures = result.assertions.filter(
    (a): a is Extract<typeof a, { ok: false }> => !a.ok,
  );
  assert.equal(failures.length, 1, `expected exactly one failure, got ${failures.length}`);
  return failures[0]!.reason;
}

describe('conformance runner, each', () => {
  it('fails an empty array rather than passing vacuously', () => {
    const result = run('each-empty', {
      id: 'each-empty',
      description: 'history over a scope with no executions yields [].',
      fixture: 'corpus',
      setup: { priorScans: [{ fixture: 'corpus' }] },
      invoke: { verb: 'history', flags: ['--json'] },
      assertions: [
        { type: 'stdout-matches-schema', schema: 'execution-record.schema.json', each: true },
      ],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /array is empty/);
  });

  it('fails when the payload is not an array at all', () => {
    const result = run('each-not-array', {
      id: 'each-not-array',
      description: 'A single-object surface cannot satisfy an element-wise assertion.',
      fixture: 'corpus',
      setup: { priorScans: [{ fixture: 'corpus' }] },
      invoke: { verb: 'history', sub: 'stats', flags: ['--json'] },
      assertions: [
        { type: 'stdout-matches-schema', schema: 'history-stats.schema.json', each: true },
      ],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /expected an array, got object/);
  });
});

describe('conformance runner, schemaPointer', () => {
  it('discriminates where the permissive root would pass', () => {
    // The control: no pointer, and the manifest sails through the
    // registry root, which declares no `required`. This is the vacuous
    // pass the pointer exists to prevent, so it is asserted rather than
    // assumed.
    const control = run('pointer-control', {
      id: 'pointer-control',
      description: 'Manifest against the aggregate root passes without checking anything.',
      fixture: 'corpus',
      invoke: { verb: 'version' },
      assertions: [
        {
          type: 'file-matches-schema',
          path: 'manifest.json',
          schema: 'plugins-registry.schema.json',
        },
      ],
    });
    assert.ok(control.passed, 'the permissive root accepts the manifest');

    const pointed = run('pointer-wrong-def', {
      id: 'pointer-wrong-def',
      description: 'The same manifest against a def it does not satisfy must fail.',
      fixture: 'corpus',
      invoke: { verb: 'version' },
      assertions: [
        {
          type: 'file-matches-schema',
          path: 'manifest.json',
          schema: 'plugins-registry.schema.json',
          schemaPointer: '/$defs/DiscoveredPlugin',
        },
      ],
    });
    assert.ok(!pointed.passed);
    assert.match(soleFailure(pointed), /DiscoveredPlugin/);
  });

  it('fails loudly when the pointer resolves to nothing', () => {
    const result = run('pointer-missing', {
      id: 'pointer-missing',
      description: 'A typo in the pointer must not be silently ignored.',
      fixture: 'corpus',
      invoke: { verb: 'version' },
      assertions: [
        {
          type: 'file-matches-schema',
          path: 'manifest.json',
          schema: 'plugins-registry.schema.json',
          schemaPointer: '/$defs/NoSuchDef',
        },
      ],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /resolves to nothing/);
  });
});

describe('conformance runner, expectExit', () => {
  it('accepts a staged step that exits with the declared code', () => {
    const result = run('expect-exit-ok', {
      id: 'expect-exit-ok',
      description: 'A staged failure the case declares is not a case failure.',
      fixture: 'corpus',
      setup: {
        priorScans: [{ fixture: 'corpus' }],
        // No DB-less verb refuses cleanly here, so use a bad flag: exit 2
        // is the catalog-wide "usage error" code.
        priorInvokes: [{ verb: 'history', flags: ['--limit', 'not-a-number'], expectExit: 2 }],
      },
      invoke: { verb: 'history', flags: ['--json'] },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.ok(result.passed, JSON.stringify(result.assertions));
  });

  it('fails when the staged step exits with a different code', () => {
    const result = run('expect-exit-wrong', {
      id: 'expect-exit-wrong',
      description: 'A step that succeeds where a refusal was declared is a case failure.',
      fixture: 'corpus',
      setup: {
        priorScans: [{ fixture: 'corpus' }],
        priorInvokes: [{ verb: 'history', flags: ['--json'], expectExit: 7 }],
      },
      invoke: { verb: 'history', flags: ['--json'] },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /expected exit 7, got 0/);
  });
});

describe('conformance runner, capture', () => {
  it('substitutes a captured value into a later invocation', () => {
    const result = run('capture-ok', {
      id: 'capture-ok',
      description: 'A value captured from a prior step reaches the main invoke.',
      fixture: 'corpus',
      setup: {
        priorScans: [{ fixture: 'corpus' }],
        priorInvokes: [{ verb: 'scan', flags: ['--json'], capture: { firstNode: '$.nodes[0].path' } }],
      },
      invoke: { verb: 'show', args: ['{{firstNode}}'], flags: ['--json'] },
      assertions: [
        { type: 'exit-code', value: 0 },
        { type: 'json-path', path: '$.node.path', equals: 'notes.md' },
      ],
    });
    assert.ok(result.passed, JSON.stringify(result.assertions));
  });

  it('fails a placeholder no capture ever bound', () => {
    const result = run('capture-unbound', {
      id: 'capture-unbound',
      description: 'An unbound placeholder must never reach the CLI verbatim.',
      fixture: 'corpus',
      setup: { priorScans: [{ fixture: 'corpus' }] },
      invoke: { verb: 'show', args: ['{{neverBound}}'], flags: ['--json'] },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /"neverBound" is not bound/);
  });

  it('fails a capture whose expression matches nothing', () => {
    const result = run('capture-nomatch', {
      id: 'capture-nomatch',
      description: 'A capture that matched nothing aborts staging.',
      fixture: 'corpus',
      setup: {
        priorScans: [{ fixture: 'corpus' }],
        priorInvokes: [{ verb: 'scan', flags: ['--json'], capture: { ghost: '$.noSuchKey' } }],
      },
      invoke: { verb: 'history', flags: ['--json'] },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /capture "ghost".*matched nothing/);
  });

  it('fails a capture resolving to a non-scalar', () => {
    const result = run('capture-nonscalar', {
      id: 'capture-nonscalar',
      description: 'An object spliced into argv would fail far from the mistake.',
      fixture: 'corpus',
      setup: {
        priorScans: [{ fixture: 'corpus' }],
        priorInvokes: [{ verb: 'scan', flags: ['--json'], capture: { whole: '$.nodes' } }],
      },
      invoke: { verb: 'history', flags: ['--json'] },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /resolved to object/);
  });

  it('never substitutes into verb or sub', () => {
    // A captured value is CLI output. If it could choose the command,
    // any implementation echoing attacker-controlled content would gain
    // a way to redirect the invocation.
    const result = run('capture-verb-literal', {
      id: 'capture-verb-literal',
      description: 'A placeholder in `verb` stays literal and the CLI rejects it.',
      fixture: 'corpus',
      setup: {
        priorScans: [{ fixture: 'corpus' }],
        priorInvokes: [{ verb: 'scan', flags: ['--json'], capture: { v: '$.nodes[0].path' } }],
      },
      invoke: { verb: '{{v}}' },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.ok(!result.passed);
    // Exit 2 is "unknown verb": the literal `{{v}}` was passed through,
    // never resolved to a runnable command.
    assert.equal(result.exitCode, 2);
  });
});
