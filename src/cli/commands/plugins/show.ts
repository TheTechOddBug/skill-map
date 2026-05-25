/**
 * `sm plugins show <id>`, render one plugin's manifest + loaded
 * extensions. Accepts bare bundle ids (`core`, `claude`,
 * `my-plugin`) and qualified extension ids (`core/<ext-id>`,
 * `<plugin>/<ext-id>`).
 *
 * Two rendering modes:
 *   - **Bare id**: full bundle detail (header + every extension row),
 *     same as `list <id>` but expanded.
 *   - **Qualified `<bundle>/<ext>` id**: single-extension detail block
 *     (header + Kind / Version / Stability / Description / Preconditions
 *     / Entry fields). The reader asked about one extension; the
 *     output answers that question instead of dumping the whole bundle.
 *
 * Both modes accept the same id shapes `sm plugins enable|disable`
 * take. The bare-bundle form renders the bundle detail (with per-extension
 * status); the qualified form renders the single-extension detail.
 */

import { Command, Option } from 'clipanion';

import { EXTENSION_KINDS, type ExtensionKind } from '../../../kernel/registry.js';
import type {
  IDiscoveredPlugin,
  ILoadedExtension,
} from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import type { IAnsi } from '../../util/ansi.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';
import {
  builtInRows,
  buildResolver,
  loadAll,
  omitModule,
  type IBuiltInBundleRow,
} from './shared.js';

export class PluginsShowCommand extends SmCommand {
  static override paths = [['plugins', 'show']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Show a single plugin\'s manifest + loaded extensions.',
    details: `
      Accepts a bundle / plugin id (\`core\`, \`claude\`, \`my-plugin\`)
      or a qualified extension id (\`core/<ext-id>\`,
      \`<plugin>/<ext-id>\`). When given a qualified id, validates the
      extension exists and renders a single-extension detail block.
      The bare form renders the parent bundle's detail with per-extension
      status. The same id shapes \`sm plugins enable\` and
      \`sm plugins disable\` accept resolve cleanly here too.
    `,
  });

  id = Option.String({ required: true });
  pluginDir = Option.String('--plugin-dir', { required: false });

  protected async run(): Promise<number> {
    const plugins = await loadAll({ pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver();
    const builtIns = builtInRows(resolveEnabled);
    const stderrAnsi = this.ansiFor('stderr');

    // Accept qualified `<bundle>/<ext>` ids the same way enable/disable
    // do, validate the bundle exists and the extension exists inside
    // it, then carry both `bundleId` and `extId` through.
    const lookupResult = resolveShowLookupId(this.id, builtIns, plugins, stderrAnsi);
    if ('error' in lookupResult) {
      this.printer!.error(lookupResult.error);
      return ExitCode.NotFound;
    }
    const { bundleId, extId } = lookupResult;

    const builtIn = builtIns.find((b) => b.id === bundleId);
    const match = plugins.find((p) => p.id === bundleId);

    if (!builtIn && !match) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.pluginNotFound, {
          glyph: stderrAnsi.red('✕'),
          id: sanitizeForTerminal(this.id),
          hint: stderrAnsi.dim(PLUGINS_TEXTS.pluginNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    if (extId !== undefined) {
      return this.renderExtensionDetail({ extId, bundleId, builtIn, match });
    }

    if (this.json) {
      const payload = builtIn ?? match;
      this.printer!.data(JSON.stringify(payload, omitModule, 2) + '\n');
      return ExitCode.Ok;
    }

    const ansi = this.ansiFor('stdout');
    const text = builtIn
      ? renderBuiltInDetail(builtIn, ansi)
      : renderPluginDetail(match!, ansi);
    this.printer!.data(text);
    return ExitCode.Ok;
  }

  /**
   * Render the single-extension detail block, the path taken when the
   * user supplies a qualified `<bundle>/<ext>` id. `--json` emits the
   * single extension row (no surrounding bundle envelope) so tooling
   * can pipe straight into `jq`; human mode renders a focused header
   * plus a Kind / Version / Stability / Description / Preconditions /
   * Entry field block.
   */
  private renderExtensionDetail(args: {
    extId: string;
    bundleId: string;
    builtIn: IBuiltInBundleRow | undefined;
    match: IDiscoveredPlugin | undefined;
  }): number {
    const { extId, bundleId, builtIn, match } = args;
    const ansi = this.ansiFor('stdout');
    if (builtIn) {
      const ext = builtIn.extensions.find((e) => e.id === extId);
      if (!ext) return ExitCode.NotFound; // resolveShowLookupId already validated; defensive.
      if (this.json) {
        this.printer!.data(JSON.stringify({ pluginId: bundleId, ...ext }, omitModule, 2) + '\n');
        return ExitCode.Ok;
      }
      this.printer!.data(renderBuiltInExtensionDetail(bundleId, ext, ansi));
      return ExitCode.Ok;
    }
    const userExt = match?.extensions?.find((e) => e.id === extId);
    if (!userExt) return ExitCode.NotFound;
    if (this.json) {
      this.printer!.data(JSON.stringify(userExt, omitModule, 2) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.data(renderUserExtensionDetail(bundleId, userExt, ansi));
    return ExitCode.Ok;
  }
}

/**
 * Resolve a user-supplied id (bare or qualified) to the bundle/plugin
 * id the renderer should look up. Bare ids fall through unchanged.
 * Qualified `<bundle>/<ext>` ids are validated: the bundle must exist
 * (built-in or user plugin) and the extension must be declared inside
 * it. Failures return the same directed error messages as
 * enable/disable so the CLI surface stays consistent, only the
 * granularity rejection that toggle applies is intentionally skipped
 * (show is informational, not destructive).
 */
function resolveShowLookupId(
  id: string,
  builtIns: IBuiltInBundleRow[],
  plugins: IDiscoveredPlugin[],
  ansi: IAnsi,
): { bundleId: string; extId?: string } | { error: string } {
  if (!id.includes('/')) return { bundleId: id };
  const parsed = parseQualifiedId(id);
  if ('error' in parsed) return { error: malformedQualifiedError(id, ansi) };

  const { bundleId, extId } = parsed;
  const knownExts = collectKnownExtensions(bundleId, builtIns, plugins);
  if (knownExts === null) return { error: unknownBundleError(bundleId, ansi) };
  if (!knownExts.includes(extId)) {
    return { error: unknownExtensionError(id, bundleId, extId, ansi) };
  }
  return { bundleId, extId };
}

function parseQualifiedId(id: string): { bundleId: string; extId: string } | { error: true } {
  const [bundleId, extId, ...rest] = id.split('/');
  if (!bundleId || !extId || rest.length > 0) return { error: true };
  return { bundleId, extId };
}

function collectKnownExtensions(
  bundleId: string,
  builtIns: IBuiltInBundleRow[],
  plugins: IDiscoveredPlugin[],
): string[] | null {
  const builtIn = builtIns.find((b) => b.id === bundleId);
  if (builtIn) return builtIn.extensions.map((e) => e.id);
  const userPlugin = plugins.find((p) => p.id === bundleId);
  if (userPlugin) return userPlugin.extensions?.map((e) => e.id) ?? [];
  return null;
}

function malformedQualifiedError(id: string, ansi: IAnsi): string {
  return tx(PLUGINS_TEXTS.qualifiedIdUnknownBundle, {
    glyph: ansi.red('✕'),
    bundleId: sanitizeForTerminal(id),
    hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdUnknownBundleHint),
  });
}

function unknownBundleError(bundleId: string, ansi: IAnsi): string {
  return tx(PLUGINS_TEXTS.qualifiedIdUnknownBundle, {
    glyph: ansi.red('✕'),
    bundleId: sanitizeForTerminal(bundleId),
    hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdUnknownBundleHint),
  });
}

function unknownExtensionError(id: string, bundleId: string, extId: string, ansi: IAnsi): string {
  return tx(PLUGINS_TEXTS.qualifiedIdNotFound, {
    glyph: ansi.red('✕'),
    id: sanitizeForTerminal(id),
    bundleId: sanitizeForTerminal(bundleId),
    extId: sanitizeForTerminal(extId),
    hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdNotFoundHint),
  });
}

interface IExtensionListItem {
  glyph: string;
  kind: string;
  name: string;
  version: string;
}

/**
 * Canonical kind ordering for the bundle-detail extension block. Mirrors
 * `EXTENSION_KINDS` from `kernel/registry.ts` (provider, extractor,
 * analyzer, action, formatter, hook), the pipeline order a reader walks
 * the satellites in on the marketing site. Within a kind, sort by short
 * id ascending (the unqualified id, NOT `<bundle>/<id>`, so user plugins
 * and built-ins sort the same way).
 */
function kindIndex(kind: string): number {
  const idx = (EXTENSION_KINDS as readonly string[]).indexOf(kind);
  return idx === -1 ? EXTENSION_KINDS.length : idx;
}

function sortExtensionsCanonical<T extends { id: string; kind: ExtensionKind | string }>(
  exts: ReadonlyArray<T>,
): T[] {
  return [...exts].sort((a, b) => {
    const k = kindIndex(a.kind) - kindIndex(b.kind);
    if (k !== 0) return k;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Detail rendering for one built-in bundle:
 *
 *   ✓  core   built-in   27 extensions
 *
 *       ✓  provider   core/markdown               1.0.0
 *       ✓  extractor  core/external-url-counter   1.0.0
 *       ✕  analyzer   core/reference-broken       1.0.0
 *       ...
 *
 * Every extension carries its own glyph (✓ / ✕) because every extension
 * is independently toggle-able by its qualified id `<bundle>/<ext>`.
 * Names are rendered qualified so the user can copy-paste the handle
 * straight into `sm plugins enable|disable`.
 */
function renderBuiltInDetail(b: IBuiltInBundleRow, ansi: IAnsi): string {
  const glyph = b.enabled
    ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
    : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  const count = b.extensions.length;
  const sorted = sortExtensionsCanonical(b.extensions);
  const items: IExtensionListItem[] = sorted.map((ext) => ({
    glyph: ext.enabled
      ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
      : ansi.red(PLUGINS_TEXTS.rowGlyphOff),
    kind: ext.kind,
    name: `${b.id}/${ext.id}`,
    version: ext.version,
  }));
  return (
    tx(PLUGINS_TEXTS.detailHeaderBuiltIn, {
      glyph,
      id: b.id,
      source: ansi.dim(PLUGINS_TEXTS.sourceBuiltIn),
      count,
      plural: count === 1 ? '' : 's',
    }) +
    PLUGINS_TEXTS.detailExtensionsBlock +
    renderExtensionItems(items)
  );
}

/**
 * Detail rendering for one user plugin. Disabled / errored plugins
 * keep the field block (`Path`, `Reason`) and skip the extensions
 * section. The `user` source label stays the same regardless of state
 * the glyph (✕) signals "off".
 */
function renderPluginDetail(match: IDiscoveredPlugin, ansi: IAnsi): string {
  const header = renderPluginDetailHeader(match, ansi);
  const fieldBlock = renderPluginDetailFields(match);
  const items = collectPluginExtensionItems(match, ansi);
  const out: string[] = [header, '\n', fieldBlock];
  if (items.length > 0) {
    out.push(PLUGINS_TEXTS.detailExtensionsBlock);
    out.push(renderExtensionItems(items));
  }
  return out.join('');
}

function renderPluginDetailHeader(match: IDiscoveredPlugin, ansi: IAnsi): string {
  const enabled = match.status === 'enabled';
  const glyph = enabled
    ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
    : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  const version = sanitizeForTerminal(
    match.manifest?.version ?? PLUGINS_TEXTS.detailVersionUnknown,
  );
  const extCount = enabled && match.extensions ? match.extensions.length : 0;
  return tx(PLUGINS_TEXTS.detailHeaderUser, {
    glyph,
    id: sanitizeForTerminal(match.id),
    version,
    source: ansi.dim(PLUGINS_TEXTS.sourceUser),
    extCount: extCount > 0
      ? `   ${extCount} extension${extCount === 1 ? '' : 's'}`
      : '',
  });
}

function renderPluginDetailFields(match: IDiscoveredPlugin): string {
  const compat = sanitizeForTerminal(
    match.manifest?.specCompat ?? PLUGINS_TEXTS.detailCompatUnknown,
  );
  const fields: Array<{ label: string; value: string }> = [];
  fields.push({ label: PLUGINS_TEXTS.detailFieldPath, value: match.path });
  if (match.manifest?.specCompat) {
    fields.push({ label: PLUGINS_TEXTS.detailFieldCompat, value: compat });
  }
  if (match.manifest?.description) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldSummary,
      value: sanitizeForTerminal(match.manifest.description),
    });
  }
  if (match.reason) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldReason,
      value: sanitizeForTerminal(match.reason),
    });
  }
  const labelWidth = Math.max(...fields.map((f) => f.label.length));
  return fields
    .map((f) =>
      tx(PLUGINS_TEXTS.detailFieldRow, {
        label: f.label.padEnd(labelWidth),
        value: f.value,
      }),
    )
    .join('');
}

function collectPluginExtensionItems(
  match: IDiscoveredPlugin,
  ansi: IAnsi,
): IExtensionListItem[] {
  const enabled = match.status === 'enabled';
  if (!enabled || !match.extensions) return [];
  const safeBundleId = sanitizeForTerminal(match.id);
  const sorted = sortExtensionsCanonical(match.extensions);
  return sorted.map((ext) => {
    const safeExtId = sanitizeForTerminal(ext.id);
    return {
      // User plugins surfaced via `loadAll` already filter on the
      // resolver, so a reachable extension on this surface is enabled
      // by construction. The disabled path goes through the bundle
      // status header above (✕ on the row).
      glyph: ansi.green(PLUGINS_TEXTS.rowGlyphOk),
      kind: sanitizeForTerminal(ext.kind),
      name: `${safeBundleId}/${safeExtId}`,
      version: sanitizeForTerminal(ext.version),
    };
  });
}

/**
 * Render an aligned block of extension rows. `kind` and `name`
 * columns are padded to the longest in the block so everything lines
 * up. Every row carries a glyph (✓ / ✕) reflecting the per-extension
 * toggle state.
 */
function renderExtensionItems(items: IExtensionListItem[]): string {
  if (items.length === 0) return '';
  const kindWidth = Math.max(...items.map((i) => i.kind.length));
  const nameWidth = Math.max(...items.map((i) => i.name.length));
  const out: string[] = [];
  for (const item of items) {
    const kind = item.kind.padEnd(kindWidth);
    const name = item.name.padEnd(nameWidth);
    out.push(
      tx(PLUGINS_TEXTS.detailExtensionRowGlyph, {
        glyph: item.glyph,
        kind,
        name,
        version: item.version,
      }),
    );
  }
  return out.join('');
}

/**
 * Single-extension detail for a built-in extension. Header is the
 * qualified id with the same enabled/disabled glyph the bundle row
 * uses, followed by a field block (Kind / Version / Stability /
 * Description / Preconditions / Entry). Optional fields the manifest
 * does not declare are dropped from the block, the row is not rendered
 * as "(none)" so the output stays compact and a missing description
 * never looks like a placeholder bug.
 */
function renderBuiltInExtensionDetail(
  bundleId: string,
  ext: IBuiltInBundleRow['extensions'][number],
  ansi: IAnsi,
): string {
  const glyph = ext.enabled
    ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
    : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  const header = tx(PLUGINS_TEXTS.detailHeaderExtensionBuiltIn, {
    glyph,
    qualifiedId: sanitizeForTerminal(`${bundleId}/${ext.id}`),
    source: ansi.dim(PLUGINS_TEXTS.sourceBuiltIn),
  });
  const meta: IExtensionFieldInput = { kind: ext.kind, version: ext.version };
  if (ext.description) meta.description = ext.description;
  if (ext.entry !== undefined) meta.entry = ext.entry;
  return header + '\n' + renderExtensionFields(meta);
}

/**
 * Single-extension detail for a user-plugin extension. Mirrors the
 * built-in variant; reads the per-extension metadata off
 * `ILoadedExtension.instance` (the loader-cloned runtime instance,
 * spec-guaranteed to carry `IExtensionBase` fields). Disabled or
 * error-state plugins never reach this code path because the
 * qualified-id resolver in `resolveShowLookupId` only matches
 * extensions discovered under `status === 'enabled'`.
 */
function renderUserExtensionDetail(
  bundleId: string,
  ext: ILoadedExtension,
  ansi: IAnsi,
): string {
  const glyph = ansi.green(PLUGINS_TEXTS.rowGlyphOk);
  const header = tx(PLUGINS_TEXTS.detailHeaderExtensionUser, {
    glyph,
    qualifiedId: sanitizeForTerminal(`${bundleId}/${ext.id}`),
    source: ansi.dim(PLUGINS_TEXTS.sourceUser),
  });
  const meta = readInstanceMeta(ext.instance);
  const input: IExtensionFieldInput = {
    kind: ext.kind,
    version: ext.version,
    entry: ext.entryPath,
  };
  if (meta.stability !== undefined) input.stability = meta.stability;
  if (meta.description !== undefined) input.description = meta.description;
  if (meta.preconditions !== undefined) input.preconditions = meta.preconditions;
  return header + '\n' + renderExtensionFields(input);
}

interface IExtensionMeta {
  description?: string;
  stability?: string;
  preconditions?: ReadonlyArray<string>;
}

interface IExtensionFieldInput {
  kind: string;
  version: string;
  stability?: string;
  description?: string;
  preconditions?: ReadonlyArray<string>;
  entry?: string;
}

function readInstanceMeta(instance: unknown): IExtensionMeta {
  if (instance === null || typeof instance !== 'object') return {};
  const obj = instance as Record<string, unknown>;
  const out: IExtensionMeta = {};
  if (typeof obj['description'] === 'string') out.description = obj['description'];
  if (typeof obj['stability'] === 'string') out.stability = obj['stability'];
  if (Array.isArray(obj['preconditions'])) {
    out.preconditions = (obj['preconditions'] as unknown[]).filter(
      (p): p is string => typeof p === 'string',
    );
  }
  return out;
}

function renderExtensionFields(meta: IExtensionFieldInput): string {
  const fields: Array<{ label: string; value: string }> = [];
  fields.push({ label: PLUGINS_TEXTS.detailFieldKind, value: sanitizeForTerminal(meta.kind) });
  fields.push({ label: PLUGINS_TEXTS.detailFieldVersion, value: sanitizeForTerminal(meta.version) });
  if (meta.stability) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldStability,
      value: sanitizeForTerminal(meta.stability),
    });
  }
  if (meta.description) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldDescription,
      value: sanitizeForTerminal(meta.description),
    });
  }
  if (meta.preconditions && meta.preconditions.length > 0) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldPreconditions,
      value: meta.preconditions.map(sanitizeForTerminal).join(', '),
    });
  }
  if (meta.entry) {
    fields.push({ label: PLUGINS_TEXTS.detailFieldEntry, value: sanitizeForTerminal(meta.entry) });
  }
  const labelWidth = Math.max(...fields.map((f) => f.label.length));
  return fields
    .map((f) =>
      tx(PLUGINS_TEXTS.detailFieldRow, {
        label: f.label.padEnd(labelWidth),
        value: f.value,
      }),
    )
    .join('');
}
