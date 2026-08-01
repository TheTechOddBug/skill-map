import { Command } from 'clipanion';

import { log } from '../../kernel/util/logger.js';
import { tx } from '../../kernel/util/tx.js';
import { VERSION_TEXTS } from '../i18n/version.texts.js';
import { resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { SmCommand } from '../util/sm-command.js';
import { isDevBuild } from '../../kernel/util/dev-mode.js';
import { VERSION } from '../../version.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';

/**
 * `sm version`, multi-line version matrix.
 *
 * Shape is defined in `spec/cli-contract.md`:
 *
 *   sm           <cli version>
 *   spec         <spec version implemented>
 *   runtime      Node v<n>.<n>.<n>
 *   db-schema    <applied migration version | ->
 *
 * `runtime` is rendered in human mode but absent from `--json`,
 * `cli-contract.md` § `sm version` lists exactly three JSON fields
 * (`{ sm, spec, dbSchema }`); the runtime line is informational only
 * and stays out of the machine surface to keep the spec contract
 * literal. Promoting it would require a spec PR + a changeset.
 *
 * `RootVersionCommand` below keeps the single-line `sm --version` form.
 *
 * `db-schema` resolution:
 *   - When the project DB file exists, the command opens it through
 *     `StoragePort.migrations.currentSchemaVersion()` (which reads
 *     `PRAGMA user_version`; the migrations runner keeps that pragma in
 *     sync with the latest applied kernel migration).
 *   - When the DB is absent, the field stays `-` (no scope provisioned
 *     yet, typically pre-`sm init`).
 *   - Any read failure is silenced into `-` rather than turned into an
 *     error: `sm version` is informational and MUST NOT crash on a bad
 *     DB file.
 */

/**
 * `sm --version`, the single-line form.
 *
 * Replaces `Builtins.VersionCommand` to keep the version surface ours
 * (`sm version` owns the multi-line matrix; this owns the one-liner),
 * claiming the same two paths it did: `--version` and `-v`.
 *
 * `-v` is the version alias here and nothing else. A `-v` / `-vv` /
 * `-vvv` verbosity counter briefly took it, which cost `sm -v` its
 * universal meaning and, with no verb to run, sent it into the bare
 * `sm serve` fan-out where it hung. Verbosity is a NAMED parameter
 * (`--log` / `--log-level`); a single-letter flag that every other CLI
 * on the planet reads as "version" was never ours to repurpose.
 *
 * `help.ts`'s `isBuiltin` filter already drops the `sm --version` path
 * from every catalog, so the verb list is unchanged.
 *
 * Extends `SmCommand` rather than Clipanion's `Command` (the shape
 * `RootHelpCommand` uses): the single-line version IS machine-consumable
 * output, so it belongs on the printer's `data` channel like any other
 * result, not on a hand-rolled `context.stdout.write`.
 */
export class RootVersionCommand extends SmCommand {
  static override paths = [['--version'], ['-v']];

  // Informational: the version line is the entire output, no `done in
  // <…>` trailer (same posture as the `sm version` verb below).
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    this.printer!.data(`${this.cli.binaryVersion ?? '<unknown>'}\n`);
    return ExitCode.Ok;
  }
}

export class VersionCommand extends SmCommand {
  static override paths = [['version']];

  static override usage = Command.Usage({
    category: 'Introspection',
    description: 'Print the CLI / spec / runtime / db-schema version matrix.',
  });

  // Informational verb, no `done in <…>` line; the version matrix is
  // the entire output.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const runtime = `Node ${process.version}`;
    const specVersion = await resolveSpecVersion();
    const dbSchema = await resolveDbSchemaVersion();
    const dev = isDevBuild();

    if (this.json) {
      // Spec § `sm version`: exactly `{ sm, spec, dbSchema }`.
      // `dbSchema` keeps the human-rendered `-` sentinel for "no DB
      // yet" so consumers branch on the literal once instead of having
      // to remember a separate JSON-only convention. `dev` is an
      // additive optional field only emitted when truthy (a published
      // install keeps the JSON shape lean).
      const payload: Record<string, unknown> = {
        sm: VERSION,
        spec: specVersion,
        dbSchema,
      };
      if (dev) payload['dev'] = true;
      this.printer!.data(JSON.stringify(payload) + '\n');
      return ExitCode.Ok;
    }

    const ansi = this.ansiFor('stdout');
    // Append a yellow `[dev]` chip to the `sm` row when the helper
    // detects a local checkout. The marker keeps the row width-stable
    // for published installs (where the column never carries the
    // suffix) and tells the operator at a glance "this is the source
    // tree, not the npm install".
    const smValue = dev ? `${VERSION} ${ansi.yellow('[dev]')}` : VERSION;
    const lines: Array<[string, string]> = [
      ['sm', smValue],
      ['spec', specVersion],
      ['runtime', runtime],
      ['db-schema', dbSchema],
    ];

    const pad = Math.max(...lines.map(([k]) => k.length));
    for (const [k, v] of lines) {
      this.printer!.data(
        tx(VERSION_TEXTS.matrixRow, { key: ansi.dim(k.padEnd(pad)), value: v }),
      );
    }
    return ExitCode.Ok;
  }
}

async function resolveSpecVersion(): Promise<string> {
  try {
    const mod = await import('@skill-map/spec', { with: { type: 'json' } });
    const version = (mod as { default?: { specPackageVersion?: string } }).default
      ?.specPackageVersion;
    return version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Resolve the project DB schema version through `StoragePort`.
 *
 * Failure modes (return `-` for all):
 *   - DB file does not exist (no `sm init` yet, `tryWithSqlite`
 *     short-circuits to `null` before opening the adapter, so no
 *     `.skill-map/` directory is provisioned for an informational
 *     read).
 *   - DB file exists but cannot be opened (corrupt / permissions).
 *   - PRAGMA returns null / non-numeric (engine quirk; never observed).
 */
async function resolveDbSchemaVersion(): Promise<string> {
  const dbPath = resolveDbPath({ db: undefined, ...defaultRuntimeContext() });
  try {
    const v = await tryWithSqlite({ databasePath: dbPath, autoBackup: false }, async (port) =>
      port.migrations.currentSchemaVersion(),
    );
    if (v === null || v === undefined) return '-';
    return String(v);
  } catch (error) {
    // The human + JSON contract pins the field to `-` on any read
    // failure (informational verb, MUST NOT crash). Surface the
    // swallowed error under `log.debug` so `sm --log debug version`
    // reveals the underlying cause (corrupt DB, permissions, pragma
    // drift).
    log.debug(`sm version: dbSchema read failed: ${error instanceof Error ? error.message : String(error)}`);
    return '-';
  }
}
