/**
 * `sm check [--json] [-n <node.path>] [--analyzers <ids>] [--include-prob] [--async]`
 *
 * Print every current issue from `scan_issues`. Equivalent to
 * `sm scan --json | jq '.issues'` but reads from the persisted snapshot,
 * so it skips the entire walk + extract + analyzer pipeline.
 *
 * Filters (orthogonal):
 *   `-n <node.path>`     restrict to issues whose nodeIds include the path.
 *   `--analyzers <ids>`      comma-separated qualified analyzer ids (e.g.
 *                         `core/validate-all,core/broken-ref`); restrict to
 *                         issues whose `analyzerId` matches any entry. Both
 *                         qualified and short ids match — the verb compares
 *                         on suffix when the entry has no `<plugin>/` prefix.
 *
 * Probabilistic Rules (spec § A.7):
 *   `--include-prob`     opt-in flag. Default unchanged: deterministic only,
 *                         CI-safe. With the flag, the verb loads the plugin
 *                         runtime, finds Rules with `mode === 'probabilistic'`
 *                         (filtered by `--analyzers` if set), and emits a stderr
 *                         advisory naming the skipped analyzer ids. Full dispatch
 *                         requires the job subsystem (Step 10) — until then
 *                         the flag is a stub: prob analyzers never produce issues
 *                         and never alter the exit code.
 *   `--async`            reserved companion to `--include-prob`. Once jobs
 *                         land it will return job ids without waiting for
 *                         completion; today it is a no-op (the advisory
 *                         simply mentions it).
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok — no error-severity issues (warns / infos do not fail the verb)
 *   1  one or more issues at severity `error`
 *   5  DB file missing — run `sm scan` first
 *
 * The `1` ≠ `0` boundary intentionally mirrors `sm scan`'s contract: an
 * agent / CI loop can use `sm check` as a fast pre-flight without paying
 * for a full walk.
 *
 * TODO: when the job subsystem ships (ROADMAP.md § Execution plan,
 * Step 10 — "Queue infrastructure" / "LLM runner"), render an output
 * marker (`(prob)` / `🧠`) on issues whose `analyzerId` belongs to a
 * probabilistic analyzer. Today the stub never produces such issues, so
 * the marker has nothing to attach to and is intentionally absent.
 */

import { Command, Option } from 'clipanion';

import { qualifiedExtensionId } from '../../kernel/registry.js';
import type { Issue, Severity } from '../../kernel/types.js';
import { matchesAnalyzerFilter } from '../../kernel/util/analyzer-filter.js';
import { CHECK_TEXTS } from '../i18n/check.texts.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { ExitCode } from '../util/exit-codes.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';
import type { IPrinter } from '../util/printer.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { SmCommand } from '../util/sm-command.js';
import { tx } from '../../kernel/util/tx.js';
import { withSqlite } from '../util/with-sqlite.js';

export class CheckCommand extends SmCommand {
  static override paths = [['check']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Print all current issues (reads from DB, faster than sm scan --json | jq).',
    details: `
      Loads every row from scan_issues. Exits 1 if any issue has
      severity \`error\`, otherwise 0. \`warn\` and \`info\` do not fail.

      Run \`sm scan\` first to populate the DB.

      \`--include-prob\` is an opt-in flag for probabilistic Analyzer
      dispatch (spec § A.7). Default is deterministic-only: same
      CI-safe behaviour as before. With the flag, registered prob
      rules are detected and named in a stderr advisory; full
      dispatch lands when the job subsystem ships at Step 10.
    `,
    examples: [
      ['Print every current issue', '$0 check'],
      ['Machine-readable issue list', '$0 check --json'],
      ['Restrict to a single node', '$0 check -n .claude/agents/architect.md'],
      ['Restrict to specific rules', '$0 check --analyzers core/broken-ref,core/validate-all'],
      ['Opt in to probabilistic analyzers (stub until Step 10)', '$0 check --include-prob'],
      ['Check the global scope', '$0 check --global'],
      ['Use a non-default DB file', '$0 check --db /path/to/skill-map.db'],
    ],
  });

  node = Option.String('-n,--node', {
    required: false,
    description:
      'Restrict to issues whose nodeIds include the given path. Combines with --analyzers and --include-prob.',
  });
  analyzers = Option.String('--analyzers', {
    required: false,
    description:
      'Comma-separated analyzer ids (qualified or short). Restrict the issue read; with --include-prob, also filters which prob analyzers surface in the advisory.',
  });
  includeProb = Option.Boolean('--include-prob', false, {
    description:
      'Detect probabilistic Analyzers and emit a stub advisory naming them (full dispatch lands at Step 10). Default off → deterministic-only, CI-safe.',
  });
  async = Option.Boolean('--async', false, {
    description:
      'Reserved companion to --include-prob: once jobs ship, returns job ids without waiting. No effect today.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description:
      'Skip drop-in plugin discovery; only kernel built-ins participate in the prob detection. Same flag shape as `sm scan`.',
  });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr);
    if (exit !== null) return exit;

    // Parse `--analyzers` once. Empty / whitespace tokens dropped.
    const analyzerFilter = parseAnalyzersFlag(this.analyzers);

    // Probabilistic Analyzer detection. Cheap when the flag is off — we never
    // touch the plugin loader at all (status quo for `sm check`).
    if (this.includeProb) {
      const probAnalyzerIds = await detectProbAnalyzerIds({
        scope: this.global ? 'global' : 'project',
        noPlugins: this.noPlugins,
        analyzerFilter,
        printer: this.printer!,
      });
      if (probAnalyzerIds.length > 0) {
        const template = this.async
          ? CHECK_TEXTS.probStubAdvisoryAsync
          : CHECK_TEXTS.probStubAdvisory;
        this.printer!.info(
          tx(template, {
            count: probAnalyzerIds.length,
            analyzerIds: probAnalyzerIds.join(', '),
          }),
        );
      }
    }

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      let issues = await adapter.issues.listAll();

      // Filters apply to the persisted issue list. They do NOT affect the
      // prob-analyzer advisory above (which already honoured `--analyzers`).
      if (this.node !== undefined) {
        const nodePath = this.node;
        issues = issues.filter((i) => i.nodeIds.includes(nodePath));
      }
      if (analyzerFilter !== undefined) {
        issues = issues.filter((i) => matchesAnalyzerFilter(i.analyzerId, analyzerFilter));
      }

      const stdout = this.context.stdout as NodeJS.WriteStream;
      const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
      if (this.json) {
        this.printer!.data(JSON.stringify(issues) + '\n');
      } else if (issues.length === 0) {
        this.printer!.data(
          tx(CHECK_TEXTS.noIssues, { glyph: ansi.green('✓') }),
        );
      } else {
        this.printer!.data(renderHuman(issues, ansi));
      }

      return issues.some((i) => i.severity === 'error') ? ExitCode.Issues : ExitCode.Ok;
    });
  }
}

/**
 * Parse the `--analyzers <ids>` flag into a normalised filter list. Returns
 * `undefined` when the flag is absent — the caller treats that as "no
 * filter, every rule passes". Empty entries are dropped silently so a
 * trailing comma does not change the matched set.
 */
function parseAnalyzersFlag(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) return undefined;
  return ids;
}

interface IDetectProbAnalyzersOptions {
  scope: 'project' | 'global';
  noPlugins: boolean;
  analyzerFilter: readonly string[] | undefined;
  printer: IPrinter;
}

/**
 * Load the plugin runtime + built-ins, collect every Analyzer with
 * `mode === 'probabilistic'`, and return their qualified ids (filtered
 * by `--analyzers` when set). Plugin load warnings are forwarded verbatim
 * to stderr so the user sees the same diagnostics `sm scan` produces.
 *
 * Returns an empty list when no prob analyzers are registered — the caller
 * skips the advisory entirely in that case (advising about nothing
 * would be noise).
 */
async function detectProbAnalyzerIds(opts: IDetectProbAnalyzersOptions): Promise<string[]> {
  const pluginRuntime = opts.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ scope: opts.scope });
  pluginRuntime.emitWarnings(opts.printer);
  const composed = composeScanExtensions({
    noBuiltIns: false,
    pluginRuntime,
    killSwitches: readConformanceKillSwitches(),
  });
  const analyzers = composed?.analyzers ?? [];

  const probIds: string[] = [];
  for (const analyzer of analyzers) {
    if (analyzer.mode !== 'probabilistic') continue;
    const qualified = qualifiedExtensionId(analyzer.pluginId, analyzer.id);
    if (opts.analyzerFilter && !matchesAnalyzerFilter(qualified, opts.analyzerFilter)) continue;
    probIds.push(qualified);
  }
  // Stable ordering so the advisory is deterministic across runs.
  probIds.sort();
  return probIds;
}

/**
 * Defence in depth: `analyzerId` / `message` / `nodeIds` originate from
 * plugin-authored strings persisted in the DB. Every value emitted by
 * this renderer runs through `sanitizeForTerminal` so a hostile plugin
 * cannot repaint the user's terminal via a stored issue row.
 *
 * Layout:
 *
 *   sm check — 10 warnings · 1 error
 *
 *     foo.md
 *       ✕  analyzer-id   Error message …
 *       ⚠  analyzer-id   Warning message …
 *
 *     bar.md
 *       ⚠  analyzer-id   Warning message …
 *
 *   Tip: `sm refresh <node>` to revalidate a file after fixes.
 *
 * Issues group by their primary `nodeIds[0]` (multi-node issues attach
 * to the first path; the message itself names any cross-file context).
 * Within each file, errors sort first, then warnings, then info — so
 * the most actionable rows lead each section. Analyzer ids align to the
 * widest in the rendered set so messages line up across rows.
 */
function renderHuman(issues: Issue[], ansi: IAnsi): string {
  // Sanitise once into a flat shape the layout passes can reason about
  // without re-running sanitization in every nested loop.
  const rows = issues.map((issue) => ({
    severity: issue.severity,
    analyzerId: sanitizeForTerminal(issue.analyzerId),
    message: sanitizeForTerminal(issue.message),
    primary: sanitizeForTerminal(issue.nodeIds[0] ?? '(no file)'),
  }));

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const r of rows) counts[r.severity]++;

  const byFile = groupRowsByFile(rows);

  // Width of the analyzer-id column = longest across all rendered rows.
  const analyzerWidth = Math.max(...rows.map((r) => r.analyzerId.length));

  const lines: string[] = [];
  lines.push(tx(CHECK_TEXTS.summaryHeader, { summary: formatSummary(counts, ansi) }));
  for (const [file, bucket] of byFile) {
    lines.push(tx(CHECK_TEXTS.fileSection, { file }));
    for (const row of bucket) {
      lines.push(
        tx(CHECK_TEXTS.issueRow, {
          glyph: severityGlyph(row.severity, ansi),
          analyzerId: ansi.dim(row.analyzerId.padEnd(analyzerWidth)),
          message: trimRedundantPath(row.message, row.primary),
        }),
      );
    }
    lines.push('\n');
  }
  // Drop the trailing blank-line separator between the last file and
  // the tip line so the output ends with exactly one blank.
  if (lines.length > 0 && lines[lines.length - 1] === '\n') lines.pop();
  lines.push(CHECK_TEXTS.tipLine);
  return lines.join('');
}

/**
 * Bucket sanitised rows by their primary file, then sort each bucket by
 * severity rank (errors before warns before infos). The Map preserves
 * insertion order so files surface in the order the issues stream
 * landed in (deterministic because `adapter.issues.listAll` returns a
 * stable ordering).
 */
type IRenderRow = {
  severity: Severity;
  analyzerId: string;
  message: string;
  primary: string;
};
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
function groupRowsByFile(rows: IRenderRow[]): Map<string, IRenderRow[]> {
  const byFile = new Map<string, IRenderRow[]>();
  for (const r of rows) {
    const bucket = byFile.get(r.primary);
    if (bucket) bucket.push(r);
    else byFile.set(r.primary, [r]);
  }
  for (const bucket of byFile.values()) {
    bucket.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  }
  return byFile;
}

/**
 * Format the header summary as `N errors · M warnings · K info`.
 * Categories with zero count are dropped so warn-only and info-only
 * runs stay terse. Each fragment is colored independently (red /
 * yellow / cyan).
 */
function formatSummary(counts: Record<Severity, number>, ansi: IAnsi): string {
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(ansi.red(`${counts.error} error${counts.error === 1 ? '' : 's'}`));
  }
  if (counts.warn > 0) {
    parts.push(
      ansi.yellow(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`),
    );
  }
  if (counts.info > 0) {
    parts.push(ansi.cyan(`${counts.info} info`));
  }
  return parts.join(' · ');
}

/** Severity glyph + color: ✕ red / ⚠ yellow / ℹ cyan. */
function severityGlyph(severity: Severity, ansi: IAnsi): string {
  switch (severity) {
    case 'error':
      return ansi.red('✕');
    case 'warn':
      return ansi.yellow('⚠');
    case 'info':
      return ansi.cyan('ℹ');
  }
}

/**
 * The file path is already in the section header, so the rule's prose
 * `Broken X reference from <path> → <target>` repeats it. Strip the
 * substring `" from <primary>"` when present — the message stays
 * grammatical (`Broken X reference → <target>`) and the section header
 * carries the file context.
 */
function trimRedundantPath(message: string, primary: string): string {
  if (primary === '(no file)') return message;
  const needle = ` from ${primary}`;
  if (!message.includes(needle)) return message;
  return message.replace(needle, '');
}
