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
  it('disables a single-extension plugin by bare id (1-1 macro, no prompt)', async () => {
    const scope = freshScope('disable-one');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-a');

    // `mock-a` ships exactly one extension (`mock-a-extractor`), so
    // the bare-id macro is a 1-1 mapping and applies without prompting.
    const r = sm(['plugins', 'disable', 'mock-a'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: mock-a\/mock-a-extractor/);

    // DB row reflects disabled (qualified key, the macro path expands).
    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-a/mock-a-extractor'), false);
    } finally {
      await adapter.close();
    }

    // sm plugins list reflects the toggle, the row glyph aggregates
    // children, so a single-extension plugin whose one child is
    // disabled lands on the ✕ glyph.
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
    assert.match(r.stdout, /enabled: mock-b\/mock-b-extractor/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-b/mock-b-extractor'), true);
    } finally {
      await adapter.close();
    }

    const list = sm(['plugins', 'list'], scope);
    assert.match(list.stdout, /✓\s+mock-b\b/);
  });

  it('--all cascades across every plugin when invoked with --yes', async () => {
    const scope = freshScope('disable-all');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-c');
    dropMockPlugin(scope, 'mock-d');

    // `--all` is the cascade macro: it expands to every extension
    // inside every discovered plugin (built-ins + user plugins).
    // Non-TTY contexts (the subprocess spawn here) need --yes to
    // confirm the cascade.
    const r = sm(['plugins', 'disable', '--all', '--yes'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Every extension lands as its own qualified id in the output.
    // Built-in counts (per the current catalog): claude=3, antigravity=1,
    // openai=1, agent-skills=1, core=27. User mocks: mock-c=1, mock-d=1.
    // Total = 3+1+1+1+27+1+1 = 35 extensions cascaded.
    assert.match(r.stdout, /disabled: \d+ extension\(s\)/);
    assert.match(r.stdout, /- claude\/at-directive/);
    assert.match(r.stdout, /- core\/markdown-link/);
    assert.match(r.stdout, /- mock-c\/mock-c-extractor/);
    assert.match(r.stdout, /- mock-d\/mock-d-extractor/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-c/mock-c-extractor'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-d/mock-d-extractor'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'claude/at-directive'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'core/markdown-link'), false);
      // Bare plugin ids are NEVER persisted, the cascade always expands.
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), undefined);
      assert.equal(await getPluginEnabled(adapter.db, 'core'), undefined);
    } finally {
      await adapter.close();
    }
  });

  it('--all without --yes refuses in non-TTY contexts', () => {
    const scope = freshScope('disable-all-no-yes');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', '--all'], scope);
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /Refusing to disable multiple extensions without confirmation/);
    assert.match(r.stderr, /--yes/);
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

    // Bare plugin id is the macro form. `mock-purge` has one
    // extension; the cascade applies without prompting and purges the
    // contributions row for that extension.
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
    // settings.json says the extension is disabled; the DB override
    // for the qualified id flips it back on. The macro form
    // (`enable mock-f`) cascades to the single child extension.
    sm(['config', 'set', 'plugins.mock-f/mock-f-extractor.enabled', 'false'], scope);
    sm(['plugins', 'enable', 'mock-f'], scope);

    const list = sm(['plugins', 'list'], scope);
    assert.equal(list.status, 0);
    // DB says enabled → status enabled (aggregate over the single child)
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

    // Each bare plugin id is a 1-1 macro (one extension each). Three
    // plugins cascade to three qualified-id writes.
    const r = sm(['plugins', 'disable', 'mock-many-a', 'mock-many-b', 'mock-many-c'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: 3 extension\(s\)/);
    assert.match(r.stdout, /- mock-many-a\/mock-many-a-extractor/);
    assert.match(r.stdout, /- mock-many-b\/mock-many-b-extractor/);
    assert.match(r.stdout, /- mock-many-c\/mock-many-c-extractor/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-many-a/mock-many-a-extractor'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-many-b/mock-many-b-extractor'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-many-c/mock-many-c-extractor'), false);
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
    assert.match(r.stdout, /enabled: 2 extension\(s\)/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-en-a/mock-en-a-extractor'), true);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-en-b/mock-en-b-extractor'), true);
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
      assert.equal(await getPluginEnabled(adapter.db, 'mock-batch-a/mock-batch-a-extractor'), undefined);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-batch-b/mock-batch-b-extractor'), undefined);
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
    // (not the multi-row header) is rendered. The macro expanded the
    // single-extension plugin to its one child id.
    assert.match(r.stdout, /disabled: mock-dedupe\/mock-dedupe-extractor/);
    assert.equal(/disabled: \d+ extension\(s\)/.test(r.stdout), false);
  });
});

// Bundle macro semantics: every extension is independently toggle-able
// by its qualified id `<plugin>/<ext>`. The bare plugin id is the macro
// form that fans the toggle out across the plugin's children;
// multi-extension plugins need --yes in non-TTY contexts so the user
// does not flip 27 core extensions by accident.
describe('sm plugins enable / disable, bundle macro', () => {
  it('disable claude (multi-extension plugin) without --yes is refused in non-TTY', () => {
    const scope = freshScope('macro-claude-no-yes');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'claude'], scope);
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /Refusing to disable multiple extensions without confirmation/);
    assert.match(r.stderr, /--yes/);
  });

  it('disable claude --yes cascades across all claude extensions', async () => {
    const scope = freshScope('macro-claude-yes');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'claude', '--yes'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /- claude\/claude/);
    assert.match(r.stdout, /- claude\/at-directive/);
    assert.match(r.stdout, /- claude\/slash-command/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      // Every child extension flipped; the bare plugin id is never
      // persisted (the macro path always expands to qualified ids).
      assert.equal(await getPluginEnabled(adapter.db, 'claude/claude'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'claude/at-directive'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'claude/slash-command'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), undefined);
    } finally {
      await adapter.close();
    }
  });

  it('disable claude/at-directive (qualified id) flips just that extension, no prompt', async () => {
    const scope = freshScope('macro-claude-qualified');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'claude/at-directive'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: claude\/at-directive/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'claude/at-directive'), false);
      // Sibling extensions untouched.
      assert.equal(await getPluginEnabled(adapter.db, 'claude/claude'), undefined);
      assert.equal(await getPluginEnabled(adapter.db, 'claude/slash-command'), undefined);
    } finally {
      await adapter.close();
    }
  });

  it('disable core (multi-extension built-in) requires --yes', () => {
    const scope = freshScope('macro-core-no-yes');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core'], scope);
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /Refusing to disable multiple extensions/);
  });

  it('disable core/node-superseded (qualified id) flips just that analyzer', async () => {
    const scope = freshScope('macro-core-qualified');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/node-superseded'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: core\/node-superseded/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'core/node-superseded'), false);
      // Other core extensions and the claude plugin untouched.
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), undefined);
      assert.equal(await getPluginEnabled(adapter.db, 'core/reference-broken'), undefined);
    } finally {
      await adapter.close();
    }
  });

  it('(i) sm plugins list shows every plugin + user plugin', () => {
    const scope = freshScope('granularity-list');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-list');

    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Each enabled plugin (built-in or user) gets its own ✓ row with the
    // `built-in` / `user` source label. The new format collapses
    // per-extension breakdown into a dim names line under the row, so
    // the test matches the row + checks names appear nearby.
    assert.match(r.stdout, /✓\s+claude\b.*built-in/);
    assert.match(r.stdout, /✓\s+core\b.*built-in/);
    // `superseded` is one of core's extensions and lands in the dim
    // names line below the `core` row.
    assert.match(r.stdout, /\bnode-superseded\b/);
    // User plugin row carries `user` instead of `built-in`.
    assert.match(r.stdout, /✓\s+mock-list\b.*user/);
  });

  it('rejects qualified id under unknown plugin with directed message', () => {
    const scope = freshScope('granularity-unknown-plugin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'no-such/anything'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id references unknown plugin/);
  });

  it('rejects qualified id with unknown extension under known plugin', () => {
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
// renderer drops the `<plugin>/<id>` qualified form (the plugin is
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
    // Extension row uses qualified name + version: `extractor  mock-q/mock-q-extractor  v…`.
    assert.match(r.stdout, /extractor\s+mock-q\/mock-q-extractor\s+v/);
  });

  it('list surfaces every loaded extension name under its plugin', () => {
    const scope = freshScope('list-qualified');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-l');

    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0);
    // The extension name shows up in the dim names line under the
    // `mock-l` row (no `<plugin>/<id>` prefix in the human output).
    assert.match(r.stdout, /\bmock-l-extractor\b/);
  });

  // Qualified `<plugin>/<ext>` ids now render a single-extension detail
  // (header + Kind / Version / Stability / Description / Preconditions /
  // Entry) instead of the parent plugin's full listing. The reader asked
  // about one extension; the output answers that question.
  it('show with qualified `<plugin>/<ext>` id renders single-extension detail (built-in)', () => {
    const scope = freshScope('show-qualified-builtin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'core/node-superseded'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Header: qualified id + built-in source.
    assert.match(r.stdout, /✓\s+core\/node-superseded\s+built-in/);
    // Field block: Kind is always present.
    assert.match(r.stdout, /Kind\s+analyzer/);
    // Version is intentionally omitted for built-ins (they inherit the
    // CLI version, no per-extension semver is maintained). The field
    // survives in `--json` for tooling consumers, see the JSON-shape
    // test below.
    assert.doesNotMatch(r.stdout, /^\s*Version\s/m);
    // Plugin counter ("24 extensions" / "N extensions") must NOT appear,
    // that's the bare-plugin header signature and would mean we fell
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
    // Extension shape, not a plugin envelope.
    assert.equal(payload.id, 'external-url-counter');
    assert.equal(payload.pluginId, 'core');
    assert.equal(payload.kind, 'extractor');
    assert.equal(typeof payload.version, 'string');
    // The plugin's `extensions` array must NOT be present, that would
    // mean we dumped the whole plugin.
    assert.equal(payload.extensions, undefined);
  });

  it('show with qualified id reflects per-extension disabled state in the glyph', async () => {
    const scope = freshScope('show-qualified-disabled-glyph');
    sm(['init', '--no-scan'], scope);

    // Baseline: enabled → green ✓.
    const before = sm(['plugins', 'show', 'core/node-superseded'], scope);
    assert.equal(before.status, 0, `stderr: ${before.stderr}`);
    assert.match(before.stdout, /✓\s+core\/node-superseded/);

    // Disable the single extension via the qualified id.
    const off = sm(['plugins', 'disable', 'core/node-superseded'], scope);
    assert.equal(off.status, 0, `stderr: ${off.stderr}`);

    // The single-ext header glyph flips to ✕; bare-plugin output would
    // keep `core` itself ✓ and only mark the inner row, this test
    // guards that we render the EXTENSION header, not the plugin.
    const after = sm(['plugins', 'show', 'core/node-superseded'], scope);
    assert.equal(after.status, 0, `stderr: ${after.stderr}`);
    assert.match(after.stdout, /✕\s+core\/node-superseded/);
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

  it('show with bare plugin id still renders the full plugin detail (regression)', () => {
    const scope = freshScope('show-bare-plugin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'core'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Plugin header signature: "N extensions" counter.
    assert.match(r.stdout, /✓\s+core\s+built-in\s+\d+\s+extensions/);
    // Per-extension rows appear (at least one sibling we can spot-check).
    assert.match(r.stdout, /\bnode-superseded\b/);
    assert.match(r.stdout, /\bexternal-url-counter\b/);
  });

  it('show rejects qualified id with unknown extension under known plugin', () => {
    const scope = freshScope('show-qualified-unknown-ext');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'core/no-such-rule'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id not found/);
    assert.match(r.stderr, /'core' does not declare an extension with id 'no-such-rule'/);
  });

  it('show rejects qualified id under unknown plugin', () => {
    const scope = freshScope('show-qualified-unknown-plugin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'no-such/anything'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id references unknown plugin/);
  });

  it('list marks individually-disabled extensions with ✕', async () => {
    const scope = freshScope('list-disabled-ext-marker');
    sm(['init', '--no-scan'], scope);

    // Baseline: every core extension visible without a marker.
    const before = sm(['plugins', 'list'], scope);
    assert.equal(before.status, 0, `stderr: ${before.stderr}`);
    assert.match(before.stdout, /\bnode-superseded\b/);
    assert.doesNotMatch(before.stdout, /✕\s+node-superseded\b/);

    // Disable one core extension by qualified id; siblings stay
    // enabled and the plugin row aggregates ✓ (any child enabled).
    const disable = sm(['plugins', 'disable', 'core/node-superseded'], scope);
    assert.equal(disable.status, 0, `stderr: ${disable.stderr}`);

    // The list now shows the ✕ marker on the disabled name. The
    // plugin row glyph stays ✓ because most of `core` is still on.
    const after = sm(['plugins', 'list'], scope);
    assert.equal(after.status, 0, `stderr: ${after.stderr}`);
    assert.match(after.stdout, /✓\s+core\b/);
    assert.match(after.stdout, /✕\s+node-superseded\b/);
  });
});

