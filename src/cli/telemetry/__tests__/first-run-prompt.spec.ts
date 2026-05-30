/**
 * Unit tests for the pure decision helpers of the consent prompt
 * (`cli/telemetry/first-run-prompt.ts`). The interactive read is not
 * exercised here; the gates and the answer parser are what guard against
 * prompting in the wrong context or misreading the operator's choice.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  interpretConsentAnswer,
  isPromptEligible,
  shouldPromptForConsent,
} from '../first-run-prompt.js';

/** Environment signals for a run that COULD prompt (TTY, DSN, not answered). */
const ELIGIBLE = {
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

describe('isPromptEligible', () => {
  it('is eligible when every environment condition holds', () => {
    assert.equal(isPromptEligible(ELIGIBLE), true);
  });

  it('not eligible when no real DSN is configured (dormant placeholder)', () => {
    assert.equal(isPromptEligible({ ...ELIGIBLE, dsnConfigured: false }), false);
  });

  it('not eligible when not a TTY (CI, pipes, scripts)', () => {
    assert.equal(isPromptEligible({ ...ELIGIBLE, isTTY: false }), false);
  });

  it('not eligible under CI', () => {
    assert.equal(isPromptEligible({ ...ELIGIBLE, isCI: true }), false);
  });

  it('not eligible when the kill switch forced telemetry off', () => {
    assert.equal(isPromptEligible({ ...ELIGIBLE, forcedOff: true }), false);
  });

  it('not eligible when the operator was already prompted', () => {
    assert.equal(isPromptEligible({ ...ELIGIBLE, alreadyPrompted: true }), false);
  });
});

describe('shouldPromptForConsent (second-run deferral)', () => {
  it('does NOT prompt on the first eligible run (firstRunSeen false)', () => {
    assert.equal(shouldPromptForConsent({ ...ELIGIBLE, firstRunSeen: false }), false);
  });

  it('prompts on the second eligible run (firstRunSeen true)', () => {
    assert.equal(shouldPromptForConsent({ ...ELIGIBLE, firstRunSeen: true }), true);
  });

  it('never prompts when the run is not eligible, regardless of firstRunSeen', () => {
    assert.equal(shouldPromptForConsent({ ...ELIGIBLE, isTTY: false, firstRunSeen: true }), false);
    assert.equal(shouldPromptForConsent({ ...ELIGIBLE, alreadyPrompted: true, firstRunSeen: true }), false);
  });
});
