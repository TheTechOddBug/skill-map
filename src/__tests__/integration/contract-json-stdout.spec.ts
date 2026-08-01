/**
 * GUARD 3, `--json` keeps stdout clean.
 *
 * `spec/cli-contract.md` §Machine-readable output analyzers is
 * unambiguous: when `--json` is set, "stdout contains ONLY the JSON
 * document (or ndjson lines, for streaming verbs)" and "stderr carries
 * logs, progress, and errors". Any verb that prints a `✓ ...` receipt or
 * a human table on stdout under `--json` breaks every consumer piping it
 * into `jq`, and no unit test sees it because unit tests read the
 * command's return value, not the channel it wrote to.
 *
 * `--json` is a GLOBAL flag, so the rule is universal: it binds every
 * verb, not only the ones whose contract row happens to describe a
 * payload. The single documented exception is `sm graph`, whose row says
 * in so many words that "the global `--json` flag is ignored on
 * `sm graph` (formats are picked via `--format`, never via the global
 * flag)"; it is covered here through `--format json` instead.
 *
 * Anti-vacuity: every verb the CLI publishes must appear either in
 * `COVERED` or in `EXCLUDED`. A verb added later fails the coverage test
 * until someone decides which it is, so this guard cannot rot into
 * checking a shrinking fraction of the surface.
 */

import { strict as assert } from 'node:assert';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  type IHelpSurface,
  SCRATCH_ROOT,
  loadHelpSurface,
  seedScannedScope,
  sm,
} from './helpers/cli-contract.js';

/**
 * Verbs exercised under `--json`, with the full argv each one needs to
 * reach real output. A verb that bails early on a missing argument would
 * pass this guard trivially, so every recipe is one that actually
 * produces its payload against the seeded scope.
 *
 * Ordered read-only first, state-mutating last: the scope is shared
 * across cases, and `plugins enable --all` in particular changes what a
 * later scan has to do.
 */
const COVERED: ReadonlyArray<readonly [string, string[]]> = [
  ['actions list', ['actions', 'list', '--json']],
  ['activity status', ['activity', 'status', '--json']],
  ['agent status', ['agent', 'status', '--json']],
  ['check', ['check', '--json']],
  ['config get', ['config', 'get', 'scan.tokenize', '--json']],
  ['config list', ['config', 'list', '--json']],
  ['config show', ['config', 'show', 'scan.tokenize', '--source', '--json']],
  ['doctor', ['doctor', '--json']],
  ['export', ['export', '', '--json']],
  ['findings', ['findings', '--json']],
  ['findings suppressions', ['findings', 'suppressions', '--json']],
  // Per the contract, `sm graph` ignores the global --json on purpose;
  // its machine surface is `--format json`, so that is what is guarded.
  ['graph --format json', ['graph', '--format', 'json']],
  ['help', ['help', '--json']],
  ['history', ['history', '--json']],
  ['history stats', ['history', 'stats', '--json']],
  ['issues suppressions', ['issues', 'suppressions', '--json']],
  ['jobs list', ['jobs', 'list', '--json']],
  ['jobs status', ['jobs', 'status', '--json']],
  ['list', ['list', '--json']],
  ['orphans', ['orphans', '--json']],
  ['plugins doctor', ['plugins', 'doctor', '--json']],
  ['plugins list', ['plugins', 'list', '--json']],
  ['plugins slots list', ['plugins', 'slots', 'list', '--json']],
  ['show', ['show', 'AGENTS.md', '--json']],
  ['version', ['version', '--json']],
  ['db migrate --status', ['db', 'migrate', '--status', '--json']],
  ['db reset --dry-run', ['db', 'reset', '--dry-run', '--json']],
  ['findings prune --dry-run', ['findings', 'prune', '--dry-run', '--json']],
  ['sidecars prune --dry-run', ['sidecars', 'prune', '--dry-run', '--yes', '--json']],
  ['hooks install --dry-run', ['hooks', 'install', 'pre-commit-bump', '--dry-run', '--json']],
  ['jobs prune', ['jobs', 'prune', '--json']],
  ['enrich --stale', ['enrich', '--stale', '--json']],
  ['scan', ['scan', '--yes', '--json']],
  ['db backup', ['db', 'backup', '--json']],
  ['db migrate', ['db', 'migrate', '--no-backup', '--json']],
  ['plugins upgrade', ['plugins', 'upgrade', '--json']],
  ['agent install', ['agent', 'install', '--json']],
  ['agent uninstall', ['agent', 'uninstall', '--json']],
  ['plugins enable', ['plugins', 'enable', '--all', '--yes', '--json']],
];

/**
 * Verbs deliberately left out, each with the reason. Two categories:
 * verbs that cannot be driven from a test at all, and ONE parked defect.
 * Nothing here is excluded merely because it fails.
 */
const EXCLUDED: ReadonlyMap<string, string> = new Map([
  // --- Cannot be driven from an automated test -----------------------
  ['serve', 'long-running listener; agents must never start one (see AGENTS.md §Agent execution)'],
  ['watch', 'long-running inotify loop; same prohibition as serve'],
  ['db shell', 'interactive SQL shell, needs a TTY'],
  ['db browser', 'launches the sqlitebrowser GUI and detaches'],
  ['db restore', 'destructive DB swap; needs a prepared backup, covered by db-restore specs'],
  ['tutorial', 'requires an empty cwd and materialises a whole skill folder'],
  ['example', 'requires an empty cwd and materialises a whole project'],
  ['init', 'requires a pristine cwd; would clobber the shared seeded scope'],
  ['conformance run', 'takes minutes and spawns `sm serve` children that a kill would orphan'],
  ['scan compare-with', 'needs a previously saved ScanResult dump on disk'],
  ['record', 'needs a running job plus its nonce; the only ndjson verb besides watch'],
  ['jobs submit', 'needs an enabled probabilistic extension to queue against'],
  ['jobs claim', 'needs a queued job; on an empty queue it exits 1 with no payload'],
  ['jobs preview', 'needs an existing job id'],
  ['jobs show', 'needs an existing job id'],
  ['jobs cancel', 'needs an existing job id'],
  ['jobs fail', 'needs an existing job id'],
  ['bump', 'gated `.sm` sidecar write; needs consent and a node with pending state'],
  ['sidecars annotate', 'gated `.sm` sidecar write needing consent'],
  ['sidecars refresh', 'gated `.sm` sidecar write needing consent'],
  ['findings dismiss', 'needs an existing finding id'],
  ['findings resolve', 'needs an existing finding id'],
  ['findings reopen', 'needs an existing finding id'],
  ['findings clear', 'needs existing finding rows'],
  ['findings undismiss', 'needs an existing suppression entry'],
  ['issues dismiss', 'needs an existing deterministic issue to key on'],
  ['issues undismiss', 'needs an existing issue suppression'],
  ['orphans reconcile', 'needs an orphan history row'],
  ['orphans undo-rename', 'needs an active auto-rename issue'],
  // Same shape as `plugins show` / `plugins config`: a required id
  // argument whose value is a built-in that renaming would silently
  // break, so the recipe would pin this guard to a specific extension.
  ['actions show', 'needs an action id argument'],
  ['plugins show', 'needs a qualified <plugin>/<ext> id argument'],
  ['plugins config', 'needs a qualified <plugin>/<ext> id argument'],
  ['plugins create', 'scaffolds a plugin directory; covered by the scaffolder specs'],
  ['plugins disable', 'symmetric with `plugins enable`, which is covered; disabling first would skew it'],
  ['plugins trust', 'mutates trust grants anchored to the checkout'],
  ['plugins untrust', 'mutates trust grants anchored to the checkout'],
  ['config set', 'mutates the shared scope config that later cases read'],
  ['config reset', 'mutates the shared scope config that later cases read'],
  ['activity install', 'writes into a provider hook config behind a consent prompt'],
  ['activity uninstall', 'writes into a provider hook config behind a consent prompt'],

  // --- Parked defect, needs a product decision -----------------------
  [
    'db dump',
    // DEFECT: `sm db dump --json` writes the raw SQL dump to stdout, so
    // stdout is not a JSON document. Unlike the other offenders this has
    // no obvious right answer: the SQL IS the verb's product (`sm db dump
    // | sqlite3` is the point of it), and the contract row says only "SQL
    // dump" without describing any `--json` payload. Resolving it means
    // either wrapping the dump in an envelope or documenting `--json` as
    // ignored the way `sm graph` does; both are the user's call, and both
    // change a shipped surface.
    'DEFERRED DEFECT: emits SQL on stdout under --json; fixing it needs a product decision',
  ],
]);

/**
 * Verbs the contract allows to stream ndjson rather than one document
 * (§Machine-readable output: "or ndjson lines, for streaming verbs like
 * `sm watch --json` and `sm record --json`"). Both are excluded above,
 * so this is here to keep the assertion honest if either is ever added.
 */
const NDJSON_VERBS: ReadonlySet<string> = new Set(['watch', 'record']);

interface IStdoutVerdict {
  clean: boolean;
  detail: string;
}

function parsesAsNdjson(text: string): boolean {
  const lines = text.split('\n').filter((l) => l !== '');
  if (lines.length === 0) return false;
  return lines.every((line) => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  });
}

function judgeStdout(label: string, stdout: string): IStdoutVerdict {
  const trimmed = stdout.trim();
  // Nothing at all is clean: the rule forbids non-JSON bytes on stdout,
  // it does not force a verb without a payload to invent one.
  if (trimmed === '') return { clean: true, detail: 'empty' };
  try {
    JSON.parse(trimmed);
    return { clean: true, detail: 'json document' };
  } catch {
    // fall through to the ndjson branch
  }
  if (NDJSON_VERBS.has(label) && parsesAsNdjson(trimmed)) {
    return { clean: true, detail: 'ndjson' };
  }
  return { clean: false, detail: JSON.stringify(trimmed.slice(0, 120)) };
}

let help: IHelpSurface;
let cwd: string;

before(() => {
  cwd = join(SCRATCH_ROOT, 'json-stdout');
  seedScannedScope(cwd);
  help = loadHelpSurface(cwd);
});

after(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('Guard 3 · --json puts nothing but the JSON document on stdout', () => {
  it('every CLI verb is either covered or explicitly excluded', () => {
    const covered = new Set(COVERED.map(([label]) => label.split(' --')[0]!));
    const unaccounted = help.verbs
      .map((v) => v.name)
      .filter((name) => !covered.has(name) && !EXCLUDED.has(name));
    assert.deepEqual(
      unaccounted,
      [],
      'these verbs are neither covered nor excluded, so this guard silently stops short of '
        + `the real surface. Add a recipe to COVERED or a reason to EXCLUDED:\n  ${unaccounted.join('\n  ')}`,
    );
  });

  it('no exclusion outlives the verb it excuses', () => {
    // A stale entry would otherwise sit here forever, reading like a
    // known limitation when the verb it names no longer exists.
    const live = new Set(help.verbs.map((v) => v.name));
    const stale = [...EXCLUDED.keys()].filter((name) => !live.has(name));
    assert.deepEqual(stale, [], `EXCLUDED names verbs the CLI no longer has: ${stale.join(', ')}`);
  });

  it('the covered set is still a majority of the CLI (vacuity tripwire)', () => {
    assert.ok(
      COVERED.length >= 35,
      `only ${COVERED.length} verbs are exercised; the matrix was gutted rather than maintained`,
    );
  });

  it('stdout carries only the JSON document', () => {
    const dirty: string[] = [];
    for (const [label, argv] of COVERED) {
      const result = sm(argv, { cwd });
      const verdict = judgeStdout(label, result.stdout);
      if (!verdict.clean) dirty.push(`sm ${label}: ${verdict.detail}`);
    }
    assert.deepEqual(
      dirty,
      [],
      `these verbs wrote human output to stdout under --json (it belongs on stderr, per `
        + `§Machine-readable output):\n  ${dirty.join('\n  ')}`,
    );
  });
});
