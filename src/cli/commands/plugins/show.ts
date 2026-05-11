/**
 * `sm plugins show <id>` — render one plugin's manifest + loaded
 * extensions. Accepts bare bundle ids (`core`, `claude`,
 * `my-plugin`) and qualified extension ids (`core/<ext-id>`,
 * `<plugin>/<ext-id>`); qualified ids resolve to the parent bundle
 * for rendering (show is informational, so the granularity rule that
 * `toggle` enforces is intentionally skipped).
 */

import { Command, Option } from 'clipanion';

import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import { ansiFor, type IAnsi } from '../../util/ansi.js';
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
      extension exists and renders the parent bundle's detail (which
      lists every extension with per-extension status for
      granularity=extension bundles like \`core\`). The same id shapes
      \`sm plugins enable\` and \`sm plugins disable\` accept resolve
      cleanly here too.
    `,
  });

  id = Option.String({ required: true });
  pluginDir = Option.String('--plugin-dir', { required: false });

  protected async run(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver(this.global);
    const builtIns = builtInRows(resolveEnabled);
    const stderr = this.context.stderr as NodeJS.WriteStream;
    const stderrAnsi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });

    // Accept qualified `<bundle>/<ext>` ids the same way enable/disable
    // do — validate the bundle exists and the extension exists inside
    // it, then look up the parent bundle for rendering. Show is
    // informational, so we do NOT enforce the granularity rules
    // toggle uses (rejecting `claude/some-ext` because `claude` has
    // granularity=bundle would be hostile when the user just wants
    // to read the manifest).
    const lookupResult = resolveShowLookupId(this.id, builtIns, plugins, stderrAnsi);
    if ('error' in lookupResult) {
      this.printer!.error(lookupResult.error);
      return ExitCode.NotFound;
    }
    const lookupId = lookupResult.bundleId;

    const builtIn = builtIns.find((b) => b.id === lookupId);
    const match = plugins.find((p) => p.id === lookupId);

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

    if (this.json) {
      const payload = builtIn ?? match;
      this.printer!.data(JSON.stringify(payload, omitModule, 2) + '\n');
      return ExitCode.Ok;
    }

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const text = builtIn
      ? renderBuiltInDetail(builtIn, ansi)
      : renderPluginDetail(match!, ansi);
    this.printer!.data(text);
    return ExitCode.Ok;
  }
}

/**
 * Resolve a user-supplied id (bare or qualified) to the bundle/plugin
 * id the renderer should look up. Bare ids fall through unchanged.
 * Qualified `<bundle>/<ext>` ids are validated: the bundle must exist
 * (built-in or user plugin) and the extension must be declared inside
 * it. Failures return the same directed error messages as
 * enable/disable so the CLI surface stays consistent — only the
 * granularity rejection that toggle applies is intentionally skipped
 * (show is informational, not destructive).
 */
function resolveShowLookupId(
  id: string,
  builtIns: IBuiltInBundleRow[],
  plugins: IDiscoveredPlugin[],
  ansi: IAnsi,
): { bundleId: string } | { error: string } {
  if (!id.includes('/')) return { bundleId: id };
  const parsed = parseQualifiedId(id);
  if ('error' in parsed) return { error: malformedQualifiedError(id, ansi) };

  const { bundleId, extId } = parsed;
  const knownExts = collectKnownExtensions(bundleId, builtIns, plugins);
  if (knownExts === null) return { error: unknownBundleError(bundleId, ansi) };
  if (!knownExts.includes(extId)) {
    return { error: unknownExtensionError(id, bundleId, extId, ansi) };
  }
  return { bundleId };
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
  glyph: string | null; // null when granularity=bundle (no per-ext toggle)
  kind: string;
  name: string;
  version: string;
}

/**
 * Detail rendering for one built-in bundle:
 *
 *   ✓  core   built-in   15 extensions
 *
 *       ✓  provider   markdown               1.0.0
 *       ✓  extractor  external-url-counter   1.0.0
 *       ...
 *
 * Per-extension glyphs only appear when `granularity=extension`. For
 * `granularity=bundle`, the glyph slot stays empty — the bundle is
 * the only toggle, so individual states are implicit.
 */
function renderBuiltInDetail(b: IBuiltInBundleRow, ansi: IAnsi): string {
  const enabled = b.enabled;
  const glyph = enabled
    ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
    : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  const count = b.extensions.length;
  // Qualify the extension name with `<bundleId>/` ONLY when
  // granularity=extension — those ids are the toggle-able handles the
  // user types into `sm plugins enable|disable`. For
  // granularity=bundle the per-extension names are informational (the
  // bundle is the only toggle-able key), so we leave them bare.
  const qualify = b.granularity === 'extension';
  const items: IExtensionListItem[] = b.extensions.map((ext) => ({
    glyph:
      b.granularity === 'extension'
        ? ext.enabled
          ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
          : ansi.red(PLUGINS_TEXTS.rowGlyphOff)
        : null,
    kind: ext.kind,
    name: qualify ? `${b.id}/${ext.id}` : ext.id,
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
 * — the glyph (✕) signals "off".
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
  const qualify = match.granularity === 'extension';
  const safeBundleId = sanitizeForTerminal(match.id);
  return match.extensions.map((ext) => {
    const safeExtId = sanitizeForTerminal(ext.id);
    return {
      glyph:
        match.granularity === 'extension'
          ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
          : null,
      kind: sanitizeForTerminal(ext.kind),
      name: qualify ? `${safeBundleId}/${safeExtId}` : safeExtId,
      version: sanitizeForTerminal(ext.version),
    };
  });
}

/**
 * Render an aligned block of extension rows. `kind` and `name`
 * columns are padded to the longest in the block so everything lines
 * up. `glyph === null` means granularity=bundle (no per-extension
 * toggle); the row template skips the glyph column for symmetry.
 */
function renderExtensionItems(items: IExtensionListItem[]): string {
  if (items.length === 0) return '';
  const kindWidth = Math.max(...items.map((i) => i.kind.length));
  const nameWidth = Math.max(...items.map((i) => i.name.length));
  const out: string[] = [];
  for (const item of items) {
    const kind = item.kind.padEnd(kindWidth);
    const name = item.name.padEnd(nameWidth);
    if (item.glyph !== null) {
      out.push(
        tx(PLUGINS_TEXTS.detailExtensionRowGlyph, {
          glyph: item.glyph,
          kind,
          name,
          version: item.version,
        }),
      );
    } else {
      out.push(
        tx(PLUGINS_TEXTS.detailExtensionRowBare, {
          kind,
          name,
          version: item.version,
        }),
      );
    }
  }
  return out.join('');
}
