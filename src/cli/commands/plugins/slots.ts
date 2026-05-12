/**
 * `sm plugins slots list`, print the closed catalogs of view slots +
 * input-types. Read-only browser the user invokes when scaffolding a
 * plugin manually or evaluating which slot fits a use case.
 */

import { Command } from 'clipanion';

import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import { ansiFor } from '../../util/ansi.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';
import { INPUT_TYPES_CATALOG, VIEW_SLOTS_CATALOG } from './slots-catalog.js';

export class PluginsSlotsListCommand extends SmCommand {
  static override paths = [['plugins', 'slots', 'list']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Print the closed catalogs of view slots and input-types.',
    details: 'Read-only. Use this when picking a slot / input-type for a new plugin.',
  });

  protected async run(): Promise<number> {
    if (this.json) {
      this.printer!.data(
        JSON.stringify(
          { viewSlots: VIEW_SLOTS_CATALOG, inputTypes: INPUT_TYPES_CATALOG },
          null,
          2,
        ) + '\n',
      );
      return ExitCode.Ok;
    }
    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const idWidth = Math.max(
      ...VIEW_SLOTS_CATALOG.map((c) => c.id.length),
      ...INPUT_TYPES_CATALOG.map((t) => t.id.length),
    );
    this.printer!.data(
      tx(PLUGINS_TEXTS.slotsListHeaderViewSlots, { count: VIEW_SLOTS_CATALOG.length }),
    );
    for (const c of VIEW_SLOTS_CATALOG) {
      this.printer!.data(
        `    ${c.id.padEnd(idWidth)}  ${ansi.dim(c.summary)}\n`,
      );
    }
    this.printer!.data(
      tx(PLUGINS_TEXTS.slotsListHeaderInputTypes, { count: INPUT_TYPES_CATALOG.length }),
    );
    for (const t of INPUT_TYPES_CATALOG) {
      this.printer!.data(
        `    ${t.id.padEnd(idWidth)}  ${ansi.dim(t.summary)}\n`,
      );
    }
    this.printer!.data(
      tx(PLUGINS_TEXTS.slotsListTipFooter, {
        tip: ansi.dim(PLUGINS_TEXTS.slotsListTipText),
      }),
    );
    return ExitCode.Ok;
  }
}
