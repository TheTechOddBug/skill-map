/**
 * Unit tests for the CLI PostHog usage surface (`cli/telemetry/posthog-init.ts`).
 *
 * A real `POSTHOG_KEY_NODE` now ships, so dormancy is gated by consent + the
 * kill switch (not by an empty key). These tests prove:
 *   - the gate truth table (kill switch wins, empty key dormant, consent),
 *   - a non-consented (or kill-switched) boot NEVER imports `posthog-node`
 *     (the injected loader is not called),
 *   - `captureUsage` is a safe no-op while dormant,
 *   - `scrubUsageEvent` strips paths before any event leaves the machine.
 *
 * We deliberately do NOT exercise the active path here: it would load the
 * real `posthog-node` SDK and open a client. The active path is covered
 * manually against a live PostHog project.
 *
 * HOME is redirected to a tempdir so the developer's real settings are
 * untouched, and the test-script-pinned `SKILL_MAP_TELEMETRY=0` is unset for
 * the consent-path assertions (no event is ever emitted here).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import {
  captureUsage,
  initUsageCli,
  isUsageCliTelemetryActive,
  isUsageKeyConfigured,
  resetUsageTelemetryForTests,
  scrubUsageEvent,
} from '../posthog-init.js';

let homeRoot: string;
let originalHome: string | undefined;
let originalKill: string | undefined;

function seedUsage(usageCliEnabled: boolean): void {
  mkdirSync(join(homeRoot, '.skill-map'), { recursive: true });
  writeFileSync(
    join(homeRoot, '.skill-map', 'settings.json'),
    JSON.stringify({ schemaVersion: 1, telemetry: { usageCliEnabled, anonymousId: 'fixed-id' } }),
  );
}

before(() => {
  homeRoot = mkdtempSync(join(tmpdir(), 'skill-map-posthog-'));
  originalHome = process.env['HOME'];
  originalKill = process.env['SKILL_MAP_TELEMETRY'];
  process.env['HOME'] = homeRoot;
  process.env['USERPROFILE'] = homeRoot;
});

after(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  if (originalKill === undefined) delete process.env['SKILL_MAP_TELEMETRY'];
  else process.env['SKILL_MAP_TELEMETRY'] = originalKill;
  rmSync(homeRoot, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(homeRoot, '.skill-map'), { recursive: true, force: true });
  delete process.env['SKILL_MAP_TELEMETRY'];
  resetUsageTelemetryForTests();
});

afterEach(() => {
  delete process.env['SKILL_MAP_TELEMETRY'];
  resetUsageTelemetryForTests();
});

describe('isUsageKeyConfigured', () => {
  it('is true now that a real key ships', () => {
    assert.equal(isUsageKeyConfigured(), true);
  });
});

describe('isUsageCliTelemetryActive', () => {
  it('is false when the key is empty, regardless of consent', () => {
    seedUsage(true);
    assert.equal(isUsageCliTelemetryActive(''), false);
  });

  it('is false when the kill switch is set, despite a real key + consent', () => {
    seedUsage(true);
    process.env['SKILL_MAP_TELEMETRY'] = '0';
    assert.equal(isUsageCliTelemetryActive('phc_real'), false);
  });

  it('is false with a real key but no opt-in', () => {
    seedUsage(false);
    assert.equal(isUsageCliTelemetryActive('phc_real'), false);
  });

  it('is true only with a real key, kill switch unset, and opt-in', () => {
    seedUsage(true);
    assert.equal(isUsageCliTelemetryActive('phc_real'), true);
  });
});

describe('initUsageCli (dormant unless opted in)', () => {
  it('never imports posthog-node while CLI usage consent is OFF', async () => {
    seedUsage(false);
    let loaderCalled = false;
    await initUsageCli(async () => {
      loaderCalled = true;
      return await import('posthog-node');
    });
    assert.equal(loaderCalled, false, 'no SDK import while consent is off');
  });

  it('never imports posthog-node while the kill switch is set, despite consent', async () => {
    seedUsage(true);
    process.env['SKILL_MAP_TELEMETRY'] = '0';
    let loaderCalled = false;
    await initUsageCli(async () => {
      loaderCalled = true;
      return await import('posthog-node');
    });
    assert.equal(loaderCalled, false, 'the kill switch keeps the SDK unloaded');
  });
});

describe('captureUsage', () => {
  it('is a safe no-op when the surface is dormant', () => {
    assert.doesNotThrow(() => captureUsage('cli.verb', { verb: 'scan', flags: [] }));
  });
});

describe('scrubUsageEvent', () => {
  it('passes null through (a dropped event)', () => {
    assert.equal(scrubUsageEvent(null), null);
  });

  it('strips an absolute home path planted in a property', () => {
    const event = {
      event: 'cli.verb',
      properties: { note: '/home/alice/projects/secret/file.md' },
    } as unknown as Parameters<typeof scrubUsageEvent>[0];
    const scrubbed = scrubUsageEvent(event) as unknown as { properties: { note: string } };
    assert.match(scrubbed.properties.note, /<HOME>/);
    assert.doesNotMatch(scrubbed.properties.note, /alice/);
  });
});
