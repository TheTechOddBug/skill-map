import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', 'bin', 'sm.js');
const EMPTY_DIR = resolve(HERE, '..', '..', '.tmp', 'empty-scan-test');

function sm(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  // NO_COLOR pins the subprocess to plain output even when the parent
  // test runner has FORCE_COLOR set, the human regexes assume no
  // ANSI bytes between glyph + id.
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      NO_COLOR: '1',
      // Hermetic spawn: the child `sm` must never touch the network, or
      // `spawnSync` hangs forever (it has no timeout). Two boot-time
      // probes reach out: the npm-registry update check and telemetry.
      // The update check normally caps at 1500ms, but a slow / blocked
      // network or an expired 24h throttle can still stall the very
      // first spawn (and running this spec on its own, outside the npm
      // `test:ci` env, hung the whole suite). Pin both kill switches on
      // the spawn itself so the spec is self-contained, not reliant on
      // the runner's env (per project memory: spawn-specs isolate their
      // own side effects).
      SM_NO_UPDATE_CHECK: '1',
      SKILL_MAP_TELEMETRY: '0',
    },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('CLI binary', () => {
  before(() => mkdirSync(EMPTY_DIR, { recursive: true }));
  after(() => rmSync(EMPTY_DIR, { recursive: true, force: true }));

  it('prints version on --version', () => {
    const r = sm(['--version']);
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it('`sm version` prints the multi-line version matrix with runtime', () => {
    const r = sm(['version']);
    assert.equal(r.status, 0);
    // New layout: 2-space indent on every row + dim key column. The
    // anchors below tolerate the leading whitespace.
    assert.match(r.stdout, /^\s+sm\s+\d+\.\d+\.\d+/m);
    assert.match(r.stdout, /^\s+spec\s+/m);
    assert.match(r.stdout, /^\s+runtime\s+Node v\d+\.\d+\.\d+/m);
    assert.match(r.stdout, /^\s+db-schema\s+/m);
  });

  it('`sm version` shows db-schema = "-" when no DB is provisioned in the cwd', () => {
    // EMPTY_DIR has no .skill-map/skill-map.db; the `db-schema` field
    // must degrade gracefully to the hyphen sentinel instead of erroring.
    const r = sm(['version'], EMPTY_DIR);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\s+db-schema\s+-\s*$/m);
  });

  it('`sm version --json` emits the three-field shape (sm, spec, dbSchema) per spec', () => {
    // `cli-contract.md` § `sm version`: `--json` emits exactly
    // `{ sm, spec, dbSchema }`. `runtime` is intentionally
    // absent from the JSON surface; expanding it is a spec change.
    // `dev` is an additive optional field only emitted in dev builds.
    const r = sm(['version', '--json'], EMPTY_DIR);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    const keys = [...Object.keys(payload)].filter((k) => k !== 'dev').sort();
    assert.deepEqual(
      keys,
      ['dbSchema', 'sm', 'spec'],
    );
    assert.match(String(payload['sm']), /^\d+\.\d+\.\d+/);
    assert.equal(typeof payload['spec'], 'string');
    // `dbSchema` is the hyphen sentinel when no DB is provisioned.
    assert.equal(payload['dbSchema'], '-');
    // Nothing else lands on stdout.
    assert.equal(r.stderr, '');
  });

  it('`sm version --json` stamps `dev: true` when running from a checkout', () => {
    // The CLI bin under test (`src/bin/sm.js`) loads the compiled
    // helper from `src/dist/.../dev-mode.js`. That path lives inside
    // the repo checkout (no `node_modules/` ancestor), so the
    // additive `dev` field MUST appear. On a published install the
    // helper would resolve to `<somewhere>/node_modules/@skill-map/cli/...`
    // and the field would be omitted, the SPA + topbar branch on
    // presence alone.
    const r = sm(['version', '--json'], EMPTY_DIR);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['dev'], true);
  });

  it('`sm version` (human) appends a yellow [dev] chip to the sm row when running from a checkout', () => {
    const r = sm(['version'], EMPTY_DIR);
    assert.equal(r.status, 0);
    // Match the dev marker literally; the colour escapes are stripped
    // when the spawned process's stdout is not a TTY (it isn't in
    // this test runner), so the chip lands as plain `[dev]` text.
    // The row is indented two spaces and the key is padded against
    // the longest column ("db-schema"), so the regex tolerates
    // leading whitespace + variable inter-column padding.
    // The version may carry a prerelease suffix on the rc channel
    // (e.g. 0.89.0-rc.0); the chip must match either shape.
    assert.match(r.stdout, /^\s*sm\s+\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s+\[dev\]\s*$/m);
  });

  it('`sm version` reports the applied migration version once a DB is provisioned', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'skill-map-version-cli-'));
    try {
      // `sm init --no-scan` creates the DB and applies kernel migrations.
      // After init, `PRAGMA user_version` should equal the latest kernel
      // migration version (currently 1: 001_initial).
      const init = sm(['init', '--no-scan'], tmpDir);
      assert.equal(init.status, 0, `init failed: ${init.stderr}`);
      const r = sm(['version'], tmpDir);
      assert.equal(r.status, 0);
      // Numeric, not the em-dash. Don't pin the exact number, the test
      // adapts to whatever migrations ship today.
      const match = /^\s+db-schema\s+(\d+)\s*$/m.exec(r.stdout);
      assert.ok(match, `db-schema line not numeric: ${r.stdout}`);
      assert.ok(Number(match[1]) >= 1, 'expected at least one migration applied');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prints usage on --help', () => {
    const r = sm(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /skill-map/);
    assert.match(r.stdout, /sm scan/);
  });

  it('renders a namespace overview for `sm plugins --help` instead of the Clipanion list', () => {
    // Regression: a command namespace (prefix that owns subcommands but is
    // not itself runnable) used to fall through to Clipanion's terse
    // "Multiple commands match" listing. It now gets the same rich layout
    // shape as a leaf verb: header, USAGE, COMMANDS list, footer.
    const r = sm(['plugins', '--help']);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /Multiple commands match/);
    assert.match(r.stdout, /^sm plugins:\s+Discover, inspect, and toggle plugins/m);
    assert.match(r.stdout, /USAGE\n\s+sm plugins <command> \[options\]/);
    assert.match(r.stdout, /COMMANDS/);
    // Subcommand rows are listed by their namespace-relative name.
    assert.match(r.stdout, /\n\s+list\s+List discovered plugins/);
    assert.match(r.stdout, /\n\s+doctor\s+Run the full load pass/);
    assert.match(r.stdout, /Run `sm plugins <command> --help` for flags and arguments\./);
  });

  it('`sm plugins list <id>` tags non-stable extensions with their lifecycle stage', () => {
    // `core/mcp-tools` ships `stability: 'beta'`; the detail row renders
    // it as `core/mcp-tools (beta)`. Stable extensions (missing == stable
    // per spec) render untagged. The tag lives in the per-plugin detail
    // (`list <id>`), the index carries no names.
    const r = sm(['plugins', 'list', 'core'], EMPTY_DIR);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /mcp-tools \(beta\)/);
    assert.match(r.stdout, /link-counter(?!\s*\()/);
  });

  it('`sm plugins show core/mcp-tools` surfaces the Stability field', () => {
    const r = sm(['plugins', 'show', 'core/mcp-tools'], EMPTY_DIR);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\s+Stability\s+beta$/m);
  });

  it('`sm help <namespace>` matches `sm <namespace> --help`', () => {
    const viaHelp = sm(['help', 'db']);
    const viaFlag = sm(['db', '--help']);
    assert.equal(viaHelp.status, 0);
    assert.equal(viaFlag.status, 0);
    assert.equal(viaHelp.stdout, viaFlag.stdout);
    assert.match(viaHelp.stdout, /^sm db:/m);
    assert.match(viaHelp.stdout, /COMMANDS/);
  });

  it('still renders a leaf verb (not the group overview) for an exact subcommand', () => {
    const r = sm(['plugins', 'list', '--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^sm plugins list:/m);
    assert.match(r.stdout, /FLAGS/);
    assert.doesNotMatch(r.stdout, /^COMMANDS$/m);
  });

  it('exits 5 with an unknown-verb message for a name that is neither verb nor namespace', () => {
    const r = sm(['help', 'definitely-not-a-verb']);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /unknown verb "definitely-not-a-verb"/);
  });

  it('bare `sm` in an empty dir (non-TTY) prints the getting-started hint and exits 2', () => {
    // Spec contract §Binary: bare invocation in an EMPTY cwd with no
    // project points the user at `sm tutorial` / `sm example` (a new
    // user wants to try the tool, not bootstrap an empty project). The
    // interactive menu only renders on a TTY; spawnSync's stdin is a
    // pipe, so the entry falls through to this hint. (The non-empty
    // `sm init` hint is covered in cli/__tests__/bare-routing.spec.ts.)
    const r = sm([], EMPTY_DIR);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /No skill-map project found/);
    assert.match(r.stderr, /sm tutorial/);
    assert.match(r.stderr, /sm example/);
  });

  it('scan --json emits a well-formed empty ScanResult', () => {
    const r = sm(['scan', '--json'], EMPTY_DIR);
    assert.equal(r.status, 0);
    const result = JSON.parse(r.stdout);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.stats.nodesCount, 0);
    assert.equal(result.stats.issuesCount, 0);
    assert.ok(Array.isArray(result.nodes));
    assert.ok(Array.isArray(result.links));
    assert.ok(Array.isArray(result.issues));
  });

  it('scan --json forwards custom roots to the ScanResult', () => {
    // The orchestrator now validates every root exists as a directory
    // (Step 4.11, guards against `sm scan -- --dry-run` accidentally
    // wiping a populated DB). Create real on-disk subdirs so this test
    // stays focused on the roots-passthrough invariant.
    const a = resolve(EMPTY_DIR, 'a');
    const b = resolve(EMPTY_DIR, 'b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const r = sm(['scan', './a', './b', '--json'], EMPTY_DIR);
    assert.equal(r.status, 0, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const result = JSON.parse(r.stdout);
    assert.deepEqual(result.roots, ['./a', './b']);
  });

  it('scan without --json emits a human-readable summary', () => {
    const r = sm(['scan'], EMPTY_DIR);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /0 nodes/);
    assert.match(r.stdout, /0 issues/);
  });

  it('Step 5.8: plain `sm scan` (no --changed) fires the rename heuristic when a prior exists', () => {
    // Provision a sandbox with a single file, scan it (populates DB),
    // delete the file, then re-scan WITHOUT --changed. The orphan
    // issue MUST appear because the heuristic now runs on every scan
    // that has a prior to compare against.
    const sandbox = resolve(HERE, '..', '..', '.tmp', 'rename-on-plain-scan');
    rmSync(sandbox, { recursive: true, force: true });
    mkdirSync(resolve(sandbox, '.claude/skills'), { recursive: true });
    const fooPath = resolve(sandbox, '.claude/skills/foo.md');
    const fooContent = [
      '---', 'name: foo', 'metadata:', '  version: 1.0.0', '---',
      '', 'Body of foo.',
    ].join('\n');
    // 1. write + scan (populates DB)
    writeFileSync(fooPath, fooContent);
    const first = sm(['scan'], sandbox);
    assert.equal(first.status, 0, `first scan failed: ${first.stderr}`);

    // Add a sibling so the after-state isn't empty (avoids the
    // --allow-empty guard).
    const keepPath = resolve(sandbox, '.claude/skills/keep.md');
    writeFileSync(
      keepPath,
      [
        '---', 'name: keep', 'metadata:', '  version: 1.0.0', '---',
        '', 'Survivor.',
      ].join('\n'),
    );
    sm(['scan'], sandbox); // re-scan to record both files in prior

    // 2. delete foo.md and re-scan WITHOUT --changed.
    rmSync(fooPath);
    const second = sm(['scan', '--json'], sandbox);
    assert.equal(second.status, 0, `second scan failed: ${second.stderr}`);
    const result = JSON.parse(second.stdout);
    const orphanIssues = (result.issues as Array<{ analyzerId: string }>).filter(
      (i) => i.analyzerId === 'orphan',
    );
    assert.equal(
      orphanIssues.length,
      1,
      `expected 1 orphan issue from plain sm scan, got ${orphanIssues.length}: ${JSON.stringify(result.issues)}`,
    );

    rmSync(sandbox, { recursive: true, force: true });
  });
});
