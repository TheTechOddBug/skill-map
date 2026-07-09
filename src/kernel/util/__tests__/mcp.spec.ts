/**
 * Coverage for `kernel/util/mcp`, the shared MCP primitives. The contracts
 * that matter to callers:
 *
 *   - `parseMcpToolName` recognises exactly `mcp__<server>__<tool>`, captures a
 *     normalised server + verbatim tool, and returns null for everything else
 *     (plain tools, single-underscore variants, junk). This is the identity
 *     bridge between the static extractor, config discovery, and live activity,
 *     so a drift here silently splits one server into two nodes.
 *   - `mcpServerId` / `mcpNodePath` are the single source of the `mcp://<id>`
 *     node identity; the consumer side and the config side MUST land on the
 *     same path regardless of author casing.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MCP_NODE_KIND,
  MCP_TOOL_RE,
  mcpServerId,
  mcpNodePath,
  parseMcpToolName,
} from '../mcp.js';

describe('kernel/util/mcp', () => {
  describe('parseMcpToolName', () => {
    it('parses a well-formed tool name into server + tool', () => {
      assert.deepEqual(parseMcpToolName('mcp__github__create_pr'), {
        server: 'github',
        tool: 'create_pr',
      });
    });

    it('lowercases the server but keeps the tool verbatim', () => {
      assert.deepEqual(parseMcpToolName('mcp__GitHub__createPR'), {
        server: 'github',
        tool: 'createPR',
      });
    });

    it('accepts hyphens and digits in both segments', () => {
      assert.deepEqual(parseMcpToolName('mcp__image-search2__find-art'), {
        server: 'image-search2',
        tool: 'find-art',
      });
    });

    it('returns null for a plain (non-MCP) tool', () => {
      assert.equal(parseMcpToolName('Read'), null);
      assert.equal(parseMcpToolName('Write'), null);
    });

    it('returns null for a single-underscore vendor variant (server delimiter missing)', () => {
      assert.equal(parseMcpToolName('mcp_github_create'), null);
    });

    it('returns null when the server or tool segment is empty', () => {
      assert.equal(parseMcpToolName('mcp____tool'), null);
      assert.equal(parseMcpToolName('mcp__server__'), null);
      assert.equal(parseMcpToolName('mcp__server'), null);
    });

    it('returns null for a server segment that does not start alphanumeric', () => {
      assert.equal(parseMcpToolName('mcp__-bad__tool'), null);
    });

    it('returns null for empty / non-string input', () => {
      assert.equal(parseMcpToolName(''), null);
      assert.equal(parseMcpToolName(undefined as unknown as string), null);
      assert.equal(parseMcpToolName(null as unknown as string), null);
    });

    it('does not match a tool name with trailing garbage', () => {
      assert.equal(parseMcpToolName('mcp__github__create_pr extra'), null);
      assert.equal(parseMcpToolName('prefix mcp__github__create_pr'), null);
    });
  });

  describe('mcpServerId', () => {
    it('trims and lowercases', () => {
      assert.equal(mcpServerId('  GitHub '), 'github');
      assert.equal(mcpServerId('images'), 'images');
    });
  });

  describe('mcpNodePath', () => {
    it('builds the mcp:// scheme from a normalised id', () => {
      assert.equal(mcpNodePath('images'), 'mcp://images');
    });

    it('normalises casing so both sides collapse onto one path', () => {
      assert.equal(mcpNodePath('GitHub'), mcpNodePath('github'));
      assert.equal(mcpNodePath('GitHub'), 'mcp://github');
    });
  });

  it('exposes a stable node kind and a shared regex', () => {
    assert.equal(MCP_NODE_KIND, 'mcp');
    assert.ok(MCP_TOOL_RE.test('mcp__x__y'));
  });
});
