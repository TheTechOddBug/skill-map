/**
 * `sm plugins config <plugin>/<ext> [<settingId> [<value>]]`, read and
 * write the operator-supplied values for an extension's declared
 * settings.
 *
 *   sm plugins config <plugin>/<ext>                      table: setting · effective value · source layer
 *   sm plugins config <plugin>/<ext> <settingId> <value>  coerce + validate + write
 *   sm plugins config <plugin>/<ext> <settingId> --reset  remove the override key
 *
 * The verb requires a qualified `<plugin>/<ext>` id; a bare plugin id is
 * the wrong granularity and is rejected with a redirect to
 * `sm plugins list <id>` (mirrors `sm plugins show`).
 *
 * Storage: a non-`secret` value lands in the committed
 * `.skill-map/settings.json` (`project` layer); a `secret`-typed value
 * is forced to the gitignored `.skill-map/settings.local.json`
 * (`project-local` layer), the dynamic equivalent of
 * `PROJECT_LOCAL_ONLY_KEYS` keyed off the declared input-type rather
 * than a fixed key list (see `input-types.schema.json#/$defs/Setting_Secret`).
 * There is no encryption, the protection is that the value never travels
 * via the shared repo. Secret values are redacted as `<redacted>` in
 * every output.
 *
 * The config tree key for a value is
 * `plugins.<pluginId>.extensions.<extId>.settings.<settingId>` (the
 * extension id is the leaf folder name, the plugin is already the
 * parent key). Reads / writes go through `core/config/helper` (the same
 * dot-path + AJV-revalidate pipeline `sm config set` uses); the
 * per-value type validation is the settings resolver's job
 * (`core/config/plugin-settings`).
 */

import { Command, Option } from 'clipanion';

import { builtInPlugins } from '../../../plugins/built-ins.js';
import {
  ConfigValidationError,
  ForbiddenSegmentError,
  getValueSource,
  ProjectLocalOnlyKeyError,
  readConfigValue,
  removeConfigValue,
  writeConfigValue,
} from '../../../core/config/helper.js';
import { resolveExtensionSettings } from '../../../core/config/plugin-settings.js';
import { loadConfig, type TConfigLayer } from '../../../kernel/config/loader.js';
import type { ILoadedExtension } from '../../../kernel/types/plugin.js';
import type { TSettingDeclaration } from '../../../kernel/types/view-catalog.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_CONFIG_TEXTS } from '../../i18n/plugins-config.texts.js';
import { defaultLocalSettingsPath, defaultSettingsPath } from '../../util/db-path.js';
import { ExitCode } from '../../util/exit-codes.js';
import { relativeIfBelow } from '../../util/path-display.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { SmCommand } from '../../util/sm-command.js';
import {
  loadAll,
  parseQualifiedExtensionId,
  pluginCatalogue,
  renderQualifiedIdError,
} from './shared.js';

type TWriteTarget = 'project' | 'project-local';

export class PluginsConfigCommand extends SmCommand {
  static override paths = [['plugins', 'config']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Read or write an extension\'s declared settings.',
    details: `
      Operates on a single extension by its qualified \`<plugin>/<ext>\`
      id. With no settingId it prints a table of each declared setting,
      its effective value, and the config layer that set it. With a
      settingId + value it coerces the shell string to the declared
      input-type, validates it, and writes
      \`plugins.<plugin>.extensions.<ext>.settings.<settingId>\` to
      settings.json (or settings.local.json for \`secret\` settings).
      \`--reset\` removes the override so the manifest default applies.
      Secret values are shown as <redacted>. Run \`sm scan\` to apply.
    `,
  });

  id = Option.String({ required: true });
  settingId = Option.String({ required: false });
  value = Option.String({ required: false });
  reset = Option.Boolean('--reset', false, {
    description: 'Remove the override for <settingId> so the manifest default applies.',
  });
  pluginDir = Option.String('--plugin-dir', { required: false });

  // Read-only when listing; the write / reset paths emit their own
  // receipt. `sm config` exempts the config family from "done in <…>";
  // mirror that here for the read path. The write path keeps the line.
  protected override emitElapsed = true;

  // CLI orchestrator: each branch is one validation gate (bare id /
  // unknown extension / no settings / unknown setting) or a mode
  // dispatch (table vs set vs reset). Splitting per branch scatters the
  // gate from the value it gates.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const stderrAnsi = this.ansiFor('stderr');

    // `config` operates on one extension. A bare plugin id is the wrong
    // granularity, redirect to `sm plugins list <id>` (mirrors `show`).
    if (!this.id.includes('/')) {
      this.printer!.error(
        tx(PLUGINS_CONFIG_TEXTS.bareId, {
          glyph: stderrAnsi.red('✕'),
          id: sanitizeForTerminal(this.id),
          hint: stderrAnsi.dim(
            tx(PLUGINS_CONFIG_TEXTS.bareIdHint, { id: sanitizeForTerminal(this.id) }),
          ),
        }),
      );
      return ExitCode.Error;
    }

    const plugins = await loadAll({ pluginDir: this.pluginDir });
    const parsed = parseQualifiedExtensionId(this.id, pluginCatalogue(plugins));
    if (!parsed.ok) {
      this.printer!.error(renderQualifiedIdError(parsed, this.id, stderrAnsi));
      return ExitCode.NotFound;
    }
    const { pluginId, extId } = parsed;

    const declarations = resolveDeclaredSettings(pluginId, extId, plugins);
    if (!declarations || Object.keys(declarations).length === 0) {
      this.printer!.error(
        tx(PLUGINS_CONFIG_TEXTS.noSettings, {
          glyph: stderrAnsi.red('✕'),
          id: sanitizeForTerminal(this.id),
          hint: stderrAnsi.dim(
            tx(PLUGINS_CONFIG_TEXTS.noSettingsHint, { id: sanitizeForTerminal(this.id) }),
          ),
        }),
      );
      return ExitCode.NotFound;
    }

    // Mode 1: no settingId → print the table / JSON of resolved values.
    if (this.settingId === undefined) {
      return this.renderTable(pluginId, extId, declarations, ctx.cwd);
    }

    // The settingId must be one the manifest declares.
    const declaration = declarations[this.settingId];
    if (!declaration) {
      this.printer!.error(
        tx(PLUGINS_CONFIG_TEXTS.unknownSetting, {
          glyph: stderrAnsi.red('✕'),
          settingId: sanitizeForTerminal(this.settingId),
          id: sanitizeForTerminal(this.id),
          hint: stderrAnsi.dim(
            tx(PLUGINS_CONFIG_TEXTS.unknownSettingHint, {
              declared: Object.keys(declarations).map((k) => `'${k}'`).join(', '),
            }),
          ),
        }),
      );
      return ExitCode.NotFound;
    }

    // Mode 3: --reset → remove the override key.
    if (this.reset) {
      return this.resetSetting(pluginId, extId, this.settingId, declaration, ctx.cwd);
    }

    // Mode 2: settingId + value → coerce, validate, write.
    if (this.value === undefined) {
      // A settingId with neither a value nor --reset reads the single
      // value (table view scoped to one row).
      return this.renderTable(pluginId, extId, { [this.settingId]: declaration }, ctx.cwd);
    }
    return this.writeSetting(pluginId, extId, this.settingId, declaration, this.value, ctx.cwd);
  }

  /**
   * Render the settings table (human) or the resolved set (`--json`).
   * Effective values come from the kernel settings resolver so the table
   * shows exactly what `ctx.settings.<id>` would see at scan time
   * (default overlaid by the config override, validated). Secret values
   * are redacted.
   */
  private renderTable(
    pluginId: string,
    extId: string,
    declarations: Record<string, TSettingDeclaration>,
    cwd: string,
  ): number {
    const { effective } = loadConfig({ cwd });
    const resolved = resolveExtensionSettings({ pluginId, id: extId, settings: declarations }, effective, () => {
      /* swallow resolver warnings here; the table shows the fallback value */
    });

    if (this.json) {
      const payload: Record<string, unknown> = {};
      for (const [settingId, declaration] of Object.entries(declarations)) {
        payload[settingId] = declaration.type === 'secret'
          ? PLUGINS_CONFIG_TEXTS.redacted
          : resolved[settingId] ?? null;
      }
      this.printer!.data(JSON.stringify(payload) + '\n');
      return ExitCode.Ok;
    }

    const ansi = this.ansiFor('stdout');
    const lines: string[] = [tx(PLUGINS_CONFIG_TEXTS.tableHeader, { id: `${pluginId}/${extId}` })];
    const idWidth = Math.max(...Object.keys(declarations).map((k) => k.length));
    for (const [settingId, declaration] of Object.entries(declarations)) {
      const display = declaration.type === 'secret'
        ? PLUGINS_CONFIG_TEXTS.redacted
        : formatValue(resolved[settingId]);
      const dotKey = settingDotKey(pluginId, extId, settingId);
      const source = getValueSource(dotKey, { cwd });
      const sourceTag = source
        ? ansi.dim(tx(PLUGINS_CONFIG_TEXTS.tableSourceTag, { source: layerLabel(source) }))
        : '';
      lines.push(
        tx(PLUGINS_CONFIG_TEXTS.tableRow, {
          settingId: settingId.padEnd(idWidth),
          value: sanitizeForTerminal(display),
          sourceTag,
        }),
      );
    }
    this.printer!.data(lines.join(''));
    return ExitCode.Ok;
  }

  private writeSetting(
    pluginId: string,
    extId: string,
    settingId: string,
    declaration: TSettingDeclaration,
    raw: string,
    cwd: string,
  ): number {
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');

    // Coerce the shell string to the declared type before validating.
    const coerced = coerceCliValue(declaration, raw);
    if (!coerced.ok) {
      this.printer!.error(
        tx(PLUGINS_CONFIG_TEXTS.coerceFailed, {
          glyph: errGlyph,
          value: sanitizeForTerminal(raw),
          type: declaration.type,
          settingId: sanitizeForTerminal(settingId),
          hint: stderrAnsi.dim(tx(PLUGINS_CONFIG_TEXTS.coerceFailedHint, { detail: coerced.reason })),
        }),
      );
      return ExitCode.Error;
    }

    // Validate the coerced value against the per-type value rules. The
    // resolver is the single source of truth for what a valid value is;
    // we run it with a throwing sink so an invalid value is rejected at
    // write time instead of being silently dropped to default at scan.
    let invalidReason: string | null = null;
    resolveExtensionSettings(
      { pluginId, id: extId, settings: { [settingId]: declaration } },
      { plugins: { [pluginId]: { extensions: { [extId]: { settings: { [settingId]: coerced.value } } } } } },
      (message) => { invalidReason = message; },
    );
    if (invalidReason !== null) {
      this.printer!.error(
        tx(PLUGINS_CONFIG_TEXTS.validationFailed, {
          glyph: errGlyph,
          settingId: sanitizeForTerminal(settingId),
          type: declaration.type,
          reason: invalidReason,
        }),
      );
      return ExitCode.Error;
    }

    // `secret`-typed settings route to the project-local layer
    // (gitignored), never the committed file, regardless of the absence
    // of an explicit local flag.
    const target: TWriteTarget = declaration.type === 'secret' ? 'project-local' : 'project';
    const dotKey = settingDotKey(pluginId, extId, settingId);
    try {
      writeConfigValue(dotKey, coerced.value, { target, cwd });
    } catch (err) {
      return this.renderWriteError(err, settingId);
    }

    const ansi = this.ansiFor('stdout');
    const display = declaration.type === 'secret'
      ? PLUGINS_CONFIG_TEXTS.redacted
      : formatValue(coerced.value);
    const path = target === 'project-local' ? defaultLocalSettingsPath(cwd) : defaultSettingsPath(cwd);
    this.printer!.data(
      tx(PLUGINS_CONFIG_TEXTS.setWritten, {
        glyph: ansi.green('✓'),
        settingId,
        value: sanitizeForTerminal(display),
        id: `${pluginId}/${extId}`,
        wroteTag: ansi.dim(tx(PLUGINS_CONFIG_TEXTS.setWroteTag, { path: relativeIfBelow(path, cwd) })),
      }),
    );
    this.printRescanFooter();
    return ExitCode.Ok;
  }

  private resetSetting(
    pluginId: string,
    extId: string,
    settingId: string,
    declaration: TSettingDeclaration,
    cwd: string,
  ): number {
    // Mirror the write routing: a secret override lives in
    // project-local, so the reset targets the same file.
    const target: TWriteTarget = declaration.type === 'secret' ? 'project-local' : 'project';
    const dotKey = settingDotKey(pluginId, extId, settingId);
    const ansi = this.ansiFor('stdout');
    let removed: boolean;
    try {
      removed = removeConfigValue(dotKey, { target, cwd });
    } catch (err) {
      return this.renderWriteError(err, settingId);
    }
    if (!removed) {
      this.printer!.data(
        tx(PLUGINS_CONFIG_TEXTS.resetNoOverride, {
          glyph: ansi.green('✓'),
          settingId,
          id: `${pluginId}/${extId}`,
        }),
      );
      return ExitCode.Ok;
    }
    const path = target === 'project-local' ? defaultLocalSettingsPath(cwd) : defaultSettingsPath(cwd);
    this.printer!.data(
      tx(PLUGINS_CONFIG_TEXTS.resetRemoved, {
        glyph: ansi.green('✓'),
        settingId,
        id: `${pluginId}/${extId}`,
        wroteTag: ansi.dim(tx(PLUGINS_CONFIG_TEXTS.setWroteTag, { path: relativeIfBelow(path, cwd) })),
      }),
    );
    this.printRescanFooter();
    return ExitCode.Ok;
  }

  private renderWriteError(err: unknown, settingId: string): number {
    const ansi = this.ansiFor('stderr');
    const glyph = ansi.red('✕');
    if (err instanceof ForbiddenSegmentError) {
      this.printer!.error(
        tx(PLUGINS_CONFIG_TEXTS.writeFailed, { glyph, settingId, message: err.message }),
      );
      return ExitCode.Error;
    }
    if (err instanceof ProjectLocalOnlyKeyError) {
      this.printer!.error(
        tx(PLUGINS_CONFIG_TEXTS.writeFailed, { glyph, settingId, message: err.message }),
      );
      return ExitCode.Error;
    }
    if (err instanceof ConfigValidationError) {
      this.printer!.error(
        tx(PLUGINS_CONFIG_TEXTS.writeFailed, { glyph, settingId, message: err.errors }),
      );
      return ExitCode.Error;
    }
    throw err;
  }

  private printRescanFooter(): void {
    if (this.json) return;
    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(PLUGINS_CONFIG_TEXTS.rescanFooter, {
        hint: ansi.dim(PLUGINS_CONFIG_TEXTS.rescanFooterText),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// settings-declaration lookup
// ---------------------------------------------------------------------------

/**
 * Resolve the declared `settings` map for `<pluginId>/<extId>`. Built-ins
 * are read from `builtInPlugins`; user plugins from the discovered
 * extension instance (the loader-cloned `IExtensionBase`). Returns
 * `undefined` when the extension cannot be found or declares no settings.
 */
function resolveDeclaredSettings(
  pluginId: string,
  extId: string,
  plugins: Awaited<ReturnType<typeof loadAll>>,
): Record<string, TSettingDeclaration> | undefined {
  for (const plugin of builtInPlugins) {
    if (plugin.id !== pluginId) continue;
    for (const ext of plugin.extensions) {
      if (ext.id === extId) return ext.settings;
    }
  }
  const match = plugins.find((p) => p.id === pluginId);
  const userExt = match?.extensions?.find((e: ILoadedExtension) => e.id === extId);
  return readInstanceSettings(userExt?.instance);
}

function readInstanceSettings(instance: unknown): Record<string, TSettingDeclaration> | undefined {
  if (instance === null || typeof instance !== 'object') return undefined;
  const settings = (instance as { settings?: unknown }).settings;
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    return settings as Record<string, TSettingDeclaration>;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// value coercion (shell string → declared type)
// ---------------------------------------------------------------------------

interface ICoerceOk {
  ok: true;
  value: unknown;
}
interface ICoerceErr {
  ok: false;
  reason: string;
}

/**
 * Coerce a shell-string `<value>` to the declared input-type. Numeric
 * types parse numerically; boolean-flag accepts `true` / `false`;
 * array / list types (string-list, enum-multipick, key-value-list) and
 * the multiple path-glob parse as JSON; everything else is taken as the
 * literal string. The result is then validated by the caller against
 * the per-type value rules; this step only owns the string → JS-value
 * transformation.
 */
// eslint-disable-next-line complexity
function coerceCliValue(declaration: TSettingDeclaration, raw: string): ICoerceOk | ICoerceErr {
  switch (declaration.type) {
    case 'integer':
    case 'number': {
      const n = Number(raw);
      if (raw.trim() === '' || Number.isNaN(n)) return { ok: false, reason: 'expected a numeric value' };
      return { ok: true, value: n };
    }
    case 'boolean-flag': {
      if (raw === 'true') return { ok: true, value: true };
      if (raw === 'false') return { ok: true, value: false };
      return { ok: false, reason: 'expected `true` or `false`' };
    }
    case 'string-list':
    case 'enum-multipick':
    case 'key-value-list':
      return parseJsonValue(raw);
    case 'path-glob':
      // `multiple: true` accepts a JSON array; the single form is a
      // plain string.
      return declaration.multiple === true ? parseJsonValue(raw) : { ok: true, value: raw };
    case 'single-string':
    case 'enum-pick':
    case 'regex':
    case 'secret':
      return { ok: true, value: raw };
    default: {
      const _exhaustive: never = declaration;
      return { ok: false, reason: `unknown input-type: ${String((_exhaustive as { type?: string }).type)}` };
    }
  }
}

function parseJsonValue(raw: string): ICoerceOk | ICoerceErr {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: 'expected a JSON value (e.g. ["a","b"])' };
  }
}

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

function settingDotKey(pluginId: string, extId: string, settingId: string): string {
  return `plugins.${pluginId}.extensions.${extId}.settings.${settingId}`;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const LAYER_LABEL: Record<TConfigLayer, string> = {
  defaults: 'default',
  project: 'settings.json',
  'project-local': 'settings.local.json',
  override: 'override',
};

function layerLabel(layer: TConfigLayer): string {
  return LAYER_LABEL[layer];
}
