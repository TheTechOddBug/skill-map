/**
 * Unit tests for the pure usage-collector helpers
 * (`cli/telemetry/usage-collector.ts`). These shape what may leave the
 * machine, so they are tested against hostile inputs (third-party ids,
 * malformed ids, flag values that must never be captured) with no SDK or
 * network in play.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { listBuiltIns } from '../../../plugins/built-ins.js';
import {
  BUILT_IN_PLUGIN_IDS,
  buildCliVerbProperties,
  buildUsageExtensionSet,
  cliVerbEventName,
  envUsageProps,
  extractFlagNames,
  normalizeTelemetryVerb,
  qualifyExtensionForUsage,
  qualifyPluginIdForUsage,
} from '../usage-collector.js';

describe('qualifyExtensionForUsage', () => {
  it('passes built-in ids through unchanged', () => {
    assert.equal(qualifyExtensionForUsage('core/markdown-link'), 'core/markdown-link');
    assert.equal(qualifyExtensionForUsage('claude/at-directive'), 'claude/at-directive');
    assert.equal(qualifyExtensionForUsage('codex/codex'), 'codex/codex');
    assert.equal(qualifyExtensionForUsage('antigravity/x'), 'antigravity/x');
    assert.equal(qualifyExtensionForUsage('agent-skills/y'), 'agent-skills/y');
  });

  it('collapses third-party ids to external_plugin', () => {
    assert.equal(qualifyExtensionForUsage('my-org/secret-detector'), 'external_plugin');
    assert.equal(qualifyExtensionForUsage('acme/anything'), 'external_plugin');
  });

  it('treats malformed ids (no slash / empty plugin) as third-party', () => {
    assert.equal(qualifyExtensionForUsage('nope'), 'external_plugin');
    assert.equal(qualifyExtensionForUsage('/leading-slash'), 'external_plugin');
    assert.equal(qualifyExtensionForUsage(''), 'external_plugin');
  });
});

describe('qualifyPluginIdForUsage (bare lens / provider ids)', () => {
  it('passes built-in plugin ids through and collapses the rest', () => {
    assert.equal(qualifyPluginIdForUsage('claude'), 'claude');
    assert.equal(qualifyPluginIdForUsage('agent-skills'), 'agent-skills');
    assert.equal(qualifyPluginIdForUsage('acme-provider'), 'external_plugin');
    assert.equal(qualifyPluginIdForUsage(''), 'external_plugin');
  });
});

describe('buildUsageExtensionSet', () => {
  it('dedupes, sorts, and collapses third-party ids', () => {
    const out = buildUsageExtensionSet([
      'core/markdown-link',
      'core/markdown-link',
      'claude/at-directive',
      'vendor/private',
      'other-vendor/also-private',
    ]);
    assert.deepEqual(out, [
      'claude/at-directive',
      'core/markdown-link',
      'external_plugin',
    ]);
  });

  it('returns an empty array for no executions', () => {
    assert.deepEqual(buildUsageExtensionSet([]), []);
  });
});

describe('cliVerbEventName', () => {
  const known = new Set(['scan', 'check', 'db', 'plugins']);

  it('names the event after a registered verb', () => {
    assert.equal(cliVerbEventName('scan', known), 'cli.scan');
    assert.equal(cliVerbEventName('check', known), 'cli.check');
    assert.equal(cliVerbEventName('db', known), 'cli.db');
  });

  it('collapses an unknown verb / typo to cli.unknown (bounded catalog)', () => {
    assert.equal(cliVerbEventName('asdfgh', known), 'cli.unknown');
    assert.equal(cliVerbEventName('', known), 'cli.unknown');
  });
});

describe('normalizeTelemetryVerb', () => {
  it('folds the root help / version flag spellings onto their verb twins', () => {
    assert.equal(normalizeTelemetryVerb('--help'), 'help');
    assert.equal(normalizeTelemetryVerb('-h'), 'help');
    assert.equal(normalizeTelemetryVerb('--version'), 'version');
    assert.equal(normalizeTelemetryVerb('-v'), 'version');
  });

  it('passes any other token through untouched', () => {
    assert.equal(normalizeTelemetryVerb('scan'), 'scan');
    assert.equal(normalizeTelemetryVerb('--json'), '--json');
    assert.equal(normalizeTelemetryVerb(''), '');
  });
});

describe('buildCliVerbProperties', () => {
  it('carries sorted/deduped flag NAMES and omits extensions for a non-scan', () => {
    assert.deepEqual(buildCliVerbProperties(['json', 'changed', 'json'], null), {
      flags: ['changed', 'json'],
    });
  });

  it('folds the extractor set in on a scan (no verb property; it is in the name)', () => {
    assert.deepEqual(
      buildCliVerbProperties(['changed'], ['claude/at-directive', 'core/markdown-link']),
      { flags: ['changed'], extensions: ['claude/at-directive', 'core/markdown-link'] },
    );
  });

  it('attaches $screen_name on a queue-lifecycle invocation, omits it otherwise', () => {
    assert.deepEqual(
      buildCliVerbProperties(['json'], ['core/ai-name-action'], 'core/ai-name-action'),
      {
        flags: ['json'],
        extensions: ['core/ai-name-action'],
        $screen_name: 'core/ai-name-action',
      },
    );
    assert.deepEqual(buildCliVerbProperties(['json'], null), { flags: ['json'] });
    assert.deepEqual(buildCliVerbProperties(['json'], null, null), { flags: ['json'] });
  });
});

describe('extractFlagNames', () => {
  it('extracts flag names, never their values', () => {
    assert.deepEqual(extractFlagNames(['--json', '--max-nodes', '500', '-q']), [
      'json',
      'max-nodes',
      'q',
    ]);
  });

  it('strips an =value suffix and ignores positionals', () => {
    assert.deepEqual(extractFlagNames(['scan', '--max-nodes=500', './some/path', '--db', '/abs/path']), [
      'db',
      'max-nodes',
    ]);
  });

  it('returns empty for no flags', () => {
    assert.deepEqual(extractFlagNames(['scan', 'roots']), []);
  });
});

describe('BUILT_IN_PLUGIN_IDS, the privacy allow-list', () => {
  // The dangerous direction is one-way. An id in this list passes through
  // to PostHog verbatim, so a NON-built-in leaking in is a privacy defect;
  // a built-in missing from it only costs signal (the id collapses to
  // `external_plugin`, which always conforms). Assert the dangerous
  // direction strictly and the lossy one loosely, rather than demanding
  // set equality, which would let a loader-side edit widen this list.
  it('contains no id that is not actually a shipped built-in', () => {
    const shipped = new Set(listBuiltIns().map((p) => p.pluginId));
    const notShipped = [...BUILT_IN_PLUGIN_IDS].filter((id) => !shipped.has(id));
    assert.deepEqual(
      notShipped,
      [],
      `allow-list carries ids this CLI does not ship: ${notShipped.join(', ')}`,
    );
  });

  it('covers every shipped built-in, so real usage is not misreported as third-party', () => {
    const missing = [...new Set(listBuiltIns().map((p) => p.pluginId))].filter(
      (id) => !BUILT_IN_PLUGIN_IDS.has(id),
    );
    assert.deepEqual(
      missing,
      [],
      `shipped built-ins absent from the allow-list collapse to external_plugin: ${missing.join(', ')}`,
    );
  });
});

describe('envUsageProps', () => {
  it('reports cli version, node major, os, and arch (no secrets)', () => {
    const env = envUsageProps('1.2.3');
    assert.equal(env.cli_version, '1.2.3');
    assert.equal(env.node_major, Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10));
    assert.equal(env.os, process.platform);
    assert.equal(env.arch, process.arch);
    assert.ok(env.environment === 'dev' || env.environment === 'prod');
  });
});
