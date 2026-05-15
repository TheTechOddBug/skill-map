import { describe, expect, it } from 'vitest';

import { SETTINGS_TEXTS } from '../../../../i18n/settings.texts';
import type { IPluginItemApi } from '../../../../models/api';
import { sourceLabel, statusLabel } from '../settings-plugins.utils';

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
    granularity: 'bundle',
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
