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
  addInvocationExtensions,
  captureCliInvocation,
  captureUsage,
  initUsageCli,
  isUsageCliTelemetryActive,
  isUsageKeyConfigured,
  resetUsageTelemetryForTests,
  scrubUsageEvent,
  setInvocationLens,
  setInvocationScreenName,
  suppressInvocationUsage,
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

  it('is false for an agent-driven invocation (SM_AGENT set)', () => {
    seedUsage(true);
    process.env['SM_AGENT'] = '1';
    try {
      assert.equal(isUsageCliTelemetryActive('phc_real'), false);
    } finally {
      delete process.env['SM_AGENT'];
    }
    assert.equal(isUsageCliTelemetryActive('phc_real'), true, 'unset re-activates');
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
    assert.doesNotThrow(() => captureUsage('cli.scan', { flags: [] }));
  });
});

describe('captureCliInvocation (extensions stash, fake client)', () => {
  /** A fake `posthog-node` namespace so the active path never loads the SDK. */
  function makeFakePosthog(): {
    ns: typeof import('posthog-node');
    captured: Array<{ event: string; properties: Record<string, unknown> }>;
  } {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    class PostHog {
      capture(msg: { event: string; properties: Record<string, unknown> }): void {
        captured.push(msg);
      }
      shutdown(): Promise<void> {
        return Promise.resolve();
      }
    }
    return { ns: { PostHog } as unknown as typeof import('posthog-node'), captured };
  }

  it('folds accumulated ids in deduped, collapsed, and sorted, then clears', async () => {
    seedUsage(true);
    const { ns, captured } = makeFakePosthog();
    await initUsageCli(() => Promise.resolve(ns));
    // Two stash calls (the enrich shape: extractors then actions), with a
    // duplicate and a third-party id.
    addInvocationExtensions(['core/markdown-link', 'acme/custom-thing']);
    addInvocationExtensions(['core/markdown-link', 'github/enrichment']);
    captureCliInvocation('enrich', ['stale'], new Set(['enrich']));
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.event, 'cli.enrich');
    assert.deepEqual(captured[0]?.properties['extensions'], [
      'core/markdown-link',
      'external_plugin',
      'github/enrichment',
    ]);
    // The stash is cleared: the next invocation carries no extensions key.
    captureCliInvocation('list', [], new Set(['list']));
    assert.equal(captured.length, 2);
    assert.equal('extensions' in (captured[1]?.properties ?? {}), false);
  });

  it('a verb with no stashed ids never grows an extensions property', async () => {
    seedUsage(true);
    const { ns, captured } = makeFakePosthog();
    await initUsageCli(() => Promise.resolve(ns));
    captureCliInvocation('check', ['json'], new Set(['check']));
    assert.equal('extensions' in (captured[0]?.properties ?? {}), false);
    assert.equal('$screen_name' in (captured[0]?.properties ?? {}), false);
  });

  it('attaches the stashed $screen_name collapsed, then clears it', async () => {
    seedUsage(true);
    const { ns, captured } = makeFakePosthog();
    await initUsageCli(() => Promise.resolve(ns));
    // The queue-lifecycle shape: one job, its extension stashed for both
    // the extensions set and the screen name.
    addInvocationExtensions(['core/ai-name-action']);
    setInvocationScreenName('core/ai-name-action');
    captureCliInvocation('record', [], new Set(['record']));
    assert.equal(captured[0]?.properties['$screen_name'], 'core/ai-name-action');
    // The stash is cleared: the next invocation carries no screen name.
    captureCliInvocation('list', [], new Set(['list']));
    assert.equal('$screen_name' in (captured[1]?.properties ?? {}), false);
  });

  it('collapses a third-party $screen_name to external_plugin', async () => {
    seedUsage(true);
    const { ns, captured } = makeFakePosthog();
    await initUsageCli(() => Promise.resolve(ns));
    addInvocationExtensions(['acme/custom-fixer']);
    setInvocationScreenName('acme/custom-fixer');
    captureCliInvocation('record', [], new Set(['record']));
    assert.equal(captured[0]?.properties['$screen_name'], 'external_plugin');
  });

  it('a fresh lens resolution rides as lens + lens_source and the screen column', async () => {
    seedUsage(true);
    const { ns, captured } = makeFakePosthog();
    await initUsageCli(() => Promise.resolve(ns));
    setInvocationLens('claude', 'autodetect');
    captureCliInvocation('scan', [], new Set(['scan']));
    assert.equal(captured[0]?.properties['lens'], 'claude');
    assert.equal(captured[0]?.properties['lens_source'], 'autodetect');
    assert.equal(captured[0]?.properties['$screen_name'], 'claude@autodetect');
    // Cleared: the next invocation carries no lens keys.
    captureCliInvocation('list', [], new Set(['list']));
    assert.equal('lens' in (captured[1]?.properties ?? {}), false);
    assert.equal('$screen_name' in (captured[1]?.properties ?? {}), false);
  });

  it('collapses a third-party lens id and lets an explicit $screen_name win', async () => {
    seedUsage(true);
    const { ns, captured } = makeFakePosthog();
    await initUsageCli(() => Promise.resolve(ns));
    setInvocationLens('acme-provider', 'set');
    setInvocationScreenName('core/ai-name-action');
    captureCliInvocation('config', [], new Set(['config']));
    assert.equal(captured[0]?.properties['lens'], 'external_plugin');
    assert.equal(captured[0]?.properties['lens_source'], 'set');
    assert.equal(captured[0]?.properties['$screen_name'], 'core/ai-name-action');
  });

  it('a suppressed invocation emits nothing and clears every stash', async () => {
    seedUsage(true);
    const { ns, captured } = makeFakePosthog();
    await initUsageCli(() => Promise.resolve(ns));
    // The successful-claim shape: stashes may exist, suppression wins.
    addInvocationExtensions(['core/ai-name-action']);
    setInvocationScreenName('core/ai-name-action');
    suppressInvocationUsage();
    captureCliInvocation('jobs', ['wait'], new Set(['jobs']));
    assert.equal(captured.length, 0, 'the suppressed invocation sends no event');
    // Everything cleared: the next invocation emits normally, with no
    // bleed-through of the suppressed invocation's stashes.
    captureCliInvocation('list', [], new Set(['list']));
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.event, 'cli.list');
    assert.equal('extensions' in (captured[0]?.properties ?? {}), false);
    assert.equal('$screen_name' in (captured[0]?.properties ?? {}), false);
  });
});

describe('scrubUsageEvent', () => {
  it('passes null through (a dropped event)', () => {
    assert.equal(scrubUsageEvent(null), null);
  });

  it('strips an absolute home path planted in a property', () => {
    const event = {
      event: 'cli.scan',
      properties: { note: '/home/alice/projects/secret/file.md' },
    } as unknown as Parameters<typeof scrubUsageEvent>[0];
    const scrubbed = scrubUsageEvent(event) as unknown as { properties: { note: string } };
    assert.match(scrubbed.properties.note, /<HOME>/);
    assert.doesNotMatch(scrubbed.properties.note, /alice/);
  });
});
