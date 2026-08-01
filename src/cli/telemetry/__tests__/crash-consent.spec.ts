/**
 * Unit tests for the pure pieces of the per-incident crash-report consent
 * flow (`cli/telemetry/crash-consent.ts`): the flow gate, the answer
 * parser, and the scrubbed preview builder. No IO, no SDK, no readline.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildCrashPreview,
  decideCrashFlow,
  interpretCrashAnswer,
  type ICrashGateInputs,
} from '../crash-consent.js';

/** A fully-promptable baseline; cases override one signal at a time. */
function promptable(overrides: Partial<ICrashGateInputs> = {}): ICrashGateInputs {
  return {
    inactiveReason: 'no-consent',
    stdinIsTTY: true,
    stderrIsTTY: true,
    isCI: false,
    json: false,
    quiet: false,
    verb: 'scan',
    ...overrides,
  };
}

describe('decideCrashFlow', () => {
  it('prompts on a fully interactive context, with or without consent', () => {
    assert.equal(decideCrashFlow(promptable()), 'prompt');
    assert.equal(decideCrashFlow(promptable({ inactiveReason: null })), 'prompt');
  });

  it('hard gates win over everything: kill switch and dormant DSN are silent', () => {
    assert.equal(decideCrashFlow(promptable({ inactiveReason: 'kill-switch' })), 'silent');
    assert.equal(decideCrashFlow(promptable({ inactiveReason: 'dsn-dormant' })), 'silent');
  });

  it('the serve verb is silent even when fully promptable (the BFF owns that process)', () => {
    assert.equal(decideCrashFlow(promptable({ verb: 'serve', inactiveReason: null })), 'silent');
  });

  it('each non-promptable signal forces the fallback', () => {
    for (const overrides of [
      { stdinIsTTY: false },
      { stderrIsTTY: false },
      { isCI: true },
      { json: true },
      { quiet: true },
    ] as const) {
      assert.equal(
        decideCrashFlow(promptable({ ...overrides, inactiveReason: null })),
        'auto-send',
        JSON.stringify(overrides),
      );
      assert.equal(
        decideCrashFlow(promptable({ ...overrides, inactiveReason: 'no-consent' })),
        'silent',
        JSON.stringify(overrides),
      );
    }
  });
});

describe('interpretCrashAnswer', () => {
  it('explicit answers always win over the bias', () => {
    for (const dflt of ['yes', 'no'] as const) {
      assert.equal(interpretCrashAnswer('y', dflt), 'yes');
      assert.equal(interpretCrashAnswer('YES', dflt), 'yes');
      assert.equal(interpretCrashAnswer(' n ', dflt), 'no');
      assert.equal(interpretCrashAnswer('no', dflt), 'no');
      assert.equal(interpretCrashAnswer('d', dflt), 'details');
      assert.equal(interpretCrashAnswer('details', dflt), 'details');
    }
  });

  it('empty Enter resolves to the biased default', () => {
    assert.equal(interpretCrashAnswer('', 'yes'), 'yes');
    assert.equal(interpretCrashAnswer('', 'no'), 'no');
  });

  it('gibberish resolves to the biased default, never an implicit yes', () => {
    assert.equal(interpretCrashAnswer('sure whatever', 'no'), 'no');
    assert.equal(interpretCrashAnswer('sure whatever', 'yes'), 'yes');
  });
});

describe('buildCrashPreview', () => {
  it('scrubs the project root and home out of the stack and message', () => {
    const err = new Error(`explode at ${process.cwd()}/some/file.ts`);
    const preview = buildCrashPreview(err, 'scan') as {
      error: { name: string; message: string; stack: string };
      tags: { surface: string; verb: string };
    };
    assert.equal(preview.error.name, 'Error');
    assert.match(preview.error.message, /<PROJECT>\/some\/file\.ts/);
    assert.doesNotMatch(preview.error.message, /crystian|\/home\//);
    // A real stack from this test file resolves under the project root.
    assert.match(preview.error.stack, /<PROJECT>|<HOME>/);
    assert.doesNotMatch(preview.error.stack, /\/home\//);
    assert.equal(preview.tags.surface, 'cli');
    assert.equal(preview.tags.verb, 'scan');
  });

  it('wraps a non-Error throw without losing the payload', () => {
    const preview = buildCrashPreview('a thrown string', 'check') as {
      error: { message: string };
    };
    assert.match(preview.error.message, /a thrown string/);
  });
});
