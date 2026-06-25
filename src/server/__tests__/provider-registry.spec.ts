import { describe, it } from 'node:test';
import { deepStrictEqual } from 'node:assert';

import { buildProviderRegistry } from '../provider-registry.js';
import type { IProvider, IProviderUi } from '../../kernel/extensions/index.js';

/** Minimal IProvider shaped for the providerRegistry tests. */
function fakeProvider(id: string, presentation: IProviderUi): IProvider {
  return {
    id,
    pluginId: id,
    kind: 'provider',
    version: '1.0.0',
    description: 'test',
    presentation,
    kinds: {},
    classify: () => null,
  };
}

describe('buildProviderRegistry', () => {
  it('builds one entry per provider keyed by id', () => {
    const claude = fakeProvider('claude', {
      label: 'Claude',
      color: '#cc785c',
      colorDark: '#e89270',
    });
    const registry = buildProviderRegistry([claude]);
    deepStrictEqual(registry, {
      claude: { label: 'Claude', color: '#cc785c', colorDark: '#e89270' },
    });
  });

  it('preserves optional fields (emoji, icon, hideChip) when present', () => {
    const markdown = fakeProvider('markdown', {
      label: 'Markdown',
      color: '#9ca3af',
      colorDark: '#6b7280',
      hideChip: true,
    });
    const openai = fakeProvider('openai', {
      label: 'OpenAI Codex',
      color: '#22c55e',
      icon: { kind: 'pi', id: 'pi-bolt' },
    });
    const registry = buildProviderRegistry([markdown, openai]);
    deepStrictEqual(registry, {
      markdown: { label: 'Markdown', color: '#9ca3af', colorDark: '#6b7280', hideChip: true },
      openai: { label: 'OpenAI Codex', color: '#22c55e', icon: { kind: 'pi', id: 'pi-bolt' } },
    });
  });

  it('omits absent optional fields rather than emitting undefined', () => {
    const agentSkills = fakeProvider('agent-skills', {
      label: 'Open Skills',
      color: '#64748b',
    });
    const registry = buildProviderRegistry([agentSkills]);
    deepStrictEqual(registry, {
      'agent-skills': { label: 'Open Skills', color: '#64748b' },
    });
  });

  it('preserves provider iteration order in the keys', () => {
    const registry = buildProviderRegistry([
      fakeProvider('claude', { label: 'Claude', color: '#cc785c' }),
      fakeProvider('openai', { label: 'OpenAI Codex', color: '#22c55e' }),
      fakeProvider('markdown', { label: 'Markdown', color: '#9ca3af', hideChip: true }),
    ]);
    deepStrictEqual(Object.keys(registry), ['claude', 'openai', 'markdown']);
  });

  it('returns an empty registry for no providers', () => {
    deepStrictEqual(buildProviderRegistry([]), {});
  });
});
