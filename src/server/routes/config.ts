/**
 * `GET /api/config`, merged effective config (defaults → user → user-local
 * → project → project-local → override), plus its provenance sibling
 * `GET /api/config/resolution` (`spec/cli-contract.md` §Serve route
 * table), the settings-hierarchy viewer's data: the effective config
 * flattened to one row per LEAF key with the layer that last wrote it
 * (the loader's `sources` map, computed anyway on every load) and
 * server-side masking for plugin-extension settings declared
 * `type: 'secret'` (their values never reach the wire in clear).
 *
 * Wraps `loadConfig` from `kernel/config/loader.ts`. Returns the
 * `effective` object inside an `IValueEnvelope` so the SPA gets a
 * stable `{ schemaVersion, kind, value }` shape.
 *
 * Warnings emitted by the layered loader (malformed JSON, schema
 * violations) are forwarded to `process.stderr`, they do NOT reach the
 * client response. Read parity with `sm config list`: warnings are
 * informational at the operator level, not user-facing on every request.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import type { ILoadedConfig, TConfigLayer } from '../../kernel/config/loader.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { builtIns } from '../../plugins/built-ins.js';
import { buildValueEnvelope } from '../envelope.js';
import type { IRouteDeps } from './deps.js';

/** One viewer row: a leaf key, its resolved value, and the winning layer. */
export interface IConfigResolutionRow {
  key: string;
  value: unknown;
  layer: TConfigLayer;
  /** True when the value was masked (a `secret`-typed plugin setting). */
  secret: boolean;
}

/** Wire replacement for a masked secret value. */
const MASKED = '••••••';

export function registerConfigRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/config', (c) => {
    const loaded = loadOr500(deps);
    return c.json(
      buildValueEnvelope(
        'config',
        loaded.effective,
        deps.kindRegistry,
        deps.providerRegistry,
        deps.contributionsRegistry,
      ),
    );
  });

  app.get('/api/config/resolution', (c) => {
    const loaded = loadOr500(deps);
    const secretPaths = collectSecretSettingPaths(deps);
    const rows = flattenLeafRows(loaded, secretPaths);
    return c.json(
      buildValueEnvelope(
        'config.resolution',
        { rows },
        deps.kindRegistry,
        deps.providerRegistry,
        deps.contributionsRegistry,
      ),
    );
  });
}

/** Shared cached read + warn forwarding + strict-throw mapping. */
function loadOr500(deps: IRouteDeps): ILoadedConfig {
  let loaded: ILoadedConfig;
  try {
    // Cached layered-config view, no per-request `loadConfig`
    // walk. Mutating routes invalidate the cache via
    // `configService.reload()` so the next read sees the new state.
    loaded = deps.configService.get();
  } catch (err) {
    // `--strict` mode would throw; the BFF never enables strict so this
    // path normally never trips. If it does (config FS read failed
    // hard), surface it as `internal` so the SPA shows a generic
    // failure instead of silently rendering empty defaults.
    throw new HTTPException(500, { message: formatErrorMessage(err) });
  }
  for (const warn of loaded.warnings) {
    log.warn(sanitizeForTerminal(warn));
  }
  return loaded;
}

/**
 * Flatten the effective config to leaf rows. A leaf is anything that is
 * not a plain object (scalars, `null`, arrays); the dot-path is the
 * viewer's row key. The winning layer resolves via the loader's
 * `sources` map with ancestor fallback (the loader records provenance at
 * the granularity it merged, which may be a parent group), defaulting to
 * `defaults` (an untouched key was never overwritten).
 */
function flattenLeafRows(
  loaded: ILoadedConfig,
  secretPaths: ReadonlySet<string>,
): IConfigResolutionRow[] {
  const rows: IConfigResolutionRow[] = [];
  const walk = (value: unknown, path: string): void => {
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path === '' ? key : `${path}.${key}`);
      }
      return;
    }
    const secret = secretPaths.has(path);
    rows.push({ key: path, value: secret ? MASKED : value, layer: layerFor(loaded, path), secret });
  };
  walk(loaded.effective, '');
  return rows;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exact provenance hit, else nearest recorded ancestor, else `defaults`. */
function layerFor(loaded: ILoadedConfig, path: string): TConfigLayer {
  let probe = path;
  for (;;) {
    const hit = loaded.sources.get(probe);
    if (hit !== undefined) return hit;
    const cut = probe.lastIndexOf('.');
    if (cut === -1) return 'defaults';
    probe = probe.slice(0, cut);
  }
}

/**
 * Dot-paths of every plugin-extension setting declared `type: 'secret'`
 * (`plugins.<pluginId>.extensions.<extId>.settings.<name>`), across the
 * BUILT-IN catalog and the boot-cached drop-in runtime. Masking is
 * declaration-driven, never a key-name heuristic.
 */
function collectSecretSettingPaths(deps: IRouteDeps): Set<string> {
  const paths = new Set<string>();
  const buckets = [
    ...Object.values(builtIns()).flat(),
    ...Object.values(deps.pluginRuntime.extensions).flat(),
  ] as ReadonlyArray<{
    pluginId: string;
    id: string;
    settings?: Record<string, { type?: string }>;
  }>;
  for (const ext of buckets) {
    for (const [name, decl] of Object.entries(ext.settings ?? {})) {
      if (decl.type === 'secret') {
        paths.add(`plugins.${ext.pluginId}.extensions.${ext.id}.settings.${name}`);
      }
    }
  }
  return paths;
}
