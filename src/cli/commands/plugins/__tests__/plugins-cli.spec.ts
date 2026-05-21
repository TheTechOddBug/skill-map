/**
 * Step 6.6, `sm plugins enable / disable` end-to-end through the real
 * binary. Each test isolates HOME and cwd so the host's `~/.skill-map/`
 * is never touched. A helper drops a mock plugin under the project
 * scope's plugin directory so the toggle verbs have something to act on.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../../kernel/adapters/sqlite/index.js';
import {
  loadContributionsForNode,
  replaceAllScanContributions,
} from '../../../../kernel/adapters/sqlite/contributions.js';
import { getPluginEnabled } from '../../../../kernel/adapters/sqlite/plugins.js';
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

function dropMockPlugin(scope: IScope, id: string): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      version: '0.1.0',
      description: 'test',
      specCompat: `^${installedSpecVersion()}`,
      catalogCompat: '*',
      granularity: 'bundle',
    }),
  );
  const extDir = join(pluginDir, 'extractors', `${id}-extractor`);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, 'index.js'),
    `export default {
       version: '0.1.0',
       description: 'mock',
       extract() {},
     };`,
  );
}

/**
 * Drop a Provider plugin under the project scope. The runtime contract
 * is just enough for the loader to accept it (or reject it
 * deterministically when fields are missing).
 */
function dropMockProvider(scope: IScope, id: string): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      version: '0.1.0',
      description: 'test',
      specCompat: `^${installedSpecVersion()}`,
      catalogCompat: '*',
      granularity: 'bundle',
    }),
  );
  // Structure-as-truth: the Provider runtime shape no longer carries
  // `kinds` (the runtime descriptor is populated by the loader from
  // `kinds/<kindName>/` folders). The mock keeps an inline `kinds`
  // map on the runtime instance so tests that exercise `classify()`
  // continue to work without planting a `kinds/` directory; the
  // loader strips `id`/`kind` literals before AJV validation.
  const manifestParts = [
    `version: '0.1.0'`,
    `description: 'mock provider'`,
    `kinds: { markdown: { schema: './schemas/markdown.schema.json', schemaJson: { $id: 'urn:test:${id}/markdown', type: 'object', additionalProperties: true }, ui: { label: 'Markdown', color: '#5b908c' } } }`,
    `async *walk() {}`,
    `classify() { return 'markdown'; }`,
  ];
  const provDir = join(pluginDir, 'providers', `${id}-provider`);
  mkdirSync(provDir, { recursive: true });
  writeFileSync(
    join(provDir, 'index.js'),
    `export default {\n  ${manifestParts.join(',\n  ')},\n};\n`,
  );
}

function sm(args: string[], scope: IScope) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    // NO_COLOR pins the subprocess to plain output regardless of any
    // FORCE_COLOR the parent test runner sets, the human regexes in
    // these tests assume no ANSI between glyph + id.
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugins-cli-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm plugins enable / disable', () => {
  it('disables a plugin: writes config_plugins row, list shows status=disabled', async () => {
    const scope = freshScope('disable-one');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-a');

    const r = sm(['plugins', 'disable', 'mock-a'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: mock-a/);

    // DB row reflects disabled
    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-a'), false);
    } finally {
      await adapter.close();
    }

    // sm plugins list reflects the toggle
    const list = sm(['plugins', 'list'], scope);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /✕\s+mock-a\b/);
  });

  it('enable flips a previously disabled plugin back on', async () => {
    const scope = freshScope('enable-flip');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-b');
    sm(['plugins', 'disable', 'mock-b'], scope);

    const r = sm(['plugins', 'enable', 'mock-b'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /enabled: mock-b/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-b'), true);
    } finally {
      await adapter.close();
    }

    const list = sm(['plugins', 'list'], scope);
    assert.match(list.stdout, /✓\s+mock-b\b/);
  });

  it('--all disables every bundle-granularity plugin (built-in claude + user plugins)', async () => {
    const scope = freshScope('disable-all');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-c');
    dropMockPlugin(scope, 'mock-d');

    const r = sm(['plugins', 'disable', '--all'], scope);
    assert.equal(r.status, 0);
    // Spec § A.7, `--all` operates on bundle-granularity ids only.
    // Built-in `claude` (granularity=bundle) is included; built-in
    // `core` (granularity=extension) is NOT, its individual extensions
    // are the toggle-able units, and `--all` deliberately does not
    // expand to qualified ids.
    // 4 built-in bundle-granularity providers (claude + gemini +
    // openai + agent-skills) plus the 2 user mocks = 6 targets.
    assert.match(r.stdout, /disabled: 6 plugin\(s\)/);
    assert.match(r.stdout, /- claude/);
    assert.match(r.stdout, /- gemini/);
    assert.match(r.stdout, /- openai/);
    assert.match(r.stdout, /- agent-skills/);
    assert.match(r.stdout, /- mock-c/);
    assert.match(r.stdout, /- mock-d/);
    // `core` must NOT be in the targets, extension granularity rejects
    // bare bundle ids.
    assert.equal(r.stdout.includes('- core\n'), false, 'core must not be toggled by --all');

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-c'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-d'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'gemini'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'agent-skills'), false);
    } finally {
      await adapter.close();
    }
  });

  it('disable eagerly purges scan_contributions for the plugin', async () => {
    // Regression coverage for the "I disabled the plugin but its
    // footer chips are still there" UX gap, see `db-schema.md`
    // § scan_contributions → "Eager purge on disable". The toggle
    // must wipe the plugin's rows immediately, without waiting for
    // the next `sm scan` catalog sweep.
    const scope = freshScope('disable-purges-contributions');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-purge');

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const seedAdapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await seedAdapter.init();
    try {
      await seedAdapter.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          {
            pluginId: 'mock-purge',
            extensionId: 'mock-purge-extractor',
            nodePath: 'a.md',
            contributionId: 'count',
            slot: 'card.footer.right',
            payload: { value: 7 },
            emittedAt: 1,
          },
          {
            pluginId: 'other',
            extensionId: 'other-ext',
            nodePath: 'a.md',
            contributionId: 'count',
            slot: 'card.footer.right',
            payload: { value: 9 },
            emittedAt: 1,
          },
        ]);
      });
    } finally {
      await seedAdapter.close();
    }

    const r = sm(['plugins', 'disable', 'mock-purge'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const verifyAdapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await verifyAdapter.init();
    try {
      const remaining = await loadContributionsForNode(verifyAdapter.db, 'a.md');
      assert.equal(remaining.length, 1, 'only the unrelated plugin row should survive');
      assert.equal(remaining[0]!.pluginId, 'other');
    } finally {
      await verifyAdapter.close();
    }
  });

  it('exit 5 on unknown plugin id', () => {
    const scope = freshScope('disable-unknown');
    sm(['init', '--no-scan'], scope);
    const r = sm(['plugins', 'disable', 'no-such-plugin'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Plugin not found/);
  });

  it('exit 2 when neither <id> nor --all is supplied', () => {
    const scope = freshScope('disable-no-arg');
    sm(['init', '--no-scan'], scope);
    const r = sm(['plugins', 'disable'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /one or more <id> arguments/);
  });

  it('exit 2 when both <id> and --all are passed', () => {
    const scope = freshScope('disable-both');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-e');
    const r = sm(['plugins', 'disable', 'mock-e', '--all'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not both/);
  });

  it('settings.json baseline is overridden by DB user override', async () => {
    const scope = freshScope('precedence');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-f');
    // settings.json says enabled: false; DB will say enabled: true.
    sm(['config', 'set', 'plugins.mock-f.enabled', 'false'], scope);
    sm(['plugins', 'enable', 'mock-f'], scope);

    const list = sm(['plugins', 'list'], scope);
    assert.equal(list.status, 0);
    // DB says enabled → status enabled
    assert.match(list.stdout, /✓\s+mock-f\b/);
  });

  it('settings.json baseline applies when DB has no override (enabled by default → disabled by settings)', () => {
    const scope = freshScope('settings-only');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-g');
    sm(['config', 'set', 'plugins.mock-g.enabled', 'false'], scope);

    const list = sm(['plugins', 'list'], scope);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /✕\s+mock-g\b/);
  });

  it('disables multiple plugins in one call', async () => {
    const scope = freshScope('disable-many');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-many-a');
    dropMockPlugin(scope, 'mock-many-b');
    dropMockPlugin(scope, 'mock-many-c');

    const r = sm(['plugins', 'disable', 'mock-many-a', 'mock-many-b', 'mock-many-c'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: 3 plugin\(s\)/);
    assert.match(r.stdout, /- mock-many-a/);
    assert.match(r.stdout, /- mock-many-b/);
    assert.match(r.stdout, /- mock-many-c/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-many-a'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-many-b'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-many-c'), false);
    } finally {
      await adapter.close();
    }
  });

  it('enables multiple plugins in one call after disabling them', async () => {
    const scope = freshScope('enable-many');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-en-a');
    dropMockPlugin(scope, 'mock-en-b');
    sm(['plugins', 'disable', 'mock-en-a', 'mock-en-b'], scope);

    const r = sm(['plugins', 'enable', 'mock-en-a', 'mock-en-b'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /enabled: 2 plugin\(s\)/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-en-a'), true);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-en-b'), true);
    } finally {
      await adapter.close();
    }
  });

  it('batch is all-or-nothing: unknown id aborts before any DB write', async () => {
    const scope = freshScope('disable-batch-unknown');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-batch-a');
    dropMockPlugin(scope, 'mock-batch-b');

    const r = sm(
      ['plugins', 'disable', 'mock-batch-a', 'no-such-plugin', 'mock-batch-b'],
      scope,
    );
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Plugin not found/);

    // Neither known id should have been written: the loop aborts on
    // the first bad entry, before the persist phase. `getPluginEnabled`
    // returns `undefined` when no config_plugins row exists (the plugin
    // is enabled by default via discovery, no override).
    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-batch-a'), undefined);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-batch-b'), undefined);
    } finally {
      await adapter.close();
    }
  });

  it('dedupes repeated ids in a batch', async () => {
    const scope = freshScope('disable-dedupe');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-dedupe');

    const r = sm(['plugins', 'disable', 'mock-dedupe', 'mock-dedupe'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Dedupe collapses to one target so the single-target message
    // (not the multi-row header) is rendered.
    assert.match(r.stdout, /disabled: mock-dedupe/);
    assert.equal(/disabled: \d+ plugin\(s\)/.test(r.stdout), false);
  });
});

// Spec § A.7, granularity. The CLI rejects mismatched ids up front so
// the user learns the model from the error message instead of silently
// writing a config_plugins row that the runtime would later ignore.
describe('sm plugins enable / disable, granularity', () => {
  it('(e) disable claude (bundle granularity) → OK, persists row under "claude"', async () => {
    const scope = freshScope('granularity-claude-disable');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'claude'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: claude/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), false);
    } finally {
      await adapter.close();
    }
  });

  it('(f) disable claude/claude (qualified id under bundle granularity) → ERROR', () => {
    const scope = freshScope('granularity-claude-qualified');
    sm(['init', '--no-scan'], scope);

    // Bundle-granularity plugins reject qualified ids: the user must
    // toggle the whole bundle, not a sub-extension.
    const r = sm(['plugins', 'disable', 'claude/claude'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /'claude' has granularity=bundle/);
    assert.match(r.stderr, /sm plugins disable claude/);
  });

  it('(g) disable core (bare bundle id under extension granularity) → ERROR', () => {
    const scope = freshScope('granularity-core-bare');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /'core' has granularity=extension/);
    assert.match(r.stderr, /sm plugins disable core\/<ext-id>/);
  });

  it('(h) disable core/superseded (qualified id under extension granularity) → OK', async () => {
    const scope = freshScope('granularity-core-qualified');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/superseded'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: core\/superseded/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'core/superseded'), false);
      // Other core extensions and the claude bundle untouched.
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), undefined);
      assert.equal(await getPluginEnabled(adapter.db, 'core/broken-ref'), undefined);
    } finally {
      await adapter.close();
    }
  });

  it('(i) sm plugins list shows every bundle + user plugin', () => {
    const scope = freshScope('granularity-list');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-list');

    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Each enabled bundle (built-in or user) gets its own ✓ row with the
    // `built-in` / `user` source label. The new format collapses
    // per-extension breakdown into a dim names line under the row, so
    // the test matches the row + checks names appear nearby.
    assert.match(r.stdout, /✓\s+claude\b.*built-in/);
    assert.match(r.stdout, /✓\s+core\b.*built-in/);
    // `superseded` is one of core's extensions and lands in the dim
    // names line below the `core` row.
    assert.match(r.stdout, /\bsuperseded\b/);
    // User plugin row carries `user` instead of `built-in`.
    assert.match(r.stdout, /✓\s+mock-list\b.*user/);
  });

  it('rejects qualified id under unknown bundle with directed message', () => {
    const scope = freshScope('granularity-unknown-bundle');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'no-such/anything'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id references unknown bundle/);
  });

  it('rejects qualified id with unknown extension under known bundle', () => {
    const scope = freshScope('granularity-unknown-ext');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/no-such-rule'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id not found/);
    assert.match(r.stderr, /'core' does not declare an extension with id 'no-such-rule'/);
  });
});

describe('sm plugins doctor, disabled is not a failure', () => {
  it('exit 0 when the only non-loaded plugin is disabled', () => {
    const scope = freshScope('doctor-disabled');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-h');
    sm(['plugins', 'disable', 'mock-h'], scope);

    const r = sm(['plugins', 'doctor'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled\s+1/);
  });
});

// Spec § A.6, show / list still expose every loaded extension id so
// the user knows what's actually running. Post-redesign the human
// renderer drops the `<bundle>/<id>` qualified form (the bundle is
// already the row header) and just prints the bare extension name,
// the qualified form survives in `--json` for tooling consumers.
describe('sm plugins show, extension visibility', () => {
  it('show resolves on the plugin id and lists every extension by name', () => {
    const scope = freshScope('show-qualified');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-q');

    const r = sm(['plugins', 'show', 'mock-q'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // New header line: `  ✓  mock-q   v0.1.0   user   1 extension`.
    assert.match(r.stdout, /✓\s+mock-q\s+v/);
    // Extension row uses bare name + version: `extractor  mock-q-extractor  v…`.
    assert.match(r.stdout, /extractor\s+mock-q-extractor\s+v/);
  });

  it('list surfaces every loaded extension name under its bundle', () => {
    const scope = freshScope('list-qualified');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-l');

    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0);
    // The extension name shows up in the dim names line under the
    // `mock-l` row (no `<bundle>/<id>` prefix in the human output).
    assert.match(r.stdout, /\bmock-l-extractor\b/);
  });

  // Qualified `<bundle>/<ext>` ids now render a single-extension detail
  // (header + Kind / Version / Stability / Description / Preconditions /
  // Entry) instead of the parent bundle's full listing. The reader asked
  // about one extension; the output answers that question.
  it('show with qualified `<bundle>/<ext>` id renders single-extension detail (built-in)', () => {
    const scope = freshScope('show-qualified-builtin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'core/superseded'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Header: qualified id + built-in source.
    assert.match(r.stdout, /✓\s+core\/superseded\s+built-in/);
    // Field block: Kind / Version are always present.
    assert.match(r.stdout, /Kind\s+analyzer/);
    assert.match(r.stdout, /Version\s+1\.0\.0/);
    // Bundle counter ("24 extensions" / "N extensions") must NOT appear,
    // that's the bare-bundle header signature and would mean we fell
    // back to the old behavior.
    assert.doesNotMatch(r.stdout, /\d+\s+extensions?/);
    // No sibling extension under `core` leaks into the output.
    assert.doesNotMatch(r.stdout, /\bexternal-url-counter\b/);
  });

  it('show with qualified id surfaces optional manifest fields when present', () => {
    const scope = freshScope('show-qualified-fields');
    sm(['init', '--no-scan'], scope);

    // `core/external-url-counter` declares description in its module
    // export. `stability` was retired with the structure-as-truth
    // refactor (display-only field); this test pins the remaining
    // optional field (`description`).
    const r = sm(['plugins', 'show', 'core/external-url-counter'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /Description\s+Counts the distinct external URLs/);
  });

  it('show with qualified id and --json emits only the extension object', () => {
    const scope = freshScope('show-qualified-json');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'core/external-url-counter', '--json'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const payload = JSON.parse(r.stdout);
    // Extension shape, not a bundle envelope.
    assert.equal(payload.id, 'external-url-counter');
    assert.equal(payload.pluginId, 'core');
    assert.equal(payload.kind, 'extractor');
    assert.equal(typeof payload.version, 'string');
    // The bundle's `extensions` array must NOT be present, that would
    // mean we dumped the whole bundle.
    assert.equal(payload.extensions, undefined);
  });

  it('show with qualified id reflects per-extension disabled state in the glyph', async () => {
    const scope = freshScope('show-qualified-disabled-glyph');
    sm(['init', '--no-scan'], scope);

    // Baseline: enabled → green ✓.
    const before = sm(['plugins', 'show', 'core/superseded'], scope);
    assert.equal(before.status, 0, `stderr: ${before.stderr}`);
    assert.match(before.stdout, /✓\s+core\/superseded/);

    // Disable the single extension via the qualified id (granularity=extension).
    const off = sm(['plugins', 'disable', 'core/superseded'], scope);
    assert.equal(off.status, 0, `stderr: ${off.stderr}`);

    // The single-ext header glyph flips to ✕; bare-bundle output would
    // keep `core` itself ✓ and only mark the inner row, this test
    // guards that we render the EXTENSION header, not the bundle.
    const after = sm(['plugins', 'show', 'core/superseded'], scope);
    assert.equal(after.status, 0, `stderr: ${after.stderr}`);
    assert.match(after.stdout, /✕\s+core\/superseded/);
  });

  it('show with qualified id targeting a user-plugin extension renders the same field block', () => {
    const scope = freshScope('show-qualified-user');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-q-show');

    const r = sm(['plugins', 'show', 'mock-q-show/mock-q-show-extractor'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Header: qualified id + user source.
    assert.match(r.stdout, /✓\s+mock-q-show\/mock-q-show-extractor\s+user/);
    // Kind / Version are required.
    assert.match(r.stdout, /Kind\s+extractor/);
    assert.match(r.stdout, /Version\s+0\.1\.0/);
    // Mock plugin declares description='mock'. `stability` was retired
    // with the structure-as-truth refactor.
    assert.match(r.stdout, /Description\s+mock/);
    // Entry path always present for user plugins (loader resolves it).
    // With auto-discovery the file lives at
    // `extractors/<name>/index.js`; the path renders as such.
    assert.match(r.stdout, /Entry\s+\S+extractors\/mock-q-show-extractor\/index\.js/);
  });

  it('show with bare bundle id still renders the full bundle detail (regression)', () => {
    const scope = freshScope('show-bare-bundle');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'core'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Bundle header signature: "N extensions" counter.
    assert.match(r.stdout, /✓\s+core\s+built-in\s+\d+\s+extensions/);
    // Per-extension rows appear (at least one sibling we can spot-check).
    assert.match(r.stdout, /\bsuperseded\b/);
    assert.match(r.stdout, /\bexternal-url-counter\b/);
  });

  it('show rejects qualified id with unknown extension under known bundle', () => {
    const scope = freshScope('show-qualified-unknown-ext');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'core/no-such-rule'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id not found/);
    assert.match(r.stderr, /'core' does not declare an extension with id 'no-such-rule'/);
  });

  it('show rejects qualified id under unknown bundle', () => {
    const scope = freshScope('show-qualified-unknown-bundle');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'no-such/anything'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id references unknown bundle/);
  });

  it('list marks individually-disabled extensions of granularity=extension bundles with ✕', async () => {
    const scope = freshScope('list-disabled-ext-marker');
    sm(['init', '--no-scan'], scope);

    // Baseline: every core extension visible without a marker.
    const before = sm(['plugins', 'list'], scope);
    assert.equal(before.status, 0, `stderr: ${before.stderr}`);
    assert.match(before.stdout, /\bsuperseded\b/);
    assert.doesNotMatch(before.stdout, /✕\s+superseded\b/);

    // Disable one core extension, granularity=extension means only the
    // qualified id flips, the bundle row stays ✓.
    const disable = sm(['plugins', 'disable', 'core/superseded'], scope);
    assert.equal(disable.status, 0, `stderr: ${disable.stderr}`);

    // The list now shows the ✕ marker on the disabled name. The bundle
    // row glyph stays ✓ (the bundle id is still enabled, only the
    // extension flipped).
    const after = sm(['plugins', 'list'], scope);
    assert.equal(after.status, 0, `stderr: ${after.stderr}`);
    assert.match(after.stdout, /✓\s+core\b/);
    assert.match(after.stdout, /✕\s+superseded\b/);
  });
});

