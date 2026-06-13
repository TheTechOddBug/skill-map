/**
 * `sm plugins config <plugin>/<ext> [<settingId> [<value>] | --reset]`
 * end-to-end through the real binary. Each test isolates HOME and cwd so
 * the host's `~/.skill-map/` is never touched.
 *
 * Subjects:
 *   - the built-in `core/external-url-counter` extractor, which declares
 *     a non-`secret` `ignored-domains` (string-list) setting; writes
 *     land in the committed `settings.json`.
 *   - a mock user plugin extension declaring a `secret`-typed setting;
 *     writes are forced to the gitignored `settings.local.json`.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { installedSpecVersion } from '../../../../kernel/adapters/plugin-loader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', '..', '..', 'bin', 'sm.js');

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

function sm(args: string[], scope: IScope): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function readSettings(scope: IScope, kind: 'settings' | 'settings.local'): Record<string, unknown> {
  const path = join(scope.cwd, '.skill-map', `${kind}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Drop a mock user plugin with one extractor that declares a
 * `secret`-typed setting (plus a normal string for breadth).
 */
function dropSecretPlugin(scope: IScope, pluginId: string, extId: string): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', pluginId);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      version: '0.1.0',
      description: 'secret-bearing test plugin',
      specCompat: `^${installedSpecVersion()}`,
      catalogCompat: '*',
    }),
  );
  const extDir = join(pluginDir, 'extractors', extId);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, 'index.js'),
    `export default {
       version: '0.1.0',
       description: 'mock extractor with a secret setting',
       settings: {
         'api-token': { type: 'secret', label: 'API token' },
         'base-url': { type: 'single-string', label: 'Base URL', default: 'https://api.example.com' },
       },
       extract() {},
     };\n`,
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugins-config-cli-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm plugins config, id-shape gates', () => {
  it('rejects a bare plugin id with a redirect to `sm plugins list`', () => {
    const scope = freshScope('bare-id');
    const r = sm(['plugins', 'config', 'core'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /needs a qualified/);
    assert.match(r.stderr, /plugins list core/);
  });

  it('errors on an unknown extension', () => {
    const scope = freshScope('unknown-ext');
    const r = sm(['plugins', 'config', 'core/does-not-exist'], scope);
    assert.equal(r.status, 5);
  });

  it('errors when the extension declares no settings', () => {
    const scope = freshScope('no-settings');
    // `core/markdown-link` declares no settings.
    const r = sm(['plugins', 'config', 'core/markdown-link'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /no configurable settings/);
  });
});

describe('sm plugins config, get / set / reset (non-secret)', () => {
  const EXT = 'core/external-url-counter';

  it('table shows the manifest default before any override', () => {
    const scope = freshScope('table-default');
    const r = sm(['plugins', 'config', EXT, '--json'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.deepEqual(obj['ignored-domains'], []);
  });

  it('set writes the coerced JSON array to settings.json', () => {
    const scope = freshScope('set-array');
    const r = sm(['plugins', 'config', EXT, 'ignored-domains', '["example.com","foo.io"]'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Set ignored-domains/);
    assert.match(r.stdout, /run `sm scan`/i);
    const settings = readSettings(scope, 'settings') as {
      plugins?: { core?: { extensions?: { 'external-url-counter'?: { settings?: Record<string, unknown> } } } };
    };
    assert.deepEqual(
      settings.plugins?.core?.extensions?.['external-url-counter']?.settings?.['ignored-domains'],
      ['example.com', 'foo.io'],
    );
    // Nothing leaked into the local file.
    assert.deepEqual(readSettings(scope, 'settings.local'), {});
  });

  it('get reflects the override and its source layer', () => {
    const scope = freshScope('get-after-set');
    sm(['plugins', 'config', EXT, 'ignored-domains', '["a.com"]'], scope);
    const r = sm(['plugins', 'config', EXT, '--json'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.deepEqual(obj['ignored-domains'], ['a.com']);
    const human = sm(['plugins', 'config', EXT], scope);
    assert.match(human.stdout, /settings\.json/);
  });

  it('rejects an uncoercible value at write time (not at scan)', () => {
    const scope = freshScope('bad-value');
    const r = sm(['plugins', 'config', EXT, 'ignored-domains', 'not-json'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /parse/i);
    // No file written on failure.
    assert.deepEqual(readSettings(scope, 'settings'), {});
  });

  it('reset removes the override key', () => {
    const scope = freshScope('reset');
    sm(['plugins', 'config', EXT, 'ignored-domains', '["a.com"]'], scope);
    const r = sm(['plugins', 'config', EXT, 'ignored-domains', '--reset'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Cleared ignored-domains/);
    const settings = readSettings(scope, 'settings') as {
      plugins?: { core?: { extensions?: { 'external-url-counter'?: { settings?: Record<string, unknown> } } } };
    };
    const leftover = settings.plugins?.core?.extensions?.['external-url-counter']?.settings?.['ignored-domains'];
    assert.equal(leftover, undefined);
  });

  it('errors on an unknown settingId', () => {
    const scope = freshScope('unknown-setting');
    const r = sm(['plugins', 'config', EXT, 'nope', 'value'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Unknown setting/);
  });
});

describe('sm plugins config, secret routing', () => {
  it('writes a secret-typed value to settings.local.json, never settings.json', () => {
    const scope = freshScope('secret-write');
    dropSecretPlugin(scope, 'vault', 'fetcher');
    const r = sm(['plugins', 'config', 'vault/fetcher', 'api-token', 'sk-super-secret'], scope);
    assert.equal(r.status, 0);
    // The receipt redacts the value.
    assert.match(r.stdout, /<redacted>/);
    assert.doesNotMatch(r.stdout, /sk-super-secret/);

    const local = readSettings(scope, 'settings.local') as {
      plugins?: { vault?: { extensions?: { fetcher?: { settings?: Record<string, unknown> } } } };
    };
    assert.equal(
      local.plugins?.vault?.extensions?.fetcher?.settings?.['api-token'],
      'sk-super-secret',
    );
    // The committed file must NOT carry the secret.
    assert.deepEqual(readSettings(scope, 'settings'), {});
  });

  it('writes a normal setting on the same extension to settings.json', () => {
    const scope = freshScope('secret-mixed');
    dropSecretPlugin(scope, 'vault', 'fetcher');
    const r = sm(['plugins', 'config', 'vault/fetcher', 'base-url', 'https://api.test.dev'], scope);
    assert.equal(r.status, 0);
    const committed = readSettings(scope, 'settings') as {
      plugins?: { vault?: { extensions?: { fetcher?: { settings?: Record<string, unknown> } } } };
    };
    assert.equal(
      committed.plugins?.vault?.extensions?.fetcher?.settings?.['base-url'],
      'https://api.test.dev',
    );
    assert.deepEqual(readSettings(scope, 'settings.local'), {});
  });

  it('redacts the secret in the table view', () => {
    const scope = freshScope('secret-table');
    dropSecretPlugin(scope, 'vault', 'fetcher');
    sm(['plugins', 'config', 'vault/fetcher', 'api-token', 'sk-secret'], scope);
    const r = sm(['plugins', 'config', 'vault/fetcher', '--json'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(obj['api-token'], '<redacted>');
    assert.doesNotMatch(r.stdout, /sk-secret/);
  });
});
