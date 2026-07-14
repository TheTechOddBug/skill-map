/**
 * CLI entry, composed by `bin/sm.js`. Registers every command and hands off
 * to Clipanion. Exit codes are defined once in `src/cli/util/exit-codes.ts`
 * (the `ExitCode` object) and follow `spec/cli-contract.md`:
 *
 *   0  ok               , `ExitCode.Ok`
 *   1  issues            , `ExitCode.Issues` (non-clean scan / check)
 *   2  error             , `ExitCode.Error` (unhandled / config / bad usage)
 *   3  duplicate         , `ExitCode.Duplicate` (record stub)
 *   4  nonce-mismatch    , `ExitCode.NonceMismatch` (record stub)
 *   5  not-found         , `ExitCode.NotFound` (DB / row / dump)
 */

import { existsSync } from 'node:fs';

import { Builtins, Cli } from 'clipanion';

import { InMemoryProgressEmitter } from '../kernel/adapters/in-memory-progress.js';
import { makeEvent, makeHookDispatcher } from '../kernel/extensions/hook-dispatcher.js';
import { configureLogger } from '../kernel/util/logger.js';
import { tx } from '../kernel/util/tx.js';
import { builtIns } from '../plugins/built-ins.js';
import { ENTRY_TEXTS } from './i18n/entry.texts.js';
import {
  Logger,
  extractLogLevelFlag,
  resolveLogLevel,
  LOGGER_ENV_VAR,
} from './util/logger.js';
import { ansiFor } from './util/ansi.js';
import { confirm } from './util/confirm.js';
import { defaultProjectDbPath } from './util/db-path.js';
import { isDirEmpty } from './util/empty-cwd.js';
import {
  decideBareNoArgs,
  promptEmptyFolderChoice,
  shouldServeAfterInit,
} from './util/empty-folder-prompt.js';
import { ExitCode } from './util/exit-codes.js';
import { formatParseError, isClipanionParseError } from './util/parse-error.js';
import { defaultRuntimeContext } from './util/runtime-context.js';
import { maybeRunUpdateCheck } from './util/update-check-banner.js';
import { maybeRunFirstRunPrompt } from './telemetry/first-run-prompt.js';
import {
  closeSentryCli,
  initSentryCli,
  setTelemetryVerbTag,
} from './telemetry/sentry-init.js';
import { captureCliInvocation, flushUsageCli, initUsageCli } from './telemetry/posthog-init.js';
import { extractFlagNames } from './telemetry/usage-collector.js';
import { ActionsListCommand, ActionsShowCommand } from './commands/actions.js';
import { AGENT_COMMANDS } from './commands/agent.js';
import { DoctorCommand } from './commands/doctor.js';
import { BUMP_COMMANDS } from './commands/bump.js';
import { CheckCommand } from './commands/check.js';
import { CONFIG_COMMANDS } from './commands/config.js';
import { CONFORMANCE_COMMANDS } from './commands/conformance.js';
import { DB_COMMANDS } from './commands/db.js';
import { ExampleCommand } from './commands/example.js';
import { ExportCommand } from './commands/export.js';
import { FindingsCommand, FindingsPruneCommand } from './commands/findings.js';
import { GraphCommand } from './commands/graph.js';
import { HelpCommand, RootHelpCommand, registeredVerbPaths, routeHelpArgs } from './commands/help.js';
import { ACTIVITY_COMMANDS } from './commands/activity.js';
import { HOOKS_COMMANDS } from './commands/hooks.js';
import { InitCommand } from './commands/init.js';
import { HistoryCommand, HistoryStatsCommand } from './commands/history.js';
import { JobPruneCommand } from './commands/jobs.js';
import { JOB_QUEUE_COMMANDS } from './commands/job-queue.js';
import { ListCommand } from './commands/list.js';
import { RecordCommand } from './commands/record.js';
import { ORPHANS_COMMANDS } from './commands/orphans.js';
import { PLUGIN_COMMANDS } from './commands/plugins.js';
import { REFRESH_COMMANDS } from './commands/refresh.js';
import { IntentionalFailCommand } from './commands/intentional-fail.js';
import { ScanCommand } from './commands/scan.js';
import { ScanCompareCommand } from './commands/scan-compare.js';
import { ServeCommand } from './commands/serve.js';
import { ShowCommand } from './commands/show.js';
import { SIDECAR_COMMANDS } from './commands/sidecar.js';
import { TutorialCommand } from './commands/tutorial.js';
import { VersionCommand } from './commands/version.js';
import { WatchCommand } from './commands/watch.js';
import { BINARY_LABEL, BINARY_NAME, VERSION } from './version.js';

const cli = new Cli({
  binaryLabel: BINARY_LABEL,
  binaryName: BINARY_NAME,
  binaryVersion: VERSION,
  enableCapture: false,
});

cli.register(Builtins.VersionCommand);
cli.register(RootHelpCommand);
cli.register(HelpCommand);
cli.register(InitCommand);
cli.register(TutorialCommand);
cli.register(ExampleCommand);
// Hidden Sentry self-test verb. Registered so it runs, but invisible in
// every help / reference surface (it declares no `static usage`). See
// commands/intentional-fail.ts.
cli.register(IntentionalFailCommand);
cli.register(ScanCommand);
cli.register(ScanCompareCommand);
cli.register(ServeCommand);
cli.register(WatchCommand);
cli.register(VersionCommand);
cli.register(ListCommand);
cli.register(ShowCommand);
cli.register(CheckCommand);
cli.register(FindingsCommand);
cli.register(FindingsPruneCommand);
cli.register(GraphCommand);
cli.register(ExportCommand);
cli.register(HistoryCommand);
cli.register(HistoryStatsCommand);
cli.register(JobPruneCommand);
cli.register(RecordCommand);
cli.register(ActionsListCommand);
cli.register(ActionsShowCommand);
cli.register(DoctorCommand);
for (const cmd of JOB_QUEUE_COMMANDS) cli.register(cmd);
for (const cmd of AGENT_COMMANDS) cli.register(cmd);
for (const cmd of CONFIG_COMMANDS) cli.register(cmd);
for (const cmd of CONFORMANCE_COMMANDS) cli.register(cmd);
for (const cmd of DB_COMMANDS) cli.register(cmd);
for (const cmd of PLUGIN_COMMANDS) cli.register(cmd);
for (const cmd of ORPHANS_COMMANDS) cli.register(cmd);
for (const cmd of REFRESH_COMMANDS) cli.register(cmd);
for (const cmd of BUMP_COMMANDS) cli.register(cmd);
for (const cmd of SIDECAR_COMMANDS) cli.register(cmd);
for (const cmd of HOOKS_COMMANDS) cli.register(cmd);
for (const cmd of ACTIVITY_COMMANDS) cli.register(cmd);

const { value: logLevelFlag, rest: args } = extractLogLevelFlag(process.argv.slice(2));
const logLevel = resolveLogLevel({
  flag: logLevelFlag,
  env: process.env[LOGGER_ENV_VAR] ?? null,
  fallback: 'warn',
  errStream: process.stderr,
});
configureLogger(new Logger({ level: logLevel, stream: process.stderr }));

// Bare invocation: `sm` with no arguments. Per spec/cli-contract.md
// §Binary, this routes to `sm serve` when a project DB exists in the
// cwd; otherwise it prints a hint and exits with code 2 (operational,
// no project to serve). `--help` / `-h` flags fall through to
// RootHelpCommand and are NOT intercepted here.
//
// Extension: bare `sm --flag <value> ...` (no verb, first token is a
// flag) also routes to `sm serve --flag <value> ...` so server-level
// flags like `--max-nodes` work without typing `serve` explicitly.
// `--help` / `-h` short-circuit through routeHelpArgs below, so a
// `sm --help` invocation still reaches RootHelpCommand.
const bareArgs = await resolveBareInvocation(args);
const routedArgs = routeHelpArgs(bareArgs ?? args, cli);

// Telemetry (opt-in, default OFF; each surface dormant until its carrier
// key is configured, see spec/telemetry.md). The one shared consent prompt
// runs first so the persisted choice is in place before init reads it.
// `sm serve` is skipped here on purpose: the BFF owns that process's Sentry
// client (initSentryBff in src/server/index.ts) and MUST NOT emit usage
// events, so neither the Sentry nor the PostHog CLI client is armed for it.
// All of this is a no-op while the carrier placeholders are empty.
const telemetryVerb = routedArgs[0];
await maybeRunFirstRunPrompt();
if (telemetryVerb !== 'serve') {
  await initSentryCli(VERSION);
  setTelemetryVerbTag(telemetryVerb);
  await initUsageCli();
}

// Spec § A.11, boot/shutdown hook dispatcher. Wired here at the CLI
// entry (the kernel only dispatches the eight pipeline-driven
// triggers from inside `runScan`). Built-in hooks are loaded
// statically from the bundle so the boot path stays free of
// `loadPluginRuntime` (FS walk + AJV compile per call). User-plugin
// hooks that subscribe to `boot` / `shutdown` are loaded but do not
// dispatch in this path today, see `spec/architecture.md` §Hook ·
// curated trigger set for the limitation note. The dispatcher's
// emitter is a throwaway InMemoryProgressEmitter, `extension.error`
// events from a misbehaving hook surface in its buffer but the entry
// never reads it back; the policy is "log, don't block."
const lifecycleDispatcher = makeHookDispatcher(
  builtIns().hooks ?? [],
  new InMemoryProgressEmitter(),
);
await lifecycleDispatcher.dispatch(
  'boot',
  makeEvent('boot', {
    argv: routedArgs,
    stderr: process.stderr,
    noColorFlag: false,
    // Dependency inversion: the `core/update-check` hook must not
    // import the probe from `cli/util/` (plugins/** → cli/ is
    // lint-banned; `built-ins.ts` feeds the core runtime and the BFF,
    // which must stay free of CLI presentation code). The driver that
    // owns the CLI surface injects it instead; drivers with no banner
    // (BFF, tests) omit the field and the hook no-ops.
    runUpdateCheck: maybeRunUpdateCheck,
  }),
);

// Pre-parse so we can intercept Clipanion's UnknownSyntaxError /
// AmbiguousSyntaxError before its default handler dumps every command's
// USAGE line to stdout. Our replacement writes a concise diagnostic to
// stderr and exits with `ExitCode.Error` (2) per spec/cli-contract.md
// §Exit codes, "unknown flag" is operational error, not result issue.
//
// Load-bearing detail: `cli.process(argv)` and `cli.run(argv)` parse
// `argv` independently. We rely on Clipanion's parser being pure (no
// env-var snapshot, no plugin registration, no shared mutable state) so
// the second parse on the success path is a true no-op. If a future
// Clipanion update tightens parser side effects, this double-parse must
// be collapsed (capture the parsed command from `process()` and feed it
// to `run()` instead of re-parsing).
try {
  cli.process(routedArgs, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
} catch (err) {
  if (isClipanionParseError(err)) {
    process.stderr.write(
      formatParseError({
        args: routedArgs,
        verbPaths: registeredVerbPaths(cli),
        error: err,
      }),
    );
    process.exit(ExitCode.Error);
  }
  throw err;
}

const exitCode = await cli.run(routedArgs, {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});

// Usage analytics (opt-in, default OFF; no-op unless the PostHog surface is
// active, see spec/telemetry.md §Usage event taxonomy). One event per
// invocation, named `cli.<verb>` (guarded against the registered closed set
// so a typo cannot mint a junk event), carrying the NAMES of the flags it was
// given (never their values) and, on a scan, the executed-extractor set the
// scan verb stashed via `setScanExtensions`. `sm serve` never armed a usage
// client, so this is a no-op for it.
if (telemetryVerb !== undefined && telemetryVerb !== '') {
  const knownVerbs = new Set(
    registeredVerbPaths(cli)
      .map((path) => path[0])
      .filter((token): token is string => token !== undefined),
  );
  captureCliInvocation(telemetryVerb, extractFlagNames(routedArgs.slice(1)), knownVerbs);
}

// Spec § A.11, `shutdown` Hook dispatch. Awaits subscribed hooks so
// they finish before `process.exit` returns control to the shell, but
// every hook is expected to be fast (the user already saw the verb's
// output). The dispatcher catches every hook error so a buggy hook
// can only delay the exit, it never alters the resolved exit code.
// Today no built-in hook subscribes to `shutdown` (the update-check
// banner moved to `boot` per the Phase 3 design call); the dispatch
// stays here as the symmetric counterpart of the `boot` dispatch
// above so user-plugin hooks subscribing to `shutdown` have a
// channel waiting for them when the user-plugin loading lands at this
// path.
await lifecycleDispatcher.dispatch(
  'shutdown',
  makeEvent('shutdown', { exitCode }),
);

// Flush any buffered telemetry before the process exits, bounded so a slow
// network cannot hang shutdown. No-op when telemetry was never initialised.
await closeSentryCli();
await flushUsageCli();

process.exit(exitCode);

/**
 * Decide whether `args` is a bare `sm` invocation that should fan out
 * to `sm serve [...]`. Returns the rewritten argv when so, `null` when
 * the user typed a real verb (Clipanion handles it directly).
 *
 * Two cases route to `serve`:
 *
 *   1. `sm` with no args → `['serve']` (historical bare default).
 *   2. `sm --flag ...` (first token is a flag, no verb anywhere
 *      before the first positional) → `['serve', ...args]`. Lets the
 *      operator pass server-level flags like `--max-nodes 5` without
 *      typing `serve`. `--help` / `-h` are NOT intercepted here, the
 *      caller threads `args` through `routeHelpArgs` so root help
 *      still wins.
 *
 * The "starts with `-`" test is intentionally cheap and avoids
 * pre-parsing argv: Clipanion's own verb list is the source of truth
 * for what is and isn't a verb; we only short-circuit when the first
 * token unambiguously is NOT a verb (flags always start with `-`).
 */
async function resolveBareInvocation(rawArgs: string[]): Promise<string[] | null> {
  if (rawArgs.length === 0) return resolveNoArgsBare();
  const first = rawArgs[0];
  // Inline the passthrough set: keeps the lookup local + avoids a
  // top-level `const` whose temporal-dead-zone would trip the module
  // initialiser (`bareArgs` is computed before this function body
  // runs, but module-top `const`s declared below this point are
  // uninitialised at that moment).
  const passthrough = new Set(['--help', '-h', '--version', '-V', '-v']);
  if (
    first !== undefined &&
    first.startsWith('-') &&
    !passthrough.has(first)
  ) {
    // Single-dash long form (`-version`, `-help`, `-foo`, length > 2,
    // no `--`) is always a typo: never a real flag, no value passing,
    // no chance Clipanion will accept it. Bypass routing so the
    // parse-error handler surfaces the proper "Did you mean '--foo'?"
    // diagnostic consistently regardless of project state (otherwise
    // the same typo would print the no-project hint when run outside
    // a project, masking the real fix).
    const isSingleDashLong = !first.startsWith('--') && first.length > 2;
    if (isSingleDashLong) return null;
    if (existsSync(defaultProjectDbPath(defaultRuntimeContext()))) {
      return ['serve', ...rawArgs];
    }
    // No DB in cwd, same "no project" failure as the no-args bare
    // case. resolveBareDefault prints the hint + exits.
    return resolveBareDefault();
  }
  return null;
}

/**
 * Decide what bare `sm` (no args) should do. With a project DB present,
 * serve it. With no DB, in an EMPTY cwd on an interactive terminal,
 * offer the getting-started menu (tutorial / example) and dispatch the
 * chosen verb; otherwise fall through to `resolveBareDefault`, which
 * prints the no-project hint and exits. Per spec/cli-contract.md
 * §Binary.
 */
async function resolveNoArgsBare(): Promise<string[]> {
  const ctx = defaultRuntimeContext();
  const stdin = process.stdin as NodeJS.ReadStream;
  const stderr = process.stderr as NodeJS.WriteStream;
  // The decision (serve / menu / init-offer / hint) is pure and unit-tested
  // in `util/empty-folder-prompt.spec.ts`; this seam only wires the live
  // FS / terminal state and the real readline prompts. Each prompt closure
  // is invoked solely in its own interactive branch, so a non-TTY caller
  // (pipe, CI) never blocks on stdin.
  const result = await decideBareNoArgs(
    {
      hasDb: existsSync(defaultProjectDbPath(ctx)),
      isTty: stdin.isTTY === true,
      isEmptyDir: isDirEmpty(ctx.cwd),
    },
    {
      menu: () => {
        const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: false });
        return promptEmptyFolderChoice(stdin, stderr, ansi);
      },
      confirmInit: () => {
        const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: false });
        return confirm(
          tx(ENTRY_TEXTS.bareOfferInit, { glyph: ansi.yellow('?'), cwd: ctx.cwd }),
          { stdin, stderr },
          { defaultAnswer: 'yes' },
        );
      },
    },
  );
  if (result.kind === 'route') return result.argv;
  if (result.kind === 'init-then-serve') {
    // The operator accepted the offer: run `sm init` here, then continue
    // into the Web UI server (the main flow serves the returned argv through
    // its full telemetry / boot-hook wrapper). A first scan that only found
    // content issues (`Issues`, exit 1) still boots the server, the map is
    // where the operator wants to see those issues; only a HARD init failure
    // (config / scan / guard error) bails with init's own code.
    const initExit = await cli.run(['init'], {
      stdin,
      stdout: process.stdout,
      stderr,
    });
    if (!shouldServeAfterInit(initExit)) process.exit(initExit);
    return ['serve'];
  }
  return resolveBareDefault();
}

/**
 * Print the no-project hint and exit 2. (The DB-present branch returns
 * `['serve']` for the flag-routing path that still calls this.) The
 * hint adapts to the cwd: an empty folder points at `sm tutorial` /
 * `sm example` (a new user wants to try the tool, not bootstrap an
 * empty project), a non-empty one at `sm init` / `sm --help`.
 *
 * Colour gating mirrors the rest of the CLI: TTY + no `NO_COLOR` /
 * `--no-color` enables ANSI, else the bare glyph bytes. `--no-color` is
 * irrelevant here (the bare invocation never parsed any flags), so the
 * resolver gets `noColorFlag: false` and relies on env + TTY.
 */
function resolveBareDefault(): string[] {
  const ctx = defaultRuntimeContext();
  if (existsSync(defaultProjectDbPath(ctx))) {
    return ['serve'];
  }
  const stderr = process.stderr as NodeJS.WriteStream;
  const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: false });
  stderr.write(
    tx(ENTRY_TEXTS.bareNoProject, {
      glyph: ansi.red('✕'),
      cwd: ctx.cwd,
      hint: ansi.dim(
        isDirEmpty(ctx.cwd) ? ENTRY_TEXTS.bareEmptyHint : ENTRY_TEXTS.bareNoProjectHint,
      ),
    }),
  );
  process.exit(ExitCode.Error);
}
