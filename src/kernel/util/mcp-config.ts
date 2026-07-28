/**
 * Config-side MCP dialect parsers. Turns a vendor's raw MCP config file into
 * canonical `IMcpServerDescriptor[]`, so the config-side discovery (the
 * `mcpConfig` Provider capability, `spec/architecture.md` §Provider · MCP config
 * discovery) never reimplements a grammar: a Provider declares WHERE its config
 * lives and in which dialect, the kernel reads the file and calls this.
 *
 * Kept out of the dependency-free `mcp.ts` (identity primitives) because these
 * pull the TOML parser. Both files together are the `kernel/util/mcp` family the
 * spec names as the single owner of every MCP grammar.
 *
 * Tolerant by contract: a malformed file, a missing server map, or a junk entry
 * yields fewer descriptors (or none), never a throw. A scan must not abort
 * because a hand-edited `settings.json` has a trailing comma.
 */

import { parse as parseToml } from 'smol-toml';

import { stripPrototypePollution } from './strip-prototype-pollution.js';
import { type IMcpServerDescriptor, type TMcpTransport, mcpServerId } from './mcp.js';

/**
 * The closed set of MCP config grammars the kernel knows. Each wraps a
 * `{ <serverName>: <serverConfig> }` map; they differ only in file format, so
 * the reader tolerates any conventional top-level key regardless of dialect
 * (`mcpServers` for Claude, `mcp_servers` for Codex TOML, `mcp` for OpenCode's
 * `opencode.json`). The per-server value shape is likewise unified: an OpenCode
 * `{ type: "remote" | "local", url, enabled }` entry reads through the same
 * `type` / `url` path a Claude `{ type: "http", url }` entry does.
 */
export type TMcpConfigDialect = 'json-mcp-servers' | 'toml-mcp-servers';

/** Parse one vendor MCP config file's raw content into descriptors. Never throws. */
export function parseMcpServerConfig(
  content: string,
  dialect: TMcpConfigDialect,
): IMcpServerDescriptor[] {
  const root = parseRoot(content, dialect);
  if (!root) return [];
  const map = pickServerMap(root);
  if (!map) return [];
  const out: IMcpServerDescriptor[] = [];
  const seen = new Set<string>();
  for (const [name, raw] of Object.entries(map)) {
    const descriptor = normaliseServer(name, raw);
    if (!descriptor || seen.has(descriptor.server)) continue;
    seen.add(descriptor.server);
    out.push(descriptor);
  }
  return out;
}

function parseRoot(content: string, dialect: TMcpConfigDialect): Record<string, unknown> | null {
  try {
    const doc: unknown = dialect === 'toml-mcp-servers' ? parseToml(content) : JSON.parse(content);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    return stripPrototypePollution(doc as Record<string, unknown>);
  } catch {
    return null;
  }
}

function pickServerMap(root: Record<string, unknown>): Record<string, unknown> | null {
  // `mcp` is OpenCode's key in `opencode.json` (a full config file whose other
  // top-level keys, `models` / `agent` / ..., are ignored here).
  const candidate = root['mcpServers'] ?? root['mcp_servers'] ?? root['mcp'];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  return candidate as Record<string, unknown>;
}

/** Mutable twin of the descriptor, assembled field-by-field before freezing into the readonly shape. */
type MutableDescriptor = { -readonly [K in keyof IMcpServerDescriptor]: IMcpServerDescriptor[K] };

function normaliseServer(name: string, raw: unknown): IMcpServerDescriptor | null {
  const server = mcpServerId(name);
  if (!server) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { server };
  const r = raw as Record<string, unknown>;
  // OpenCode's `enabled: false` disables a server, so it materialises no node.
  if (r['enabled'] === false) return null;
  return buildDescriptor(server, r);
}

function buildDescriptor(server: string, r: Record<string, unknown>): IMcpServerDescriptor {
  const url = nonEmptyString(r['url']);
  const command = nonEmptyString(r['command']);
  const args = nonEmptyArray(stringArray(r['args']));
  const env = stringRecord(r['env']);
  const tools = nonEmptyArray(extractTools(r));
  const transport = resolveTransport(r['type'], url, command);
  const d: MutableDescriptor = { server };
  if (transport) d.transport = transport;
  if (command) d.command = command;
  if (args) d.args = args;
  if (env) d.env = env;
  if (url) d.url = url;
  if (tools) d.toolsProvided = tools;
  return d;
}

/** Declared tools under any of the config's spellings (`tools`, `tools_provided`, `toolsProvided`). */
function extractTools(r: Record<string, unknown>): string[] | undefined {
  return (
    stringArray(r['tools']) ?? stringArray(r['tools_provided']) ?? stringArray(r['toolsProvided'])
  );
}

// Per-server `type` spellings each vendor uses, grouped by transport. OpenCode
// names them `local` / `remote`; Claude / Codex use `stdio` / `http` (+ the
// remote-http flavours). Kept as Sets so `resolveTransport` stays flat.
const STDIO_TYPES = new Set(['stdio', 'local']);
const HTTP_TYPES = new Set(['http', 'streamable-http', 'sse', 'remote']);

/**
 * Resolve the transport: an explicit `type` wins (MCP's remote flavours all map
 * to `http`), else a `url` implies `http` and a `command` implies `stdio`. When
 * nothing is declared the transport stays absent (a name-only descriptor).
 */
function resolveTransport(
  type: unknown,
  url: string | undefined,
  command: string | undefined,
): TMcpTransport | undefined {
  if (typeof type === 'string') {
    const t = type.toLowerCase();
    if (STDIO_TYPES.has(t)) return 'stdio';
    if (HTTP_TYPES.has(t)) return 'http';
  }
  if (url) return 'http';
  if (command) return 'stdio';
  return undefined;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((e): e is string => typeof e === 'string');
}

function nonEmptyArray(a: string[] | undefined): string[] | undefined {
  return a && a.length > 0 ? a : undefined;
}

function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
