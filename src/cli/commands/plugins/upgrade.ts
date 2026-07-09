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

import { defaultProjectPluginsDir } from '../../../core/paths/db-path.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';
import { pluginPackageJson } from './scaffold/index.js';

/** Per-plugin outcome of the `package.json` structural backfill. */
type TBackfillOutcome = 'created' | 'added-type' | 'ok' | 'foreign-type';

interface IBackfillEntry {
  id: string;
  outcome: TBackfillOutcome;
}

interface IBackfillResult {
  entries: IBackfillEntry[];
  /** Set when an explicit `<plugin-id>` matched no discovered plugin dir. */
  notFound: string | null;
}

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
    this.printer!.data(
      'sm plugins upgrade: no catalog migrations registered for v1.0.0.\n' +
        '  All loaded plugins are catalog-current.\n' +
        '  Run `sm plugins doctor` to surface any incompatible-catalog status.\n',
    );
    return result.notFound !== null ? ExitCode.Error : ExitCode.Ok;
  }

  private renderBackfill(result: IBackfillResult): void {
    if (result.notFound !== null) {
      this.printer!.warn(
        `  no plugin '${result.notFound}' under the project plugins dir; nothing to upgrade.\n`,
      );
      return;
    }
    for (const entry of result.entries) {
      switch (entry.outcome) {
        case 'created':
          this.printer!.data(
            `  ${entry.id}: wrote package.json ("type": "module") so Node loads its ESM extensions cleanly.\n`,
          );
          break;
        case 'added-type':
          this.printer!.data(`  ${entry.id}: added "type": "module" to its package.json.\n`);
          break;
        case 'foreign-type':
          this.printer!.warn(
            `  ${entry.id}: package.json declares a non-module "type" (or is malformed); left untouched, check it if Node warns about the module type.\n`,
          );
          break;
        case 'ok':
          // Already current; stay quiet so the output highlights only changes.
          break;
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
