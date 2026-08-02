import { describe, expect, it } from 'vitest';

import {
  buildAiActionEventProperties,
  buildAppStartEventProperties,
  buildFeatureEventProperties,
  buildFilterEventProperties,
  buildLensSelectEventProperties,
  buildNodeActionEventProperties,
  buildPluginApplyProperties,
  buildPluginUsageSet,
  buildSidecarConsentEventProperties,
  qualifyFindingTypeForUsage,
  qualifyKindForUsage,
  qualifyMaybePluginValue,
  qualifyPluginForUsage,
} from '../usage-collector';

describe('qualifyPluginForUsage', () => {
  it('passes built-in ids through, bare plugin or qualified extension', () => {
    expect(qualifyPluginForUsage('claude')).toBe('claude');
    expect(qualifyPluginForUsage('core')).toBe('core');
    expect(qualifyPluginForUsage('core/markdown-link')).toBe('core/markdown-link');
    expect(qualifyPluginForUsage('claude/at-directive')).toBe('claude/at-directive');
    // Parity with the CLI allow-list: github is a shipped built-in and must
    // not misreport as external_plugin.
    expect(qualifyPluginForUsage('github')).toBe('github');
    expect(qualifyPluginForUsage('github/enrichment')).toBe('github/enrichment');
  });

  it('pins EVERY member of the built-in allow-list (lockstep with the CLI copy)', () => {
    // The authoritative list lives in src/cli/telemetry/usage-collector.ts
    // (spec-asserted against the shipped built-ins there). The UI copy is a
    // hand-mirror; this pin makes a drifted member a visible test failure
    // instead of an invisible external_plugin misreport. Update BOTH copies
    // and BOTH specs together when a built-in lands or leaves.
    const builtIns = [
      'claude',
      'antigravity',
      'codex',
      'opencode',
      'agent-skills',
      'core',
      'github',
      'test-plugin',
    ];
    for (const id of builtIns) {
      expect(qualifyPluginForUsage(id)).toBe(id);
      expect(qualifyPluginForUsage(`${id}/some-extension`)).toBe(`${id}/some-extension`);
    }
  });

  it('collapses third-party ids to external_plugin (bare or qualified)', () => {
    expect(qualifyPluginForUsage('my-org/secret')).toBe('external_plugin');
    expect(qualifyPluginForUsage('my-org')).toBe('external_plugin');
    expect(qualifyPluginForUsage('')).toBe('external_plugin');
  });
});

describe('buildPluginUsageSet', () => {
  it('dedupes, sorts, and collapses third-party ids', () => {
    expect(
      buildPluginUsageSet([
        'core/markdown-link',
        'core/markdown-link',
        'claude/at-directive',
        'vendor/private',
      ]),
    ).toEqual(['claude/at-directive', 'core/markdown-link', 'external_plugin']);
  });

  it('returns an empty array for no ids', () => {
    expect(buildPluginUsageSet([])).toEqual([]);
  });
});

describe('qualifyKindForUsage', () => {
  it('passes built-in Provider kinds through', () => {
    for (const kind of ['agent', 'command', 'markdown', 'mcp', 'skill', 'workflow']) {
      expect(qualifyKindForUsage(kind)).toBe(kind);
    }
  });

  it('collapses plugin-declared kinds to external_plugin', () => {
    expect(qualifyKindForUsage('runbook')).toBe('external_plugin');
    expect(qualifyKindForUsage('')).toBe('external_plugin');
  });
});

describe('qualifyMaybePluginValue', () => {
  it('collapses qualified ids and passes slash-free values verbatim', () => {
    expect(qualifyMaybePluginValue('core/node-set-tags')).toBe('core/node-set-tags');
    expect(qualifyMaybePluginValue('acme/private-action')).toBe('external_plugin');
    expect(qualifyMaybePluginValue('findings-restore')).toBe('findings-restore');
    expect(qualifyMaybePluginValue('reference-broken')).toBe('reference-broken');
  });
});

describe('qualifyFindingTypeForUsage', () => {
  it('passes kernel-lane types and built-in finder types verbatim', () => {
    expect(qualifyFindingTypeForUsage('injection-detected', 'acme/finder', 'kernel')).toBe(
      'injection-detected',
    );
    expect(qualifyFindingTypeForUsage('incoherence', 'core/ai-coherence', 'extension')).toBe(
      'incoherence',
    );
  });

  it('collapses a third-party finder vocabulary with its plugin', () => {
    expect(qualifyFindingTypeForUsage('secret-sauce', 'acme/finder', 'extension')).toBe(
      'external_plugin',
    );
  });
});

describe('buildPluginApplyProperties', () => {
  it('splits toggle deltas into collapsed sets and a stateful screen name', () => {
    expect(
      buildPluginApplyProperties([
        { id: 'core/link-counter', enabled: true },
        { id: 'acme/private-fixer', enabled: false },
        { id: 'b/y' },
      ]),
    ).toEqual({
      enabled: ['core/link-counter'],
      disabled: ['external_plugin'],
      $screen_name: 'core/link-counter:true external_plugin:false',
    });
  });

  it('returns null for a settings-only batch (no toggle happened)', () => {
    expect(buildPluginApplyProperties([{ id: 'b/y' }])).toBeNull();
    expect(buildPluginApplyProperties([])).toBeNull();
  });
});

describe('buildFeatureEventProperties ($screen_name folding)', () => {
  it('bare gesture: the surface alone', () => {
    expect(buildFeatureEventProperties('scan')).toEqual({ $screen_name: 'scan' });
  });

  it('toggle value folds as :value (boolean and enum string)', () => {
    expect(buildFeatureEventProperties('live-toggle', true)).toEqual({
      value: true,
      $screen_name: 'live-toggle:true',
    });
    expect(buildFeatureEventProperties('theme-toggle', 'dark')).toEqual({
      value: 'dark',
      $screen_name: 'theme-toggle:dark',
    });
  });

  it('shared-surface source folds as @source, after the value', () => {
    expect(buildFeatureEventProperties('hook-install', undefined, 'quick-start')).toEqual({
      source: 'quick-start',
      $screen_name: 'hook-install@quick-start',
    });
    expect(buildFeatureEventProperties('mcp-server', true, 'settings')).toEqual({
      value: true,
      source: 'settings',
      $screen_name: 'mcp-server:true@settings',
    });
  });

  it('collapses plugin-qualified string values inside the builder', () => {
    // The generic feature channel is the one open-vocabulary path left, so
    // the collapse is enforced HERE: a call site can pass a raw qualified id
    // and a third-party plugin id still never leaves the browser.
    expect(buildFeatureEventProperties('finding-fix', 'core/reference-broken')).toEqual({
      value: 'core/reference-broken',
      $screen_name: 'finding-fix:core/reference-broken',
    });
    expect(buildFeatureEventProperties('finding-dismiss', 'acme/private-finder')).toEqual({
      value: 'external_plugin',
      $screen_name: 'finding-dismiss:external_plugin',
    });
    // Slash-free values (closed unions, our own flow literals) pass verbatim,
    // and pre-collapsed call sites stay idempotent.
    expect(buildFeatureEventProperties('finding-restore', 'external_plugin')).toEqual({
      value: 'external_plugin',
      $screen_name: 'finding-restore:external_plugin',
    });
  });
});

describe('buildAppStartEventProperties', () => {
  it('carries the collapsed lens when the boot probe resolved one', () => {
    expect(buildAppStartEventProperties('claude')).toEqual({
      $screen_name: 'app-start',
      lens: 'claude',
    });
    expect(buildAppStartEventProperties('acme-provider')).toEqual({
      $screen_name: 'app-start',
      lens: 'external_plugin',
    });
  });

  it('omits the lens when unknown', () => {
    expect(buildAppStartEventProperties(null)).toEqual({ $screen_name: 'app-start' });
  });
});

describe('buildFilterEventProperties', () => {
  it('valueless group (favorites) carries the group alone', () => {
    expect(buildFilterEventProperties('favorites')).toEqual({
      group: 'favorites',
      $screen_name: 'favorites',
    });
  });

  it('severity / link values pass verbatim (closed unions)', () => {
    expect(buildFilterEventProperties('severity', 'error')).toEqual({
      group: 'severity',
      value: 'error',
      $screen_name: 'severity:error',
    });
  });

  it('kind values collapse when plugin-declared', () => {
    expect(buildFilterEventProperties('kind', 'skill')).toEqual({
      group: 'kind',
      value: 'skill',
      $screen_name: 'kind:skill',
    });
    expect(buildFilterEventProperties('kind', 'runbook')).toEqual({
      group: 'kind',
      value: 'external_plugin',
      $screen_name: 'kind:external_plugin',
    });
  });
});

describe('buildLensSelectEventProperties', () => {
  it('the collapsed lens rides BOTH as value and as the cross-event lens', () => {
    expect(buildLensSelectEventProperties('codex', 'settings')).toEqual({
      value: 'codex',
      lens: 'codex',
      source: 'settings',
      $screen_name: 'lens-select:codex@settings',
    });
    expect(buildLensSelectEventProperties('acme-provider', 'settings')).toEqual({
      value: 'external_plugin',
      lens: 'external_plugin',
      source: 'settings',
      $screen_name: 'lens-select:external_plugin@settings',
    });
  });
});

describe('buildAiActionEventProperties', () => {
  it('collapses the extension id and suffixes :autofix only when chained', () => {
    expect(buildAiActionEventProperties('core/ai-security', false)).toEqual({
      value: 'core/ai-security',
      auto_fix: false,
      $screen_name: 'ai-action:core/ai-security',
    });
    expect(buildAiActionEventProperties('acme/finder', true)).toEqual({
      value: 'external_plugin',
      auto_fix: true,
      $screen_name: 'ai-action:external_plugin:autofix',
    });
  });
});

describe('buildNodeActionEventProperties', () => {
  it('collapses the action id', () => {
    expect(buildNodeActionEventProperties('core/node-bump')).toEqual({
      value: 'core/node-bump',
      $screen_name: 'node-action:core/node-bump',
    });
    expect(buildNodeActionEventProperties('acme/private')).toEqual({
      value: 'external_plugin',
      $screen_name: 'node-action:external_plugin',
    });
  });
});

describe('buildSidecarConsentEventProperties', () => {
  it('carries the resolution and the parked action (collapsed or literal)', () => {
    expect(buildSidecarConsentEventProperties('always', 'core/node-set-tags')).toEqual({
      value: 'always',
      action: 'core/node-set-tags',
      $screen_name: 'sidecar-consent:always',
    });
    expect(buildSidecarConsentEventProperties('once', 'acme/private-action')).toEqual({
      value: 'once',
      action: 'external_plugin',
      $screen_name: 'sidecar-consent:once',
    });
    expect(buildSidecarConsentEventProperties('declined', 'findings-restore')).toEqual({
      value: 'declined',
      action: 'findings-restore',
      $screen_name: 'sidecar-consent:declined',
    });
  });

  it('omits the action when the park context is unknown', () => {
    expect(buildSidecarConsentEventProperties('declined', null)).toEqual({
      value: 'declined',
      $screen_name: 'sidecar-consent:declined',
    });
  });
});
