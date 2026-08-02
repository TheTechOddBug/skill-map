import { describe, expect, it } from 'vitest';

import {
  buildPluginApplyProperties,
  buildPluginUsageSet,
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
  it('splits toggle deltas into collapsed enabled / disabled sets', () => {
    expect(
      buildPluginApplyProperties([
        { id: 'core/link-counter', enabled: true },
        { id: 'acme/private-fixer', enabled: false },
        { id: 'b/y' },
      ]),
    ).toEqual({ enabled: ['core/link-counter'], disabled: ['external_plugin'] });
  });

  it('returns null for a settings-only batch (no toggle happened)', () => {
    expect(buildPluginApplyProperties([{ id: 'b/y' }])).toBeNull();
    expect(buildPluginApplyProperties([])).toBeNull();
  });
});
