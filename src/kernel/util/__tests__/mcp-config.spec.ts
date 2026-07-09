/**
 * Coverage for `kernel/util/mcp-config`, the config-side dialect parsers. The
 * contracts that matter to the `mcpConfig` capability reader:
 *
 *   - both dialects (JSON `mcpServers`, TOML `mcp_servers`) normalise to the
 *     same `IMcpServerDescriptor` shape, with transport inferred when not
 *     explicit (url → http, command → stdio);
 *   - server names collapse by `mcpServerId` (casing-insensitive identity);
 *   - the parser is TOLERANT: malformed input, a missing server map, or a junk
 *     entry yields fewer descriptors, never a throw (a scan cannot abort on a
 *     hand-edited config).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseMcpServerConfig } from '../mcp-config.js';

describe('kernel/util/mcp-config', () => {
  describe('json-mcp-servers', () => {
    it('parses a stdio server with command/args/env', () => {
      const content = JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_TOKEN: 'x' },
          },
        },
      });
      assert.deepEqual(parseMcpServerConfig(content, 'json-mcp-servers'), [
        {
          server: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'x' },
        },
      ]);
    });

    it('parses a remote http server (explicit type)', () => {
      const content = JSON.stringify({
        mcpServers: { deepwiki: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' } },
      });
      assert.deepEqual(parseMcpServerConfig(content, 'json-mcp-servers'), [
        { server: 'deepwiki', transport: 'http', url: 'https://mcp.deepwiki.com/mcp' },
      ]);
    });

    it('infers http transport from a bare url (no type)', () => {
      const content = JSON.stringify({
        mcpServers: { context7: { url: 'https://mcp.context7.com/mcp' } },
      });
      assert.deepEqual(parseMcpServerConfig(content, 'json-mcp-servers'), [
        { server: 'context7', transport: 'http', url: 'https://mcp.context7.com/mcp' },
      ]);
    });

    it('lowercases the server name for identity', () => {
      const content = JSON.stringify({ mcpServers: { GitHub: { command: 'x' } } });
      assert.equal(parseMcpServerConfig(content, 'json-mcp-servers')[0]!.server, 'github');
    });

    it('carries declared tools from tools / tools_provided', () => {
      const content = JSON.stringify({
        mcpServers: { img: { url: 'https://x/mcp', tools: ['search', 'fetch'] } },
      });
      assert.deepEqual(parseMcpServerConfig(content, 'json-mcp-servers')[0]!.toolsProvided, [
        'search',
        'fetch',
      ]);
    });

    it('returns a name-only descriptor when the entry is not an object', () => {
      const content = JSON.stringify({ mcpServers: { weird: 'nope' } });
      assert.deepEqual(parseMcpServerConfig(content, 'json-mcp-servers'), [{ server: 'weird' }]);
    });

    it('dedupes entries that collapse to the same id', () => {
      const content = JSON.stringify({
        mcpServers: { github: { command: 'a' }, GitHub: { command: 'b' } },
      });
      const out = parseMcpServerConfig(content, 'json-mcp-servers');
      assert.equal(out.length, 1);
      assert.equal(out[0]!.server, 'github');
    });
  });

  describe('toml-mcp-servers', () => {
    it('parses a stdio server table with args and env', () => {
      const content = [
        '[mcp_servers.github]',
        'command = "npx"',
        'args = ["-y", "@modelcontextprotocol/server-github"]',
        '',
        '[mcp_servers.github.env]',
        'GITHUB_TOKEN = "x"',
      ].join('\n');
      assert.deepEqual(parseMcpServerConfig(content, 'toml-mcp-servers'), [
        {
          server: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'x' },
        },
      ]);
    });

    it('parses a remote server from a url key', () => {
      const content = '[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n';
      assert.deepEqual(parseMcpServerConfig(content, 'toml-mcp-servers'), [
        { server: 'context7', transport: 'http', url: 'https://mcp.context7.com/mcp' },
      ]);
    });
  });

  describe('tolerance', () => {
    it('returns [] for malformed JSON', () => {
      assert.deepEqual(parseMcpServerConfig('{ not json', 'json-mcp-servers'), []);
    });

    it('returns [] for malformed TOML', () => {
      assert.deepEqual(parseMcpServerConfig('[[[bad', 'toml-mcp-servers'), []);
    });

    it('returns [] when there is no server map', () => {
      assert.deepEqual(parseMcpServerConfig(JSON.stringify({ other: 1 }), 'json-mcp-servers'), []);
    });

    it('returns [] for an empty string', () => {
      assert.deepEqual(parseMcpServerConfig('', 'json-mcp-servers'), []);
    });

    it('tolerates the alternate top-level key regardless of dialect', () => {
      const content = JSON.stringify({ mcp_servers: { x: { url: 'https://x/mcp' } } });
      assert.equal(parseMcpServerConfig(content, 'json-mcp-servers')[0]!.server, 'x');
    });
  });
});
