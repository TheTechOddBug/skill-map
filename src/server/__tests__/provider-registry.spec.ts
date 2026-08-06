import { describe, it } from 'node:test';
import { deepStrictEqual } from 'node:assert';

import { buildProviderRegistry } from '../provider-registry.js';
import type {
  IProvider,
  IProviderReadConfig,
  IProviderUi,
} from '../../kernel/extensions/index.js';
import { claudeProvider } from '../../plugins/claude/providers/claude/index.js';
import { codexProvider } from '../../plugins/codex/providers/codex/index.js';
import { antigravityProvider } from '../../plugins/antigravity/providers/antigravity/index.js';
import { opencodeProvider } from '../../plugins/opencode/providers/opencode/index.js';

/**
 * Minimal IProvider shaped for the providerRegistry tests. `gated` drives
 * `gatedByActiveLens`, which the registry projects to the `isLens` flag: a
 * gated provider is a selectable lens, a non-gated one is the base. `read`
 * is optional, only the structured-frontmatter providers (codex) set it.
 */
function fakeProvider(
  id: string,
  presentation: IProviderUi,
  gated = false,
  read?: IProviderReadConfig,
): IProvider {
  return {
    id,
    pluginId: id,
    kind: 'provider',
    version: '1.0.0',
    description: 'test',
    presentation,
    gatedByActiveLens: gated,
    ...(read ? { read } : {}),
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

  it('projects read.bodyField when the provider declares one', () => {
    const codex = fakeProvider(
      'codex',
      { label: 'OpenAI Codex', color: '#22c55e' },
      true,
      { extensions: ['.toml'], parser: 'toml', bodyField: 'developer_instructions' },
    );
    const registry = buildProviderRegistry([codex]);
    deepStrictEqual(registry, {
      codex: {
        label: 'OpenAI Codex',
        color: '#22c55e',
        isLens: true,
        bodyField: 'developer_instructions',
      },
    });
  });

  it('omits bodyField when read declares no body field', () => {
    const claude = fakeProvider('claude', { label: 'Claude', color: '#cc785c' }, true, {
      extensions: ['.md'],
      parser: 'frontmatter-yaml',
    });
    const registry = buildProviderRegistry([claude]);
    deepStrictEqual(registry, {
      claude: { label: 'Claude', color: '#cc785c', isLens: true },
    });
  });

  it('projects invocationSigil when the presentation declares one', () => {
    const codex = fakeProvider(
      'codex',
      { label: 'OpenAI Codex', color: '#22c55e', invocationSigil: '$' },
      true,
    );
    const registry = buildProviderRegistry([codex]);
    deepStrictEqual(registry, {
      codex: { label: 'OpenAI Codex', color: '#22c55e', isLens: true, invocationSigil: '$' },
    });
  });

  it('omits invocationSigil when the presentation declares none', () => {
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

  it('projects the mcpRegister recipe verbatim when the provider declares one', () => {
    const claude = fakeProvider('claude', { label: 'Claude', color: '#cc785c' }, true);
    const recipe = {
      kind: 'command' as const,
      command: { template: 'claude mcp add --transport http --scope local skill-map {{url}}' },
    };
    const registry = buildProviderRegistry([{ ...claude, mcpRegister: recipe }]);
    deepStrictEqual(registry, {
      claude: { label: 'Claude', color: '#cc785c', isLens: true, mcpRegister: recipe },
    });
  });

  it('omits mcpRegister when the provider declares none', () => {
    const base = fakeProvider('markdown', { label: 'Markdown', color: '#64748b' });
    const registry = buildProviderRegistry([base]);
    deepStrictEqual(registry, {
      markdown: { label: 'Markdown', color: '#64748b', isLens: false },
    });
  });

  it('returns an empty registry for no providers', () => {
    deepStrictEqual(buildProviderRegistry([]), {});
  });
});

/**
 * The recipes themselves. They used to live in a closed `Record` inside the
 * UI keyed by provider id, which silently downgraded every lens outside that
 * list (any project-local drop-in Provider) to the bare-URL fallback. They
 * are Provider data now, so this is where they are pinned: the exact text an
 * operator copies, per built-in lens.
 */
describe('built-in MCP registration recipes', () => {
  it('claude registers through its own mcp verb, scoped local', () => {
    // `--scope local` on purpose: skill-map is a per-developer tool, so the
    // server stays out of the committed `.mcp.json` the lens READS.
    deepStrictEqual(claudeProvider.mcpRegister, {
      kind: 'command',
      command: { template: 'claude mcp add --transport http --scope local skill-map {{url}}' },
    });
  });

  it('codex registers through its mcp verb with --url', () => {
    deepStrictEqual(codexProvider.mcpRegister, {
      kind: 'command',
      command: { template: 'codex mcp add skill-map --url {{url}}' },
    });
  });

  it('antigravity hands over a document for its home-global config', () => {
    // The `agy` CLI has no `mcp` subcommand and the config is home-global,
    // so hand-editing that file is the only way in.
    deepStrictEqual(antigravityProvider.mcpRegister, {
      kind: 'config',
      config: {
        target: '~/.gemini/config/mcp_config.json',
        document: { mcpServers: { 'skill-map': { serverUrl: '{{url}}' } } },
      },
    });
  });

  it('opencode hands over a document for the operator GLOBAL config', () => {
    // Not the project `opencode.json` the lens reads: OpenCode's docs call
    // that one safe to commit, so it is the team's file.
    deepStrictEqual(opencodeProvider.mcpRegister, {
      kind: 'config',
      config: {
        target: '~/.config/opencode/opencode.json',
        document: {
          $schema: 'https://opencode.ai/config.json',
          mcp: { 'skill-map': { type: 'remote', url: '{{url}}', enabled: true } },
        },
      },
    });
  });

  it('every declared recipe carries the {{url}} placeholder', () => {
    for (const provider of [
      claudeProvider,
      codexProvider,
      antigravityProvider,
      opencodeProvider,
    ]) {
      const register = provider.mcpRegister;
      const text =
        register?.kind === 'command'
          ? register.command.template
          : JSON.stringify(register?.config.document ?? {});
      // A recipe without it would copy a setup line pointing nowhere.
      deepStrictEqual(text.includes('{{url}}'), true, `${provider.id} has no {{url}}`);
    }
  });
});
