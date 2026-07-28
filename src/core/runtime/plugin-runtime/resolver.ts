/**
 * Layered enabled-resolver helpers, read the per-extension enable state
 * straight from the `settings.json` config layers, and expose the
 * per-extension checks every compose helper needs. The DB no longer
 * carries enable, it carries the orthogonal import-trust grant (the
 * `trustMap` below), surfaced alongside the resolver for the loader's
 * import-trust gate.
 *
 * The resolver layer is the single place that owns the
 * "is this id enabled right now?" question; the composer / catalogs /
 * registry-update paths consume it through the helpers below so the
 * toggle model (per-extension, no plugin kill-switch) stays consistent.
 */

import { loadTrust, type ITrustSkip } from '../../../kernel/config/plugin-trust-store.js';
import type {
  IBuiltInPlugin,
  TBuiltInExtension,
} from '../../../plugins/built-ins.js';
import { loadConfig } from '../../../kernel/config/loader.js';
import {
  installedDefaultEnabled,
  makeEnabledResolver,
  type TEnabledResolver,
} from '../../../kernel/config/plugin-resolver.js';
import { lockedBuiltInIds } from '../../../plugins/locked-built-ins.js';
import type { TExtensionStability } from '../../../kernel/extensions/base.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import { resolveDbPath } from '../../paths/db-path.js';
import { tryWithSqlite } from '../../sqlite/with-sqlite.js';
import type { IRuntimeContext } from '../runtime-context.js';

/**
 * Default-enabled fall-back used when no config / DB is available.
 * Honours the caller-supplied installed default so an `experimental`
 * extension stays OFF even on a bare project with zero overrides
 * (`installedDefault` is `false` for those, see `installedDefaultEnabled`).
 */
export function defaultResolveEnabled(_id: string, installedDefault = true): boolean {
  return installedDefault;
}

/**
 * Per-extension enabled filter for built-in plugins. Honours the spec
 * promise that "no extension is privileged", every built-in is
 * removable via the config layers (`settings.json` /
 * `settings.local.json`). The plugin row is a
 * presentational grouping only; the lookup key is always the qualified
 * extension id `<plugin.id>/<ext.id>`. The installed default comes from
 * the extension's `defaultEnabled` override when declared, else its
 * `stability` (experimental ships disabled).
 */
export function isBuiltInExtensionEnabled(
  plugin: IBuiltInPlugin,
  ext: TBuiltInExtension,
  resolveEnabled: TEnabledResolver,
): boolean {
  return isPluginEntryEnabled(plugin, ext.id, resolveEnabled, ext.stability, ext.defaultEnabled);
}

/**
 * Underlying primitive, works on the plain extension `id` rather than
 * a typed extension instance, so it can be reused from manifest-side
 * filters (`filterBuiltInManifests`) where the value is `IPluginManifest`,
 * not `TBuiltInExtension`. Same toggle semantics as
 * `isBuiltInExtensionEnabled`. `stability` drives the installed default
 * (experimental ships disabled); omit it for plugin-level callers that
 * want the plain enabled-by-default.
 */
export function isPluginEntryEnabled(
  plugin: IBuiltInPlugin,
  extId: string,
  resolveEnabled: TEnabledResolver,
  stability?: TExtensionStability,
  defaultEnabled?: boolean,
): boolean {
  return resolveEnabled(
    qualifiedExtensionId(plugin.id, extId),
    installedDefaultEnabled(stability, defaultEnabled),
  );
}

/**
 * Decide whether a loaded user-plugin extension is enabled under a
 * (possibly fresh) resolver. The lookup key is the qualified extension
 * id `<pluginId>/<extId>`, mirroring `isPluginEntryEnabled` for
 * built-ins. There is no plugin-level kill-switch anymore. The
 * extension's `stability` (when carried) drives the installed default.
 */
export function isPluginExtensionEnabled(
  ext: { pluginId: string; id: string; stability?: TExtensionStability; defaultEnabled?: boolean },
  resolveEnabled: TEnabledResolver,
): boolean {
  return resolveEnabled(
    qualifiedExtensionId(ext.pluginId, ext.id),
    installedDefaultEnabled(ext.stability, ext.defaultEnabled),
  );
}

/**
 * Layered resolver inputs read once from config + DB: the (config-only)
 * enabled resolver AND the orthogonal import-trust input (the DB trust
 * map keyed by bare plugin id) that backs the import-trust gate. Bundled
 * so `loadPluginRuntime` builds everything from a single DB read.
 */
export interface IResolverInputs {
  resolveEnabled: TEnabledResolver;
  /**
   * VERIFIED trust: bare plugin ids whose scope-lock grant was minted on
   * this machine, in this checkout. Only these may have their code
   * imported. Formerly raw DB rows, which a hostile
   * repo could ship pre-set (audit C1).
   */
  trustMap: Map<string, boolean>;
  /**
   * Records that exist but were NOT honoured, with why. Surfaced so the
   * operator learns their plugin did not load and what to do about it;
   * a security control that fails silently is indistinguishable from a
   * broken one.
   */
  trustSkipped: readonly ITrustSkip[];
}

/**
 * Read config + the DB trust map once and return the config-only enabled
 * resolver plus the import-trust input (`trustMap`) the gate consumes
 * (`makeTrustResolver`).
 */
export async function buildResolverInputs(
  ctx: IRuntimeContext,
): Promise<IResolverInputs> {
  const { effective: cfg } = loadConfig({ ...ctx });
  // Trust comes from the scope lock, not the DB: it is keyed to the
  // checkout rather than to a database file, so it neither dies with a
  // schema-drift rebuild nor follows a `--db` override to a file the
  // import gate never reads. No DB open is needed here at all.
  const { trusted, skipped } = loadTrust(ctx.cwd);
  return {
    resolveEnabled: makeEnabledResolver(cfg, lockedBuiltInIds()),
    trustMap: new Map([...trusted].map((id) => [id, true])),
    trustSkipped: skipped,
  };
}

/**
 * Build the layered settings.json enabled-resolver. Mirrors the shape of
 * `buildResolver` in `src/cli/commands/plugins/shared.ts` to keep the
 * resolution policy in lock-step. Any divergence between
 * `sm plugins list` and the runtime would be a confusing UX regression.
 */
export async function buildEnabledResolver(
  ctx: IRuntimeContext,
): Promise<TEnabledResolver> {
  return (await buildResolverInputs(ctx)).resolveEnabled;
}
