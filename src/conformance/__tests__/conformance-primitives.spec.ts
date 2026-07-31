/**
 * The case-format fields that make previously inexpressible contracts
 * testable: `each` and `schemaPointer` on the schema assertions,
 * `expectExit` and `capture` on staged invocations, and the
 * server-capable family (`setup.serve`, `http-matches-schema`,
 * `ndjson-line`).
 *
 * Every test here asserts the NEGATIVE direction, because that is the
 * direction these fields exist for. The positive direction is already
 * covered by the shipped cases in `conformance.spec.ts`, and a primitive
 * that only ever passes is indistinguishable from one that never checks
 * anything, which is precisely the failure mode `file-matches-schema`
 * lived in for its whole life before this work. The one exception is the
 * `setup.serve` lifecycle test at the bottom, whose subject is the
 * TEARDOWN guarantee rather than an assertion outcome.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { _startStaticServeForTests, runConformanceCase, type IRunCaseResult } from '../index.js';

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
function soleFailure(result: IRunCaseResult): string {
  const failures = result.assertions.filter(
    (a): a is Extract<typeof a, { ok: false }> => !a.ok,
  );
  assert.equal(failures.length, 1, `expected exactly one failure, got ${failures.length}`);
  return failures[0]!.reason;
}

describe('conformance runner, each', () => {
  it('fails an empty array rather than passing vacuously', async () => {
    const result = await run('each-empty', {
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

  it('fails when the payload is not an array at all', async () => {
    const result = await run('each-not-array', {
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
  it('discriminates where the permissive root would pass', async () => {
    // The control: no pointer, and the manifest sails through the
    // registry root, which declares no `required`. This is the vacuous
    // pass the pointer exists to prevent, so it is asserted rather than
    // assumed.
    const control = await run('pointer-control', {
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

    const pointed = await run('pointer-wrong-def', {
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

  it('fails loudly when the pointer resolves to nothing', async () => {
    const result = await run('pointer-missing', {
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
  it('accepts a staged step that exits with the declared code', async () => {
    const result = await run('expect-exit-ok', {
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

  it('fails when the staged step exits with a different code', async () => {
    const result = await run('expect-exit-wrong', {
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
  it('substitutes a captured value into a later invocation', async () => {
    const result = await run('capture-ok', {
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

  it('fails a placeholder no capture ever bound', async () => {
    const result = await run('capture-unbound', {
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

  it('fails a capture whose expression matches nothing', async () => {
    const result = await run('capture-nomatch', {
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

  it('fails a capture resolving to a non-scalar', async () => {
    const result = await run('capture-nonscalar', {
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

  it('never substitutes into verb or sub', async () => {
    // A captured value is CLI output. If it could choose the command,
    // any implementation echoing attacker-controlled content would gain
    // a way to redirect the invocation.
    const result = await run('capture-verb-literal', {
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

describe('conformance runner, http-matches-schema', () => {
  it('fails the authoring error of declaring it without setup.serve', async () => {
    const result = await run('http-no-serve', {
      id: 'http-no-serve',
      description: 'An http assertion without a server is an authoring error, never a skip.',
      fixture: 'corpus',
      invoke: { verb: 'version' },
      assertions: [
        {
          type: 'http-matches-schema',
          request: { path: '/api/nodes' },
          schema: 'api/rest-envelope.schema.json',
        },
      ],
    });
    assert.ok(!result.passed);
    const reason = soleFailure(result);
    assert.match(reason, /setup\.serve/);
    // The reason names the missing server, not a network error: no fetch
    // was attempted (the runner checks for the port before any request).
    assert.match(reason, /no request was attempted/);
  });
});

describe('conformance runner, ndjson-line', () => {
  it('fails when no line matches the selector', async () => {
    const result = await run('ndjson-no-match', {
      id: 'ndjson-no-match',
      description: 'A selector that hits no line must fail, not pass vacuously.',
      fixture: 'corpus',
      setup: { priorScans: [{ fixture: 'corpus' }] },
      // `scan --json` emits one compact JSON line: a valid ndjson stream
      // in which nothing carries `type: run.started`.
      invoke: { verb: 'scan', flags: ['--json'] },
      assertions: [{ type: 'ndjson-line', match: { type: 'run.started' } }],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /no stdout line deep-equals/);
  });

  it('fails a non-JSON stdout line naming its line number', async () => {
    const result = await run('ndjson-not-json', {
      id: 'ndjson-not-json',
      description: 'Human-mode stdout is not an ndjson stream; the stray line fails the parse.',
      fixture: 'corpus',
      invoke: { verb: 'version' },
      assertions: [{ type: 'ndjson-line', match: { type: 'run.started' } }],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /line 1 is not parseable JSON/);
  });

  it('fails a comparator that misses on the matched line', async () => {
    const result = await run('ndjson-comparator-miss', {
      id: 'ndjson-comparator-miss',
      description: 'A matched line whose path comparator misses fails on that line.',
      fixture: 'corpus',
      setup: { priorScans: [{ fixture: 'corpus' }] },
      invoke: { verb: 'scan', flags: ['--json'] },
      assertions: [
        {
          type: 'ndjson-line',
          // Matches the single scan-result line on its top-level const...
          match: { schemaVersion: 1 },
          // ...then applies an impossible comparator against it.
          path: '$.stats.nodesCount',
          lessThan: 0,
        },
      ],
    });
    assert.ok(!result.passed);
    assert.match(soleFailure(result), /not < 0/);
  });
});

describe('conformance runner, parallel', () => {
  it('fails a per-result assertion combined with parallel, without spawning anything', async () => {
    const result = await run('parallel-per-result', {
      id: 'parallel-per-result',
      description: 'With N results "the" exit code is ambiguous; the pairing is an authoring error.',
      invoke: { verb: 'version', parallel: 2 },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.ok(!result.passed);
    const reason = soleFailure(result);
    // Names the offending type, and states nothing ran: the gate fires
    // before the scope is staged, so both streams are empty, the cheap
    // observable that no child was spawned.
    assert.match(reason, /`exit-code`/);
    assert.match(reason, /nothing was spawned/);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('fails a parallel-* assertion without parallel, naming the type', async () => {
    const result = await run('parallel-without-flag', {
      id: 'parallel-without-flag',
      description: 'A set assertion over one result has no set to assert over.',
      invoke: { verb: 'version' },
      assertions: [{ type: 'parallel-exit-codes', sorted: [0, 0] }],
    });
    assert.ok(!result.passed);
    const reason = soleFailure(result);
    assert.match(reason, /`parallel-exit-codes`/);
    assert.match(reason, /invoke\.parallel/);
    assert.equal(result.stdout, '');
  });

  it('fails parallel-exit-codes on a wrong multiset, showing actual vs expected', async () => {
    // `version` is fixture-free and always exits 0, so two concurrent
    // copies yield [0, 0]; asserting [0, 1] must fail showing both sides.
    const result = await run('parallel-codes-mismatch', {
      id: 'parallel-codes-mismatch',
      description: 'Two version invocations both exit 0; the [0, 1] expectation must fail.',
      invoke: { verb: 'version', parallel: 2 },
      assertions: [{ type: 'parallel-exit-codes', sorted: [0, 1] }],
    });
    assert.ok(!result.passed);
    const reason = soleFailure(result);
    assert.match(reason, /\[0,0\]/);
    assert.match(reason, /\[0,1\]/);
  });

  it('counts non-JSON stdouts as zero and fails a crafted count mismatch', async () => {
    // The real one-winner race is covered by the shipped
    // `claim-race-atomicity` case in conformance.spec.ts; here the cheap
    // fixture-free variant pins the counting semantics. `version` prints
    // a human-mode matrix, not JSON, so zero results can ever satisfy
    // the comparator: count 0 passes, count 2 must fail naming 0 of 2.
    const passing = await run('parallel-count-zero', {
      id: 'parallel-count-zero',
      description: 'Non-JSON stdouts simply do not count; an expected zero passes.',
      invoke: { verb: 'version', parallel: 2 },
      assertions: [
        { type: 'parallel-json-path-count', path: '$.x', matches: '.+', count: 0 },
      ],
    });
    assert.ok(passing.passed, JSON.stringify(passing.assertions));

    const mismatch = await run('parallel-count-mismatch', {
      id: 'parallel-count-mismatch',
      description: 'The same invoke against an impossible count must fail with the tally.',
      invoke: { verb: 'version', parallel: 2 },
      assertions: [
        { type: 'parallel-json-path-count', path: '$.x', matches: '.+', count: 2 },
      ],
    });
    assert.ok(!mismatch.passed);
    assert.match(soleFailure(mismatch), /0 of 2 results satisfy \$\.x, expected 2/);
  });
});

describe('conformance runner, sleepAfterMs', () => {
  it('delays between staged steps by at least the armed duration', async () => {
    // The primitive is a wall-clock guarantee, so the observable IS the
    // elapsed time: two trivial staged steps with a 1200ms sleep after
    // the first cannot complete faster than the sleep itself.
    const started = Date.now();
    const result = await run('sleep-after-ms', {
      id: 'sleep-after-ms',
      description: 'The runner sleeps after a staged step before the next one.',
      fixture: 'corpus',
      setup: {
        priorInvokes: [{ verb: 'version', sleepAfterMs: 1200 }, { verb: 'version' }],
      },
      invoke: { verb: 'version' },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.ok(result.passed, JSON.stringify(result.assertions));
    assert.ok(
      Date.now() - started >= 1200,
      `case finished in ${Date.now() - started}ms, faster than the armed 1200ms sleep`,
    );
  });
});

describe('conformance runner, setup.staticServe', () => {
  it('rejects a staticServe fixture escaping the fixtures root before serving anything', async () => {
    // Same posture as a traversal in `fixture` / `priorScans[].fixture`:
    // the reference is case-author-controlled, so the containment guard
    // throws before any listener binds or any child spawns.
    await assert.rejects(
      () =>
        run('static-serve-escape', {
          id: 'static-serve-escape',
          description: 'A staticServe fixture escaping the fixtures root must be refused.',
          fixture: 'corpus',
          setup: { staticServe: { fixture: '../../../../../../etc' } },
          invoke: { verb: 'version' },
          assertions: [{ type: 'exit-code', value: 0 }],
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /escapes its anchor/);
        return true;
      },
    );
  });

  it('serves recorded files with 200 and answers 404 for everything else', async () => {
    // The HTTP contract, probed through the test seam: recorded file →
    // its bytes; unrecorded path, the bare root (no directory listing),
    // and an encoded traversal → 404 with no body served.
    const remote = join(root, 'static-serve-http', 'remote');
    mkdirSync(join(remote, 'api'), { recursive: true });
    writeFileSync(join(remote, 'api', 'answer.json'), '{"answer":42}');
    const handle = await _startStaticServeForTests(remote);
    try {
      const recorded = await fetch(`${handle.url}/api/answer.json`);
      assert.equal(recorded.status, 200);
      assert.equal(await recorded.text(), '{"answer":42}');

      const unrecorded = await fetch(`${handle.url}/api/nope.json`);
      assert.equal(unrecorded.status, 404);

      const rootListing = await fetch(`${handle.url}/`);
      assert.equal(rootListing.status, 404, 'directory listings are not served');

      const dirListing = await fetch(`${handle.url}/api`);
      assert.equal(dirListing.status, 404, 'a directory path is a 404, not an index');

      // fetch() normalises literal `..` client-side, so the traversal
      // must travel encoded to reach the server's own containment gate.
      const traversal = await fetch(`${handle.url}/api/%2e%2e/%2e%2e/etc/passwd`);
      assert.equal(traversal.status, 404, 'an escaping request path is refused');
    } finally {
      await handle.close();
    }
  });

  it('binds {{staticServeUrl}} into argv substitution for the main invoke', async () => {
    // The binding proof: the placeholder reaches the child's argv as the
    // real loopback base URL. `sm show <url>` finds no such node, so the
    // not-found message quotes the substituted URL back on stderr.
    const { casePath, fixturesRoot } = writeCase('static-serve-binding', {
      id: 'static-serve-binding',
      description: 'The staticServe base URL is substituted like any captured value.',
      fixture: 'corpus',
      setup: {
        staticServe: { fixture: 'remote' },
        priorScans: [{ fixture: 'corpus' }],
      },
      invoke: { verb: 'show', args: ['{{staticServeUrl}}'] },
      assertions: [
        { type: 'exit-code', value: 5 },
        { type: 'stderr-matches', pattern: 'http://127\\.0\\.0\\.1:\\d+' },
      ],
    });
    mkdirSync(join(fixturesRoot, 'remote'), { recursive: true });
    const result = await runConformanceCase({
      binary: BIN,
      specRoot: SPEC_ROOT,
      casePath,
      fixturesRoot,
    });
    assert.ok(result.passed, JSON.stringify(result.assertions));
  });
});

describe('conformance runner, setup.serve lifecycle', () => {
  it('boots the server, asserts against it, and tears the child down', async () => {
    const result = await run('serve-teardown', {
      id: 'serve-teardown',
      description: 'A serve case passes and the serve child is gone once the runner returns.',
      fixture: 'corpus',
      setup: { priorScans: [{ fixture: 'corpus' }], serve: true },
      invoke: { verb: 'version' },
      assertions: [
        { type: 'exit-code', value: 0 },
        // Observable only through the ordering guarantee: the file exists
        // solely while the server runs, and assertions evaluate before
        // teardown.
        {
          type: 'file-matches-schema',
          path: '.skill-map/serve.json',
          schema: 'serve-info.schema.json',
        },
      ],
    });
    assert.ok(result.passed, JSON.stringify(result.assertions));

    // The runner returning at all is already teardown evidence: it awaits
    // the child's exit (SIGTERM, SIGKILL fallback) before removing the
    // scope, so a live child would have held this await. On Linux,
    // double-check via /proc that no process still has its cwd inside the
    // scope this case ran in (the scope prefix embeds the case id).
    if (process.platform === 'linux') {
      const leaked = readdirSync('/proc')
        .filter((entry) => /^\d+$/.test(entry))
        .filter((pid) => {
          try {
            return readlinkSync(`/proc/${pid}/cwd`).includes('sm-conformance-serve-teardown');
          } catch {
            return false;
          }
        });
      assert.deepEqual(leaked, [], `serve child leaked: pids ${leaked.join(', ')}`);
    }
  });
});
