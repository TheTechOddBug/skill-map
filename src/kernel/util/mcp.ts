/**
 * Shared Model Context Protocol (MCP) primitives. Single source of truth for
 * the `mcp__<server>__<tool>` tool-name grammar, the `mcp://<server>` virtual
 * node identity, and the canonical parsed-server descriptor. Vendor-neutral by
 * design (mirrors `kernel/util/at-token.ts`): every MCP consumer reuses these
 * instead of carrying its own copy.
 *
 * Consumers:
 *   - `core/mcp-tools` (consumer side): reads `frontmatter.tools`, matches the
 *     tool-name grammar, emits an `mcp://<server>` virtual node + `references`
 *     link. Knows only the server NAME.
 *   - config-side discovery (the `mcpConfig` Provider capability, spec
 *     `architecture.md` §Provider · MCP config discovery): parses a vendor
 *     config file into `IMcpServerDescriptor[]` and emits the same node with
 *     richer metadata. The DIALECT parsers live here so a new vendor reuses a
 *     grammar instead of reimplementing one.
 *   - live invocation (the `activity` capability): a provider's `mapEvent`
 *     feeds a runtime tool name through `parseMcpToolName` to light the same
 *     `mcp://<server>` node the static side drew.
 *   - the read-only MCP server (`spec/mcp-server.md`) is a producer and does
 *     not use these; it exposes the graph, it does not classify MCP usage.
 */

/** The `Node.kind` every MCP server node carries. Open-string, not in the built-in `NodeKind` alias. */
export const MCP_NODE_KIND = 'mcp';

/** How a host reaches an MCP server. `stdio` = local subprocess; `http` = remote Streamable HTTP. */
export type McpTransport = 'stdio' | 'http';

/**
 * Canonical parsed shape of one declared MCP server. Only `server` is always
 * known: the consumer side (a `mcp__<server>__<tool>` reference) yields just the
 * id, while the config side fills in transport + launch / endpoint details.
 */
export interface IMcpServerDescriptor {
  /** Server id (the `<server>` segment), already normalised via `mcpServerId`. The node identity. */
  readonly server: string;
  /** Transport, when the config declares enough to tell. Absent on a name-only (consumer-side) descriptor. */
  readonly transport?: McpTransport;
  /** stdio: launch command. */
  readonly command?: string;
  /** stdio: launch arguments. */
  readonly args?: readonly string[];
  /** stdio: environment overrides. */
  readonly env?: Readonly<Record<string, string>>;
  /** http: remote endpoint URL. */
  readonly url?: string;
  /** Tools the server declares it provides, when the config lists them. */
  readonly toolsProvided?: readonly string[];
}

/**
 * Canonical server id: trimmed and lowercased. The `mcp://<id>` node identity
 * derives from this, so the consumer side (`mcp__GitHub__x`) and the config
 * side (a `GitHub` config key) collapse onto one node.
 */
export function mcpServerId(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The synthetic `path` of an MCP server node. The ONLY place the scheme is built. */
export function mcpNodePath(server: string): string {
  return `mcp://${mcpServerId(server)}`;
}

/**
 * Tool-name grammar (Claude convention, adopted by vendors that reuse the open
 * SKILL frontmatter): `mcp__<server>__<tool>`. Case-insensitive; the server is
 * captured for identity, the tool for the live-invocation surface.
 */
export const MCP_TOOL_RE = /^mcp__([a-z0-9][a-z0-9_-]*)__([a-z0-9_-]+)$/i;

/**
 * Parse a tool name against the MCP grammar. Returns `{ server, tool }` (server
 * normalised via `mcpServerId`, tool verbatim) or `null` for a non-MCP tool
 * (`Read`, `Write`, a single-underscore vendor variant, etc.). Deterministic,
 * no side effects.
 */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (typeof name !== 'string' || name.length === 0) return null;
  const m = MCP_TOOL_RE.exec(name);
  if (!m) return null;
  return { server: mcpServerId(m[1]!), tool: m[2]! };
}
