/**
 * Config-side MCP discovery (the `mcpConfig` Provider capability, spec
 * `architecture.md` §Provider · MCP config discovery). A POST-WALK step: it
 * runs over the node set the walk already produced, so it never touches the
 * per-node extraction loop or its accumulator.
 *
 * For the active Provider's declared `mcpConfig` sources, it reads each config
 * file, parses its declared MCP servers (shared `kernel/util/mcp-config`), and
 * reconciles them into the node set:
 *
 *   - a server already present as a consumer-side `mcp://` node (emitted by
 *     `core/mcp-tools` from a `tools:` reference) is ENRICHED in place: the
 *     config metadata is overlaid onto its frontmatter and the config file
 *     joins its `derivedFrom` (config-side is canonical, but the consumer-side
 *     link counts are preserved);
 *   - a server declared but unreferenced is APPENDED as a fresh orphan node
 *     (state "declared + unused").
 *
 * Best-effort and never throws: no `cwd`, a Provider without `mcpConfig`, or a
 * missing / unreadable / malformed config file is a silent no-op. A hand-edited
 * `settings.json` with a trailing comma must not abort the scan.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { IProvider, IProviderMcpConfigSource } from '../extensions/provider.js';
import type { Node } from '../types.js';
import { MCP_NODE_KIND, mcpNodePath, type IMcpServerDescriptor } from '../util/mcp.js';
import { parseMcpServerConfig } from '../util/mcp-config.js';

const VIRTUAL_NODE_PLACEHOLDER_HASH = '0'.repeat(64);

/** Mutates `nodes` in place with the active Provider's config-side MCP servers. */
export function applyConfigSideMcpNodes(
  nodes: Node[],
  activeProvider: IProvider | null,
  opts: { cwd?: string; roots: readonly string[] },
): void {
  const ctx = configContext(activeProvider, opts.cwd);
  if (!ctx) return;
  const byPath = new Map<string, Node>();
  for (const node of nodes) byPath.set(node.path, node);
  for (const source of ctx.sources) processSource(nodes, byPath, ctx, source);
}

interface IConfigContext {
  readonly cwd: string;
  readonly providerId: string;
  readonly sources: readonly IProviderMcpConfigSource[];
}

function configContext(
  activeProvider: IProvider | null,
  cwd: string | undefined,
): IConfigContext | null {
  const sources = activeProvider?.mcpConfig?.sources;
  if (!cwd || !activeProvider || !sources || sources.length === 0) return null;
  return { cwd, providerId: activeProvider.id, sources };
}

function processSource(
  nodes: Node[],
  byPath: Map<string, Node>,
  ctx: IConfigContext,
  source: IProviderMcpConfigSource,
): void {
  const content = readConfig(resolve(ctx.cwd, source.path));
  if (content === null) return;
  for (const descriptor of parseMcpServerConfig(content, source.dialect)) {
    reconcile(nodes, byPath, descriptor, ctx.providerId, source.path);
  }
}

function readConfig(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function reconcile(
  nodes: Node[],
  byPath: Map<string, Node>,
  descriptor: IMcpServerDescriptor,
  providerId: string,
  sourcePath: string,
): void {
  const path = mcpNodePath(descriptor.server);
  const frontmatter = descriptorFrontmatter(descriptor);
  const existing = byPath.get(path);
  if (existing) {
    existing.frontmatter = { ...(existing.frontmatter ?? {}), ...frontmatter };
    existing.derivedFrom = mergeDerivedFrom(existing.derivedFrom, sourcePath);
    existing.virtual = true;
    return;
  }
  const node = buildConfigMcpNode(path, providerId, sourcePath, frontmatter);
  nodes.push(node);
  byPath.set(path, node);
}

function buildConfigMcpNode(
  path: string,
  providerId: string,
  sourcePath: string,
  frontmatter: Record<string, unknown>,
): Node {
  return {
    path,
    kind: MCP_NODE_KIND,
    provider: providerId,
    bodyHash: VIRTUAL_NODE_PLACEHOLDER_HASH,
    frontmatterHash: VIRTUAL_NODE_PLACEHOLDER_HASH,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    virtual: true,
    derivedFrom: [sourcePath],
    frontmatter,
  };
}

/** Project the descriptor's declared fields onto the virtual node's synthesized frontmatter. */
function descriptorFrontmatter(d: IMcpServerDescriptor): Record<string, unknown> {
  const fm: Record<string, unknown> = { name: d.server };
  if (d.transport) fm['transport'] = d.transport;
  if (d.command) fm['command'] = d.command;
  if (d.args) fm['args'] = d.args;
  if (d.env) fm['env'] = d.env;
  if (d.url) fm['url'] = d.url;
  if (d.toolsProvided) fm['toolsProvided'] = d.toolsProvided;
  return fm;
}

/** Union the config file into an existing node's `derivedFrom`, config source first, deduped. */
function mergeDerivedFrom(existing: readonly string[] | undefined, sourcePath: string): string[] {
  return [...new Set<string>([sourcePath, ...(existing ?? [])])];
}
