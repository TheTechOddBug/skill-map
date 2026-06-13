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

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { EXTENSION_KINDS } from '../../../kernel/registry.js';

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

    // The scaffolded plugin itself resolves to `enabled`. The per-plugin
    // JSON (with the `status` field) is emitted by `list <id> --json`;
    // `show` is extension-only now.
    const detail = sm(['plugins', 'list', 'demo-highlight', '--json'], scope);
    assert.equal(detail.status, 0, `stderr: ${detail.stderr}`);
    assert.equal(JSON.parse(detail.stdout).status, 'enabled');
  });

  it('scaffolded extractor emits its contribution on scan', () => {
    const scope = freshScope('emit');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'extractor', 'demo-highlight'], scope).status, 0);

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
