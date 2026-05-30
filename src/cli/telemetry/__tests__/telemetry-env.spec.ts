/**
 * Unit tests for the telemetry `environment` resolver
 * (`cli/telemetry/telemetry-env.ts`). Pure read of `SKILL_MAP_TELEMETRY_ENV`.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { resolveTelemetryEnv, TELEMETRY_ENV_VAR } from '../telemetry-env.js';

const original = process.env[TELEMETRY_ENV_VAR];

afterEach(() => {
  if (original === undefined) delete process.env[TELEMETRY_ENV_VAR];
  else process.env[TELEMETRY_ENV_VAR] = original;
});

describe('resolveTelemetryEnv', () => {
  it('is prod when the var is absent', () => {
    delete process.env[TELEMETRY_ENV_VAR];
    assert.equal(resolveTelemetryEnv(), 'prod');
  });

  it('is prod when empty or whitespace', () => {
    process.env[TELEMETRY_ENV_VAR] = '';
    assert.equal(resolveTelemetryEnv(), 'prod');
    process.env[TELEMETRY_ENV_VAR] = '   ';
    assert.equal(resolveTelemetryEnv(), 'prod');
  });

  it('is prod when explicitly set to a production marker', () => {
    process.env[TELEMETRY_ENV_VAR] = 'prod';
    assert.equal(resolveTelemetryEnv(), 'prod');
    process.env[TELEMETRY_ENV_VAR] = 'production';
    assert.equal(resolveTelemetryEnv(), 'prod');
  });

  it('is dev for any other non-empty value (dev tooling sets it)', () => {
    process.env[TELEMETRY_ENV_VAR] = 'dev';
    assert.equal(resolveTelemetryEnv(), 'dev');
    process.env[TELEMETRY_ENV_VAR] = 'development';
    assert.equal(resolveTelemetryEnv(), 'dev');
  });
});
