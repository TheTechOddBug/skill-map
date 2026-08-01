/**
 * Shared helpers across the `sm plugins …` verb family.
 *
 * Originally inline in `cli/commands/plugins.ts`; extracted as part of
 * the architect-audit follow-up that split the verb into per-command
 * files under `cli/commands/plugins/`. Anything two or more subcommand
 * files need lives here:
 *
 *   - search-path resolution (`resolveSearchPaths`) for `<cwd>/.skill-map/plugins/`
 *     (with `--plugin-dir <path>` override)
 *   - enabled-state resolver composition (`buildResolver`), DB overrides
 *     stacked on top of `settings.json` + installed defaults
 *   - discovery (`loadAll`), runs the full PluginLoader pass
 *   - synthetic built-in plugin view (`builtInRows`) so list / show /
 *     doctor / toggle treat built-ins as first-class plugins
 *   - JSON helpers (`omitModule`) for `--json` output that includes
 *     `ILoadedExtension.module` (live ESM namespaces with cycles)
 *   - prose helpers (`wrapText`) shared by list and doctor renderers
 *
 * Per `spec/cli-contract.md` §Scope is always project-local, plugin
 * discovery walks `<cwd>/.skill-map/plugins/` only; the user-scoped
 * `~/.skill-map/plugins/` root and the `-g/--global` switch have been
 * removed. Authors that want to point at a sibling tree pass
 * `--plugin-dir <path>`.
 */

import {
  builtInPlugins,
  type TBuiltInExtension,
} from '../../../plugins/built-ins.js';
import { sortPluginsForPresentation } from '../../../plugins/presentation-order.js';
import {
  createPluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../../kernel/config/loader.js';
import type { TExtensionStability } from '../../../kernel/extensions/index.js';
import { resolve } from 'node:path';

import {
  installedDefaultEnabled,
  makeEnabledResolver,
  makeTrustResolver,
  type TEnabledResolver,
} from '../../../kernel/config/plugin-resolver.js';
import { loadTrust } from '../../../kernel/config/plugin-trust-store.js';
import { lockedBuiltInIds } from '../../../plugins/locked-built-ins.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { log } from '../../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import type { IAnsi } from '../../util/ansi.js';
import { defaultProjectPluginsDir } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';

export interface IPluginDirOption {
  pluginDir: string | undefined;
}

/**
 * Compose the search-path list every subcommand walks for plugins.
 * `--plugin-dir <path>` replaces the project default; otherwise the
 * single discovery root is `<cwd>/.skill-map/plugins/`.
 */
export function resolveSearchPaths(opts: IPluginDirOption, cwd: string): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  return [defaultProjectPluginsDir({ cwd })];
}

/**
 * Build a resolver from the layered config (settings.json). Enable is a
 * pure-config concern now (the DB carries the orthogonal import-trust
 * grant, not enable), so this is a thin wrapper over the layered config
 * read. This is the ENABLE axis only; `loadAll` builds the orthogonal
 * import-trust gate separately.
 */
export async function buildResolver(): Promise<TEnabledResolver> {
  const ctx = defaultRuntimeContext();
  const { effective: cfg } = loadConfig({ cwd: ctx.cwd });
  return makeEnabledResolver(cfg, lockedBuiltInIds());
}

/**
 * Run the full PluginLoader discovery + load pass against the search
 * paths derived from `opts`. Used by every verb that needs the live
 * status of user plugins (`list` / `show` / `doctor` / `toggle` /
 * `trust` / `config`).
 *
 * --- The management family is trust-gated too (2026-07-28) -------------
 *
 * This used to omit `resolveImportTrust`, on the reasoning that running
 * an `sm plugins` verb is itself the operator's explicit choice to work
 * with the project's plugins. That was wrong twice over.
 *
 * Wrong on the facts: the loader's pre-import gate keeps the manifest
 * and reports `status: 'disabled'` + `untrusted: true`, so gating never
 * hid anything. The old docstring justified the omission with "so
 * `sm plugins list` still surfaces untrusted plugins instead of hiding
 * them", a cost that does not exist.
 *
 * Wrong on the threat model: under clone-and-scan, `sm plugins list` was
 * the shortest path to executing a hostile repo's code, reached by an
 * operator doing the responsible thing (looking before trusting). The
 * untrusted advisory pointed straight at it. `sm plugins trust` itself
 * ran the very code the operator had not yet consented to.
 *
 * Reviewing a plugin means reading its source and its manifest, neither
 * of which requires importing it. The manifest-derived fields survive
 * the gate; only per-extension `version` / `stability`, which live in
 * the module, go missing until trust is granted.
 *
 * `--plugin-dir <path>` stays exempt, matching the runtime: the
 * operator pointed the loader at that code on purpose. It is
 * ANNOUNCED, though (audit finding, 2026-08-01). The exemption was
 * silent, so a hostile project's README saying "inspect our plugins
 * with `sm plugins list --plugin-dir ./tools/sm-plugins`" restored the
 * execute-on-inspect path verbatim, with nothing on screen to say code
 * had run. Typing the flag is consent to load that directory; it is
 * not evidence the operator knows a listing evaluates module bodies,
 * so the warning states it every time.
 */
export async function loadAll(opts: IPluginDirOption): Promise<IDiscoveredPlugin[]> {
  const ctx = defaultRuntimeContext();
  const validators = loadSchemaValidators();
  const loaderOpts: IPluginLoaderOptions = {
    searchPaths: resolveSearchPaths(opts, ctx.cwd),
    validators,
    specVersion: installedSpecVersion(),
    resolveEnabled: await buildResolver(),
  };
  if (opts.pluginDir) {
    log.warn(
      tx(PLUGINS_TEXTS.pluginDirTrustBypass, {
        dir: sanitizeForTerminal(opts.pluginDir),
      }),
    );
  } else {
    // Fails closed: a scope lock that cannot be read grants nothing.
    const { trusted } = loadTrust(ctx.cwd);
    const trustMap = new Map([...trusted].map((id) => [id, true] as const));
    loaderOpts.resolveImportTrust = makeTrustResolver(trustMap, lockedBuiltInIds());
  }
  const loader = createPluginLoader(loaderOpts);
  return loader.discoverAndLoadAll();
}

// --- built-in plugin synthesis -------------------------------------------

export interface IBuiltInPluginRow {
  id: string;
  /**
   * Aggregate enabled-state for the plugin: `true` when at least one of
   * its extensions is enabled. Used by the human renderer to pick the
   * row glyph (`✓` / `✕`) when a per-extension breakdown is not shown.
   */
  enabled: boolean;
  /**
   * One- to three-sentence summary of what the plugin ships. Carried so
   * `sm plugins list <plugin>` can surface the same description the BFF
   * publishes for the SPA without re-deriving it. Always populated for
   * built-ins (the plugin declaration in `built-ins.ts` requires it).
   */
  description: string;
  extensions: ReadonlyArray<{
    id: string;
    kind: string;
    version: string;
    enabled: boolean;
    /**
     * Per-extension metadata used by the single-extension detail view
     * (`sm plugins show <plugin>/<ext>`). `description` is required by
     * the new manifest contract; `stability` is the optional lifecycle
     * label (`IExtensionBase.stability`); `entry` is the runtime entry
     * path preserved for diagnostics.
     */
    description: string;
    stability?: TExtensionStability;
    entry?: string;
  }>;
  /** Per-extension version+kind catalogue, surfaced in `sm plugins list <id> --json`. */
  manifestSummary: string;
}

/**
 * Build a synthesised view over the built-in plugins with the
 * resolved enabled-state per extension. Every extension is independently
 * toggle-able by its qualified id `<plugin>/<ext>`; the plugin-level
 * `enabled` is just an aggregate ("any child enabled") so the row
 * renderer can pick a glyph at a glance.
 */
export function builtInRows(resolveEnabled: TEnabledResolver): IBuiltInPluginRow[] {
  // Presentation order: `core` first, then the vendor plugins. Runtime
  // iteration of `builtInPlugins` keeps `core` last so `core/markdown`
  // stays the terminal fallback provider; the CLI listing surface
  // inverts that for readability.
  return sortPluginsForPresentation(builtInPlugins).map((plugin) => {
    const extensions = plugin.extensions.map((ext) => extensionRowFromBuiltIn(ext, plugin, resolveEnabled));
    const manifestSummary = plugin.extensions
      .map((ext) => `${ext.kind}:${qualifiedExtensionId(plugin.id, ext.id)}@${ext.version}`)
      .join(', ');
    return {
      id: plugin.id,
      enabled: extensions.some((e) => e.enabled),
      description: plugin.description,
      extensions,
      manifestSummary,
    };
  });
}

/**
 * Build one row of `IBuiltInPluginRow.extensions`. Pulls the optional
 * metadata (`description`, `stability`, `preconditions`, `entry`) from
 * the live built-in instance so `sm plugins show <plugin>/<ext>` can
 * render a full single-extension detail without re-fetching the source
 * module. The optional fields stay `undefined` when the extension does
 * not declare them; the renderer skips empty rows.
 */
function extensionRowFromBuiltIn(
  ext: TBuiltInExtension,
  plugin: { id: string },
  resolveEnabled: TEnabledResolver,
): IBuiltInPluginRow['extensions'][number] {
  // `exactOptionalPropertyTypes` rejects assigning `undefined` to an
  // optional field, so we build the row in two steps: required fields
  // first, then spread the optional ones only when the source defined
  // them.
  const row: IBuiltInPluginRow['extensions'][number] = {
    id: ext.id,
    kind: ext.kind,
    version: ext.version,
    enabled: resolveEnabled(qualifiedExtensionId(plugin.id, ext.id), installedDefaultEnabled(ext.stability, ext.defaultEnabled)),
    description: ext.description ?? '',
  };
  if (ext.stability !== undefined) row.stability = ext.stability;
  if (ext.entry !== undefined) row.entry = ext.entry;
  return row;
}

/**
 * Append the lifecycle tag (` (beta)`, ` (experimental)`, ...) to an
 * extension name when the manifest declares a non-default `stability`.
 * `stable` (declared or defaulted) returns the name untouched, per the
 * spec's "missing == stable, no badge" contract. The value passed AJV's
 * closed enum at load time, but it still runs through
 * `sanitizeForTerminal` for defense in depth (kernel annex rule).
 */
export function withStabilityTag(name: string, stability?: TExtensionStability): string {
  if (!stability || stability === 'stable') return name;
  return name + tx(PLUGINS_TEXTS.stabilityTag, { stability: sanitizeForTerminal(stability) });
}

/**
 * JSON-serializer replacer: the `ILoadedExtension.module` field is a
 * live ESM namespace with circular references, omit it from output.
 *
 * We identify the namespace by `[Symbol.toStringTag] === 'Module'` (the
 * standard tag Node sets on ESM module records), so a plugin manifest
 * that legitimately ships an unrelated `module` key is preserved.
 */
export function omitModule(key: string, value: unknown): unknown {
  if (key !== 'module') return value;
  if (value === null || typeof value !== 'object') return value;
  const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
  return tag === 'Module' ? undefined : value;
}

// --- qualified-id parsing (shared by show / list / enable / disable) -----

/** A plugin reduced to its id + the ids of its declared extensions. */
export interface IPluginCatalogueEntry {
  id: string;
  extensionIds: string[];
}

/**
 * Build the canonical plugin catalogue: built-ins first, then loaded
 * user plugins. Shared by `enable` / `disable` (bare-id expansion) and
 * `show` / `list` (id validation + bare-plugin lookup). Plugins whose
 * manifest never validated list with an empty `extensionIds` so a buggy
 * plugin can still be addressed by its bare id.
 *
 * The catalogue is the DECLARED inventory, so it folds in extensions
 * that exist on disk but were not imported (disabled, or belonging to an
 * untrusted plugin). This is load-bearing rather than cosmetic: the
 * catalogue is what `sm plugins enable <plugin>/<ext>` resolves ids
 * against, so listing only the imported ones would make a disabled
 * extension impossible to turn back on, and an experimental one
 * impossible to turn on at all.
 */
export function pluginCatalogue(plugins: IDiscoveredPlugin[]): IPluginCatalogueEntry[] {
  const out: IPluginCatalogueEntry[] = [];
  for (const plugin of builtInPlugins) {
    out.push({ id: plugin.id, extensionIds: plugin.extensions.map((e) => e.id) });
  }
  for (const p of plugins) {
    out.push({
      id: p.id,
      extensionIds: [
        ...(p.extensions ?? []).map((e) => e.id),
        ...(p.unloadedExtensions ?? []).map((e) => e.id),
      ],
    });
  }
  return out;
}

/** Outcome of parsing a qualified `<plugin>/<ext>` id against a catalogue. */
export type TQualifiedIdResult =
  | { ok: true; pluginId: string; extId: string }
  | { ok: false; reason: 'malformed' | 'unknown-plugin' | 'unknown-extension'; pluginId?: string; extId?: string };

/**
 * Parse and validate a qualified `<plugin>/<ext>` id against the
 * catalogue. Owns the split + existence checks that `show` and
 * `enable` / `disable` would otherwise each reimplement; the caller
 * renders the directed message for the returned `reason` via
 * `renderQualifiedIdError` so every verb shares one error surface.
 */
export function parseQualifiedExtensionId(
  id: string,
  catalogue: IPluginCatalogueEntry[],
): TQualifiedIdResult {
  const [pluginId, extId, ...rest] = id.split('/');
  if (!pluginId || !extId || rest.length > 0) return { ok: false, reason: 'malformed' };
  const plugin = catalogue.find((p) => p.id === pluginId);
  if (!plugin) return { ok: false, reason: 'unknown-plugin', pluginId };
  if (!plugin.extensionIds.includes(extId)) {
    return { ok: false, reason: 'unknown-extension', pluginId, extId };
  }
  return { ok: true, pluginId, extId };
}

/**
 * Render the directed error for a failed `parseQualifiedExtensionId`.
 * `rawId` is the user's original input (used verbatim for the malformed
 * case, where there is no clean `pluginId` to quote). Mirrors the wording
 * `enable` / `disable` and `show` printed independently before the helper
 * was shared.
 */
export function renderQualifiedIdError(
  result: Extract<TQualifiedIdResult, { ok: false }>,
  rawId: string,
  ansi: IAnsi,
): string {
  const glyph = ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  if (result.reason === 'unknown-extension') {
    return tx(PLUGINS_TEXTS.qualifiedIdNotFound, {
      glyph,
      id: sanitizeForTerminal(rawId),
      pluginId: sanitizeForTerminal(result.pluginId ?? ''),
      extId: sanitizeForTerminal(result.extId ?? ''),
      hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdNotFoundHint),
    });
  }
  // `malformed` has no clean plugin id to quote, so it echoes the raw
  // input; `unknown-plugin` quotes the parsed plugin id. Both use the
  // same "unknown plugin" template.
  return tx(PLUGINS_TEXTS.qualifiedIdUnknownPlugin, {
    glyph,
    pluginId: sanitizeForTerminal(result.reason === 'unknown-plugin' ? (result.pluginId ?? rawId) : rawId),
    hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdUnknownPluginHint),
  });
}

/**
 * Generic greedy word-wrap to a soft visible width. Splits on
 * whitespace runs and never breaks mid-word. Returns raw lines (no
 * indent, no color); the caller prepends indent and applies styling
 * so wrap math stays honest under color codes.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}
