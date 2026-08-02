/**
 * Unit coverage for the extension settings resolver
 * (`core/config/plugin-settings.ts`):
 *   - declares-no-settings → {}
 *   - manifest default applied when no override
 *   - config override overlays the default
 *   - per-type value validation (every input-type)
 *   - invalid value → falls back to default + emits one warning
 *   - secret has no default, so omitted when no override
 *
 * Pure in-memory: the resolver reads a plain config object, no storage
 * adapter is involved.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildSettingsResolver,
  resolveExtensionSettings,
  type ISettingsManifestRef,
} from '../plugin-settings.js';
import type { TSettingDeclaration } from '../../../kernel/types/view-catalog.js';

/** Build a minimal config object carrying one extension's settings. */
function configWith(
  pluginId: string,
  extId: string,
  settings: Record<string, unknown>,
): { plugins: Record<string, { extensions: Record<string, { settings: Record<string, unknown> }> }> } {
  return { plugins: { [pluginId]: { extensions: { [extId]: { settings } } } } };
}

function manifest(settings: Record<string, TSettingDeclaration>): ISettingsManifestRef {
  return { pluginId: 'core', id: 'demo', settings };
}

describe('resolveExtensionSettings', () => {
  it('returns {} when the extension declares no settings', () => {
    assert.deepEqual(resolveExtensionSettings({ pluginId: 'core', id: 'x' }, {}), {});
    assert.deepEqual(resolveExtensionSettings({ pluginId: 'core', id: 'x', settings: {} }, {}), {});
  });

  it('applies the manifest default when no override exists', () => {
    const m = manifest({ keywords: { type: 'string-list', label: 'Keywords', default: ['TODO'] } });
    assert.deepEqual(resolveExtensionSettings(m, {}), { keywords: ['TODO'] });
  });

  it('omits a setting with no default and no override', () => {
    const m = manifest({ note: { type: 'single-string', label: 'Note' } });
    assert.deepEqual(resolveExtensionSettings(m, {}), {});
  });

  it('overlays a valid config override on top of the default', () => {
    const m = manifest({ keywords: { type: 'string-list', label: 'Keywords', default: ['TODO'] } });
    const cfg = configWith('core', 'demo', { keywords: ['FIXME', 'XXX'] });
    assert.deepEqual(resolveExtensionSettings(m, cfg), { keywords: ['FIXME', 'XXX'] });
  });

  it('reads the override under the leaf extension id (not the qualified id)', () => {
    const m: ISettingsManifestRef = {
      pluginId: 'core',
      id: 'external-url-counter',
      settings: { 'ignored-domains': { type: 'string-list', label: 'Ignored', default: [] } },
    };
    const cfg = configWith('core', 'external-url-counter', { 'ignored-domains': ['example.com'] });
    assert.deepEqual(resolveExtensionSettings(m, cfg), { 'ignored-domains': ['example.com'] });
  });

  describe('per-type value validation', () => {
    function resolveOne(declaration: TSettingDeclaration, value: unknown): { resolved: unknown; warnings: string[] } {
      const warnings: string[] = [];
      const out = resolveExtensionSettings(
        manifest({ s: declaration }),
        configWith('core', 'demo', { s: value }),
        (w) => warnings.push(w),
      );
      return { resolved: out['s'], warnings };
    }

    it('string-list accepts string[], rejects non-string entries', () => {
      assert.deepEqual(resolveOne({ type: 'string-list', label: 'L', default: [] }, ['a', 'b']).resolved, ['a', 'b']);
      const bad = resolveOne({ type: 'string-list', label: 'L', default: ['d'] }, ['ok', 3]);
      assert.deepEqual(bad.resolved, ['d']);
      assert.equal(bad.warnings.length, 1);
    });

    it('string-list honours min / max / itemMaxLength', () => {
      assert.deepEqual(resolveOne({ type: 'string-list', label: 'L', default: ['d'], min: 2 }, ['only']).resolved, ['d']);
      assert.deepEqual(resolveOne({ type: 'string-list', label: 'L', default: ['d'], max: 1 }, ['a', 'b']).resolved, ['d']);
      assert.deepEqual(
        resolveOne({ type: 'string-list', label: 'L', default: ['d'], itemMaxLength: 2 }, ['toolong']).resolved,
        ['d'],
      );
    });

    it('single-string honours minLength / maxLength / pattern', () => {
      assert.equal(resolveOne({ type: 'single-string', label: 'L', default: 'd' }, 'value').resolved, 'value');
      assert.equal(resolveOne({ type: 'single-string', label: 'L', default: 'd', minLength: 3 }, 'ab').resolved, 'd');
      assert.equal(resolveOne({ type: 'single-string', label: 'L', default: 'd', maxLength: 2 }, 'abc').resolved, 'd');
      assert.equal(
        resolveOne({ type: 'single-string', label: 'L', default: 'd', pattern: '^[a-z]+$' }, 'ABC').resolved,
        'd',
      );
      assert.equal(
        resolveOne({ type: 'single-string', label: 'L', default: 'd', pattern: '^[a-z]+$' }, 'abc').resolved,
        'abc',
      );
    });

    it('boolean-flag accepts booleans only', () => {
      assert.equal(resolveOne({ type: 'boolean-flag', label: 'L', default: false }, true).resolved, true);
      assert.equal(resolveOne({ type: 'boolean-flag', label: 'L', default: false }, 'true').resolved, false);
    });

    it('integer accepts safe integers within bounds', () => {
      assert.equal(resolveOne({ type: 'integer', label: 'L', default: 0 }, 7).resolved, 7);
      assert.equal(resolveOne({ type: 'integer', label: 'L', default: 0 }, 1.5).resolved, 0);
      assert.equal(resolveOne({ type: 'integer', label: 'L', default: 0, min: 1 }, 0).resolved, 0);
      assert.equal(resolveOne({ type: 'integer', label: 'L', default: 0, max: 5 }, 9).resolved, 0);
    });

    it('number accepts finite decimals, rejects NaN / Infinity', () => {
      assert.equal(resolveOne({ type: 'number', label: 'L', default: 0 }, 0.3).resolved, 0.3);
      assert.equal(resolveOne({ type: 'number', label: 'L', default: 1 }, Number.POSITIVE_INFINITY).resolved, 1);
      assert.equal(resolveOne({ type: 'number', label: 'L', default: 1 }, Number.NaN).resolved, 1);
      assert.equal(resolveOne({ type: 'number', label: 'L', default: 1, min: 0, max: 1 }, 2).resolved, 1);
    });

    it('enum-pick accepts one of the declared options', () => {
      const decl: TSettingDeclaration = {
        type: 'enum-pick',
        label: 'L',
        default: 'a',
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      };
      assert.equal(resolveOne(decl, 'b').resolved, 'b');
      assert.equal(resolveOne(decl, 'c').resolved, 'a');
    });

    it('enum-multipick accepts a subset of the declared options', () => {
      const decl: TSettingDeclaration = {
        type: 'enum-multipick',
        label: 'L',
        default: [],
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      };
      assert.deepEqual(resolveOne(decl, ['a', 'b']).resolved, ['a', 'b']);
      assert.deepEqual(resolveOne({ ...decl, default: ['a'] }, ['a', 'zzz']).resolved, ['a']);
    });

    it('path-glob accepts string (single) or string[] (multiple)', () => {
      assert.equal(resolveOne({ type: 'path-glob', label: 'L', default: '*' }, 'src/**').resolved, 'src/**');
      assert.equal(resolveOne({ type: 'path-glob', label: 'L', default: '*' }, ['array']).resolved, '*');
      // `multiple: true` accepts a `string[]` runtime value (the
      // `default` stays a single string per the schema).
      assert.deepEqual(
        resolveOne({ type: 'path-glob', label: 'L', default: '*', multiple: true }, ['a', 'b']).resolved,
        ['a', 'b'],
      );
      assert.equal(
        resolveOne({ type: 'path-glob', label: 'L', default: '*', multiple: true }, 'not-array').resolved,
        '*',
      );
    });

    it('regex accepts a compilable pattern, rejects an uncompilable one', () => {
      assert.equal(resolveOne({ type: 'regex', label: 'L', default: '.*' }, '[a-z]+').resolved, '[a-z]+');
      assert.equal(resolveOne({ type: 'regex', label: 'L', default: '.*' }, '[unclosed').resolved, '.*');
    });

    it('secret accepts a string; has no default so omitted when no override', () => {
      assert.equal(resolveOne({ type: 'secret', label: 'L' }, 'token').resolved, 'token');
      // A non-string override degrades; secret has no default, so the
      // resolved key is absent entirely.
      const noOverride = resolveExtensionSettings(manifest({ s: { type: 'secret', label: 'L' } }), {});
      assert.equal('s' in noOverride, false);
    });

    it('key-value-list accepts Array<{key,value}>', () => {
      const decl: TSettingDeclaration = { type: 'key-value-list', label: 'L', default: [] };
      assert.deepEqual(resolveOne(decl, [{ key: 'a', value: '1' }]).resolved, [{ key: 'a', value: '1' }]);
      assert.deepEqual(resolveOne({ ...decl, default: [{ key: 'd', value: 'd' }] }, [{ key: 'x' }]).resolved, [
        { key: 'd', value: 'd' },
      ]);
    });

    it('match-list accepts a mixed literal / regex / glob list', () => {
      const decl: TSettingDeclaration = { type: 'match-list', label: 'L', default: [] };
      const mixed = [
        { type: 'literal', value: 'docs/x/spec.md' },
        { type: 'regex', value: '^docs/x/' },
        { type: 'glob', value: 'docs/x/' },
      ];
      const out = resolveOne(decl, mixed);
      assert.deepEqual(out.resolved, mixed);
      assert.equal(out.warnings.length, 0);
    });

    it('match-list rejects non-arrays, bad shapes, and unknown kinds', () => {
      const decl: TSettingDeclaration = {
        type: 'match-list',
        label: 'L',
        default: [{ type: 'literal', value: 'd' }],
      };
      const fallback = [{ type: 'literal', value: 'd' }];
      for (const bad of [
        'not-an-array',
        [{ type: 'literal' }],
        [{ value: 'x' }],
        [{ type: 'substring', value: 'x' }],
        [null],
      ]) {
        const out = resolveOne(decl, bad);
        assert.deepEqual(out.resolved, fallback);
        assert.equal(out.warnings.length, 1);
      }
    });

    it('match-list rejects empty, oversize, and control-character values', () => {
      const decl: TSettingDeclaration = { type: 'match-list', label: 'L', default: [] };
      for (const bad of [
        [{ type: 'literal', value: '' }],
        [{ type: 'literal', value: 'x'.repeat(257) }],
        [{ type: 'literal', value: 'a\u001B[2Jb' }],
        [{ type: 'glob', value: 'two\nlines' }],
      ]) {
        const out = resolveOne(decl, bad);
        assert.deepEqual(out.resolved, []);
        assert.equal(out.warnings.length, 1);
      }
    });

    it('match-list rejects an uncompilable regex entry but never a glob', () => {
      const decl: TSettingDeclaration = { type: 'match-list', label: 'L', default: [] };
      const bad = resolveOne(decl, [{ type: 'regex', value: '[unclosed' }]);
      assert.deepEqual(bad.resolved, []);
      assert.equal(bad.warnings.length, 1);
      assert.match(bad.warnings[0]!, /compilable/);
      // The same body as a glob entry is fine: globs have no compile concept.
      const asGlob = resolveOne(decl, [{ type: 'glob', value: '[unclosed' }]);
      assert.deepEqual(asGlob.resolved, [{ type: 'glob', value: '[unclosed' }]);
      assert.equal(asGlob.warnings.length, 0);
    });
  });

  it('emits exactly one warning per invalid value and never throws', () => {
    const warnings: string[] = [];
    const m = manifest({
      a: { type: 'integer', label: 'A', default: 1 },
      b: { type: 'string-list', label: 'B', default: ['x'] },
    });
    const cfg = configWith('core', 'demo', { a: 'not-a-number', b: ['ok'] });
    const out = resolveExtensionSettings(m, cfg, (w) => warnings.push(w));
    assert.deepEqual(out, { a: 1, b: ['ok'] });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /core\/demo/);
  });
});

describe('buildSettingsResolver', () => {
  it('returns a closure that resolves any extension against the captured config', () => {
    const cfg = configWith('core', 'demo', { keywords: ['FIXME'] });
    const resolve = buildSettingsResolver(cfg);
    const resolved = resolve(manifest({ keywords: { type: 'string-list', label: 'K', default: [] } }));
    assert.deepEqual(resolved, { keywords: ['FIXME'] });
    // An unrelated extension with no config falls back to its default.
    const other = resolve({ pluginId: 'core', id: 'other', settings: { n: { type: 'integer', label: 'N', default: 5 } } });
    assert.deepEqual(other, { n: 5 });
  });
});
