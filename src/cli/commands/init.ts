/**
 * `sm init [--no-scan] [--force]`, bootstrap a skill-map project.
 *
 *   - Creates `<cwd>/.skill-map/`.
 *   - Writes `settings.json` (`{ "schemaVersion": 1 }`) and
 *     `settings.local.json` (`{}`).
 *   - Copies the bundled `.skillmapignore` template into the scope root.
 *   - Provisions `<cwd>/.skill-map/skill-map.db` (kernel migrations
 *     run automatically via `SqliteStorageAdapter.init()`).
 *   - Appends `.skill-map/settings.local.json` and
 *     `.skill-map/skill-map.db` to the project's `.gitignore`
 *     (creating the file when missing). The default `history.share`
 *     is `false`, so the DB stays untracked unless the team opts in.
 *   - Runs a first scan unless `--no-scan` is passed.
 *
 * Per `spec/cli-contract.md` §Scope is always project-local, scope is
 * always project-local; there is no `-g/--global` to provision under
 * `~/.skill-map/`.
 *
 * Re-running on an already-initialised project errors with exit 2
 * unless `--force` is passed.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Command, Option } from 'clipanion';

import { writeFileAtomicExclusive } from '../../core/config/atomic-write.js';
import { runScanForCommand } from '../../core/runtime/scan-runner.js';
import { loadBundledIgnoreText } from '../../kernel/scan/ignore.js';
import { tx } from '../../kernel/util/tx.js';
import type { IAnsi } from '../util/ansi.js';
import { INIT_TEXTS } from '../i18n/init.texts.js';
import {
  defaultDbPath,
  defaultIgnoreFilePath,
  defaultLocalSettingsPath,
  defaultSettingsPath,
  GITIGNORE_ENTRIES,
  SKILL_MAP_DIR,
} from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { pathExists } from '../util/fs.js';
import { createPrinter, type IPrinter } from '../util/printer.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';

export class InitCommand extends SmCommand {
  static override paths = [['init']];
  static override usage = Command.Usage({
    category: 'Setup',
    description: 'Bootstrap the current project: scaffold .skill-map/, provision DB, run first scan.',
    details: `
      Creates ./.skill-map/ with settings.json, settings.local.json,
      and skill-map.db. Drops a starter .skillmapignore at the project
      root and appends the DB + local settings to .gitignore.

      Re-running over an existing project errors with exit 2 unless
      --force is passed. --no-scan skips the first scan; useful in CI
      where the operator wants to provision before populating roots.
    `,
    examples: [
      ['Initialise the current project', '$0 init'],
      ['Bootstrap without running the first scan', '$0 init --no-scan'],
      ['Force-overwrite an existing project', '$0 init --force'],
      ['Preview what would be created', '$0 init --dry-run'],
    ],
  });

  noScan = Option.Boolean('--no-scan', false, {
    description: 'Skip the first scan after scaffolding.',
  });
  force = Option.Boolean('--force', false, {
    description: 'Overwrite an existing settings.json / settings.local.json / .skillmapignore.',
  });
  strict = Option.Boolean('--strict', false, {
    description: 'Strict mode: fail on any layered-loader warning AND promote frontmatter warnings to errors during the first scan. Same flag as sm scan / sm config.',
  });
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Preview the scope provisioning without touching the filesystem or the DB. Honours --force for the would-overwrite preview. Skips the first scan unconditionally; dry-run never persists.',
  });

  // CLI orchestrator: paths setup + dry-run branch (delegated to
  // `writeDryRunPlan`) + real provision (mkdir + 4 file writes +
  // gitignore management + DB provision + first scan delegation).
  // The first-scan branch already lives in `runFirstScan`.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const scopeRoot = ctx.cwd;
    const skillMapDir = join(scopeRoot, SKILL_MAP_DIR);
    const settingsPath = defaultSettingsPath(scopeRoot);
    const localPath = defaultLocalSettingsPath(scopeRoot);
    const ignorePath = defaultIgnoreFilePath(scopeRoot);
    const dbPath = defaultDbPath(scopeRoot);

    if ((await pathExists(settingsPath)) && !this.force) {
      const stderrAnsi = this.ansiFor('stderr');
      this.printer!.error(
        tx(INIT_TEXTS.alreadyInitialised, {
          glyph: stderrAnsi.red('✕'),
          settingsPath,
          hint: stderrAnsi.dim(INIT_TEXTS.alreadyInitialisedHint),
        }),
      );
      return ExitCode.Error;
    }

    const printer = this.printer ?? createPrinter({
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      quietInfo: this.quiet,
    });

    if (this.dryRun) {
      await writeDryRunPlan(printer, {
        skillMapDir, settingsPath, localPath, ignorePath, dbPath,
        scopeRoot, force: this.force, noScan: this.noScan,
      });
      return ExitCode.Ok;
    }

    await mkdir(skillMapDir, { recursive: true });
    // Audit L4: stage through `writeFileAtomicExclusive` so the temp
    // file is opened with `O_EXCL | O_NOFOLLOW` and a CSPRNG-random
    // suffix. A local attacker who pre-planted a symlink at the final
    // path cannot redirect the write (rename replaces the symlink
    // atomically); the temp inode is owner-only (mode 0o600) and the
    // rename preserves that. Mirrors `writeJsonAtomic` /
    // sidecar-store atomicity.
    writeFileAtomicExclusive(settingsPath, JSON.stringify({ schemaVersion: 1 }, null, 2) + '\n');
    if (!(await pathExists(localPath)) || this.force) {
      writeFileAtomicExclusive(localPath, '{}\n');
    }
    if (!(await pathExists(ignorePath)) || this.force) {
      // `.skillmapignore` ships with the repo (it lives next to the
      // user's `.gitignore` and is meant to be committed + edited by
      // anyone with checkout access). Stage it at the standard public
      // mode `0o644` instead of the writer's default `0o600` so other
      // users on the same host, or shared-mount workflows, can read
      // it without a chmod dance. Settings + sidecars keep their
      // `0o600` privacy default.
      writeFileAtomicExclusive(ignorePath, loadBundledIgnoreText(), 0o644);
    }

    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');

    const updated = await ensureGitignoreEntries(scopeRoot, GITIGNORE_ENTRIES);
    if (updated) {
      const gitignorePath = join(scopeRoot, '.gitignore');
      printer.info(
        GITIGNORE_ENTRIES.length === 1
          ? tx(INIT_TEXTS.gitignoreUpdatedSingular, { glyph: okGlyph, path: gitignorePath })
          : tx(INIT_TEXTS.gitignoreUpdatedPlural, {
              glyph: okGlyph,
              path: gitignorePath,
              count: GITIGNORE_ENTRIES.length,
            }),
      );
    }

    // Provision the DB. `withSqlite` opens the adapter, which auto-
    // applies migrations on init(); by the time this returns the DB is
    // at the latest kernel schema.
    await withSqlite({ databasePath: dbPath, autoBackup: false }, async () => {
      // No-op: opening (and closing) the adapter is the work here.
    });

    printer.info(tx(INIT_TEXTS.initialised, { glyph: okGlyph, skillMapDir }));

    if (this.noScan) return ExitCode.Ok;

    // First scan. Inline (not subprocess) so the parent process owns
    // the elapsed line and the stdout/stderr streams cleanly.
    return runFirstScan(scopeRoot, this.strict, printer, this.context.stderr, ansi);
  }
}

/**
 * Render the `--dry-run` plan to stdout: which directories/files the
 * verb would create or overwrite, and whether the first scan would
 * run. Used only when `--dry-run` is set; the real provision path
 * skips this entirely.
 */
async function writeDryRunPlan(
  printer: IPrinter,
  opts: {
    skillMapDir: string;
    settingsPath: string;
    localPath: string;
    ignorePath: string;
    dbPath: string;
    scopeRoot: string;
    force: boolean;
    noScan: boolean;
  },
): Promise<void> {
  printer.info(INIT_TEXTS.dryRunHeader);
  if (!(await pathExists(opts.skillMapDir))) {
    printer.info(tx(INIT_TEXTS.dryRunWouldCreateDir, { path: opts.skillMapDir }));
  }
  // settingsPath: always written (caller gated --force above).
  printer.info(await dryRunFileMessage(opts.settingsPath));
  // Local + ignore: written only when missing OR --force.
  if (!(await pathExists(opts.localPath)) || opts.force) {
    printer.info(await dryRunFileMessage(opts.localPath));
  }
  if (!(await pathExists(opts.ignorePath)) || opts.force) {
    printer.info(await dryRunFileMessage(opts.ignorePath));
  }
  await writeDryRunGitignorePlan(printer, opts.scopeRoot);
  printer.info(tx(INIT_TEXTS.dryRunWouldProvisionDb, { path: opts.dbPath }));
  printer.info(
    opts.noScan ? INIT_TEXTS.dryRunWouldSkipFirstScan : INIT_TEXTS.dryRunWouldRunFirstScan,
  );
}

/** "would overwrite X" if the file exists, else "would write X". */
async function dryRunFileMessage(path: string): Promise<string> {
  return (await pathExists(path))
    ? tx(INIT_TEXTS.dryRunWouldOverwriteFile, { path })
    : tx(INIT_TEXTS.dryRunWouldWriteFile, { path });
}

/**
 * Subhelper of `writeDryRunPlan`, render the `.gitignore` preview
 * (unchanged / one-entry / multi-entry phrasing). Project scope only.
 */
async function writeDryRunGitignorePlan(
  printer: IPrinter,
  scopeRoot: string,
): Promise<void> {
  const wouldAdd = await previewGitignoreEntries(scopeRoot, GITIGNORE_ENTRIES);
  const gitignorePath = join(scopeRoot, '.gitignore');
  if (wouldAdd.length === 0) {
    printer.info(tx(INIT_TEXTS.dryRunWouldLeaveGitignoreUnchanged, { path: gitignorePath }));
  } else if (wouldAdd.length === 1) {
    printer.info(
      tx(INIT_TEXTS.dryRunWouldUpdateGitignoreSingular, {
        path: gitignorePath,
        entries: wouldAdd[0]!,
      }),
    );
  } else {
    printer.info(
      tx(INIT_TEXTS.dryRunWouldUpdateGitignorePlural, {
        path: gitignorePath,
        count: wouldAdd.length,
        entries: wouldAdd.join(', '),
      }),
    );
  }
}

/**
 * Drive the post-provision first scan. Thin adapter over
 * `runScanForCommand` (`core/runtime/scan-runner.ts`), init reuses the
 * shared scan pipeline (plugin runtime composition, ignore filter,
 * prior-snapshot load, persist branch) and only owns the wrapping:
 *
 *   - `noPlugins: true` so init never walks `.skill-map/plugins/`
 *     (the project was just provisioned; no plugins could possibly be
 *     installed there yet).
 *   - The runtime context's `cwd` is overridden to the scope root so
 *     `loadConfig` and `defaultProjectDbPath` resolve under the
 *     correct directory.
 *   - Init-specific render templates (`firstScanSummary`,
 *     `configLoadFailure`, `scanFailed`), the runner returns a
 *     discriminated outcome, this adapter maps the kinds to
 *     `INIT_TEXTS.*` strings.
 */
// First-scan path: validates four `outcome.kind` branches before
// rendering the summary. Each branch routes to a distinct exit code,
// so the cyclomatic count is intrinsic to the contract.
// eslint-disable-next-line complexity
async function runFirstScan(
  scopeRoot: string,
  strict: boolean,
  printer: IPrinter,
  stderr: NodeJS.WritableStream,
  ansi: IAnsi,
): Promise<number> {
  printer.info(INIT_TEXTS.runningFirstScan);

  const outcome = await runScanForCommand({
    roots: [scopeRoot],
    noBuiltIns: false,
    noPlugins: true,
    noTokens: false,
    dryRun: false,
    changed: false,
    // Init's first scan always persists, even when the scope is
    // empty, the historic behaviour was to seed the DB regardless of
    // node count. `runScanForCommand`'s guard refuses to wipe a
    // populated DB with a zero-result scan; init's DB is freshly
    // provisioned (zero rows), so the guard is dormant. Pass
    // `allowEmpty: true` defensively in case a future change pre-seeds.
    allowEmpty: true,
    strict,
    stderr,
    printer,
    ctx: { cwd: scopeRoot },
    // Init's first scan is a provisioning step, not the user's
    // primary "show me my graph" call. Don't block waiting for the
    // operator to disambiguate the lens here; let init complete with
    // `activeProvider` unset and let the FIRST explicit `sm scan`
    // surface the prompt. Treat the `ambiguous-provider` outcome below
    // as a soft hint, not a failure.
    yes: true,
  });

  const errGlyph = ansi.red('✕');
  if (outcome.kind === 'config-error') {
    stderr.write(tx(INIT_TEXTS.configLoadFailure, { glyph: errGlyph, message: outcome.message }));
    return ExitCode.Error;
  }
  if (outcome.kind === 'scan-error') {
    stderr.write(tx(INIT_TEXTS.scanFailed, { glyph: errGlyph, message: outcome.message }));
    return ExitCode.Error;
  }
  if (outcome.kind === 'guard-trip') {
    // Defensive, the guard cannot fire on a freshly-provisioned DB
    // (zero rows). Surface as a scan failure if it ever does.
    stderr.write(
      tx(INIT_TEXTS.scanFailed, {
        glyph: errGlyph,
        message: `guard tripped (${outcome.existing} existing rows)`,
      }),
    );
    return ExitCode.Error;
  }
  if (outcome.kind === 'ambiguous-provider') {
    // Ambiguous lens at init time is a soft hint, not a failure. Init's
    // DB is provisioned, settings.json + .skill-map/ are written; the
    // operator just needs to pick a lens before their next scan.
    printer.warn(outcome.message);
    return ExitCode.Ok;
  }

  const result = outcome.result;
  const hasErrors = result.issues.some((i) => i.severity === 'error');
  printer.info(
    tx(INIT_TEXTS.firstScanSummary, {
      glyph: hasErrors ? ansi.red('✕') : ansi.green('✓'),
      nodes: result.nodes.length,
      nodesPlural: result.nodes.length === 1 ? '' : 's',
      links: result.links.length,
      linksPlural: result.links.length === 1 ? '' : 's',
      issues: result.issues.length,
      issuesPlural: result.issues.length === 1 ? '' : 's',
    }),
  );
  // Issues with severity=error gate the exit code, mirroring `sm scan`.
  return hasErrors ? ExitCode.Issues : ExitCode.Ok;
}

/**
 * Compute which `entries` would be appended to `<scopeRoot>/.gitignore`
 * by the live `ensureGitignoreEntries` call, WITHOUT writing. Used by
 * `--dry-run` to render an honest preview of what `sm init` would
 * change. Same parsing rules as the live function so the preview tracks
 * the real outcome (skip blank lines and comment lines, dedupe by exact
 * trimmed match).
 */
async function previewGitignoreEntries(
  scopeRoot: string,
  entries: readonly string[],
): Promise<string[]> {
  const path = join(scopeRoot, '.gitignore');
  const body = (await pathExists(path)) ? await readFile(path, 'utf8') : '';
  const present = new Set(
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
  return entries.filter((entry) => !present.has(entry));
}

/**
 * Append every `entry` to `<scopeRoot>/.gitignore` that is not already
 * present (compared as trimmed line). Creates the file if absent.
 * Returns true if the file was written.
 */
async function ensureGitignoreEntries(
  scopeRoot: string,
  entries: readonly string[],
): Promise<boolean> {
  const path = join(scopeRoot, '.gitignore');
  let body = '';
  if (await pathExists(path)) {
    body = await readFile(path, 'utf8');
  }
  const present = new Set(
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
  let changed = false;
  for (const entry of entries) {
    if (present.has(entry)) continue;
    if (body.length > 0 && !body.endsWith('\n')) body += '\n';
    body += `${entry}\n`;
    present.add(entry);
    changed = true;
  }
  if (changed) await writeFile(path, body);
  return changed;
}
