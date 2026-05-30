/**
 * Unit tests for the pure decision helpers of the first-run consent prompt
 * (`cli/telemetry/first-run-prompt.ts`). The interactive read is not
 * exercised here; the gate and the answer parser are what guard against
 * prompting in the wrong context or misreading the operator's choice.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  interpretConsentAnswer,
  shouldPromptForConsent,
} from '../first-run-prompt.js';

const OPEN = {
  dsnConfigured: true,
  isTTY: true,
  isCI: false,
  forcedOff: false,
  alreadyPrompted: false,
};

describe('interpretConsentAnswer', () => {
  it('treats y / yes (any case, padded) as opt-in', () => {
    assert.equal(interpretConsentAnswer('y'), 'yes');
    assert.equal(interpretConsentAnswer('  YES '), 'yes');
  });

  it('treats d / details as the disclosure request', () => {
    assert.equal(interpretConsentAnswer('d'), 'details');
    assert.equal(interpretConsentAnswer('Details'), 'details');
  });

  it('treats empty / n / anything else as opt-out (safe default)', () => {
    assert.equal(interpretConsentAnswer(''), 'no');
    assert.equal(interpretConsentAnswer('n'), 'no');
    assert.equal(interpretConsentAnswer('nope'), 'no');
    assert.equal(interpretConsentAnswer('whatever'), 'no');
  });
});

describe('shouldPromptForConsent', () => {
  it('opens only when every condition holds', () => {
    assert.equal(shouldPromptForConsent(OPEN), true);
  });

  it('stays closed when no real DSN is configured (dormant placeholder)', () => {
    assert.equal(shouldPromptForConsent({ ...OPEN, dsnConfigured: false }), false);
  });

  it('stays closed when not a TTY (CI, pipes, scripts)', () => {
    assert.equal(shouldPromptForConsent({ ...OPEN, isTTY: false }), false);
  });

  it('stays closed under CI', () => {
    assert.equal(shouldPromptForConsent({ ...OPEN, isCI: true }), false);
  });

  it('stays closed when the kill switch forced telemetry off', () => {
    assert.equal(shouldPromptForConsent({ ...OPEN, forcedOff: true }), false);
  });

  it('stays closed when the operator was already prompted', () => {
    assert.equal(shouldPromptForConsent({ ...OPEN, alreadyPrompted: true }), false);
  });
});
