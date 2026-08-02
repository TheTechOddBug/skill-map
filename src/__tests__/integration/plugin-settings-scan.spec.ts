/**
 * End-to-end proof that operator-supplied extension settings reach the
 * scan pipeline. Drives the real `sm` binary against a temp project:
 *
 *   1. baseline `sm scan` counts every external URL,
 *   2. `sm plugins config core/external-url-counter ignored-domains [...]`
 *      writes the override,
 *   3. a second `sm scan` shows the count drop, the excluded domain no
 *      longer contributes to `node.externalRefsCount`.
 *
 * Exercises the priority wiring path: `scan-runner` loads the merged
 * config, builds `buildSettingsResolver(cfg)`, threads it through
 * `composeScanExtensions`, and the extractor reads `ctx.settings`.
 *
 * HOME is isolated so the host's `~/.skill-map/` is never touched.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { grantTrust } from '../../kernel/config/plugin-trust-store.js';
import { installedSpecVersion } from '../../kernel/adapters/plugin-loader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', 'bin', 'sm.js');

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

function externalRefsCount(scanJson: string, nodeFragment: string): number {
  const parsed = JSON.parse(scanJson) as { nodes?: Array<{ path: string; externalRefsCount: number }> };
  const node = (parsed.nodes ?? []).find((n) => n.path.includes(nodeFragment));
  assert.ok(node, `expected a node matching ${nodeFragment} in the scan output`);
  return node.externalRefsCount;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugin-settings-scan-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('extension settings reach the scan pipeline', () => {
  function seedFixture(scope: IScope): void {
    const file = join(scope.cwd, '.claude', 'agents', 'links.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      [
        '---',
        'name: links',
        'description: external URLs',
        '---',
        '',
        'See https://example.com for docs.',
        'Also https://other.org/x here.',
        'And https://example.com/page deeper.',
      ].join('\n'),
    );
  }

  it('counts every external URL when no ignore list is set', () => {
    const scope = freshScope('baseline');
    seedFixture(scope);
    const r = sm(['scan', '--json'], scope);
    assert.equal(r.status, 0, r.stderr);
    // Two distinct example.com URLs + one other.org → 3 distinct hosts'
    // URLs, all counted.
    assert.equal(externalRefsCount(r.stdout, 'links.md'), 3);
  });

  it('drops the excluded domain from externalRefsCount after `sm plugins config`', () => {
    const scope = freshScope('with-ignore');
    seedFixture(scope);

    const set = sm(
      ['plugins', 'config', 'core/external-url-counter', 'ignored-domains', '["example.com"]'],
      scope,
    );
    assert.equal(set.status, 0, set.stderr);

    const r = sm(['scan', '--json'], scope);
    assert.equal(r.status, 0, r.stderr);
    // Both example.com URLs are excluded; only https://other.org/x
    // survives → 1.
    assert.equal(externalRefsCount(r.stdout, 'links.md'), 1);
  });

  it('reset restores the full count', () => {
    const scope = freshScope('reset');
    seedFixture(scope);
    sm(['plugins', 'config', 'core/external-url-counter', 'ignored-domains', '["example.com"]'], scope);
    const reset = sm(['plugins', 'config', 'core/external-url-counter', 'ignored-domains', '--reset'], scope);
    assert.equal(reset.status, 0, reset.stderr);
    const r = sm(['scan', '--json'], scope);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(externalRefsCount(r.stdout, 'links.md'), 3);
  });
});

describe('secret envVar override reaches ctx.settings at scan time', () => {
  /**
   * A drop-in probe plugin whose extractor ECHOES the resolved secret to
   * stderr, the minimal observable that proves the env value traversed
   * the whole chain in the real binary: CLI adapter (`settingsEnv:
   * process.env`) → scan runner → settings resolver → composer →
   * `ctx.settings` inside the extractor. Fenced marker so the assertion
   * never collides with scan progress output.
   */
  function dropProbePlugin(scope: IScope): void {
    const pluginDir = join(scope.cwd, '.skill-map', 'plugins', 'probe');
    mkdirSync(pluginDir, { recursive: true });
    grantTrust(scope.cwd, 'probe');
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        version: '0.1.0',
        description: 'settings-echo probe plugin',
        specCompat: `^${installedSpecVersion()}`,
        catalogCompat: '*',
      }),
    );
    const extDir = join(pluginDir, 'extractors', 'echo');
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, 'extension.json'),
      JSON.stringify({ version: '0.1.0', description: 'echoes ctx.settings.token' }),
    );
    writeFileSync(
      join(extDir, 'index.js'),
      `export default {
         settings: {
           token: { type: 'secret', label: 'Probe token', envVar: 'PROBE_TOKEN' },
         },
         extract(ctx) {
           const token = ctx.settings ? ctx.settings.token : undefined;
           process.stderr.write('PROBE-TOKEN[' + String(token) + ']\\n');
           return [];
         },
       };\n`,
    );
  }

  function seedNode(scope: IScope): void {
    const file = join(scope.cwd, '.claude', 'agents', 'probe.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, ['---', 'name: probe', 'description: probe node', '---', '', 'Body.'].join('\n'));
  }

  it('delivers the env-provided secret to the extractor', () => {
    const scope = freshScope('env-e2e');
    seedNode(scope);
    dropProbePlugin(scope);

    const withEnv = sm(['scan', '--json'], scope, { PROBE_TOKEN: 'sk-e2e-env' });
    assert.equal(withEnv.status, 0, withEnv.stderr);
    assert.match(withEnv.stderr, /PROBE-TOKEN\[sk-e2e-env\]/);

    // Without the env var the secret has no value at all (no default,
    // nothing stored): the key is omitted from ctx.settings.
    const without = sm(['scan', '--json'], scope);
    assert.equal(without.status, 0, without.stderr);
    assert.match(without.stderr, /PROBE-TOKEN\[undefined\]/);
  });

  it('env wins over a stored value, and falls back to it when unset', () => {
    const scope = freshScope('env-precedence');
    seedNode(scope);
    dropProbePlugin(scope);
    const write = sm(['plugins', 'config', 'probe/echo', 'token', 'sk-stored'], scope);
    assert.equal(write.status, 0, write.stderr);

    const withEnv = sm(['scan', '--json'], scope, { PROBE_TOKEN: 'sk-e2e-env' });
    assert.match(withEnv.stderr, /PROBE-TOKEN\[sk-e2e-env\]/);

    const without = sm(['scan', '--json'], scope);
    assert.match(without.stderr, /PROBE-TOKEN\[sk-stored\]/);
  });
});
