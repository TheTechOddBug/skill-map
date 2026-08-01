/**
 * The `sm` command registry: the single ordered list of every command
 * class the binary exposes, plus the factory that builds the `SmCli`
 * around it.
 *
 * Split out of `cli/entry.ts` because that module is a process DRIVER,
 * not a composition root: importing it boots the logger, dispatches the
 * `boot` hook, arms telemetry, parses `process.argv` and calls
 * `process.exit`. Anything that needs the composed CLI without running
 * it (the introspection guard in
 * `cli/commands/__tests__/help-introspection.spec.ts`, `sm help`'s own
 * channel tests, any future docs generator) has to be able to construct
 * it in isolation, and MUST see the same list the binary registers, a
 * second hand-maintained list would drift the day a verb is added and
 * the guard would go quietly blind.
 *
 * Registration ORDER is preserved verbatim from the previous inline
 * block: Clipanion resolves ambiguous argv against the registration
 * index, and `sm help` sorts its own catalog by verb path anyway.
 */

import type { BaseContext, CommandClass } from 'clipanion';

import { BINARY_LABEL, BINARY_NAME, VERSION } from '../version.js';
import { SmCli } from './sm-cli.js';
import { ActionsListCommand, ActionsShowCommand } from './commands/actions.js';
import { ACTIVITY_COMMANDS } from './commands/activity.js';
import { AGENT_COMMANDS } from './commands/agent.js';
import { BUMP_COMMANDS } from './commands/bump.js';
import { CheckCommand } from './commands/check.js';
import { CONFIG_COMMANDS } from './commands/config.js';
import { CONFORMANCE_COMMANDS } from './commands/conformance.js';
import { DB_COMMANDS } from './commands/db.js';
import { DoctorCommand } from './commands/doctor.js';
import { ExampleCommand } from './commands/example.js';
import { ExportCommand } from './commands/export.js';
import {
  FindingsClearCommand,
  FindingsCommand,
  FindingsDismissCommand,
  FindingsPruneCommand,
  FindingsReopenCommand,
  FindingsResolveCommand,
  FindingsSuppressionsCommand,
  FindingsUndismissCommand,
} from './commands/findings.js';
import { GraphCommand } from './commands/graph.js';
import { HelpCommand, RootHelpCommand } from './commands/help.js';
import { HistoryCommand, HistoryStatsCommand } from './commands/history.js';
import { HOOKS_COMMANDS } from './commands/hooks.js';
import { InitCommand } from './commands/init.js';
import { IntentionalFailCommand } from './commands/intentional-fail.js';
import {
  IssuesDismissCommand,
  IssuesSuppressionsCommand,
  IssuesUndismissCommand,
} from './commands/issues.js';
import { JOB_QUEUE_COMMANDS } from './commands/job-queue.js';
import { JobPruneCommand } from './commands/jobs.js';
import { ListCommand } from './commands/list.js';
import { ORPHANS_COMMANDS } from './commands/orphans.js';
import { PLUGIN_COMMANDS } from './commands/plugins.js';
import { RecordCommand } from './commands/record.js';
import { REFRESH_COMMANDS } from './commands/refresh.js';
import { ScanCommand } from './commands/scan.js';
import { ScanCompareCommand } from './commands/scan-compare.js';
import { ServeCommand } from './commands/serve.js';
import { ShowCommand } from './commands/show.js';
import { SIDECAR_COMMANDS } from './commands/sidecar.js';
import { TutorialCommand } from './commands/tutorial.js';
import { RootVersionCommand, VersionCommand } from './commands/version.js';
import { WatchCommand } from './commands/watch.js';

/**
 * Every command class the `sm` binary registers, in registration order.
 *
 * `IntentionalFailCommand` is the hidden Sentry self-test verb: it runs,
 * but declares no `static usage`, so Clipanion (and therefore
 * `sm help`) leaves it out of every catalog. `RootHelpCommand` and
 * `RootVersionCommand` claim bare flag paths (`-h` / `--help` /
 * `--version`) that `sm help` filters out for the same reason.
 */
export const SM_COMMANDS: readonly CommandClass<BaseContext>[] = [
  RootVersionCommand,
  RootHelpCommand,
  HelpCommand,
  InitCommand,
  TutorialCommand,
  ExampleCommand,
  IntentionalFailCommand,
  ScanCommand,
  ScanCompareCommand,
  ServeCommand,
  WatchCommand,
  VersionCommand,
  ListCommand,
  ShowCommand,
  CheckCommand,
  FindingsCommand,
  FindingsPruneCommand,
  FindingsClearCommand,
  FindingsResolveCommand,
  FindingsReopenCommand,
  FindingsDismissCommand,
  FindingsSuppressionsCommand,
  FindingsUndismissCommand,
  IssuesDismissCommand,
  IssuesUndismissCommand,
  IssuesSuppressionsCommand,
  GraphCommand,
  ExportCommand,
  HistoryCommand,
  HistoryStatsCommand,
  JobPruneCommand,
  RecordCommand,
  ActionsListCommand,
  ActionsShowCommand,
  DoctorCommand,
  ...JOB_QUEUE_COMMANDS,
  ...AGENT_COMMANDS,
  ...CONFIG_COMMANDS,
  ...CONFORMANCE_COMMANDS,
  ...DB_COMMANDS,
  ...PLUGIN_COMMANDS,
  ...ORPHANS_COMMANDS,
  ...REFRESH_COMMANDS,
  ...BUMP_COMMANDS,
  ...SIDECAR_COMMANDS,
  ...HOOKS_COMMANDS,
  ...ACTIVITY_COMMANDS,
];

/**
 * Build the composed CLI: an `SmCli` (introspection-complete
 * `definitions()`) carrying every registered command. Pure, no I/O, no
 * argv reading, safe to call from a test.
 */
export function createSmCli(): SmCli {
  const cli = new SmCli({
    binaryLabel: BINARY_LABEL,
    binaryName: BINARY_NAME,
    binaryVersion: VERSION,
    enableCapture: false,
  });
  for (const command of SM_COMMANDS) cli.register(command);
  return cli;
}
