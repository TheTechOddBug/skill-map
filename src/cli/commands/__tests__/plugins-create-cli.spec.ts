/**
 * `sm plugins create` end-to-end through the real binary. Guards the
 * scaffolder against the structure-as-truth drift it regressed on once:
 * the manifest used to carry `id` + a root `settings` block (both
 * rejected by `plugins-registry.schema.json#/$defs/PluginManifest`,
 * `additionalProperties: false`) and the extractor stub declared the
 * dead `viewContributions` field instead of `ui`, so a freshly
 * scaffolded plugin failed to load with `invalid-manifest` and never
 * emitted its chip. These tests scaffold a plugin and assert it loads
 * clean and emits its contribution.
 *
 * Each test isolates HOME and cwd so the host's `~/.skill-map/` is
 * never touched and usage telemetry stays dormant.
 */

import { grantTrust } from '../../../kernel/config/plugin-trust-store.js';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { EXTENSION_KINDS } from '../../../kernel/registry.js';
import { withSqlite } from '../../../core/sqlite/with-sqlite.js';

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
    env: {
      ...process.env,
      HOME: scope.home,
      USERPROFILE: scope.home,
      NO_COLOR: '1',
      SKILL_MAP_TELEMETRY: '0',
    },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * Grant local import-trust so the scaffolded plugin's code is allowed to
 * load on the scan that follows. The grant is a scope-lock record keyed
 * to `cwd`, so it must be written against the PROJECT root, not the
 * shared temp dir the suite lives in.
 */
function trustProjectPlugin(cwd: string, pluginId: string): void {
  grantTrust(cwd, pluginId);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugins-create-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm plugins create, scaffolder shape', () => {
  it('emits a lean plugin.json (no id, no root settings)', () => {
    const scope = freshScope('manifest');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    const r = sm(['plugins', 'create', 'extractor', 'demo-highlight'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const manifest = JSON.parse(
      readFileSync(
        join(scope.cwd, '.skill-map', 'plugins', 'demo-highlight', 'plugin.json'),
        'utf8',
      ),
    );
    // `id` is derived from the folder; `settings` live per-extension.
    // Both are rejected at the manifest root by the schema.
    assert.equal(manifest.id, undefined, 'manifest must not carry id');
    assert.equal(manifest.settings, undefined, 'manifest must not carry root settings');
    assert.deepEqual(Object.keys(manifest).sort(), [
      'catalogCompat',
      'description',
      'specCompat',
      'version',
    ]);
  });

  it('emits a package.json with "type": "module" so Node loads ESM extensions cleanly', () => {
    const scope = freshScope('pkg');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'extractor', 'demo-highlight'], scope).status, 0);

    const pkg = JSON.parse(
      readFileSync(
        join(scope.cwd, '.skill-map', 'plugins', 'demo-highlight', 'package.json'),
        'utf8',
      ),
    );
    assert.equal(pkg.type, 'module', 'package.json must declare ESM');
    assert.equal(pkg.private, true, 'plugin package is never published');
  });

  it('emits an extractor stub that declares ui + per-extension settings', () => {
    const scope = freshScope('stub');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'extractor', 'demo-highlight'], scope).status, 0);

    const stub = readFileSync(
      join(
        scope.cwd,
        '.skill-map',
        'plugins',
        'demo-highlight',
        'extractors',
        'demo-highlight-extractor',
        'index.js',
      ),
      'utf8',
    );
    // `ui` replaced `viewContributions`; settings moved into the stub.
    assert.match(stub, /\n\s*ui:\s*{/, 'stub must declare a `ui` block');
    assert.doesNotMatch(stub, /viewContributions/, 'stub must not use the dead field');
    assert.match(stub, /\n\s*settings:\s*{/, 'stub must declare per-extension settings');
    assert.match(stub, /slot:\s*'card\.footer\.left'/);
    // Strict structure-as-truth: kind/id come from the folder, never the
    // export. A scaffolded stub that declared either would now fail to load.
    assert.doesNotMatch(stub, /\n\s*kind:/, 'stub must not declare `kind` (derived from the folder)');
    assert.doesNotMatch(stub, /\n\s*id:/, 'stub must not declare `id` (derived from the folder)');
  });

  it('scaffolds a plugin that loads clean (no invalid-manifest)', () => {
    const scope = freshScope('doctor');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'extractor', 'demo-highlight'], scope).status, 0);

    const doctor = sm(['plugins', 'doctor', '--json'], scope);
    assert.equal(doctor.status, 0, `stderr: ${doctor.stderr}`);
    const counts = JSON.parse(doctor.stdout).counts;
    assert.equal(counts.invalid, 0, 'no invalid manifests');
    assert.equal(counts.loadError, 0, 'no load errors');

    // A freshly scaffolded plugin is UNTRUSTED: `sm plugins create` says
    // so in its own next-steps output, and since 2026-07-28 the whole
    // `sm plugins` family honours the gate instead of importing anyway.
    const beforeTrust = sm(['plugins', 'list', 'demo-highlight', '--json'], scope);
    assert.equal(beforeTrust.status, 0, `stderr: ${beforeTrust.stderr}`);
    assert.equal(JSON.parse(beforeTrust.stdout).status, 'disabled', 'untrusted until granted');

    assert.equal(sm(['plugins', 'trust', 'demo-highlight'], scope).status, 0);

    // Once trusted it resolves to `enabled`. The per-plugin JSON (with
    // the `status` field) is emitted by `list <id> --json`; `show` is
    // extension-only now.
    const detail = sm(['plugins', 'list', 'demo-highlight', '--json'], scope);
    assert.equal(detail.status, 0, `stderr: ${detail.stderr}`);
    assert.equal(JSON.parse(detail.stdout).status, 'enabled');
  });

  it('scaffolded extractor emits its contribution on scan', async () => {
    const scope = freshScope('emit');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'extractor', 'demo-highlight'], scope).status, 0);
    // Post-H1 gate: the scaffolded project-local plugin is discovered but
    // its code stays dormant until locally trusted, so grant trust (the
    // in-test equivalent of `sm plugins enable`) before the scan loads it.
    trustProjectPlugin(scope.cwd, 'demo-highlight');

    mkdirSync(join(scope.cwd, 'notes'), { recursive: true });
    writeFileSync(
      join(scope.cwd, 'notes', 'ideas.md'),
      '---\nname: Ideas\ndescription: notes\n---\n\n# Ideas\n\n- [ ] TODO one\n- [ ] FIXME two\n',
    );

    const r = sm(['scan'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /invalid-manifest/);

    // Stronger than "no invalid-manifest": the scaffolded extractor's
    // extract() body must actually count the two keywords and emit the
    // chip payload. Read it back from the persisted scan_contributions row.
    const db = new DatabaseSync(join(scope.cwd, '.skill-map', 'skill-map.db'));
    try {
      const rows = db
        .prepare(
          'SELECT slot, payload_json FROM scan_contributions WHERE plugin_id = ? AND contribution_id = ?',
        )
        .all('demo-highlight', 'count') as Array<{ slot: string; payload_json: string }>;
      assert.equal(rows.length, 1, 'exactly one contribution row emitted');
      assert.equal(rows[0]!.slot, 'card.footer.left');
      assert.deepEqual(JSON.parse(rows[0]!.payload_json), { value: 2 }, 'TODO + FIXME = 2');
    } finally {
      db.close();
    }
  });
});

describe('sm plugins create, every extension kind loads enabled', () => {
  for (const kind of EXTENSION_KINDS) {
    it(`scaffolds a ${kind} that loads clean`, () => {
      const scope = freshScope(`kind-${kind}`);
      assert.equal(sm(['init', '--no-scan'], scope).status, 0);
      const id = `demo-${kind}`;
      const create = sm(['plugins', 'create', kind, id], scope);
      assert.equal(create.status, 0, `create stderr: ${create.stderr}`);

      const doctor = sm(['plugins', 'doctor', '--json'], scope);
      assert.equal(doctor.status, 0, `doctor stderr: ${doctor.stderr}`);
      const counts = JSON.parse(doctor.stdout).counts;
      assert.equal(counts.invalid, 0, `${kind}: no invalid manifests`);
      assert.equal(counts.loadError, 0, `${kind}: no load errors`);

      // Trust is the author's one-time local grant (the scaffolder's own
      // next-steps text says to run it); without it the gate keeps the
      // code unimported, which is the point of the gate.
      assert.equal(sm(['plugins', 'trust', id], scope).status, 0, `${kind}: trust`);

      const detail = sm(['plugins', 'list', id, '--json'], scope);
      assert.equal(detail.status, 0, `list stderr: ${detail.stderr}`);
      assert.equal(JSON.parse(detail.stdout).status, 'enabled', `${kind} resolves enabled`);

      // The action kind ships a sibling report.schema.json (structure-as-truth:
      // every Action carries one, or it fails to load).
      if (kind === 'action') {
        const reportSchema = join(
          scope.cwd, '.skill-map', 'plugins', id, 'actions', `${id}-action`, 'report.schema.json',
        );
        assert.match(readFileSync(reportSchema, 'utf8'), /confidence/, 'action ships report.schema.json');
      }
    });
  }

  it('rejects an unknown --kind', () => {
    const scope = freshScope('bad-kind');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    const r = sm(['plugins', 'create', 'wizard', 'demo-bad'], scope);
    assert.notEqual(r.status, 0, 'unknown kind exits non-zero');
    assert.match(r.stderr + r.stdout, /Unknown extension kind/);
  });
});

describe('sm plugins create, input validation and overwrite', () => {
  it('rejects an invalid plugin-id', () => {
    const scope = freshScope('bad-id');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    const r = sm(['plugins', 'create', 'extractor', 'Bad_Id'], scope);
    assert.notEqual(r.status, 0, 'invalid id exits non-zero');
    assert.match(r.stderr + r.stdout, /kebab-case lowercase/);
  });

  it('refuses to overwrite an existing plugin without --force', () => {
    const scope = freshScope('no-force');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'extractor', 'demo-dup'], scope).status, 0);
    const r = sm(['plugins', 'create', 'extractor', 'demo-dup'], scope);
    assert.notEqual(r.status, 0, 'second create without --force exits non-zero');
    assert.match(r.stderr + r.stdout, /Refusing to overwrite/);
  });

  it('overwrites an existing plugin with --force', () => {
    const scope = freshScope('force');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'extractor', 'demo-dup'], scope).status, 0);
    const r = sm(['plugins', 'create', 'extractor', 'demo-dup', '--force'], scope);
    assert.equal(r.status, 0, `--force should overwrite: ${r.stderr}`);
  });
});

describe('sm plugins upgrade, package.json backfill', () => {
  /** Scaffold a plugin, returning its dir so tests can mutate its package.json. */
  function scaffold(scope: IScope, id: string): string {
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'extractor', id], scope).status, 0);
    return join(scope.cwd, '.skill-map', 'plugins', id);
  }

  function readPkg(pluginDir: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
  }

  it('recreates a missing package.json (a plugin scaffolded before the fix)', () => {
    const scope = freshScope('upgrade-missing');
    const dir = scaffold(scope, 'demo-old');
    rmSync(join(dir, 'package.json'));
    const r = sm(['plugins', 'upgrade', 'demo-old'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(readPkg(dir)['type'], 'module');
  });

  it('adds "type": "module" to a package.json missing it, preserving other fields', () => {
    const scope = freshScope('upgrade-add-type');
    const dir = scaffold(scope, 'demo-notype');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo-notype', sideEffects: false }),
    );
    assert.equal(sm(['plugins', 'upgrade', 'demo-notype'], scope).status, 0);
    const pkg = readPkg(dir);
    assert.equal(pkg['type'], 'module');
    assert.equal(pkg['name'], 'demo-notype', 'existing fields survive');
    assert.equal(pkg['sideEffects'], false, 'existing fields survive');
  });

  it('never clobbers a package.json that declares a non-module type', () => {
    const scope = freshScope('upgrade-foreign');
    const dir = scaffold(scope, 'demo-cjs');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    assert.equal(sm(['plugins', 'upgrade', 'demo-cjs'], scope).status, 0);
    assert.equal(readPkg(dir)['type'], 'commonjs', 'author choice preserved');
  });

  it('exits non-zero when the named plugin does not exist', () => {
    const scope = freshScope('upgrade-missing-id');
    scaffold(scope, 'demo-present');
    const r = sm(['plugins', 'upgrade', 'not-a-plugin'], scope);
    assert.notEqual(r.status, 0);
  });
});
