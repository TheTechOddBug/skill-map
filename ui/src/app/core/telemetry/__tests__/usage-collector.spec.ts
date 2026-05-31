import { describe, expect, it } from 'vitest';

import { buildPluginUsageSet, qualifyPluginForUsage } from '../usage-collector';

describe('qualifyPluginForUsage', () => {
  it('passes built-in ids through, bare plugin or qualified extension', () => {
    expect(qualifyPluginForUsage('claude')).toBe('claude');
    expect(qualifyPluginForUsage('core')).toBe('core');
    expect(qualifyPluginForUsage('core/markdown-link')).toBe('core/markdown-link');
    expect(qualifyPluginForUsage('claude/at-directive')).toBe('claude/at-directive');
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
