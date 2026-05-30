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
    const r = sm(['plugins', 'create', 'demo-highlight'], scope);
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
    assert.equal(sm(['plugins', 'create', 'demo-highlight'], scope).status, 0);

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
  });

  it('scaffolds a plugin that loads clean (no invalid-manifest)', () => {
    const scope = freshScope('doctor');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'demo-highlight'], scope).status, 0);

    const doctor = sm(['plugins', 'doctor', '--json'], scope);
    assert.equal(doctor.status, 0, `stderr: ${doctor.stderr}`);
    const counts = JSON.parse(doctor.stdout).counts;
    assert.equal(counts.invalid, 0, 'no invalid manifests');
    assert.equal(counts.loadError, 0, 'no load errors');

    // The scaffolded plugin itself resolves to `enabled`.
    const show = sm(['plugins', 'show', 'demo-highlight', '--json'], scope);
    assert.equal(show.status, 0, `stderr: ${show.stderr}`);
    assert.equal(JSON.parse(show.stdout).status, 'enabled');
  });

  it('scaffolded extractor emits its contribution on scan', () => {
    const scope = freshScope('emit');
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    assert.equal(sm(['plugins', 'create', 'demo-highlight'], scope).status, 0);

    mkdirSync(join(scope.cwd, 'notes'), { recursive: true });
    writeFileSync(
      join(scope.cwd, 'notes', 'ideas.md'),
      '---\nname: Ideas\ndescription: notes\n---\n\n# Ideas\n\n- [ ] TODO one\n- [ ] FIXME two\n',
    );

    const r = sm(['scan'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /invalid-manifest/);
  });
});
