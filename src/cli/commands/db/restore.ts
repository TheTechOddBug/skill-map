/**
 * `sm db restore <source>` — destructive verb that replaces the active
 * DB with a backup file. Confirms interactively unless `--yes` /
 * `--force` is passed; supports `--dry-run` for a preview that bypasses
 * the prompt.
 */

import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { ansiFor } from '../../util/ansi.js';
import { relativeIfBelow } from '../../util/path-display.js';
import { confirm } from '../../util/confirm.js';
import { tx } from '../../../kernel/util/tx.js';
import { DB_TEXTS } from '../../i18n/db.texts.js';
import { resolveDbPath } from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { ExitCode } from '../../util/exit-codes.js';
import { pathExists, statOrNull } from '../../util/fs.js';
import { SmCommand } from '../../util/sm-command.js';

/**
 * Force `0o600` perms on a file, swallowing failures (Windows / non-POSIX
 * filesystems may reject `chmod`). Used after `db restore` to keep the
 * restored DB owner-readable only — see audit L4.
 */
async function chmodOwnerOnlyBestEffort(target: string): Promise<void> {
  try {
    await chmod(target, 0o600);
  } catch {
    // Best effort — the DB is already in place; tightening perms is a
    // hardening pass, not a correctness gate.
  }
}

export class DbRestoreCommand extends SmCommand {
  static override paths = [['db', 'restore']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Replace the active DB file with a backup.',
    details: `
      Destructive. Requires interactive confirmation unless --yes / --force
      is passed. scan_* will be re-populated by the next sm scan.
      With --dry-run: previews the swap (source size, target overwrite
      status, sidecars to drop) without copying or deleting anything.
      Dry-run bypasses the confirmation prompt.
    `,
  });

  source = Option.String({ required: true });
  yes = Option.Boolean('--yes,--force', false);
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Preview the restore without overwriting the live DB.',
  });

  protected async run(): Promise<number> {
    const target = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    const sourcePath = resolve(this.source);

    const stderr = this.context.stderr as NodeJS.WriteStream;
    const stderrAnsi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });

    const sourceStat = await statOrNull(sourcePath);
    if (!sourceStat) {
      this.printer!.error(
        tx(DB_TEXTS.restoreSourceNotFound, { glyph: stderrAnsi.red('✕'), sourcePath }),
      );
      return ExitCode.NotFound;
    }

    if (this.dryRun) {
      this.printer!.data(DB_TEXTS.dryRunHeader);
      const sourceBytes = sourceStat.size;
      const targetClause = (await pathExists(target))
        ? DB_TEXTS.dryRunRestoreTargetExistsClause
        : DB_TEXTS.dryRunRestoreTargetMissingClause;
      this.printer!.data(
        tx(DB_TEXTS.dryRunRestoreWouldOverwrite, {
          sourcePath,
          sourceBytes,
          target,
          targetClause,
        }),
      );
      return ExitCode.Ok;
    }

    if (!this.yes) {
      const ok = await confirm(tx(DB_TEXTS.restoreConfirm, { sourcePath, target }), {
        stdin: this.context.stdin,
        stderr: this.context.stderr,
      });
      if (!ok) {
        this.printer!.info(DB_TEXTS.aborted);
        return ExitCode.Error;
      }
    }

    await mkdir(dirname(target), { recursive: true });
    await copyFile(sourcePath, target);
    // Defence in depth (audit L4): force restrictive owner-only perms on
    // the restored DB. Helper-extracted so the try/catch doesn't push
    // `execute` past the cyclomatic budget.
    await chmodOwnerOnlyBestEffort(target);
    // WAL sidecars from the old DB would be out of sync — delete them so
    // next open starts clean against the restored main file.
    for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
      if (await pathExists(sidecar)) await rm(sidecar);
    }

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const cwd = defaultRuntimeContext().cwd;
    this.printer!.data(
      tx(DB_TEXTS.restoreDone, {
        glyph: ansi.green('✓'),
        sourcePath: relativeIfBelow(sourcePath, cwd),
        target: relativeIfBelow(target, cwd),
      }),
    );
    return ExitCode.Ok;
  }
}
