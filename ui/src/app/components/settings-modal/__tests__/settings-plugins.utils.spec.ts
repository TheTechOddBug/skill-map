import { describe, expect, it } from 'vitest';

import { SETTINGS_TEXTS } from '../../../../i18n/settings.texts';
import type { IPluginExtensionApi, IPluginItemApi } from '../../../../models/api';
import {
  buildStateFromPlugins,
  qualifiedKey,
  sourceLabel,
  statusLabel,
} from '../settings-plugins.utils';

/**
 * Label resolvers, surface mapping from the spec's status / source
 * enums to the user-visible strings in the Settings catalogue. The
 * pure functions live alongside the filter / sort helpers so the
 * component file stays focused on view glue.
 */

function bundle(
  overrides: Partial<IPluginItemApi> & Pick<IPluginItemApi, 'status'>,
): IPluginItemApi {
  return {
    id: 'test',
    version: '1.0.0',
    kinds: ['provider'],
    reason: null,
    source: 'built-in',
    ...overrides,
  };
}

describe('settings-plugins.utils, statusLabel', () => {
  it('returns the "Enabled" string for status=enabled', () => {
    const label = statusLabel(bundle({ status: 'enabled' }), SETTINGS_TEXTS);
    expect(label).toBe(SETTINGS_TEXTS.enabledLabel);
  });

  it('returns the "Disabled" string for status=disabled', () => {
    const label = statusLabel(bundle({ status: 'disabled' }), SETTINGS_TEXTS);
    expect(label).toBe(SETTINGS_TEXTS.disabledLabel);
  });

  it('routes each failure status to its catalogue entry', () => {
    const failures: Array<IPluginItemApi['status']> = [
      'invalid-manifest',
      'load-error',
      'incompatible-spec',
      'id-collision',
    ];
    for (const status of failures) {
      const label = statusLabel(bundle({ status }), SETTINGS_TEXTS);
      expect(label).toBe(SETTINGS_TEXTS.statusFailure[status]);
    }
  });
});

describe('settings-plugins.utils, sourceLabel', () => {
  it('maps each source value to its catalogue entry', () => {
    expect(sourceLabel('built-in', SETTINGS_TEXTS)).toBe(SETTINGS_TEXTS.sourceBuiltIn);
    expect(sourceLabel('project', SETTINGS_TEXTS)).toBe(SETTINGS_TEXTS.sourceProject);
  });
});

function ext(
  overrides: Partial<IPluginExtensionApi> & Pick<IPluginExtensionApi, 'id'>,
): IPluginExtensionApi {
  return {
    kind: 'extractor',
    version: '1.0.0',
    enabled: true,
    ...overrides,
  };
}

describe('settings-plugins.utils, buildStateFromPlugins', () => {
  it('seeds per-extension keys for every extension, no bundle-level key', () => {
    // The bundle is a presentational grouping; every extension is
    // independently toggle-able by its qualified id. The state map
    // tracks the per-extension axis only.
    const plugin: IPluginItemApi = {
      id: 'claude',
      version: '1.0.0',
      kinds: ['provider', 'extractor'],
      status: 'enabled',
      reason: null,
      source: 'built-in',
      extensions: [
        ext({ id: 'claude', enabled: true }),
        ext({ id: 'at-directive', enabled: true }),
        ext({ id: 'slash', enabled: false }),
      ],
    };
    const state = buildStateFromPlugins([plugin]);
    expect(state.has('claude')).toBe(false);
    expect(state.get(qualifiedKey('claude', 'claude'))).toBe(true);
    expect(state.get(qualifiedKey('claude', 'at-directive'))).toBe(true);
    expect(state.get(qualifiedKey('claude', 'slash'))).toBe(false);
  });

  it('seeds per-extension keys for core (no bundle key)', () => {
    const plugin: IPluginItemApi = {
      id: 'core',
      version: '1.0.0',
      kinds: ['extractor', 'analyzer'],
      status: 'enabled',
      reason: null,
      source: 'built-in',
      extensions: [
        ext({ id: 'markdown-link', enabled: true }),
        ext({ id: 'broken-ref', enabled: false }),
      ],
    };
    const state = buildStateFromPlugins([plugin]);
    expect(state.has('core')).toBe(false);
    expect(state.get(qualifiedKey('core', 'markdown-link'))).toBe(true);
    expect(state.get(qualifiedKey('core', 'broken-ref'))).toBe(false);
  });

  it('reflects each extension state independently of the bundle row status', () => {
    const plugin: IPluginItemApi = {
      id: 'claude',
      version: '1.0.0',
      kinds: ['provider'],
      status: 'disabled',
      reason: null,
      source: 'built-in',
      extensions: [ext({ id: 'at-directive', enabled: true })],
    };
    const state = buildStateFromPlugins([plugin]);
    expect(state.has('claude')).toBe(false);
    expect(state.get(qualifiedKey('claude', 'at-directive'))).toBe(true);
  });

  it('skips failure rows entirely (no bundle key, no extension keys)', () => {
    const plugin: IPluginItemApi = {
      id: 'broken',
      version: null,
      kinds: [],
      status: 'invalid-manifest',
      reason: 'malformed manifest',
      source: 'project',
      extensions: [ext({ id: 'orphan', enabled: true })],
    };
    const state = buildStateFromPlugins([plugin]);
    expect(state.size).toBe(0);
  });
});
