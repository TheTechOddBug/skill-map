/**
 * Coverage for `applyConfigSideMcpNodes`, the post-walk config-side MCP
 * discovery step. The contracts that matter:
 *
 *   - a declared-but-unreferenced server is APPENDED as a fresh virtual node
 *     (state "declared + unused");
 *   - a declared server that already has a consumer-side node is ENRICHED in
 *     place, keeping its link counts and unioning `derivedFrom` (config-side
 *     canonical, consumer-side counts preserved);
 *   - both dialects (JSON `.mcp.json`, TOML `.codex/config.toml`) work;
 *   - best-effort: no cwd, no capability, or a missing config file is a no-op.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyConfigSideMcpNodes } from '../mcp-config-nodes.js';
import type { Node } from '../../types.js';
import type { IProvider } from '../../extensions/provider.js';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sm-mcp-config-'));
  created.push(dir);
  return dir;
}

/** Minimal IProvider: the step only reads `.id` and `.mcpConfig`. */
function provider(id: string, sources: { path: string; dialect: string }[]): IProvider {
  return { id, mcpConfig: { sources } } as unknown as IProvider;
}

function consumerNode(server: string): Node {
  return {
    path: `mcp://${server}`,
    kind: 'mcp',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 3,
    externalRefsCount: 0,
    virtual: true,
    derivedFrom: ['.claude/skills/x/SKILL.md'],
    frontmatter: { name: server },
  };
}

describe('applyConfigSideMcpNodes', () => {
  it('appends a declared-but-unused server (json dialect)', () => {
    const cwd = freshCwd();
    writeFileSync(
      join(cwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { deepwiki: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' } } }),
    );
    const nodes: Node[] = [];
    applyConfigSideMcpNodes(nodes, provider('claude', [{ path: '.mcp.json', dialect: 'json-mcp-servers' }]), {
      cwd,
      roots: [cwd],
    });
    assert.equal(nodes.length, 1);
    const node = nodes[0]!;
    assert.equal(node.path, 'mcp://deepwiki');
    assert.equal(node.kind, 'mcp');
    assert.equal(node.virtual, true);
    assert.deepEqual(node.derivedFrom, ['.mcp.json']);
    assert.equal(node.frontmatter?.['transport'], 'http');
    assert.equal(node.frontmatter?.['url'], 'https://mcp.deepwiki.com/mcp');
    assert.equal(node.linksInCount, 0);
  });

  it('enriches an existing consumer-side node in place, preserving link counts', () => {
    const cwd = freshCwd();
    writeFileSync(
      join(cwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', 'srv'] } } }),
    );
    const existing = consumerNode('github');
    const nodes: Node[] = [existing];
    applyConfigSideMcpNodes(nodes, provider('claude', [{ path: '.mcp.json', dialect: 'json-mcp-servers' }]), {
      cwd,
      roots: [cwd],
    });
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0], existing, 'same node object, enriched in place');
    assert.equal(existing.linksInCount, 3, 'consumer-side link count preserved');
    assert.equal(existing.frontmatter?.['transport'], 'stdio');
    assert.equal(existing.frontmatter?.['command'], 'npx');
    // config source first, consumer-side source retained, deduped
    assert.deepEqual(existing.derivedFrom, ['.mcp.json', '.claude/skills/x/SKILL.md']);
  });

  it('reads the toml dialect', () => {
    const cwd = freshCwd();
    mkdirSync(join(cwd, '.codex'));
    writeFileSync(
      join(cwd, '.codex', 'config.toml'),
      '[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n',
    );
    const nodes: Node[] = [];
    applyConfigSideMcpNodes(nodes, provider('codex', [{ path: '.codex/config.toml', dialect: 'toml-mcp-servers' }]), {
      cwd,
      roots: [cwd],
    });
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0]!.path, 'mcp://context7');
    assert.equal(nodes[0]!.frontmatter?.['transport'], 'http');
  });

  it('is a no-op without a cwd', () => {
    const nodes: Node[] = [];
    applyConfigSideMcpNodes(nodes, provider('claude', [{ path: '.mcp.json', dialect: 'json-mcp-servers' }]), {
      roots: [],
    });
    assert.equal(nodes.length, 0);
  });

  it('is a no-op when the config file is missing', () => {
    const cwd = freshCwd();
    const nodes: Node[] = [];
    applyConfigSideMcpNodes(nodes, provider('claude', [{ path: '.mcp.json', dialect: 'json-mcp-servers' }]), {
      cwd,
      roots: [cwd],
    });
    assert.equal(nodes.length, 0);
  });

  it('is a no-op for a provider without mcpConfig', () => {
    const cwd = freshCwd();
    const nodes: Node[] = [];
    applyConfigSideMcpNodes(nodes, { id: 'markdown' } as unknown as IProvider, { cwd, roots: [cwd] });
    assert.equal(nodes.length, 0);
  });
});
