/**
 * `sm plugins list`, tabulate discovered plugins with status.
 *
 * Scans `<cwd>/.skill-map/plugins/` (or `--plugin-dir <path>` when
 * the operator opts into a custom root). Built-in plugins (`claude`,
 * `core`, …) surface alongside user plugins so the user sees the
 * full plugin universe in one place.
 */

import { Command, Option } from 'clipanion';

import { qualifiedExtensionId } from '../../../kernel/registry.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
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
  withStabilityTag,
  type IBuiltInPluginRow,
} from './shared.js';

export class PluginsListCommand extends SmCommand {
  static override paths = [['plugins', 'list']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'List discovered plugins and their load status.',
    details: 'Scans <cwd>/.skill-map/plugins (or --plugin-dir <path>). Built-in plugins (claude, core) are listed alongside user plugins.',
  });

  pluginDir = Option.String('--plugin-dir', { required: false });

  protected async run(): Promise<number> {
    const plugins = await loadAll({ pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver();
    const builtIns = builtInRows(resolveEnabled);

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
    this.printer!.data(renderListHuman(builtIns, plugins, resolveEnabled, ansi));
    return ExitCode.Ok;
  }
}

interface IListRow {
  /** Plugin id (raw, sanitized for user plugins). */
  id: string;
  /** Resolved enabled-state of the row. Drives ✓ / ✕ glyph + color. */
  enabled: boolean;
  /** Source label (`built-in` / `user`). */
  source: string;
  /** Bare extension names (no kind: prefix, no @version). */
  names: string[];
  /** Optional reason line shown when the row failed to load. */
  reason?: string | undefined;
}

/**
 * Render the human-mode body of `sm plugins list`.
 *
 * Layout per row:
 *
 *   ✓  <id padded>  <count> ext   <source>
 *        name-a, name-b, name-c
 *
 * Names wrap to a soft 76-col limit, broken on commas, indented to
 * line up under the names start column. Padding is computed once
 * across the whole table so columns align regardless of id length.
 */
function renderListHuman(
  builtIns: IBuiltInPluginRow[],
  plugins: IDiscoveredPlugin[],
  resolveEnabled: (id: string) => boolean,
  ansi: IAnsi,
): string {
  const rows: IListRow[] = [
    ...builtIns.map(builtInToListRow),
    ...plugins.map((p) => pluginToListRow(p, resolveEnabled)),
  ];

  const idWidth = Math.max(...rows.map((r) => r.id.length));
  const countWidth = Math.max(
    ...rows.map((r) => String(r.names.length).length),
  );

  const lines: string[] = [];
  for (const row of rows) {
    const glyph = row.enabled
      ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
      : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
    const idCol = row.id.padEnd(idWidth);
    const countCol = String(row.names.length).padStart(countWidth);
    lines.push(
      tx(PLUGINS_TEXTS.pluginRow, {
        glyph,
        id: idCol,
        count: ` ${countCol}`,
        source: ansi.dim(row.source),
      }),
    );
    const indent = PLUGINS_TEXTS.pluginSubIndent;
    if (row.reason) {
      lines.push(`${indent}${ansi.dim(row.reason)}`);
    } else if (row.names.length > 0) {
      for (const wrapped of wrapNames(row.names, indent, 76)) {
        lines.push(`${indent}${ansi.dim(wrapped)}`);
      }
    }
  }
  return lines.join('\n') + '\n' + PLUGINS_TEXTS.listTipShow;
}

function builtInToListRow(b: IBuiltInPluginRow): IListRow {
  // Built-in ids and extension names are static / trusted (compiled in
  // from `plugins/built-ins.ts`); no sanitisation needed.
  //
  // Every extension is independently toggle-able by its qualified id
  // `<plugin>/<ext>`. Surface that state in the names line by prefixing
  // disabled extensions with the `✕` glyph so the user sees per-extension
  // status at a glance without having to run `sm plugins show` or
  // `sm plugins doctor`. Non-default lifecycle labels (`beta`, ...)
  // render as a ` (beta)`-style tag after the name.
  const names = b.extensions.map((e) => {
    const name = withStabilityTag(e.id, e.stability);
    return e.enabled ? name : `${PLUGINS_TEXTS.rowGlyphOff} ${name}`;
  });
  return {
    id: b.id,
    enabled: b.enabled,
    source: PLUGINS_TEXTS.sourceBuiltIn,
    names,
  };
}

function pluginToListRow(
  p: IDiscoveredPlugin,
  resolveEnabled: (id: string) => boolean,
): IListRow {
  // Every field that originates from the plugin manifest (`id`,
  // per-ext ids, `reason`) is user-controlled and runs through
  // `sanitizeForTerminal` before it lands in the rendered output.
  //
  // Plugin aggregate: failure rows keep their loader-verdict glyph;
  // loaded rows aggregate the per-extension toggle state (at least
  // one child enabled → ✓, every child disabled → ✕), mirroring the
  // BFF projection. This keeps the list view consistent with the
  // per-extension toggle model now that the plugin itself has no
  // toggle axis.
  const isLoaded = p.status === 'enabled';
  const extensions = p.extensions ?? [];
  const enabled = isLoaded
    ? extensions.length === 0 || extensions.some((e) => resolveEnabled(qualifiedExtensionId(p.id, e.id)))
    : false;
  const names = extensions.map((e) => {
    const safeId = withStabilityTag(sanitizeForTerminal(e.id), e.stability);
    return resolveEnabled(qualifiedExtensionId(p.id, e.id))
      ? safeId
      : `${PLUGINS_TEXTS.rowGlyphOff} ${safeId}`;
  });
  const reason =
    p.status === 'enabled'
      ? undefined
      : sanitizeForTerminal(p.reason ?? '') || undefined;
  return {
    id: sanitizeForTerminal(p.id),
    enabled,
    source: PLUGINS_TEXTS.sourceUser,
    names,
    reason,
  };
}

/**
 * Greedy wrap of a comma-separated list to a soft visible width.
 * Returns the raw (uncoloured, un-indented) chunks; the caller
 * prepends indent + applies color so wrap math stays honest under
 * color codes.
 */
function wrapNames(names: string[], indent: string, maxWidth: number): string[] {
  const out: string[] = [];
  const sep = ', ';
  let current = '';
  for (const name of names) {
    const candidate = current === '' ? name : `${current}${sep}${name}`;
    if (indent.length + candidate.length > maxWidth && current !== '') {
      out.push(`${current},`);
      current = name;
    } else {
      current = candidate;
    }
  }
  if (current !== '') out.push(current);
  return out;
}
