/**
 * `sm graph [--format <name>]`
 *
 * Renders the persisted graph through a registered formatter and writes
 * the result to stdout. Default `--format ascii`; the other built-in
 * formatters are `json`, `mermaid`, and `dot`. The set is OPEN: any
 * enabled plugin-supplied formatter is selectable by its folder name.
 *
 * Read-only: opens the DB, calls `loadScanResult`, picks the formatter
 * whose `formatId` matches `--format`, and prints. Never persists.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   2  bad flag / no formatter registered / unhandled error
 *   5  DB missing
 *
 * Formatter registry: built-in formatters plus drop-in plugin formatters
 * discovered under `<cwd>/.skill-map/plugins/` (Step 9.1). Failed plugins
 * emit one stderr warning each; the verb keeps running on whatever
 * loaded successfully. Pass `--no-plugins` to skip plugin discovery
 * entirely.
 */

import { Command, Option } from 'clipanion';

import { tx } from '../../kernel/util/tx.js';
import { GRAPH_TEXTS } from '../i18n/graph.texts.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { SmCommand } from '../util/sm-command.js';
import {
  composeFormatters,
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../../core/runtime/plugin-runtime.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { withSqlite } from '../../core/sqlite/with-sqlite.js';

const DEFAULT_FORMAT = 'ascii';

export class GraphCommand extends SmCommand {
  static override paths = [['graph']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Render the full graph via the named formatter.',
    details: `
      Reads the persisted scan and prints a textual rendering. Built-in
      formats: \`ascii\` (default), \`json\`, \`mermaid\` (a Mermaid
      \`flowchart\`), and \`dot\` (a Graphviz \`digraph\`, pipe it into
      \`dot -Tsvg\`). Any enabled plugin formatter surfaces here too,
      selected by its folder name.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['Render the graph as ASCII (default)', '$0 graph'],
      ['Render with an explicit format', '$0 graph --format ascii'],
      ['Mermaid flowchart', '$0 graph --format mermaid'],
      ['Graphviz SVG', '$0 graph --format dot | dot -Tsvg > graph.svg'],
      ['Use a non-default DB file', '$0 graph --db /path/to/skill-map.db'],
    ],
  });

  format = Option.String('--format', DEFAULT_FORMAT, {
    description: `Formatter format. Must match the \`formatId\` field of a registered formatter. Default: ${DEFAULT_FORMAT}.`,
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery. Only built-in formatters participate.',
  });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr, this.noColor);
    if (exit !== null) return exit;

    const pluginRuntime = this.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime();
    pluginRuntime.emitWarnings(this.printer!);

    const formatters = composeFormatters({ pluginRuntime });
    const formatter = formatters.find((f) => f.formatId === this.format);
    if (!formatter) {
      const available = formatters
        .map((f) => f.formatId)
        .sort()
        .join(', ');
      const ansi = this.ansiFor('stderr');
      this.printer!.error(
        tx(GRAPH_TEXTS.noFormatterRegistered, {
          glyph: ansi.red('✕'),
          format: this.format,
          hint: ansi.dim(
            tx(GRAPH_TEXTS.noFormatterRegisteredHint, {
              available: available || GRAPH_TEXTS.availableNone,
            }),
          ),
        }),
      );
      return ExitCode.Error;
    }

    // Read verb: advise on drift, never refuse (spec/db-schema.md §Schema
    // drift, read-side opens advise).
    const versionCheck = buildReadVersionCheck(this.printer!, this.ansiFor('stderr'));
    return withSqlite({ databasePath: dbPath, autoBackup: false, versionCheck }, async (adapter) => {
      const scan = await adapter.scans.load();
      const text = formatter.format({
        nodes: scan.nodes,
        links: scan.links,
        issues: scan.issues,
        // Resolved settings of the formatter (empty when the formatter
        // declares none, or when the composer did not populate them).
        settings: formatter.resolvedSettings ?? {},
        // Pass the full persisted scan so format-specific renderers
        // that mirror a `ScanResult` envelope (today: built-in `json`)
        // can emit it verbatim without re-deriving fields like
        // `schemaVersion` or `stats` from the three primary arrays.
        scanResult: scan,
      });
      // Formatter output is text; trailing newline normalisation makes the
      // verb safe to pipe into anything that splits on lines without
      // double-newlining when the formatter already terminates its output.
      // Deliberately NOT terminal-sanitized (decision 2026-07-28): stdout
      // is the artifact here (dot / mermaid / a deliberately ANSI-colored
      // terminal format), a payload channel like `--json` bodies, and the
      // operator opted into the plugin via the trust gate. See
      // context/cli-output-style.md §Sanitisation, payload-channel
      // exemption.
      this.printer!.data(text.endsWith('\n') ? text : text + '\n');
      return ExitCode.Ok;
    });
  }
}

