/**
 * `sm plugins upgrade [<plugin-id>]`, apply registered catalog
 * migrations to one (or every) plugin manifest. Empty migration
 * registry today (Phase 5 / catalog v1.0.0); the verb structure
 * exists so future renames / deprecations land without spec churn.
 */

import { Command, Option } from 'clipanion';

import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';

export class PluginsUpgradeCommand extends SmCommand {
  static override paths = [['plugins', 'upgrade']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Apply catalog migrations to plugin manifests.',
    details:
      'No migrations registered against catalog v1.0.0 yet; this verb is a no-op today. The structure exists so future slot renames / deprecations land without spec churn.',
  });

  pluginId = Option.String({ required: false, name: 'plugin-id' });

  protected async run(): Promise<number> {
    this.printer!.data(
      'sm plugins upgrade: no migrations registered for catalog v1.0.0.\n' +
        '  All loaded plugins are catalog-current.\n' +
        '  Run `sm plugins doctor` to surface any incompatible-catalog status.\n',
    );
    return ExitCode.Ok;
  }
}
