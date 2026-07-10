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
 * so the `core/reference-broken` analyzer surfaces the dangling reference as
 * a warning (sabor A of the migration plan: undeclared MCP refs are
 * broken-refs). Once the per-provider config readers ship (Phase 5b),
 * MCP nodes get emitted from BOTH the config (canonical declaration)
 * and the per-usage frontmatter, and the orchestrator's first-wins
 * dedup keeps the config-side as the authoritative one.
 */

import type {
  IBuiltInManifest,
  IExtractor,
  IExtractorContext,
} from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';
import { MCP_NODE_KIND, mcpNodePath, parseMcpToolName } from '../../../../kernel/util/mcp.js';

const ID = 'mcp-tools';

export const mcpToolsExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Turns `tools: [mcp__<server>__<tool>]` entries in a node\'s frontmatter into an MCP node per unique server and an arrow from the source to each one. Example: `tools: [mcp__github__create_pr]` adds an `mcp://github` node and an arrow to it.',
  // Reads the universal `mcp__<server>__<tool>` frontmatter identifier
  // (the same string every vendor uses). Promoted to beta now that
  // config-side discovery (the `mcpConfig` capability) and live
  // invocation (claude + codex) have landed, so it ships ENABLED by
  // default, MCP declarations show on the map out of the box.
  stability: 'beta',
  scope: 'frontmatter',

  extract(ctx: IExtractorContext): void {
    const raw = ctx.frontmatter['tools'];
    if (!Array.isArray(raw)) return;
    const serverHits = collectMcpServers(raw);
    if (serverHits.size === 0) return;
    for (const [server, indices] of serverHits) {
      const mcpPath = mcpNodePath(server);
      ctx.emitNode({
        path: mcpPath,
        kind: MCP_NODE_KIND,
        virtual: true,
        provider: ctx.node.provider,
        derivedFrom: [ctx.node.path],
        frontmatter: { name: server },
      });
      // Use the first frontmatter index where this server appeared as
      // the Signal's `fieldPath` anchor. Subsequent occurrences are
      // collapsed by the extractor's own dedup (same MCP server, same
      // source -> one edge), the path identifies WHERE in the tools
      // array the canonical declaration sits.
      ctx.emitSignal({
        source: ctx.node.path,
        scope: 'frontmatter',
        fieldPath: ['tools', String(indices[0]!)],
        raw: `mcp__${server}__*`,
        candidates: [
          {
            extractorId: ID,
            kind: 'references',
            target: mcpPath,
            confidence: 0.85,
            rationale: 'tools[] entry matches mcp__<server>__<tool> pattern',
            trigger: {
              originalTrigger: `mcp__${server}__*`,
              normalizedTrigger: mcpPath,
            },
          },
        ],
      });
    }
  },
};

function collectMcpServers(tools: readonly unknown[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (let i = 0; i < tools.length; i += 1) {
    const t = tools[i];
    if (typeof t !== 'string' || t.length === 0) continue;
    const parsed = parseMcpToolName(t);
    if (!parsed) continue;
    const server = parsed.server;
    const indices = out.get(server) ?? [];
    indices.push(i);
    out.set(server, indices);
  }
  return out;
}
