/**
 * `sm plugins create <kind> <plugin-id>`, scaffold a new plugin.
 *
 * `<kind>` (the first positional) is one of the six extension kinds and is
 * required; `<plugin-id>` is the second positional. Emits a lean
 * `plugin.json` (plugin manifest only, no `id` / `settings` at the root,
 * both are structure-as-truth or per-extension now) plus a per-kind
 * extension stub (and any sibling files the kind needs, e.g. an action's
 * `report.schema.json`) and a `README.md`. The author edits to taste.
 *
 * Lands the plugin under `<scope>/.skill-map/plugins/<plugin-id>/` (per
 * `AGENTS.md`, "Plugins are scaffolded, not hand-written", the canonical
 * drop-in location). Use `--at <path>` to override.
 *
 * The kind → generator registry, the stubs, and the shared manifest /
 * README builders live under `./scaffold/`. This command only validates
 * the inputs, resolves the target directory, and writes the file list.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { installedSpecVersion } from '../../../kernel/adapters/plugin-loader.js';
import { EXTENSION_KINDS, type ExtensionKind } from '../../../kernel/registry.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import { defaultProjectPluginsDir } from '../../util/db-path.js';
import { ExitCode } from '../../util/exit-codes.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { SmCommand } from '../../util/sm-command.js';
import { generateScaffold } from './scaffold/index.js';

export class PluginsCreateCommand extends SmCommand {
  static override paths = [['plugins', 'create']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Scaffold a new plugin directory.',
    details:
      'Emits plugin.json + a per-kind extension stub + README. `<kind>` is one of: provider, extractor, analyzer, action, formatter, hook. The extractor stub ships one view contribution (slot `card.footer.left`) and one setting (`string-list`); edit to taste. Use `sm plugins slots list` to browse the slot / input-type catalog.',
    examples: [
      ['Scaffold an extractor', '$0 plugins create extractor kw-counter'],
      ['Scaffold an analyzer', '$0 plugins create analyzer my-linter'],
      ['Scaffold a provider', '$0 plugins create provider my-vendor'],
    ],
  });

  // First positional: the extension kind (required). Declared before
  // `pluginId` so clipanion assigns it the first positional slot.
  kind = Option.String({ required: true, name: 'kind' });
  pluginId = Option.String({ required: true, name: 'plugin-id' });
  at = Option.String('--at', { required: false });
  force = Option.Boolean('--force', false);

  protected async run(): Promise<number> {
    const ansi = this.ansiFor('stderr');
    const errGlyph = ansi.red('✕');
    if (!EXTENSION_KINDS.includes(this.kind as ExtensionKind)) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.createInvalidKind, {
          glyph: errGlyph,
          kind: sanitizeForTerminal(this.kind),
          hint: ansi.dim(
            tx(PLUGINS_TEXTS.createInvalidKindHint, { kinds: EXTENSION_KINDS.join(', ') }),
          ),
        }),
      );
      return ExitCode.Error;
    }
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(this.pluginId)) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.createInvalidId, {
          glyph: errGlyph,
          id: sanitizeForTerminal(this.pluginId),
          hint: ansi.dim(PLUGINS_TEXTS.createInvalidIdHint),
        }),
      );
      return ExitCode.Error;
    }
    const kind = this.kind as ExtensionKind;
    const ctx = defaultRuntimeContext();
    const baseDir = defaultProjectPluginsDir(ctx);
    const targetDir = this.at ? resolve(this.at) : join(baseDir, this.pluginId);
    if (existsSync(targetDir) && !this.force) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.createRefuseOverwrite, {
          glyph: errGlyph,
          targetDir: sanitizeForTerminal(targetDir),
          hint: ansi.dim(PLUGINS_TEXTS.createRefuseOverwriteHint),
        }),
      );
      return ExitCode.Error;
    }

    const specVersion = installedSpecVersion();
    const files = generateScaffold(kind, this.pluginId, specVersion);
    for (const file of files) {
      const abs = join(targetDir, file.relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, file.contents);
    }
    const mainFile = `${kind}s/${this.pluginId}-${kind}/index.js`;

    this.printer!.data(
      tx(PLUGINS_TEXTS.createSuccess, {
        targetDir: sanitizeForTerminal(targetDir),
        mainFile,
      }),
    );
    return ExitCode.Ok;
  }
}
