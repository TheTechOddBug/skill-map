/**
 * `sm plugins list [<id>]`.
 *
 * No id: tabulate every discovered plugin (built-in + user) with status,
 * one row per plugin. This is the index ("which plugins exist"), so it
 * stays terse: glyph, id, extension count, source. The per-extension
 * breakdown lives one level down in `sm plugins list <id>`.
 *
 * Bare plugin id (`core`, `my-plugin`): render that plugin's detail,
 * header + manifest fields + one row per extension (kind / version /
 * per-extension toggle glyph). Extension ids render qualified so they
 * paste straight into `sm plugins enable|disable|show`.
 *
 * Qualified `<plugin>/<ext>` id: rejected with a redirect to
 * `sm plugins show`, which renders the single-extension detail.
 *
 * Scans `<cwd>/.skill-map/plugins/` (or `--plugin-dir <path>` when the
 * operator opts into a custom root).
 */

import { Command, Option } from 'clipanion';

import {
  installedDefaultEnabled,
  type EnabledResolver,
} from '../../../kernel/config/plugin-resolver.js';
import type { TExtensionStability } from '../../../kernel/extensions/index.js';
import {
  EXTENSION_KINDS,
  qualifiedExtensionId,
  type ExtensionKind,
} from '../../../kernel/registry.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { pluralSuffix } from '../../../kernel/util/text.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import type { IAnsi } from '../../util/ansi.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';
import {
  builtInRows,
  buildResolver,
  loadAll,
  omitModule,
  withStabilityTag,
  type IBuiltInPluginRow,
} from './shared.js';

export class PluginsListCommand extends SmCommand {
  static override paths = [['plugins', 'list']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'List discovered plugins, or one plugin\'s extensions.',
    details: `
      No id: scans <cwd>/.skill-map/plugins (or --plugin-dir <path>) and
      lists every plugin (built-in + user) with status, one row each.
      With a bare plugin id: renders that plugin's manifest and its
      extensions (kind / version / per-extension status). A qualified
      \`<plugin>/<ext>\` id is rejected with a redirect to \`sm plugins show\`.
    `,
  });

  id = Option.String({ required: false });
  pluginDir = Option.String('--plugin-dir', { required: false });

  protected async run(): Promise<number> {
    const plugins = await loadAll({ pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver();
    const builtIns = builtInRows(resolveEnabled);

    if (this.id !== undefined) {
      return this.renderPluginDetailById(this.id, builtIns, plugins);
    }

    if (this.json) {
      this.printer!.data(
        JSON.stringify({ builtIns, plugins }, omitModule, 2) + '\n',
      );
      return ExitCode.Ok;
    }

    if (plugins.length === 0 && builtIns.length === 0) {
      this.printer!.data(PLUGINS_TEXTS.listEmpty);
      return ExitCode.Ok;
    }

    const ansi = this.ansiFor('stdout');
    this.printer!.data(renderIndexHuman(builtIns, plugins, resolveEnabled, ansi));
    return ExitCode.Ok;
  }

  /**
   * `sm plugins list <id>`, render one plugin's full detail. A qualified
   * `<plugin>/<ext>` id is the wrong granularity for `list` (it targets a
   * single extension), redirect to `sm plugins show`. A bare id that
   * matches no plugin is a NotFound.
   */
  private renderPluginDetailById(
    id: string,
    builtIns: IBuiltInPluginRow[],
    plugins: IDiscoveredPlugin[],
  ): number {
    const stderrAnsi = this.ansiFor('stderr');

    if (id.includes('/')) {
      const pluginId = id.split('/')[0] ?? id;
      this.printer!.error(
        tx(PLUGINS_TEXTS.listQualifiedId, {
          glyph: stderrAnsi.red(PLUGINS_TEXTS.rowGlyphOff),
          id: sanitizeForTerminal(id),
          hint: stderrAnsi.dim(
            tx(PLUGINS_TEXTS.listQualifiedIdHint, {
              id: sanitizeForTerminal(id),
              pluginId: sanitizeForTerminal(pluginId),
            }),
          ),
        }),
      );
      return ExitCode.Error;
    }

    const builtIn = builtIns.find((b) => b.id === id);
    const match = plugins.find((p) => p.id === id);
    if (!builtIn && !match) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.pluginNotFound, {
          glyph: stderrAnsi.red(PLUGINS_TEXTS.rowGlyphOff),
          id: sanitizeForTerminal(id),
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

    const ansi = this.ansiFor('stdout');
    const text = builtIn
      ? renderBuiltInDetail(builtIn, ansi)
      : renderPluginDetail(match!, ansi);
    this.printer!.data(text);
    return ExitCode.Ok;
  }
}

// --- index (no id) -------------------------------------------------------

interface IIndexRow {
  /** Plugin id (raw, sanitized for user plugins). */
  id: string;
  /** Resolved enabled-state of the row. Drives ✓ / ✕ glyph + color. */
  enabled: boolean;
  /** Source label (`built-in` / `user`). */
  source: string;
  /** Number of extensions the plugin declares (drives the `N ext` column). */
  extCount: number;
  /** Optional reason line shown when the row failed to load. */
  reason?: string | undefined;
}

/**
 * Render the human-mode body of `sm plugins list` (no id). One row per
 * plugin, no per-extension breakdown:
 *
 *   ✓  <id padded>  <count> ext   <source>
 *        <reason, only when the plugin failed to load>
 *
 * Padding is computed once across the whole table so columns align
 * regardless of id length. The extension breakdown (kinds, versions,
 * per-extension status) lives in `sm plugins list <id>`.
 */
function renderIndexHuman(
  builtIns: IBuiltInPluginRow[],
  plugins: IDiscoveredPlugin[],
  resolveEnabled: EnabledResolver,
  ansi: IAnsi,
): string {
  const rows: IIndexRow[] = [
    ...builtIns.map(builtInToIndexRow),
    ...plugins.map((p) => pluginToIndexRow(p, resolveEnabled)),
  ];

  const idWidth = Math.max(...rows.map((r) => r.id.length));
  const countWidth = Math.max(...rows.map((r) => String(r.extCount).length));

  const lines: string[] = [];
  for (const row of rows) {
    const glyph = row.enabled
      ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
      : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
    const idCol = row.id.padEnd(idWidth);
    const countCol = String(row.extCount).padStart(countWidth);
    lines.push(
      tx(PLUGINS_TEXTS.pluginRow, {
        glyph,
        id: idCol,
        count: ` ${countCol}`,
        source: ansi.dim(row.source),
      }),
    );
    if (row.reason) {
      lines.push(`${PLUGINS_TEXTS.pluginSubIndent}${ansi.dim(row.reason)}`);
    }
  }
  return lines.join('\n') + '\n' + PLUGINS_TEXTS.listTipShow;
}

function builtInToIndexRow(b: IBuiltInPluginRow): IIndexRow {
  return {
    id: b.id,
    enabled: b.enabled,
    source: PLUGINS_TEXTS.sourceBuiltIn,
    extCount: b.extensions.length,
  };
}

function pluginToIndexRow(
  p: IDiscoveredPlugin,
  resolveEnabled: EnabledResolver,
): IIndexRow {
  // Every field that originates from the plugin manifest (`id`, `reason`)
  // is user-controlled and runs through `sanitizeForTerminal` before it
  // lands in the rendered output.
  //
  // Plugin aggregate: failure rows are off; loaded rows aggregate the
  // per-extension toggle state (at least one child enabled → ✓, every
  // child disabled → ✕), mirroring the BFF projection.
  const isLoaded = p.status === 'enabled';
  const extensions = p.extensions ?? [];
  const extEnabled = (e: { id: string; stability?: TExtensionStability; defaultEnabled?: boolean }): boolean =>
    resolveEnabled(qualifiedExtensionId(p.id, e.id), installedDefaultEnabled(e.stability, e.defaultEnabled));
  const enabled = isLoaded
    ? extensions.length === 0 || extensions.some((e) => extEnabled(e))
    : false;
  const reason =
    p.status === 'enabled'
      ? undefined
      : sanitizeForTerminal(p.reason ?? '') || undefined;
  return {
    id: sanitizeForTerminal(p.id),
    enabled,
    source: PLUGINS_TEXTS.sourceUser,
    extCount: extensions.length,
    reason,
  };
}

// --- per-plugin detail (`list <id>`) -------------------------------------

interface IExtensionListItem {
  glyph: string;
  kind: string;
  name: string;
  /**
   * Optional. Populated for user-plugin extensions so the plugin-detail
   * block surfaces per-extension semver. Omitted for built-in extensions
   * (`core`, `claude`, `antigravity`, `codex`, `agent-skills`), which
   * inherit the CLI version and are not versioned independently.
   */
  version?: string;
}

/**
 * Canonical kind ordering for the plugin-detail extension block. Mirrors
 * `EXTENSION_KINDS` from `kernel/registry.ts` (provider, extractor,
 * analyzer, action, formatter, hook), the pipeline order a reader walks
 * the satellites in on the marketing site. Within a kind, sort by short
 * id ascending (the unqualified id, NOT `<plugin>/<id>`, so user plugins
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
 * Detail rendering for one built-in plugin:
 *
 *   ✓  core   built-in   27 extensions
 *
 *       ✓  provider   core/markdown               1.0.0
 *       ✓  extractor  core/external-url-counter   1.0.0
 *       ✕  analyzer   core/reference-broken       1.0.0
 *       ...
 *
 * Every extension carries its own glyph (✓ / ✕) because every extension
 * is independently toggle-able by its qualified id `<plugin>/<ext>`.
 * Names are rendered qualified so the user can copy-paste the handle
 * straight into `sm plugins enable|disable|show`.
 */
function renderBuiltInDetail(b: IBuiltInPluginRow, ansi: IAnsi): string {
  const glyph = b.enabled
    ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
    : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  const count = b.extensions.length;
  const sorted = sortExtensionsCanonical(b.extensions);
  // Built-in extensions inherit the CLI version, no per-extension
  // version is rendered. Per-extension versioning is reserved for
  // user (external) plugins.
  const items: IExtensionListItem[] = sorted.map((ext) => ({
    glyph: ext.enabled
      ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
      : ansi.red(PLUGINS_TEXTS.rowGlyphOff),
    kind: ext.kind,
    name: withStabilityTag(`${b.id}/${ext.id}`, ext.stability),
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
 * section. The `user` source label stays the same regardless of state,
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
      ? tx(PLUGINS_TEXTS.detailHeaderExtCount, {
          extCount,
          plural: pluralSuffix(extCount),
        })
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
  const safePluginId = sanitizeForTerminal(match.id);
  const sorted = sortExtensionsCanonical(match.extensions);
  return sorted.map((ext) => {
    const safeExtId = sanitizeForTerminal(ext.id);
    return {
      // User plugins surfaced via `loadAll` already filter on the
      // resolver, so a reachable extension on this surface is enabled
      // by construction. The disabled path goes through the plugin
      // status header above (✕ on the row).
      glyph: ansi.green(PLUGINS_TEXTS.rowGlyphOk),
      kind: sanitizeForTerminal(ext.kind),
      name: withStabilityTag(`${safePluginId}/${safeExtId}`, ext.stability),
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
  // `name` padding exists to align the `v<version>` column. When no
  // item carries a version (built-in plugins, which inherit the CLI
  // version), drop the padding so rows don't end in trailing spaces.
  const anyVersion = items.some((i) => i.version !== undefined);
  const nameWidth = anyVersion ? Math.max(...items.map((i) => i.name.length)) : 0;
  const out: string[] = [];
  for (const item of items) {
    const kind = item.kind.padEnd(kindWidth);
    const name = anyVersion ? item.name.padEnd(nameWidth) : item.name;
    const versionSuffix = item.version ? `  v${item.version}` : '';
    out.push(
      tx(PLUGINS_TEXTS.detailExtensionRowGlyph, {
        glyph: item.glyph,
        kind,
        name,
        versionSuffix,
      }),
    );
  }
  return out.join('');
}
