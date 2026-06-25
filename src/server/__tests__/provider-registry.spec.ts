import { describe, it } from 'node:test';
import { deepStrictEqual } from 'node:assert';

import { buildProviderRegistry } from '../provider-registry.js';
import type { IProvider, IProviderUi } from '../../kernel/extensions/index.js';

/**
 * Minimal IProvider shaped for the providerRegistry tests. `gated` drives
 * `gatedByActiveLens`, which the registry projects to the `isLens` flag: a
 * gated provider is a selectable lens, a non-gated one is the base.
 */
function fakeProvider(id: string, presentation: IProviderUi, gated = false): IProvider {
  return {
    id,
    pluginId: id,
    kind: 'provider',
    version: '1.0.0',
    description: 'test',
    presentation,
    gatedByActiveLens: gated,
    kinds: {},
    classify: () => null,
  };
}

describe('buildProviderRegistry', () => {
  it('builds one entry per provider keyed by id, stamping isLens', () => {
    const claude = fakeProvider(
      'claude',
      { label: 'Claude', color: '#cc785c', colorDark: '#e89270' },
      true,
    );
    const registry = buildProviderRegistry([claude]);
    deepStrictEqual(registry, {
      claude: { label: 'Claude', color: '#cc785c', colorDark: '#e89270', isLens: true },
    });
  });

  it('projects isLens false for a non-gated base, true for a gated lens', () => {
    const markdown = fakeProvider('markdown', {
      label: 'Markdown',
      color: '#9ca3af',
      colorDark: '#6b7280',
      hideChip: true,
    }); // non-gated base
    const codex = fakeProvider(
      'codex',
      { label: 'OpenAI Codex', color: '#22c55e', icon: { kind: 'pi', id: 'pi-bolt' } },
      true,
    );
    const registry = buildProviderRegistry([markdown, codex]);
    deepStrictEqual(registry, {
      markdown: {
        label: 'Markdown',
        color: '#9ca3af',
        colorDark: '#6b7280',
        isLens: false,
        hideChip: true,
      },
      codex: {
        label: 'OpenAI Codex',
        color: '#22c55e',
        isLens: true,
        icon: { kind: 'pi', id: 'pi-bolt' },
      },
    });
  });

  it('omits absent optional fields rather than emitting undefined', () => {
    const agentSkills = fakeProvider(
      'agent-skills',
      { label: 'Agent Skills', color: '#64748b' },
      true,
    );
    const registry = buildProviderRegistry([agentSkills]);
    deepStrictEqual(registry, {
      'agent-skills': { label: 'Agent Skills', color: '#64748b', isLens: true },
    });
  });

  it('preserves provider iteration order in the keys', () => {
    const registry = buildProviderRegistry([
      fakeProvider('claude', { label: 'Claude', color: '#cc785c' }, true),
      fakeProvider('codex', { label: 'OpenAI Codex', color: '#22c55e' }, true),
      fakeProvider('markdown', { label: 'Markdown', color: '#9ca3af', hideChip: true }),
    ]);
    deepStrictEqual(Object.keys(registry), ['claude', 'codex', 'markdown']);
  });

  it('returns an empty registry for no providers', () => {
    deepStrictEqual(buildProviderRegistry([]), {});
  });
});
