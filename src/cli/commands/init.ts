/**
 * `sm init [--no-scan] [--force]`, bootstrap a skill-map project.
 *
 *   - Creates `<cwd>/.skill-map/`.
 *   - Writes `settings.json` (`{ "schemaVersion": 1 }`) and
 *     `settings.local.json` (`{}`).
 *   - Copies the bundled `.skillmapignore` template into the scope root.
 *   - Provisions `<cwd>/.skill-map/skill-map.db` (kernel migrations
 *     run automatically via `SqliteStorageAdapter.init()`).
 *   - Writes the scope ignore file (`.skill-map/.gitignore`) listing the
 *     per-machine runtime artifacts, so they stay untracked. The
 *     project-root `.gitignore` is NOT touched: the rules live inside
 *     the directory they describe (`core/scope-gitignore.ts`,
 *     `spec/cli-contract.md` §Scope ignore file).
 *   - Runs a first scan unless `--no-scan` is passed.
 *
 * Per `spec/cli-contract.md` §Scope is always project-local, scope is
 * always project-local; there is no `-g/--global` to provision under
 * `~/.skill-map/`.
 *
 * Re-running on an already-initialised project errors with exit 2
 * unless `--force` is passed.
 */

import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Command, Option } from 'clipanion';

import { writeFileAtomicExclusive } from '../../kernel/util/atomic-write.js';
import { runScanForCommand } from '../../core/runtime/scan-runner.js';
import { SCAN_RUNNER_TEXTS } from '../../core/runtime/i18n/scan-runner.texts.js';
import { loadBundledIgnoreText } from '../../kernel/scan/ignore.js';
import { tx } from '../../kernel/util/tx.js';
import type { IAnsi } from '../util/ansi.js';
import { INIT_TEXTS } from '../i18n/init.texts.js';
import {
  defaultDbPath,
  defaultIgnoreFilePath,
  defaultLocalSettingsPath,
  defaultScopeGitignorePath,
  defaultSettingsPath,
  SCOPE_GITIGNORE_ENTRIES,
  SKILL_MAP_DIR,
} from '../util/db-path.js';
import { ensureScopeGitignore, previewScopeGitignore } from '../../core/scope-gitignore.js';
import { ExitCode } from '../util/exit-codes.js';
import { pathExists } from '../util/fs.js';
import { createPrinter, type IPrinter } from '../../core/runtime/printer.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../../core/sqlite/with-sqlite.js';

export class InitCommand extends SmCommand {
  static override paths = [['init']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Issues, ExitCode.Error];
  static override usage = Command.Usage({
    category: 'Setup',
    description: 'Bootstrap the current project: scaffold .skill-map/, provision DB, run first scan.',
    details: `
      Creates ./.skill-map/ with settings.json, settings.local.json,
      skill-map.db and a .gitignore covering the generated artifacts.
      Drops a starter .skillmapignore at the project root.

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
      quietInfo: this.quiet || this.json,
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

    const gitignoreOutcome = ensureScopeGitignore(scopeRoot);
    if (gitignoreOutcome === 'created' || gitignoreOutcome === 'updated') {
      printer.info(
        tx(INIT_TEXTS.scopeGitignoreWritten, {
          glyph: okGlyph,
          path: defaultScopeGitignorePath(scopeRoot),
          count: SCOPE_GITIGNORE_ENTRIES.length,
        }),
      );
    }

    // --force semantic, full reset (greenfield posture per AGENTS.md):
    // a prior DB at `dbPath` is rebuilt from scratch instead of being
    // re-opened in place. Re-opening a stale DB whose schema predates
    // the current `001_initial.sql` produces `JSON.parse(undefined)`
    // crashes inside `loadScanResult` (columns added post-DB-creation
    // come back as `undefined` from Kysely, and the defensive wrap
    // surfaces them as "Failed to read scan rows" errors). Wiping the
    // file means `withSqlite` below provisions a fresh DB at the
    // current schema; state_* tables (LLM jobs, summaries) are wiped
    // too, this is intentional and matches the "reset everything
    // about the project" promise of --force. Also drop the WAL / SHM
    // sidecars so a freshly-opened DB starts clean.
    if (this.force && (await pathExists(dbPath))) {
      await safeUnlink(dbPath);
      await safeUnlink(`${dbPath}-wal`);
      await safeUnlink(`${dbPath}-shm`);
      printer.info(tx(INIT_TEXTS.removedPriorDb, { glyph: okGlyph, path: dbPath }));
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
    return runFirstScan(
      scopeRoot,
      this.strict,
      printer,
      this.context.stderr,
      this.context.stdin,
      ansi,
    );
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
  writeDryRunScopeGitignorePlan(printer, opts.scopeRoot);
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
 * Delete `path` if it exists, swallow ENOENT (file already gone) and
 * EPERM (Windows file-locked transient on WAL/SHM sidecars when a
 * background reader briefly holds them). Used by the `--force` DB
 * reset path so a missing sidecar does not abort the init.
 */
async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EPERM') return;
    throw err;
  }
}

/**
 * Subhelper of `writeDryRunPlan`, render the scope ignore file preview.
 * The live path (`ensureScopeGitignore`) either creates the file or tops
 * up the entries it is missing; the preview mirrors both branches
 * without touching the filesystem.
 */
function writeDryRunScopeGitignorePlan(printer: IPrinter, scopeRoot: string): void {
  const { path, exists, wouldAdd } = previewScopeGitignore(scopeRoot);
  if (!exists) {
    printer.info(tx(INIT_TEXTS.dryRunWouldWriteScopeGitignore, { path, count: wouldAdd.length }));
    return;
  }
  printer.info(
    wouldAdd.length === 0
      ? tx(INIT_TEXTS.dryRunWouldLeaveScopeGitignoreUnchanged, { path })
      : tx(INIT_TEXTS.dryRunWouldTopUpScopeGitignore, {
          path,
          count: wouldAdd.length,
          entries: wouldAdd.join(', '),
        }),
  );
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
  stdin: NodeJS.ReadableStream,
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
    stdin,
    printer,
    ctx: { cwd: scopeRoot },
    // Interactive on ambiguous lens detection: when init finds 2+
    // provider markers under the scope, the runner prompts the
    // operator to pick one (same UX as `sm scan`). The chosen lens
    // is persisted to `.skill-map/settings.json` immediately, so the
    // operator's very next `sm scan` skips the prompt. For
    // non-interactive contexts (CI), use `--no-scan` to skip the
    // first-scan step entirely.
    yes: false,
    // Pre-rendered glyphs / dim per `context/cli-output-style.md`.
    // The interactive prompt uses the yellow `⚠` (advisory: operator
    // chooses), and the fallback "operator gave no valid answer"
    // branch downgrades to a yellow `⚠` as well (init treats it as
    // advisory rather than a hard failure: the DB is already
    // provisioned, the operator just needs to pick a lens before the
    // next real scan).
    style: {
      warnGlyph: ansi.yellow('⚠'),
      errorGlyph: ansi.yellow('⚠'),
      dim: ansi.dim,
    },
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
    // operator just needs to pick a lens before their next scan. The
    // runner returned a pre-formatted §3.1b advisory block (glyph +
    // headline + dim hint); print verbatim so the operator sees one
    // glyph, not two.
    printer.warn(outcome.message);
    return ExitCode.Ok;
  }

  const result = outcome.result;
  // Announce the auto-detected lens before the first-scan summary, on
  // the same stream (stderr/info) the summary uses, so the bootstrap's
  // (now removed) stderr line is preserved here without interleaving.
  if (outcome.lensAutoDetected) {
    printer.info(
      tx(SCAN_RUNNER_TEXTS.activeProviderAutodetected, { id: outcome.lensAutoDetected }),
    );
  }
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

