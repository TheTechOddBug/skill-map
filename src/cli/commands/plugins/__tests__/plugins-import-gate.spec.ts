/**
 * The `sm plugins` management family honours the import-trust gate
 * (2026-07-28, follow-up to audit C1).
 *
 * `loadAll` used to omit `resolveImportTrust`, so while `sm scan` and
 * `sm serve` correctly refused to import an untrusted project-local
 * plugin, EVERY verb in the management family imported it anyway. Under
 * clone-and-scan that made `sm plugins list` the shortest path to
 * executing a hostile repo's code, and the untrusted advisory pointed
 * operators straight at it. Worse, `sm plugins trust` itself ran the
 * code the operator had not yet consented to.
 *
 * The assertions here are behavioural, not structural: a marker file
 * written at module top level is the only honest proof that code did or
 * did not run. Both directions are covered, because a test that only
 * checks the marker is absent would still pass if the payload were
 * silently broken.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', '..', '..', 'bin', 'sm.js');
const PLUGIN_ID = 'evil-drop-in';
const MARKER = 'IMPORTED.txt';

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  home: string;
}

/**
 * A project holding one hostile drop-in whose analyzer writes a marker
 * into the process cwd the instant its module is imported. The payload
 * sits at module top level, so merely resolving the module runs it,
 * which is exactly the primitive the gate has to deny.
 */
function hostileProject(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  const extDir = join(cwd, '.skill-map', 'plugins', PLUGIN_ID, 'analyzers', 'boom');
  mkdirSync(extDir, { recursive: true });
  mkdirSync(home, { recursive: true });

  writeFileSync(
    join(cwd, '.skill-map', 'plugins', PLUGIN_ID, 'plugin.json'),
    JSON.stringify({
      version: '1.0.0',
      specCompat: '>=0.1.0',
      catalogCompat: '>=0.1.0',
      description: 'hostile drop-in used by the import-gate regression test',
    }),
  );
  writeFileSync(
    join(cwd, '.skill-map', 'plugins', PLUGIN_ID, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  // The declarative half lives on disk so the loader can read it
  // WITHOUT importing the module. It says nothing about stability, so
  // the extension is enabled by default and only trust is in question.
  writeFileSync(
    join(extDir, 'extension.json'),
    JSON.stringify({ version: '1.0.0', description: 'writes a marker at import time' }),
  );
  writeFileSync(
    join(extDir, 'index.js'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      `writeFileSync(join(process.cwd(), '${MARKER}'), 'imported\\n');`,
      'export default {',
      "  phase: 'detect',",
      '  analyze: () => [],',
      '};',
    ].join('\n'),
  );
  return { cwd, home };
}

function sm(args: string[], scope: IScope): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: {
      ...process.env,
      HOME: scope.home,
      USERPROFILE: scope.home,
      NO_COLOR: '1',
      SKILL_MAP_TELEMETRY: '0',
      SM_NO_UPDATE_CHECK: '1',
    },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Did the plugin's module body run during this invocation? */
function ran(scope: IScope, args: string[]): boolean {
  const marker = join(scope.cwd, MARKER);
  if (existsSync(marker)) unlinkSync(marker);
  sm(args, scope);
  return existsSync(marker);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-import-gate-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm plugins family, untrusted project-local code is never imported', () => {
  // Every verb whose body reaches `loadAll`. `trust` is the one that
  // mattered most: reviewing before consenting must not be the act that
  // grants execution.
  const VERBS: readonly (readonly string[])[] = [
    ['plugins', 'list'],
    ['plugins', 'list', PLUGIN_ID],
    ['plugins', 'doctor'],
    ['plugins', 'config', PLUGIN_ID],
    ['plugins', 'trust', '--help'],
  ];

  for (const verb of VERBS) {
    it(`\`sm ${verb.join(' ')}\` does not run it`, () => {
      const scope = hostileProject('deny');
      assert.equal(ran(scope, [...verb]), false, `${verb.join(' ')} imported untrusted code`);
    });
  }

  it('surfaces the plugin instead of hiding it, with a directed reason', () => {
    const scope = hostileProject('surface');
    const listed = sm(['plugins', 'list', PLUGIN_ID, '--json'], scope);
    assert.equal(listed.status, 0, `stderr: ${listed.stderr}`);
    const row = JSON.parse(listed.stdout) as { status: string; reason?: string };
    // Gating must not cost visibility: the manifest survives the
    // pre-import gate, which is why refusing to import was always free.
    assert.equal(row.status, 'disabled');
    assert.match(row.reason ?? '', /trust/i, 'reason must name the missing grant');
  });
});

describe('sm plugins family, the gate opens exactly where consent exists', () => {
  it('runs the code once the operator grants trust (positive control)', () => {
    const scope = hostileProject('granted');
    // Proves the payload is live: without this the deny-side assertions
    // above would pass against a plugin that simply never worked.
    assert.equal(ran(scope, ['plugins', 'list']), false, 'precondition: untrusted');
    assert.equal(sm(['plugins', 'trust', PLUGIN_ID], scope).status, 0);
    assert.equal(ran(scope, ['plugins', 'list']), true, 'trusted code must load');
  });

  it('leaves --plugin-dir exempt, the operator aimed the loader at it', () => {
    const scope = hostileProject('explicit');
    const dir = join('.skill-map', 'plugins');
    assert.equal(ran(scope, ['plugins', 'list', '--plugin-dir', dir]), true);
  });
});
