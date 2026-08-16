/**
 * Step 6.5, `sm init` end-to-end through the real binary. Each test
 * isolates HOME and cwd so the host's `~/.skill-map/` is never touched.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', '..', 'bin', 'sm.js');

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  home: string;
}

function freshScope(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function sm(
  args: string[],
  scope: IScope,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-init-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm init, project scope', () => {
  it('scaffolds .skill-map/ with settings + ignore + DB and runs first scan', () => {
    const scope = freshScope('basic');
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, '.skill-map', 'settings.json')));
    assert.ok(existsSync(join(scope.cwd, '.skill-map', 'settings.local.json')));
    assert.ok(existsSync(join(scope.cwd, '.skill-map', 'skill-map.db')));
    assert.ok(existsSync(join(scope.cwd, '.skillmapignore')));

    const settings = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal(settings.schemaVersion, 1);
    const local = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.local.json'), 'utf8'),
    );
    assert.deepEqual(local, {});
    const ignoreText = readFileSync(join(scope.cwd, '.skillmapignore'), 'utf8');
    assert.match(ignoreText, /node_modules\//);
    assert.match(ignoreText, /\.git\//);
  });

  // `.skillmapignore` ships with the repo (committed alongside the
  // user's `.gitignore`) and is meant to be readable by anyone with
  // checkout access. Settings + sidecars keep `0o600` because they
  // may carry private paths; the ignore is the one init-managed file
  // that opts into the public `0o644` mode. Skipped on Windows
  // because Node.js maps POSIX modes to the readonly attribute only,
  // so the assertion is meaningless there.
  it(
    'writes .skillmapignore with mode 0o644 (public read)',
    { skip: process.platform === 'win32' },
    () => {
      const scope = freshScope('ignore-mode');
      const r = sm(['init', '--no-scan'], scope);
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      const ignoreMode = statSync(join(scope.cwd, '.skillmapignore')).mode & 0o777;
      assert.equal(ignoreMode, 0o644);
      // Sanity: settings stays 0o600 (the privacy default).
      const settingsMode =
        statSync(join(scope.cwd, '.skill-map', 'settings.json')).mode & 0o777;
      assert.equal(settingsMode, 0o600);
    },
  );

  // `spec/cli-contract.md` §Scope ignore file: the rules live INSIDE
  // `.skill-map/`, covering every generated artifact. The SQLite
  // sidecars matter specifically because the bare `skill-map.db`
  // pattern does not match `skill-map.db-wal` / `-shm`.
  it('writes the scope ignore file covering every generated artifact', () => {
    const scope = freshScope('scope-gitignore-create');
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 0);
    const lines = readFileSync(join(scope.cwd, '.skill-map', '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    assert.deepEqual(lines, [
      'settings.local.json',
      'skill-map.db',
      'skill-map.db-wal',
      'skill-map.db-shm',
      'serve.json',
      'scope.lock.json',
      'operations.log*',
      'backups/',
      'activity/',
      'sessions/',
    ]);
    // The committed surface stays trackable, and the project-root
    // `.gitignore` is no longer skill-map's business.
    assert.ok(!lines.includes('settings.json'));
    assert.ok(!lines.includes('plugins/'));
    assert.equal(existsSync(join(scope.cwd, '.gitignore')), false);
  });

  it('leaves the project-root .gitignore untouched', () => {
    const scope = freshScope('root-gitignore-untouched');
    writeFileSync(join(scope.cwd, '.gitignore'), 'dist\nnode_modules\n');
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 0);
    assert.equal(
      readFileSync(join(scope.cwd, '.gitignore'), 'utf8'),
      'dist\nnode_modules\n',
    );
  });

  it('errors with exit 2 when re-running over an existing scope without --force', () => {
    const scope = freshScope('reinit-blocked');
    sm(['init', '--no-scan'], scope);
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /already exists/);
  });

  it('--force overwrites existing files', () => {
    const scope = freshScope('reinit-force');
    sm(['init', '--no-scan'], scope);
    // Mutate settings.json to detect overwrite.
    writeFileSync(
      join(scope.cwd, '.skill-map', 'settings.json'),
      JSON.stringify({ schemaVersion: 1, tokenizer: 'o200k_base' }, null, 2) + '\n',
    );
    const r = sm(['init', '--no-scan', '--force'], scope);
    assert.equal(r.status, 0);
    const settings = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.deepEqual(settings, { schemaVersion: 1 });
  });

  it('runs first scan by default (smoke: nodes counted in stderr)', () => {
    const scope = freshScope('first-scan');
    // Drop one .claude/agents/foo.md so the scan finds something.
    const agentDir = join(scope.cwd, '.claude', 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'foo.md'),
      '---\nname: foo\nkind: agent\n---\nbody\n',
    );
    const r = sm(['init'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // M1 wiring: status banners route through `printer.info` → stderr,
    // so stdout stays empty until a `--json` payload lands.
    assert.match(r.stderr, /Running first scan/);
    // The first scan renders the SAME block `sm scan` does
    // (`util/scan-summary.ts`): dot-separated counts, dim elapsed, then
    // the database path. It used to print a one-off `First scan: …`
    // line, a format that appeared exactly once in the product.
    assert.match(r.stderr, /1 node · 0 links · .*\bin \d+ms/);
    assert.match(r.stderr, /\.skill-map\/skill-map\.db/);
    assert.equal(/First scan:/.test(r.stderr), false);
  });
});

describe('sm init: -g is rejected (no global scope post-cleanup)', () => {
  it('exits 2 with an unknown-option error and writes nothing', () => {
    const scope = freshScope('rejects-g');
    const r = sm(['init', '-g', '--no-scan'], scope);
    // Clipanion's usage error exit code (per spec/cli-contract.md).
    assert.equal(r.status, 2);
    // No state was provisioned, neither in HOME nor in cwd.
    assert.equal(existsSync(join(scope.home, '.skill-map')), false);
    assert.equal(existsSync(join(scope.cwd, '.skill-map')), false);
  });
});

describe('sm init --dry-run (H3, spec §Dry-run)', () => {
  it('previews the scope without touching the filesystem', () => {
    const scope = freshScope('dryrun-fresh');
    const r = sm(['init', '--dry-run'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // M1 wiring: dry-run plan flows through `printer.info` → stderr.
    assert.match(r.stderr, /\(dry-run/);
    assert.match(r.stderr, /would create.+\.skill-map/);
    assert.match(r.stderr, /would write.+settings\.json/);
    assert.match(r.stderr, /would write.+settings\.local\.json/);
    assert.match(r.stderr, /would write.+\.skillmapignore/);
    assert.match(r.stderr, /would write.+\.skill-map.+\.gitignore \(10 generated artifacts\)/);
    assert.match(r.stderr, /would provision DB/);
    assert.match(r.stderr, /would run first scan/);

    // Spec §Dry-run: NO observable side effects.
    assert.equal(existsSync(join(scope.cwd, '.skill-map')), false);
    assert.equal(existsSync(join(scope.cwd, '.skillmapignore')), false);
    assert.equal(existsSync(join(scope.cwd, '.gitignore')), false);
  });

  it('--dry-run --no-scan changes the first-scan preview line', () => {
    const scope = freshScope('dryrun-no-scan');
    const r = sm(['init', '--dry-run', '--no-scan'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /would skip first scan/);
    assert.doesNotMatch(r.stderr, /would run first scan/);
  });

  it('--dry-run on existing scope without --force exits 2 (same gate as live)', () => {
    const scope = freshScope('dryrun-existing');
    sm(['init', '--no-scan'], scope);
    const r = sm(['init', '--dry-run'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /already exists/);
  });

  it('--dry-run --force on existing scope previews overwrites', () => {
    const scope = freshScope('dryrun-force');
    sm(['init', '--no-scan'], scope);
    // Snapshot existing settings to detect any write.
    const before = readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8');

    const r = sm(['init', '--dry-run', '--force'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /would overwrite.+settings\.json/);

    // No actual write happened.
    const after = readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8');
    assert.equal(after, before);
  });

  // Top-up preview: an ignore file written by an older CLI (short entry
  // list) is reported as the delta, not as a full rewrite. `--force` is
  // needed only because the scope already exists.
  it('--dry-run previews the top-up of an existing scope ignore file', () => {
    const scope = freshScope('dryrun-scope-gitignore-topup');
    sm(['init', '--no-scan'], scope);
    writeFileSync(
      join(scope.cwd, '.skill-map', '.gitignore'),
      'settings.local.json\nskill-map.db\nserve.json\nbackups/\n',
    );
    const r = sm(['init', '--dry-run', '--force'], scope);
    assert.equal(r.status, 0);
    assert.match(
      r.stderr,
      /would update.+\.gitignore \(add 6: skill-map\.db-wal, skill-map\.db-shm, scope\.lock\.json, operations\.log\*, activity\/, sessions\/\)/,
    );
  });
});
