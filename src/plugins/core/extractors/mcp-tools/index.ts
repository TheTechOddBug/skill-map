/**
 * MCP-tools extractor. Reads `frontmatter.tools` on agent / skill /
 * command nodes (Claude Code declares the field as `string[]`; other
 * vendors that adopt the open-standard SKILL frontmatter do the
 * same) and surfaces every Model Context Protocol (MCP) server
 * referenced through it as:
 *
 *   1. A virtual `Node` with `path: 'mcp://<server>'`,
 *      `kind: 'mcp'`, `virtual: true`, `derivedFrom: [<source path>]`.
 *      Deduplicated by the orchestrator across emissions so N nodes
 *      referencing the same server materialise one MCP node.
 *   2. A `references` link from the source node to that virtual MCP
 *      node, marking the usage as a first-class edge in the graph.
 *
 * Pattern recognised: `mcp__<server>__<tool>` (Claude convention).
 * Vendor-specific flavours that diverge (single-underscore variants,
 * etc.) fall through unchanged; the per-vendor extractor (when it
 * lands) will recognise its own shape. Non-matching entries are
 * ignored.
 *
 * `references` kind is the closest semantic fit in the spec's closed
 * link.kind enum (the source skill / agent *references* the MCP
 * server it uses). Confidence is 0.85: the pattern match is strong
 * but the runtime can still reject the tool at invocation time if the
 * server is unhealthy / misconfigured.
 *
 * When the referenced MCP server is not declared in any provider's
 * config (`settings.json` / `.cursor/mcp.json` / `~/.codex/config.toml`),
 * the orchestrator emits no extra virtual node from the config side,
 * so the `core/broken-ref` analyzer surfaces the dangling reference as
 * a warning (sabor A of the migration plan: undeclared MCP refs are
 * broken-refs). Once the per-provider config readers ship (Phase 5b),
 * MCP nodes get emitted from BOTH the config (canonical declaration)
 * and the per-usage frontmatter, and the orchestrator's first-wins
 * dedup keeps the config-side as the authoritative one.
 */

import type {
  IExtractor,
  IExtractorContext,
} from '../../../../kernel/extensions/index.js';

const ID = 'mcp-tools';

/** Claude convention. Captures `<server>`; the tool name segment is unused. */
const MCP_PATTERN = /^mcp__([a-z0-9][a-z0-9_-]*)__[a-z0-9_-]+$/i;

export const mcpToolsExtractor: IExtractor = {
  id: ID,
  pluginId: 'core',
  kind: 'extractor',
  version: '1.0.0',
  description:
    'Detects `tools: [mcp__<server>__<tool>]` entries in a node\'s frontmatter and turns each unique server into an MCP node + a reference edge from the source.',
  scope: 'frontmatter',

  extract(ctx: IExtractorContext): void {
    const raw = ctx.frontmatter['tools'];
    if (!Array.isArray(raw)) return;
    const servers = collectMcpServers(raw);
    if (servers.size === 0) return;
    for (const server of servers) {
      const mcpPath = `mcp://${server}`;
      ctx.emitNode({
        path: mcpPath,
        kind: 'mcp',
        virtual: true,
        provider: ctx.node.provider,
        derivedFrom: [ctx.node.path],
        frontmatter: { name: server },
      });
      ctx.emitLink({
        source: ctx.node.path,
        target: mcpPath,
        kind: 'references',
        confidence: 0.85,
        sources: [ID],
        trigger: {
          originalTrigger: `mcp__${server}__*`,
          normalizedTrigger: mcpPath,
        },
      });
    }
  },
};

function collectMcpServers(tools: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const t of tools) {
    if (typeof t !== 'string' || t.length === 0) continue;
    const match = MCP_PATTERN.exec(t);
    if (!match) continue;
    out.add(match[1]!.toLowerCase());
  }
  return out;
}
