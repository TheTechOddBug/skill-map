import { describe, expect, it } from 'vitest';

import type {
  IPluginExtensionApi,
  IPluginExtensionSettingApi,
  IPluginItemApi,
  TSettingValueApi,
} from '../../../../models/api';
import {
  buildSettingsFromPlugins,
  changedSettings,
  coerceToDeclared,
  extensionSettingsDirty,
  seedExtensionSettings,
  settingValuesEqual,
} from '../settings-plugins.utils';

/**
 * settings-buffer pure helpers: seeding the editable buffer from the
 * wire shape, coercing wire values into the declared runtime type, and
 * the dirty-diff / changed-keys projection that backs the Apply payload.
 * Secret semantics (blank = unchanged, typed = send) are exercised
 * explicitly.
 */

function ext(
  id: string,
  settings: IPluginExtensionSettingApi[],
  overrides: Partial<IPluginExtensionApi> = {},
): IPluginExtensionApi {
  return {
    id,
    kind: 'extractor',
    version: '1.0.0',
    enabled: true,
    settings,
    ...overrides,
  };
}

function plugin(id: string, extensions: IPluginExtensionApi[]): IPluginItemApi {
  return {
    id,
    version: null,
    kinds: ['extractor'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    extensions,
  };
}

describe('coerceToDeclared', () => {
  it('coerces booleans, numbers, lists, and key-value rows by declared type', () => {
    expect(coerceToDeclared({ id: 'b', type: 'boolean-flag', label: 'B' }, true)).toBe(true);
    expect(coerceToDeclared({ id: 'b', type: 'boolean-flag', label: 'B' }, 'nope')).toBe(false);
    expect(coerceToDeclared({ id: 'n', type: 'integer', label: 'N' }, 5)).toBe(5);
    expect(coerceToDeclared({ id: 'n', type: 'number', label: 'N' }, 'x')).toBe('');
    expect(
      coerceToDeclared({ id: 'l', type: 'string-list', label: 'L' }, ['a', 1, 'b']),
    ).toEqual(['a', 'b']);
    expect(
      coerceToDeclared(
        { id: 'kv', type: 'key-value-list', label: 'KV' },
        [{ key: 'A', value: 'B' }, { nope: true }],
      ),
    ).toEqual([{ key: 'A', value: 'B' }]);
  });

  it('routes path-glob by the multiple flag', () => {
    expect(coerceToDeclared({ id: 'g', type: 'path-glob', label: 'G' }, 'a')).toBe('a');
    expect(
      coerceToDeclared({ id: 'g', type: 'path-glob', label: 'G', multiple: true }, ['a', 'b']),
    ).toEqual(['a', 'b']);
  });

  it('keeps well-shaped match-list entries and drops malformed ones', () => {
    // Without the dedicated case, the default branch would coerce the
    // array to '' and silently empty the editor.
    expect(
      coerceToDeclared({ id: 'm', type: 'match-list', label: 'M' }, [
        { type: 'literal', value: 'docs/x/spec.md' },
        { type: 'regex', value: '^docs/x/' },
        { type: 'glob', value: 'drafts/**' },
        { type: 'substring', value: 'bad-kind' },
        { value: 'no-kind' },
        'not-an-object',
      ]),
    ).toEqual([
      { type: 'literal', value: 'docs/x/spec.md' },
      { type: 'regex', value: '^docs/x/' },
      { type: 'glob', value: 'drafts/**' },
    ]);
    expect(coerceToDeclared({ id: 'm', type: 'match-list', label: 'M' }, 'nope')).toEqual([]);
  });
});

describe('seedExtensionSettings', () => {
  it('prefers the resolved value, then default, then a typed blank', () => {
    const e = ext(
      'x',
      [
        { id: 'resolved', type: 'single-string', label: 'R', default: 'd' },
        { id: 'defaulted', type: 'single-string', label: 'D', default: 'd' },
        { id: 'blankList', type: 'string-list', label: 'L' },
        { id: 'blankBool', type: 'boolean-flag', label: 'B' },
      ],
      { settingValues: { resolved: 'fromConfig' } },
    );
    const seeded = seedExtensionSettings(e);
    expect(seeded['resolved']).toBe('fromConfig');
    expect(seeded['defaulted']).toBe('d');
    expect(seeded['blankList']).toEqual([]);
    expect(seeded['blankBool']).toBe(false);
  });

  it('always seeds a secret blank regardless of secretSettingsSet', () => {
    const e = ext('x', [{ id: 'tok', type: 'secret', label: 'Token' }], {
      secretSettingsSet: ['tok'],
    });
    expect(seedExtensionSettings(e)['tok']).toBe('');
  });
});

describe('buildSettingsFromPlugins', () => {
  it('keys each settings-bearing extension by its qualified id and skips the rest', () => {
    const buffer = buildSettingsFromPlugins([
      plugin('core', [
        ext('with', [{ id: 's', type: 'single-string', label: 'S', default: 'v' }]),
        ext('without', []),
      ]),
    ]);
    expect([...buffer.keys()]).toEqual(['core/with']);
    expect(buffer.get('core/with')).toEqual({ s: 'v' });
  });
});

describe('changedSettings', () => {
  const decls: IPluginExtensionSettingApi[] = [
    { id: 'name', type: 'single-string', label: 'Name', default: 'a' },
    { id: 'count', type: 'integer', label: 'Count' },
    { id: 'tok', type: 'secret', label: 'Token' },
  ];

  it('returns only the keys whose value changed', () => {
    const original = { name: 'a', count: '', tok: '' };
    const pending = { name: 'b', count: '', tok: '' };
    expect(changedSettings(decls, original, pending)).toEqual({ name: 'b' });
  });

  it('never ships a blank secret, always ships a typed secret', () => {
    const original = { name: 'a', count: '', tok: '' };
    expect(changedSettings(decls, original, { name: 'a', count: '', tok: '' })).toBeNull();
    expect(
      changedSettings(decls, original, { name: 'a', count: '', tok: 'hunter2' }),
    ).toEqual({ tok: 'hunter2' });
  });

  it('drops a numeric "unset" sentinel but ships a real number', () => {
    const original = { name: 'a', count: '', tok: '' };
    expect(changedSettings(decls, original, { name: 'a', count: '', tok: '' })).toBeNull();
    expect(
      changedSettings(decls, original, { name: 'a', count: 9, tok: '' }),
    ).toEqual({ count: 9 });
  });

  it('returns null when nothing changed', () => {
    const same = { name: 'a', count: '', tok: '' };
    expect(changedSettings(decls, same, { ...same })).toBeNull();
  });
});

describe('extensionSettingsDirty', () => {
  it('mirrors changedSettings as a boolean', () => {
    const decls: IPluginExtensionSettingApi[] = [
      { id: 'name', type: 'single-string', label: 'Name', default: 'a' },
    ];
    expect(extensionSettingsDirty(decls, { name: 'a' }, { name: 'a' })).toBe(false);
    expect(extensionSettingsDirty(decls, { name: 'a' }, { name: 'b' })).toBe(true);
  });
});

describe('settingValuesEqual', () => {
  it('compares scalars, arrays, and key-value rows structurally', () => {
    expect(settingValuesEqual('a', 'a')).toBe(true);
    expect(settingValuesEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(settingValuesEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(
      settingValuesEqual([{ key: 'k', value: 'v' }], [{ key: 'k', value: 'v' }]),
    ).toBe(true);
    expect(
      settingValuesEqual([{ key: 'k', value: 'v' }], [{ key: 'k', value: 'x' }]),
    ).toBe(false);
  });

  it('compares match-list entries by (type, value), pinning the dirty-state regression', () => {
    // Two equal entries MUST compare equal; before the dedicated branch
    // they fell through to `false` and the extension read permanently
    // dirty, shipping the patch on every apply.
    expect(
      settingValuesEqual(
        [{ type: 'literal', value: 'docs/x/spec.md' }],
        [{ type: 'literal', value: 'docs/x/spec.md' }],
      ),
    ).toBe(true);
    expect(
      settingValuesEqual(
        [{ type: 'literal', value: 'docs/x/spec.md' }],
        [{ type: 'regex', value: 'docs/x/spec.md' }],
      ),
    ).toBe(false);
    expect(
      settingValuesEqual(
        [{ type: 'glob', value: 'a/' }],
        [{ type: 'glob', value: 'b/' }],
      ),
    ).toBe(false);
  });

  it('seeds and dirty-diffs a match-list setting end to end', () => {
    const decls: IPluginExtensionSettingApi[] = [
      { id: 'ignored-references', type: 'match-list', label: 'Ignored references', default: [] },
    ];
    const seeded = { 'ignored-references': [] as TSettingValueApi };
    const same = { 'ignored-references': [] as TSettingValueApi };
    expect(extensionSettingsDirty(decls, seeded, same)).toBe(false);
    const changed = {
      'ignored-references': [{ type: 'literal', value: 'docs/x/spec.md' }] as TSettingValueApi,
    };
    expect(extensionSettingsDirty(decls, seeded, changed)).toBe(true);
    expect(changedSettings(decls, seeded, changed)).toEqual(changed);
  });
});
