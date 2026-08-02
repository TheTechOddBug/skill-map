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
import { grantTrust } from '../../../../kernel/config/plugin-trust-store.js';

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

function sm(
  args: string[],
  scope: IScope,
  extraEnv: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home, NO_COLOR: '1', ...extraEnv },
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
 *
 * Trust is granted with it: the settings a plugin declares live in its
 * module, so `sm plugins config` has to import it, which the gate denies
 * without the operator's local consent (`plugins-import-gate.spec.ts`).
 */
function dropSecretPlugin(scope: IScope, pluginId: string, extId: string): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', pluginId);
  mkdirSync(pluginDir, { recursive: true });
  grantTrust(scope.cwd, pluginId);
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
  writeFileSync(join(extDir, 'extension.json'), JSON.stringify({ version: '0.1.0', description: 'fixture extension' }));
  writeFileSync(
    join(extDir, 'index.js'),
    `export default {
       settings: {
         'api-token': { type: 'secret', label: 'API token', envVar: 'VAULT_API_TOKEN' },
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

describe('sm plugins config, match-list (core/reference-broken)', () => {
  // The first BUILT-IN ANALYZER with declared settings; this block
  // doubles as the smoke test that the analyzer path renders in the
  // config table like the extractor path does.
  const EXT = 'core/reference-broken';
  const LIST =
    '[{"type":"literal","value":"docs/x/spec.md"},{"type":"regex","value":"^docs/x/"},{"type":"glob","value":"drafts/**"}]';

  it('table shows the manifest default before any override', () => {
    const scope = freshScope('ml-default');
    const r = sm(['plugins', 'config', EXT, '--json'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.deepEqual(obj['ignored-references'], []);
  });

  it('set writes the coerced entry array to settings.json (committed layer)', () => {
    const scope = freshScope('ml-set');
    const r = sm(['plugins', 'config', EXT, 'ignored-references', LIST], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Set ignored-references/);
    const settings = readSettings(scope, 'settings') as {
      plugins?: { core?: { extensions?: { 'reference-broken'?: { settings?: Record<string, unknown> } } } };
    };
    assert.deepEqual(settings.plugins?.core?.extensions?.['reference-broken']?.settings?.['ignored-references'], [
      { type: 'literal', value: 'docs/x/spec.md' },
      { type: 'regex', value: '^docs/x/' },
      { type: 'glob', value: 'drafts/**' },
    ]);
    assert.deepEqual(readSettings(scope, 'settings.local'), {});
  });

  it('rejects a non-JSON value at coerce time', () => {
    const scope = freshScope('ml-not-json');
    const r = sm(['plugins', 'config', EXT, 'ignored-references', 'docs/x/spec.md'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /parse/i);
    assert.deepEqual(readSettings(scope, 'settings'), {});
  });

  it('rejects an uncompilable regex entry at write time (not at scan)', () => {
    const scope = freshScope('ml-bad-regex');
    const r = sm(['plugins', 'config', EXT, 'ignored-references', '[{"type":"regex","value":"[unclosed"}]'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /compilable/);
    assert.deepEqual(readSettings(scope, 'settings'), {});
  });

  it('rejects an unknown entry kind at write time', () => {
    const scope = freshScope('ml-bad-kind');
    const r = sm(['plugins', 'config', EXT, 'ignored-references', '[{"type":"substring","value":"x"}]'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /literal, regex, glob/);
  });

  it('reset removes the override key', () => {
    const scope = freshScope('ml-reset');
    sm(['plugins', 'config', EXT, 'ignored-references', LIST], scope);
    const r = sm(['plugins', 'config', EXT, 'ignored-references', '--reset'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Cleared ignored-references/);
    const settings = readSettings(scope, 'settings') as {
      plugins?: { core?: { extensions?: { 'reference-broken'?: { settings?: Record<string, unknown> } } } };
    };
    assert.equal(settings.plugins?.core?.extensions?.['reference-broken']?.settings?.['ignored-references'], undefined);
  });

  it('human table renders the analyzer setting with its source layer', () => {
    const scope = freshScope('ml-table');
    sm(['plugins', 'config', EXT, 'ignored-references', LIST], scope);
    const r = sm(['plugins', 'config', EXT], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ignored-references/);
    assert.match(r.stdout, /settings\.json/);
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

  it('shows [env] as the source while the envVar override is active', () => {
    const scope = freshScope('secret-env-source');
    dropSecretPlugin(scope, 'vault', 'fetcher');
    // A stored value exists, but the env override wins and the table
    // says so (spec/input-types.md §secret). Still redacted either way.
    sm(['plugins', 'config', 'vault/fetcher', 'api-token', 'sk-stored'], scope);
    const r = sm(['plugins', 'config', 'vault/fetcher'], scope, {
      VAULT_API_TOKEN: 'sk-from-env',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[env\]/);
    assert.doesNotMatch(r.stdout, /sk-from-env/);
  });
});

describe('sm plugins config, project-local-only key routing', () => {
  it('writes the github base-URL override to settings.local.json (was refused outright)', () => {
    const scope = freshScope('local-only-github');
    const r = sm(
      ['plugins', 'config', 'github/enrichment', 'apiBaseUrl', 'https://ghe.corp.test/api/v3'],
      scope,
    );
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const local = readSettings(scope, 'settings.local') as {
      plugins?: { github?: { extensions?: { enrichment?: { settings?: Record<string, unknown> } } } };
    };
    assert.equal(
      local.plugins?.github?.extensions?.enrichment?.settings?.['apiBaseUrl'],
      'https://ghe.corp.test/api/v3',
    );
    // The committed file must never carry a PROJECT_LOCAL_ONLY key.
    assert.deepEqual(readSettings(scope, 'settings'), {});
  });
});
