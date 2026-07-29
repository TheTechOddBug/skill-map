/**
 * `sm plugins upgrade [<plugin-id>]`, bring existing drop-in plugins up
 * to the current scaffolding standard. Two concerns:
 *
 *   1. **Structural backfill**: ensure every plugin ships a `package.json`
 *      with `"type": "module"` so Node loads its ESM `.js` extensions
 *      without the `MODULE_TYPELESS_PACKAGE_JSON` warning (the scaffolder
 *      emits this for new plugins; upgrade repairs ones created before it
 *      did). Never clobbers a package.json that already declares a
 *      non-module `type`.
 *   2. **Catalog migrations**: apply registered slot / kind renames. The
 *      migration registry is empty today (catalog v1.0.0); the structure
 *      exists so future migrations land without spec churn.
 *
 * Operates on the operator's own project-local plugin files
 * (`.skill-map/plugins/`), so no consent gate: running the verb is the
 * choice to touch them.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Command, Option } from 'clipanion';

import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { defaultProjectPluginsDir } from '../../../core/paths/db-path.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';
import { pluginPackageJson } from './scaffold/index.js';

/** Per-plugin outcome of the `package.json` structural backfill. */
type TBackfillOutcome = 'created' | 'added-type' | 'ok' | 'foreign-type';

/** Plural directory name per extension kind, the discovery convention. */
const KIND_DIRS: readonly string[] = [
  'providers',
  'extractors',
  'analyzers',
  'actions',
  'formatters',
  'hooks',
];

/** Entry file names checked inside each `<kind>s/<name>/`, priority order. */
const INDEX_FILES: readonly string[] = ['index.js', 'index.mjs', 'index.ts'];

/** Fields that moved from the module into `extension.json`. */
const MOVED_FIELDS: readonly string[] = ['version', 'description', 'stability', 'defaultEnabled'];

/** Per-extension outcome of the `extension.json` migration. */
type TExtOutcome = 'ext-created' | 'ext-partial' | 'ext-ok' | 'ext-stale-module';

interface IExtEntry {
  /** `<plugin>/<kind>s/<name>`, relative, for the operator to locate it. */
  where: string;
  outcome: TExtOutcome;
  /** For `ext-stale-module`: the field names still declared in the module. */
  staleFields: string[];
  /** The entry file that carries them, so the message names a real file. */
  indexFile: string;
}

interface IBackfillEntry {
  id: string;
  outcome: TBackfillOutcome;
}

interface IBackfillResult {
  entries: IBackfillEntry[];
  /** Set when an explicit `<plugin-id>` matched no discovered plugin dir. */
  notFound: string | null;
}

/**
 * Read one field's literal out of an extension module's SOURCE TEXT.
 *
 * Deliberately lexical, never a dynamic `import()`. Importing here would
 * execute exactly the code the enable / trust gates exist to hold back,
 * in the worst possible moment: an operator running `sm plugins upgrade`
 * on a freshly cloned repo, before trusting anything. A migration verb
 * that bypasses the security boundary it is migrating toward is not a
 * migration, it is the hole.
 *
 * Handles both authoring forms the scaffolder and every in-repo fixture
 * use: the value on the same line as the key, and the value on the next
 * line (prettier's wrap for long descriptions). Anything it cannot read
 * is reported so the author fills it in, rather than guessed at.
 *
 * Precedent: `scripts/generate-built-ins.js` already scrapes `mode` and
 * `stability` out of TypeScript source with regexes, for the same reason
 * (it runs before the TS build and cannot import the module).
 */
function readFieldFromSource(source: string, field: string): string | boolean | null {
  const quoted = new RegExp(`^[ \\t]*${field}:[ \\t]*(['"])(.*?)\\1`, 'm');
  const sameLine = quoted.exec(source);
  if (sameLine) return sameLine[2] ?? null;
  const wrapped = new RegExp(`^[ \\t]*${field}:[ \\t]*\\n[ \\t]*(['"])(.*?)\\1`, 'm');
  const nextLine = wrapped.exec(source);
  if (nextLine) return nextLine[2] ?? null;
  const bool = new RegExp(`^[ \\t]*${field}:[ \\t]*(true|false)`, 'm').exec(source);
  if (bool) return bool[1] === 'true';
  return null;
}

/** Does the module source still declare any of the relocated fields? */
function staleFieldsIn(source: string): string[] {
  return MOVED_FIELDS.filter((f) => new RegExp(`^[ \\t]*${f}[ \\t]*:`, 'm').test(source));
}

/**
 * Write a missing `extension.json` for every extension of every
 * discovered plugin, seeding it from the module's source text.
 *
 * This verb deliberately does NOT rewrite the module to delete the
 * relocated fields. Editing someone's JavaScript with regexes is how a
 * migration corrupts a plugin; the author deletes four lines instead,
 * and the renderer prints exactly which ones. Until they do, the plugin
 * stays `invalid-manifest`, which is the honest state.
 */
function migrateExtensionManifests(pluginsDir: string, onlyId?: string): IExtEntry[] {
  const out: IExtEntry[] = [];
  for (const pluginId of listDirSorted(pluginsDir)) {
    if (onlyId !== undefined && pluginId !== onlyId) continue;
    const pluginDir = join(pluginsDir, pluginId);
    if (!existsSync(join(pluginDir, 'plugin.json'))) continue;
    for (const { dir, where } of extensionDirsOf(pluginDir, pluginId)) {
      const entry = migrateOneExtension(dir, where);
      if (entry !== null) out.push(entry);
    }
  }
  return out;
}

/** Sorted directory listing, empty for anything absent or unreadable. */
function listDirSorted(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path).sort();
  } catch {
    return [];
  }
}

/** Every `<kind>s/<name>/` directory of one plugin, in discovery order. */
function extensionDirsOf(
  pluginDir: string,
  pluginId: string,
): Array<{ dir: string; where: string }> {
  const out: Array<{ dir: string; where: string }> = [];
  for (const kindDir of KIND_DIRS) {
    const kindPath = join(pluginDir, kindDir);
    for (const name of listDirSorted(kindPath)) {
      out.push({ dir: join(kindPath, name), where: `${pluginId}/${kindDir}/${name}` });
    }
  }
  return out;
}

/** `null` when the directory holds no extension entry file at all. */
function migrateOneExtension(extDir: string, where: string): IExtEntry | null {
  const indexFile = INDEX_FILES.find((f) => existsSync(join(extDir, f)));
  if (indexFile === undefined) return null;
  let source: string;
  try {
    source = readFileSync(join(extDir, indexFile), 'utf8');
  } catch {
    return null;
  }
  const stale = staleFieldsIn(source);
  const metaPath = join(extDir, 'extension.json');

  if (existsSync(metaPath)) {
    // Already migrated. The only thing left to report is a module that
    // never had its relocated fields deleted, which still fails to load.
    const outcome: TExtOutcome = stale.length > 0 ? 'ext-stale-module' : 'ext-ok';
    return { where, outcome, staleFields: stale, indexFile };
  }

  const { meta, complete } = seedExtensionMeta(source);
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  return {
    where,
    outcome: complete ? 'ext-created' : 'ext-partial',
    staleFields: stale,
    indexFile,
  };
}

/**
 * Build the `extension.json` body from a module's source text.
 * `complete` is false when either required field had to fall back to a
 * placeholder, which the caller surfaces as a warning rather than
 * pretending the migration finished.
 */
function seedExtensionMeta(source: string): { meta: Record<string, unknown>; complete: boolean } {
  const version = readFieldFromSource(source, 'version');
  const description = readFieldFromSource(source, 'description');
  const stability = readFieldFromSource(source, 'stability');
  const defaultEnabled = readFieldFromSource(source, 'defaultEnabled');
  const meta: Record<string, unknown> = {
    version: typeof version === 'string' ? version : TODO_VALUE,
    description: typeof description === 'string' ? description : TODO_VALUE,
  };
  if (typeof stability === 'string') meta['stability'] = stability;
  if (typeof defaultEnabled === 'boolean') meta['defaultEnabled'] = defaultEnabled;
  return { meta, complete: typeof version === 'string' && typeof description === 'string' };
}

/** Placeholder for a field the source did not yield; the author fills it. */
const TODO_VALUE = 'TODO';

export class PluginsUpgradeCommand extends SmCommand {
  static override paths = [['plugins', 'upgrade']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Bring drop-in plugins up to the current scaffolding standard.',
    details:
      'Backfills a `package.json` with `"type": "module"` on plugins missing it (so Node loads their ESM extensions without the MODULE_TYPELESS warning), then applies any registered catalog migrations (none against catalog v1.0.0 yet). Pass a `<plugin-id>` to upgrade one; omit it to upgrade every discovered plugin.',
  });

  pluginId = Option.String({ required: false, name: 'plugin-id' });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const pluginsDir = defaultProjectPluginsDir(ctx);
    const result = backfillPluginPackageJson(pluginsDir, this.pluginId);
    this.renderBackfill(result);
    if (result.notFound === null) {
      this.renderExtensionMigration(migrateExtensionManifests(pluginsDir, this.pluginId));
    }
    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(PLUGINS_TEXTS.upgradeNoMigrations, {
        glyph: ansi.green('✓'),
        tip: ansi.dim(PLUGINS_TEXTS.upgradeNoMigrationsTip),
      }),
    );
    return result.notFound !== null ? ExitCode.Error : ExitCode.Ok;
  }

  private renderBackfill(result: IBackfillResult): void {
    if (result.notFound !== null) {
      // §3.1b block on stderr: the verb exits Error for this case, so the
      // rejection renders as an error, not a soft warning.
      const stderrAnsi = this.ansiFor('stderr');
      this.printer!.error(
        tx(PLUGINS_TEXTS.upgradeNotFound, {
          glyph: stderrAnsi.red('✕'),
          id: sanitizeForTerminal(result.notFound),
          hint: stderrAnsi.dim(PLUGINS_TEXTS.upgradeNotFoundHint),
        }),
      );
      return;
    }
    for (const entry of result.entries) {
      // Plugin ids are directory names read off disk (dirent), so they
      // sanitize before interpolation per context/kernel.md §CLI output
      // sanitization (filesystem entries category).
      const id = sanitizeForTerminal(entry.id);
      const rowAnsi = this.ansiFor('stdout');
      switch (entry.outcome) {
        case 'created':
          this.printer!.data(
            tx(PLUGINS_TEXTS.upgradeBackfillCreated, { glyph: rowAnsi.green('✓'), id }),
          );
          break;
        case 'added-type':
          this.printer!.data(
            tx(PLUGINS_TEXTS.upgradeBackfillAddedType, { glyph: rowAnsi.green('✓'), id }),
          );
          break;
        case 'foreign-type':
          this.printer!.warn(
            tx(PLUGINS_TEXTS.upgradeBackfillForeignType, {
              glyph: this.ansiFor('stderr').yellow('⚠'),
              id,
            }),
          );
          break;
        case 'ok':
          // Already current; stay quiet so the output highlights only changes.
          break;
      }
    }
  }

  /**
   * Report the `extension.json` migration. Silent when every extension
   * was already current, so the verb's output stays a list of changes
   * rather than an inventory.
   */
  private renderExtensionMigration(entries: readonly IExtEntry[]): void {
    const notable = entries.filter((e) => e.outcome !== 'ext-ok' || e.staleFields.length > 0);
    if (notable.length === 0) return;
    this.printer!.data(PLUGINS_TEXTS.upgradeExtHeader);
    for (const entry of notable) {
      // `where` is composed from directory names read off disk, so it
      // sanitizes before interpolation (context/kernel.md §CLI output
      // sanitization, filesystem entries).
      const where = sanitizeForTerminal(entry.where);
      const stdout = this.ansiFor('stdout');
      if (entry.outcome === 'ext-created') {
        this.printer!.data(tx(PLUGINS_TEXTS.upgradeExtCreated, { glyph: stdout.green('✓'), where }));
      } else if (entry.outcome === 'ext-partial') {
        this.printer!.warn(
          tx(PLUGINS_TEXTS.upgradeExtPartial, {
            glyph: this.ansiFor('stderr').yellow('⚠'),
            where,
          }),
        );
      }
      // A stale module is reported even when the file was just written,
      // because writing the file is only half the migration.
      if (entry.staleFields.length > 0) {
        this.printer!.warn(
          tx(PLUGINS_TEXTS.upgradeExtStaleModule, {
            glyph: this.ansiFor('stderr').yellow('⚠'),
            where,
            fields: entry.staleFields.map((f) => `\`${f}\``).join(', '),
            indexFile: sanitizeForTerminal(entry.indexFile),
          }),
        );
      }
    }
  }
}

/**
 * Ensure each discovered plugin dir carries a `package.json` with
 * `"type": "module"`. A plugin dir is any immediate subdirectory of the
 * plugins dir that holds a `plugin.json`. When `onlyId` is given, only
 * that plugin is touched (and a miss is reported via `notFound`).
 */
function backfillPluginPackageJson(
  pluginsDir: string,
  onlyId: string | undefined,
): IBackfillResult {
  if (!existsSync(pluginsDir)) {
    return { entries: [], notFound: onlyId ?? null };
  }
  const pluginIds = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(pluginsDir, d.name, 'plugin.json')))
    .map((d) => d.name);
  const targets = onlyId !== undefined ? pluginIds.filter((id) => id === onlyId) : pluginIds;
  if (onlyId !== undefined && targets.length === 0) {
    return { entries: [], notFound: onlyId };
  }
  const entries = targets.map((id) => ({ id, outcome: ensurePackageJson(join(pluginsDir, id)) }));
  return { entries, notFound: null };
}

/**
 * Ensure ONE plugin dir's `package.json` declares `"type": "module"`.
 * Missing file → write the canonical minimal one; present without a
 * `type` → add it, preserving every other field; already `module` →
 * no-op; a foreign / malformed `type` → leave it and report so the
 * operator inspects it (never clobber an explicit author choice).
 */
function ensurePackageJson(pluginDir: string): TBackfillOutcome {
  const pkgPath = join(pluginDir, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify(pluginPackageJson(), null, 2) + '\n', 'utf8');
    return 'created';
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return 'foreign-type';
  }
  const type = parsed['type'];
  if (type === 'module') return 'ok';
  if (typeof type === 'string' && type.length > 0) return 'foreign-type';
  parsed['type'] = 'module';
  writeFileSync(pkgPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return 'added-type';
}
