import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { buildKindRegistry } from '../kind-registry.js';
import type { IProvider } from '../../kernel/extensions/index.js';

/** Minimal IProvider shaped for the kindRegistry tests. */
function fakeProvider(id: string, kinds: IProvider['kinds']): IProvider {
  return {
    id,
    pluginId: id,
    kind: 'provider',
    version: '1.0.0',
    description: 'test',
    kinds,
    classify: () => 'unknown',
  };
}

describe('buildKindRegistry', () => {
  it('builds an entry per kind a single provider declares', () => {
    const claude = fakeProvider('claude', {
      agent: {
        schema: './a.json',
        schemaJson: {},
        ui: { label: 'Agents', color: '#3b82f6', colorDark: '#60a5fa' },
      },
      skill: {
        schema: './s.json',
        schemaJson: {},
        ui: { label: 'Skills', color: '#10b981' },
      },
    });
    const registry = buildKindRegistry([claude]);
    deepStrictEqual(Object.keys(registry).sort(), ['agent', 'skill']);
    strictEqual(registry['agent']!.primaryProviderId, 'claude');
    deepStrictEqual(Object.keys(registry['agent']!.providers), ['claude']);
    strictEqual(registry['agent']!.providers['claude']!.label, 'Agents');
    strictEqual(registry['agent']!.providers['claude']!.color, '#3b82f6');
    strictEqual(registry['agent']!.providers['claude']!.colorDark, '#60a5fa');
    strictEqual(registry['skill']!.providers['claude']!.colorDark, undefined);
  });

  it('cross-provider sharing, both contributions kept under `providers`, primary stays first', () => {
    const claude = fakeProvider('claude', {
      agent: {
        schema: './a.json',
        schemaJson: {},
        ui: { label: 'Agents', color: '#3b82f6' },
      },
    });
    const openai = fakeProvider('openai', {
      agent: {
        schema: './ga.json',
        schemaJson: {},
        ui: { label: 'Codex Agents', color: '#22c55e' },
      },
    });
    const registry = buildKindRegistry([claude, openai]);
    strictEqual(registry['agent']!.primaryProviderId, 'claude');
    deepStrictEqual(Object.keys(registry['agent']!.providers).sort(), ['claude', 'openai']);
    strictEqual(registry['agent']!.providers['claude']!.color, '#3b82f6');
    strictEqual(registry['agent']!.providers['openai']!.color, '#22c55e');
  });

  it('order matters, first provider in the input array wins primaryProviderId', () => {
    const claude = fakeProvider('claude', {
      agent: {
        schema: './a.json',
        schemaJson: {},
        ui: { label: 'Agents', color: '#3b82f6' },
      },
    });
    const openai = fakeProvider('openai', {
      agent: {
        schema: './ga.json',
        schemaJson: {},
        ui: { label: 'Codex Agents', color: '#22c55e' },
      },
    });
    const registryOpenaiFirst = buildKindRegistry([openai, claude]);
    strictEqual(registryOpenaiFirst['agent']!.primaryProviderId, 'openai');
    deepStrictEqual(
      Object.keys(registryOpenaiFirst['agent']!.providers).sort(),
      ['claude', 'openai'],
    );
  });

  it('empty providers array yields an empty registry', () => {
    deepStrictEqual(buildKindRegistry([]), {});
  });
});
