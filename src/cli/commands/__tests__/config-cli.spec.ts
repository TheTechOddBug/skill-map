/**
 * Step 6.3, `sm config list / get / set / reset / show` end-to-end through
 * the real binary. Each test isolates HOME and cwd so the host's
 * `~/.skill-map/` is never touched.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
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

function writeSettings(scopeRoot: string, body: unknown, kind: 'settings' | 'settings.local' = 'settings'): void {
  const dir = join(scopeRoot, '.skill-map');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${kind}.json`), JSON.stringify(body));
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
  root = mkdtempSync(join(tmpdir(), 'skill-map-config-cli-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm config list', () => {
  it('returns defaults when no settings files exist', () => {
    const scope = freshScope('list-defaults');
    const r = sm(['config', 'list', '--json'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout);
    assert.equal(obj.tokenizer, 'cl100k_base');
    assert.equal(obj.scan.tokenize, true);
    assert.equal(obj.jobs.minimumTtlSeconds, 60);
  });

  it('reads project layer and prints sorted dot-paths in human mode', () => {
    const scope = freshScope('list-human');
    // `tokenizer` is a closed enum; o200k_base is the non-default member.
    writeSettings(scope.cwd, { tokenizer: 'o200k_base' });
    const r = sm(['config', 'list'], scope);
    assert.equal(r.status, 0);
    // New layout: keys grouped under section headers (`General`,
    // `Scan`, …) with the section's prefix stripped from the displayed
    // key. The match regexes target key + value with whitespace
    // tolerance so column padding does not couple the test to the
    // current widths.
    assert.match(r.stdout, /^\s+schemaVersion\s+1\s*$/m);
    assert.match(r.stdout, /^\s+tokenizer\s+o200k_base\s*$/m);
    // `scan.tokenize` displays as bare `tokenize` under the `Scan`
    // header (the dotted form remains valid for `sm config get/set`).
    assert.match(r.stdout, /^\s+tokenize\s+true\s*$/m);
  });

  it('--json emits the merged object', () => {
    const scope = freshScope('list-json');
    writeSettings(scope.cwd, { scan: { strict: true } });
    const r = sm(['config', 'list', '--json'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout);
    assert.equal(obj.scan.strict, true);
    assert.equal(obj.scan.tokenize, true); // from defaults
  });
});

describe('sm config get', () => {
  it('returns a leaf value', () => {
    const scope = freshScope('get-leaf');
    writeSettings(scope.cwd, { tokenizer: 'o200k_base' });
    const r = sm(['config', 'get', 'tokenizer'], scope);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'o200k_base');
  });

  it('returns a nested object as JSON in human mode', () => {
    const scope = freshScope('get-object');
    const r = sm(['config', 'get', 'scan'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout);
    assert.equal(obj.tokenize, true);
  });

  it('--json wraps strings as JSON literals', () => {
    const scope = freshScope('get-json');
    const r = sm(['config', 'get', 'tokenizer', '--json'], scope);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '"cl100k_base"');
  });

  it('exit 5 on unknown key', () => {
    const scope = freshScope('get-unknown');
    const r = sm(['config', 'get', 'nope.nope'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Unknown config key/);
  });

  it('suggests close matches on a typo (Did you mean?)', () => {
    const scope = freshScope('get-typo');
    // `scan.tokenizr` is one char away from the real `scan.tokenize`.
    const r = sm(['config', 'get', 'scan.tokenizr'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Unknown config key: scan\.tokenizr/);
    assert.match(r.stderr, /Did you mean 'scan\.tokenize'\?/);
  });

  it('omits the suggestion when nothing is close enough', () => {
    const scope = freshScope('get-no-suggest');
    // `xyzzy` is far from every real key, Levenshtein distance > cap.
    const r = sm(['config', 'get', 'xyzzy'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Unknown config key: xyzzy/);
    assert.doesNotMatch(r.stderr, /Did you mean/);
  });

  // Regression for bd-25m: schema-declared keys whose runtime value is
  // computed (today only `activeProvider`) MUST return the runtime
  // value (null when no filesystem signal, or the auto-detected
  // provider id) instead of "Unknown config key". Pre-bd-25m every
  // such read errored with exit 5 because the key wasn't materialised
  // in `defaults.json`, leaving operators confused why `set` succeeded
  // while `get` returned "Unknown".
  it('returns null for activeProvider when settings + filesystem yield nothing', () => {
    const scope = freshScope('get-active-provider-null');
    const r = sm(['config', 'get', 'activeProvider'], scope);
    assert.equal(r.status, 0, `expected 0, stderr=${r.stderr}`);
    assert.equal(r.stdout.trim(), 'null');
  });

  it('returns the filesystem auto-detect for activeProvider when settings is empty', () => {
    const scope = freshScope('get-active-provider-autodetect');
    mkdirSync(join(scope.cwd, '.claude'), { recursive: true });
    const r = sm(['config', 'get', 'activeProvider'], scope);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'claude');
  });

  it('returns the persisted value for activeProvider when settings has it', () => {
    const scope = freshScope('get-active-provider-persisted');
    writeSettings(scope.cwd, { activeProvider: 'antigravity' });
    const r = sm(['config', 'get', 'activeProvider'], scope);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'antigravity');
  });
});

describe('sm config show', () => {
  it('--source surfaces the winning layer', () => {
    const scope = freshScope('show-source');
    writeSettings(scope.cwd, { tokenizer: 'o200k_base' });
    const r = sm(['config', 'show', 'tokenizer', '--source'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /o200k_base\s+\(from project\)/);
  });

  it('--source on a nested object reports the highest-precedence descendant', () => {
    const scope = freshScope('show-nested');
    writeSettings(scope.home, { scan: { tokenize: false } });
    writeSettings(scope.cwd, { scan: { strict: true } });
    const r = sm(['config', 'show', 'scan', '--source'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(from project\)/);
  });

  it('--source --json emits { value, source }', () => {
    const scope = freshScope('show-json');
    writeSettings(scope.cwd, { tokenizer: 'o200k_base' });
    const r = sm(['config', 'show', 'tokenizer', '--source', '--json'], scope);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.value, 'o200k_base');
    assert.equal(payload.source, 'project');
  });

  it('without --source behaves like get', () => {
    const scope = freshScope('show-no-source');
    const r = sm(['config', 'show', 'tokenizer'], scope);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'cl100k_base');
  });
});

describe('sm config set', () => {
  it('writes to project file by default and coerces JSON-like values', () => {
    const scope = freshScope('set-project');
    const r = sm(['config', 'set', 'scan.tokenize', 'false'], scope);
    assert.equal(r.status, 0);
    const path = join(scope.cwd, '.skill-map', 'settings.json');
    const written = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(written.scan.tokenize, false); // boolean, not string
  });

  it('-g is rejected as unknown option (no global scope post-cleanup)', () => {
    const scope = freshScope('set-rejects-g');
    const r = sm(['config', 'set', 'tokenizer', 'o200k_base', '-g'], scope);
    // Clipanion exits 2 ("usage error") on an unknown option.
    assert.equal(r.status, 2);
    // Nothing was written, neither in cwd nor in HOME.
    assert.equal(existsSync(join(scope.cwd, '.skill-map', 'settings.json')), false);
    assert.equal(existsSync(join(scope.home, '.skill-map', 'settings.json')), false);
  });

  it('coerces numbers and nested dot-paths', () => {
    const scope = freshScope('set-nested');
    const r = sm(['config', 'set', 'jobs.minimumTtlSeconds', '120'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal(written.jobs.minimumTtlSeconds, 120);
    assert.equal(typeof written.jobs.minimumTtlSeconds, 'number');
  });

  it('rejects schema-violating values without writing the file', () => {
    const scope = freshScope('set-invalid');
    const r = sm(['config', 'set', 'scan.tokenize', 'maybe'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Invalid config/);
    assert.equal(existsSync(join(scope.cwd, '.skill-map', 'settings.json')), false);
  });

  it('preserves unrelated keys when setting a new one', () => {
    const scope = freshScope('set-preserve');
    // `tokenizer` is a closed enum; o200k_base is a valid non-default
    // member so the read-modify-write revalidation accepts it.
    writeSettings(scope.cwd, { tokenizer: 'o200k_base' });
    const r = sm(['config', 'set', 'scan.tokenize', 'false'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal(written.tokenizer, 'o200k_base');
    assert.equal(written.scan.tokenize, false);
  });

  it('emits done-in stderr (set is in-scope per cli-contract)', () => {
    const scope = freshScope('set-elapsed');
    const r = sm(['config', 'set', 'tokenizer', 'o200k_base'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /^done in /m);
  });

  // Audit M5, atomic write. The set verb stages content into a sibling
  // `<settings>.tmp.<pid>` file and `renameSync`s it into place so a
  // crash mid-write leaves the destination either at its prior content
  // or at the new content, never half-written. The asymptotic check
  // here (no `<settings>.tmp.*` siblings remain after a successful
  // write) confirms the rename happened and the temp was reaped. We
  // skip the "interrupt mid-write" simulation as too brittle; this
  // pins the surface guarantee.
  it('atomic write: leaves no <settings>.tmp.<pid> sibling after a successful set', () => {
    const scope = freshScope('set-atomic');
    const r = sm(['config', 'set', 'tokenizer', 'o200k_base'], scope);
    assert.equal(r.status, 0);
    const dir = join(scope.cwd, '.skill-map');
    const written = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    assert.equal(written.tokenizer, 'o200k_base', 'main settings file is updated');
    // No `settings.json.tmp.<pid>` sibling lingers after the rename,
    // the atomic-write helper either renames into place (success) or
    // unlinks the staged file in its `catch` (failure).
    const siblings = readdirSync(dir).filter((name) => name.startsWith('settings.json.tmp.'));
    assert.deepEqual(siblings, [], `expected no tmp siblings; got ${JSON.stringify(siblings)}`);
  });

  // Marker drift detection: setting `activeProvider` MUST refresh the
  // `activeProviderMarkers` snapshot to match the current filesystem
  // state. The next scan diffs the freshly re-detected set against
  // this snapshot; without the refresh, the operator would see a
  // spurious drift warn naming every marker that existed before the
  // explicit `sm config set`.
  it('refreshes activeProviderMarkers snapshot when activeProvider is set', () => {
    const scope = freshScope('set-active-provider-snapshot');
    // Plant `.claude/` so the auto-detect resolves something concrete.
    mkdirSync(join(scope.cwd, '.claude'), { recursive: true });
    const r = sm(['config', 'set', 'activeProvider', 'claude'], scope);
    assert.equal(r.status, 0, r.stderr);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['activeProvider'], 'claude');
    assert.deepEqual(written['activeProviderMarkers'], ['claude']);
  });

  it('captures every detected marker (not just the picked lens id)', () => {
    const scope = freshScope('set-active-provider-multi');
    // Both `.claude/` AND `.codex/` exist on disk; operator picks
    // claude. The snapshot must reflect BOTH markers detected at
    // set-time, not just the one whose id was passed to `set`.
    mkdirSync(join(scope.cwd, '.claude'), { recursive: true });
    mkdirSync(join(scope.cwd, '.codex'), { recursive: true });
    const r = sm(['config', 'set', 'activeProvider', 'claude'], scope);
    assert.equal(r.status, 0, r.stderr);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['activeProvider'], 'claude');
    // Snapshot reflects the full set of markers on disk at set-time,
    // so a future drift only fires when reality moves AWAY from this.
    assert.deepEqual(
      (written['activeProviderMarkers'] as string[]).sort(),
      ['claude', 'openai'],
    );
  });
});

describe('sm config reset', () => {
  it('removes a previously-set key from the project file', () => {
    const scope = freshScope('reset-basic');
    writeSettings(scope.cwd, { tokenizer: 'o200k_base', scan: { tokenize: false } });
    const r = sm(['config', 'reset', 'scan.tokenize'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal('scan' in written, false);
    assert.equal(written.tokenizer, 'o200k_base');
  });

  it('idempotent on absent key (exit 0, no write)', () => {
    const scope = freshScope('reset-absent');
    const r = sm(['config', 'reset', 'tokenizer'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /No override/);
  });

  it('-g is rejected as unknown option (no global scope post-cleanup)', () => {
    const scope = freshScope('reset-rejects-g');
    // Plant a user file; the verb MUST not touch it because -g is rejected.
    writeSettings(scope.home, { tokenizer: 'o200k_base' });
    const r = sm(['config', 'reset', 'tokenizer', '-g'], scope);
    assert.equal(r.status, 2);
    // User file untouched.
    const written = JSON.parse(
      readFileSync(join(scope.home, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal(written.tokenizer, 'o200k_base');
  });

  it('prunes empty parent objects after deleting nested key', () => {
    const scope = freshScope('reset-prune');
    writeSettings(scope.cwd, { jobs: { minimumTtlSeconds: 120 } });
    const r = sm(['config', 'reset', 'jobs.minimumTtlSeconds'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal('jobs' in written, false);
  });
});

describe('sm config, --strict UX', () => {
  it('without --strict: warning to stderr, exit 0', () => {
    const scope = freshScope('strict-warn');
    writeSettings(scope.cwd, { bogus_key: 'nope' });
    const r = sm(['config', 'list'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /unknown key bogus_key/);
    // Sectioned layout: indented `schemaVersion  1` under `General`.
    assert.match(r.stdout, /^\s+schemaVersion\s+1\s*$/m);
  });

  it('--strict: clean stderr message + exit 2 (no Clipanion stack trace)', () => {
    const scope = freshScope('strict-error');
    writeSettings(scope.cwd, { bogus_key: 'nope' });
    const r = sm(['config', 'list', '--strict'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /sm config: /);
    assert.match(r.stderr, /unknown key bogus_key/);
    // Crucially NO stack trace leaking through.
    assert.ok(!r.stderr.includes('Internal Error'), `stack trace leaked: ${r.stderr}`);
    assert.ok(!r.stderr.includes('    at '), `stack trace leaked: ${r.stderr}`);
  });

  it('--strict also wraps `config get`', () => {
    const scope = freshScope('strict-get');
    writeSettings(scope.cwd, { scan: { tokenize: 'not-a-bool' } });
    const r = sm(['config', 'get', 'scan.tokenize', '--strict'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /sm config: /);
    assert.ok(!r.stderr.includes('Internal Error'));
  });

  it('--strict also wraps `config show`', () => {
    const scope = freshScope('strict-show');
    writeSettings(scope.cwd, { scan: { tokenize: 42 } });
    const r = sm(['config', 'show', 'scan.tokenize', '--strict'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /sm config: /);
    assert.ok(!r.stderr.includes('Internal Error'));
  });

  it('--strict: malformed JSON → clean message + exit 2', () => {
    const scope = freshScope('strict-bad-json');
    mkdirSync(join(scope.cwd, '.skill-map'), { recursive: true });
    writeFileSync(join(scope.cwd, '.skill-map', 'settings.json'), '{ not json');
    const r = sm(['config', 'list', '--strict'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /sm config: /);
    assert.match(r.stderr, /invalid JSON/);
    assert.ok(!r.stderr.includes('Internal Error'));
  });
});

describe('sm config, prototype-pollution defence (audit H2)', () => {
  for (const segment of ['__proto__', 'constructor', 'prototype']) {
    it(`config set rejects "${segment}" segment with a clean error`, () => {
      const scope = freshScope(`set-${segment}`);
      const r = sm(['config', 'set', `${segment}.polluted`, 'true'], scope);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /forbidden key segment/);
      assert.match(r.stderr, new RegExp(segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      // No file written.
      assert.ok(!existsSync(join(scope.cwd, '.skill-map', 'settings.json')));
    });

    it(`config set rejects nested "${segment}" segment`, () => {
      const scope = freshScope(`set-nested-${segment}`);
      const r = sm(['config', 'set', `scan.${segment}.x`, 'true'], scope);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /forbidden key segment/);
    });

    it(`config get rejects "${segment}" segment without exposing prototype data`, () => {
      const scope = freshScope(`get-${segment}`);
      const r = sm(['config', 'get', `${segment}.polluted`], scope);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /forbidden key segment/);
      assert.equal(r.stdout, '');
    });

    it(`config reset rejects "${segment}" segment`, () => {
      const scope = freshScope(`reset-${segment}`);
      writeSettings(scope.cwd, { scan: { tokenize: false } });
      const r = sm(['config', 'reset', `${segment}.x`], scope);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /forbidden key segment/);
      // Pre-existing settings file untouched.
      const written = JSON.parse(
        readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal((written['scan'] as Record<string, unknown>)['tokenize'], false);
    });
  }
});
