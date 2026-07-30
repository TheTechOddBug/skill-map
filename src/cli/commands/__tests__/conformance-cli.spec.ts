/**
 * Phase 5 / A.13, `sm conformance run` verb.
 *
 * Acceptance tests for the new CLI verb. The verb dispatches to a child
 * `sm` process per case, so end-to-end runs are slower than other unit
 * tests; we keep the fixture surface small (one targeted scope at a
 * time) and rely on the in-process suite at `conformance.test.ts` to
 * cover the underlying runner mechanics.
 *
 * Cases covered:
 *
 *   (a) `sm conformance run --scope spec` exits 0, the spec scope
 *       contains only `kernel-empty-boot`, which is universal. Exercises
 *       the happy path: scope selection, case enumeration, summary
 *       output.
 *
 *   (b) `sm conformance run --scope <bogus>` exits 2 with a directed
 *       stderr message naming the available scopes. Exercises the
 *       unknown-scope guard rail.
 *
 * The `--scope all` and `--scope provider:claude` paths are exercised
 * at full breadth by the in-process `conformance.test.ts` suite which
 * runs every spec + Claude case directly through the runner.
 */

import { describe, it } from 'node:test';
import { match, ok, strictEqual } from 'node:assert/strict';

import type { BaseContext } from 'clipanion';

import {
  ConformanceRunCommand,
  formatAssertionFailureDetail,
} from '../conformance.js';

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

describe('sm conformance run', () => {
  it('runs the spec scope cleanly', async () => {
    const cap = captureContext();
    const cmd = new ConformanceRunCommand();
    cmd.scope = 'spec';
    // Clipanion populates Option-backed fields when it drives the
    // command; we instantiate directly, so seed EVERY option the body
    // reads. An un-seeded field still carries Clipanion's Option
    // descriptor, a truthy object: `if (this.json)` would take the
    // `--json` branch, and `this.case_ !== undefined` would filter the
    // run by a case id that is an object and matches nothing.
    cmd.case_ = undefined;
    cmd.json = false;
    cmd.quiet = false;
    cmd.noColor = false;
    Object.defineProperty(cmd, 'context', { value: cap.context });

    const exit = await cmd.execute();
    strictEqual(exit, 0, `expected exit 0, got ${exit}\n--- stdout ---\n${cap.stdout()}\n--- stderr ---\n${cap.stderr()}`);
    // Per cli-output-style.md §8: per-scope progress (header + per-case
    // OK/FAIL rows + scope summary) routes through `printer.info`
    // (stderr); only the grand-total result lands on stdout.
    match(cap.stderr(), /Running conformance scope spec/);
    // The spec scope ships at least the kernel-empty-boot case.
    match(cap.stderr(), /ok\s+kernel-empty-boot/);
    // The grand total stays on stdout (it IS the verb's result).
    match(cap.stdout(), /sm conformance: \d+\/\d+ passed across 1 scope/);
  });

  it('rejects an unknown scope with a directed error', async () => {
    const cap = captureContext();
    const cmd = new ConformanceRunCommand();
    cmd.scope = 'bogus-scope';
    cmd.case_ = undefined;
    cmd.json = false;
    cmd.quiet = false;
    cmd.noColor = false;
    Object.defineProperty(cmd, 'context', { value: cap.context });

    const exit = await cmd.execute();
    strictEqual(exit, 2, `expected exit 2, got ${exit}`);
    match(cap.stderr(), /unknown --scope 'bogus-scope'/);
    match(cap.stderr(), /Available: spec/);
  });

  it('narrows the run to a single case with --case', async () => {
    const cap = captureContext();
    const cmd = new ConformanceRunCommand();
    cmd.case_ = 'kernel-empty-boot';
    // Same reason `json` is seeded above: instantiating the command
    // directly leaves every un-set Option field holding Clipanion's
    // descriptor object, which `--scope` would then read as a value.
    cmd.scope = undefined;
    cmd.json = false;
    cmd.quiet = false;
    cmd.noColor = false;
    Object.defineProperty(cmd, 'context', { value: cap.context });

    const exit = await cmd.execute();
    strictEqual(exit, 0, `expected exit 0, got ${exit}\n${cap.stderr()}`);
    // One case, and one SCOPE: a scope holding no match is skipped
    // rather than reported as empty, so the summary describes what
    // actually ran.
    match(cap.stdout(), /sm conformance: 1\/1 passed across 1 scope/);
    match(cap.stderr(), /ok\s+kernel-empty-boot/);
    // No default scope filter was set, so every scope was searched and
    // the other cases were skipped rather than run.
    ok(!/preamble-bitwise-match/.test(cap.stderr()), 'other cases must not run');
  });

  it('rejects a --case id that matches nothing rather than reporting a clean sweep', async () => {
    // The failure mode worth designing against: a typo in CI that goes
    // green forever because zero cases trivially all passed.
    const cap = captureContext();
    const cmd = new ConformanceRunCommand();
    cmd.case_ = 'no-such-case-id';
    cmd.scope = undefined;
    cmd.json = false;
    cmd.quiet = false;
    cmd.noColor = false;
    Object.defineProperty(cmd, 'context', { value: cap.context });

    const exit = await cmd.execute();
    strictEqual(exit, 2, `expected exit 2, got ${exit}\n${cap.stdout()}`);
    match(cap.stderr(), /no case with id "no-such-case-id"/);
    ok(!/passed across/.test(cap.stdout()), 'must not print a success summary');
  });

  it('emits a bad-query error envelope for an unknown --case under --json', async () => {
    const cap = captureContext();
    const cmd = new ConformanceRunCommand();
    cmd.case_ = 'no-such-case-id';
    cmd.scope = undefined;
    cmd.json = true;
    cmd.quiet = false;
    cmd.noColor = false;
    Object.defineProperty(cmd, 'context', { value: cap.context });

    const exit = await cmd.execute();
    strictEqual(exit, 2, `expected exit 2, got ${exit}`);
    const payload = JSON.parse(cap.stdout()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    strictEqual(payload.ok, false);
    strictEqual(payload.error.code, 'bad-query');
    match(payload.error.message, /no-such-case-id/);
  });
});

// Audit M1, assertion `reason` strings flow from the conformance
// runner; some variants splice the impl-under-test's stderr verbatim
// (`runtime-error` carries subprocess output), a runaway or hostile
// impl could emit kilobytes that drown the user's terminal AND embed
// ANSI escapes that repaint it. The CLI must sanitize + cap (1000
// chars) before printing. Driving the full runner just to provoke a
// hostile reason would require a contrived failing case + bespoke
// fixture; instead the formatter is exposed as
// `formatAssertionFailureDetail` and unit-tested directly. The
// production call site uses the same helper, so the behavioural
// contract stays pinned.
describe('formatAssertionFailureDetail, audit M1 sanitization + length cap', () => {
  it('strips C0 escapes from the reason', () => {
    const out = formatAssertionFailureDetail('exit-code', 'expected 0 got 1\x1b[2J\x1b[H');
    ok(!out.includes('\x1b'), `expected no ESC byte; got ${JSON.stringify(out)}`);
    ok(out.includes('expected 0 got 1'));
    ok(out.includes('exit-code'));
  });

  it('caps an oversized reason, bounded total output length', () => {
    const oversize = 'x'.repeat(5000);
    const out = formatAssertionFailureDetail('runtime-error', oversize);
    // Cap is 1000 chars on the reason interpolation; the surrounding
    // template adds a fixed tail. Bound a few hundred chars above 1000
    // so we pin the cap policy without coupling to template byte
    // counts.
    ok(out.length < 1500, `expected capped output length, got ${out.length}`);
    // Sanity: the original 5000-char tail must not round-trip, the
    // helper's `truncateHead` cuts and replaces the overflow with an
    // ellipsis.
    ok(!out.includes('x'.repeat(2000)), 'oversize payload was cut');
  });

  it('combined: oversized reason WITH C0 escapes, both gates fire', () => {
    // The cap applies to the raw reason BEFORE sanitization; even so,
    // any ESC byte that survives the cut must still be stripped. This
    // pins both halves of the gate at once.
    const reason = '\x1b[31m' + 'y'.repeat(5000) + '\x1b[0m';
    const out = formatAssertionFailureDetail('runtime-error', reason);
    ok(!out.includes('\x1b'));
    ok(out.length < 1500);
  });
});
