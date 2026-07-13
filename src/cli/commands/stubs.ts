/**
 * Clipanion stubs for every verb from `spec/cli-contract.md` that has no
 * real implementation yet. Each stub:
 *
 * 1. Registers the same paths as the final command will (so `sm help` sees
 *    the full surface today).
 * 2. Advertises its future home via the `category` / `description` /
 *    `details` in the Usage block, this is what the Step 1c
 *    introspection layer serialises to json / md. Every stub
 *    description carries a `(planned)` suffix appended via
 *    `planned()`, so `sm --help` users can tell at a glance which
 *    verbs work today and which are reserved for future shipment.
 * 3. On execute, writes a one-liner to stderr (`<verb>: not yet
 *    implemented (planned).`) and exits with code 2 (error / unhandled)
 *    per spec/cli-contract.md §Exit codes.
 *
 * Stubs extend `StubCommand` (which extends `SmCommand`), audit M6.
 * That gives every stub the shared flag set (`--json`, `--quiet`,
 * `--no-color`, `-v`, `--db`) for free, so a script that does
 * `sm doctor --json` against today's stub keeps working when the real
 * verb lands. `emitElapsed = false` is set on the base because a
 * not-implemented verb doesn't produce a meaningful timing line.
 *
 * Why no Step number in user-facing strings: roadmap step numbers shift
 * (a Step 9 plan can be split into 9.1 / 9.2 / 9.3 mid-flight), and
 * stale promises in `--help` are a worse UX than no promise at all.
 * The `// Step N` comments scattered in this file ARE preserved as
 * dev hints; they're for whoever is reading the source, not for end
 * users.
 *
 * When a later Step replaces a stub, the replacement class takes over
 * the same paths and this file loses the entry. The ordering here
 * mirrors the contract's section order so a grep → stub mapping is
 * easy.
 */

import { Command, Option } from 'clipanion';

import { ExitCode } from '../util/exit-codes.js';
import { SmCommand } from '../util/sm-command.js';
import { tx } from '../../kernel/util/tx.js';
import { STUBS_TEXTS } from '../i18n/stubs.texts.js';

/**
 * Tag a description as belonging to a planned-but-unimplemented verb.
 * Currently appends `(planned)` so the help output disambiguates
 * stubs from real verbs without committing to a release date.
 */
function planned(description: string): string {
  return `${description} (planned)`;
}

/**
 * Base for every "not yet implemented" verb. Inherits the global flag
 * set from `SmCommand`, suppresses the trailing `done in <…>` line
 * (planned verbs don't earn timing telemetry), and emits the standard
 * stderr advisory + ExitCode.Error.
 *
 * Subclasses override `verbName` (used in the advisory string) and
 * declare any verb-specific flags via `Option.*`. They do NOT override
 * `run()`, the base implementation is the same for every stub.
 */
abstract class StubCommand extends SmCommand {
  protected override emitElapsed = false;
  protected abstract readonly verbName: string;

  protected async run(): Promise<number> {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(STUBS_TEXTS.notImplemented, {
        glyph: ansi.yellow('⋯'),
        verb: this.verbName,
      }),
    );
    return ExitCode.Error;
  }
}

// ---------------------------------------------------------------------------
// Setup & state
// ---------------------------------------------------------------------------
//
// `sm init` left this file at Step 6.5; it lives in src/cli/commands/init.ts
// now. `sm doctor` remains a stub until Step 3 (or whenever doctor lands).

export class DoctorCommand extends StubCommand {
  static override paths = [['doctor']];
  static override usage = Command.Usage({
    category: 'Setup',
    description: planned('Diagnostic report: DB integrity, pending migrations, orphan rows, plugin status, runner availability.'),
  });

  protected override readonly verbName = 'doctor';
}

// ---------------------------------------------------------------------------
// Config, moved to ./config.ts at Step 6.3
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------
//
// `sm list`, `sm show`, `sm check` left this file in Step 4.5; they live
// in src/cli/commands/{list,show,check}.ts now. The remaining Browse
// stubs (findings / graph / export / orphans*) ship in later Steps.

export class FindingsCommand extends StubCommand {
  static override paths = [['findings']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: planned('Probabilistic findings: injection, stale summaries, low confidence.'),
  });
  kind = Option.String('--kind', { required: false });
  since = Option.String('--since', { required: false });
  threshold = Option.String('--threshold', { required: false });

  protected override readonly verbName = 'findings';
}

// GraphCommand moved to ./graph.ts at Step 8.1.
// ExportCommand moved to ./export.ts at Step 8.3.

// orphans / orphans reconcile / orphans undo-rename, moved to ./orphans.ts
// at Step 5.6

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export class ActionsListCommand extends StubCommand {
  static override paths = [['actions', 'list']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: planned('Registered action types (manifest view).'),
  });

  protected override readonly verbName = 'actions list';
}

export class ActionsShowCommand extends StubCommand {
  static override paths = [['actions', 'show']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: planned('Full action manifest, including preconditions and expected duration.'),
  });
  id = Option.String({ required: true });

  protected override readonly verbName = 'actions show';
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
//
// Every job verb below ships in ROADMAP.md § Execution plan, Step 10
// ("Queue infrastructure" + "LLM runner"). They are wired as stubs
// today so `sm help` advertises the full command surface. The real
// implementations land in `cli/commands/jobs.ts`
// (which already hosts `sm job prune`).

// JobSubmitCommand / JobListCommand / JobShowCommand moved to
// ./job-queue.ts (lands real in Step 10, queue infrastructure).
// JobClaimCommand / JobStatusCommand / JobCancelCommand moved to
// ./job-queue.ts (lands real in Step 10 Phase C).

export class JobRunCommand extends StubCommand {
  static override paths = [['job', 'run']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: planned('Full CLI-runner loop: claim + spawn + record.'),
  });
  all = Option.Boolean('--all', false);
  max = Option.String('--max', { required: false });

  protected override readonly verbName = 'job run';
}

// JobPruneCommand moved to ./jobs.ts (lands real in Step 7.3).

// RecordCommand moved to ./record.ts (lands real in Step 10 Phase D, the
// job callback).

// ---------------------------------------------------------------------------
// History, moved to ./history.ts at Step 5.3 / 5.4
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plugins, enable/disable moved to ./plugins.ts at Step 6.6
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Server, `sm serve` moved out of this file at Step 14.1; the real
// implementation lives at `cli/commands/serve.ts` (Hono BFF skeleton +
// single-port mandate).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Aggregate export
// ---------------------------------------------------------------------------

export const STUB_COMMANDS = [
  DoctorCommand,
  FindingsCommand,
  ActionsListCommand,
  ActionsShowCommand,
  JobRunCommand,
];
