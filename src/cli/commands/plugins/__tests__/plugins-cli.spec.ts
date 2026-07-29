/**
 * `sm plugins enable / disable / trust / untrust` end-to-end through the
 * real binary. Each test isolates HOME and cwd so the host's
 * `~/.skill-map/` is never touched. A helper drops a mock plugin under the
 * project scope's plugin directory so the verbs have something to act on.
 *
 * Two orthogonal axes (post-split): enable persists the per-extension
 * `enabled` to the CONFIG layers (`settings.json` /
 * `settings.local.json`), trust persists a per-plugin row to the
 * `config_plugins` DB store. The enable assertions read the config back
 * via `sm config get`; the trust assertions read the DB row directly.
 */

import { grantTrust, loadTrust } from '../../../../kernel/config/plugin-trust-store.js';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
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

import { SqliteStorageAdapter } from '../../../../kernel/adapters/sqlite/index.js';
import {
  loadContributionsForNode,
  replaceAllScanContributionErrors,
  replaceAllScanContributions,
  type IContributionErrorRecord,
} from '../../../../kernel/adapters/sqlite/contributions.js';
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

/**
 * Options shared by the drop-in fixtures.
 *
 * `trusted` defaults to TRUE because these fixtures model a plugin the
 * operator has already installed and consented to; without the grant
 * the loader refuses to import it (the whole `sm plugins` family honours
 * the import-trust gate since 2026-07-28), so every assertion about
 * loaded extensions would be asserting the gate instead of the verb.
 * The trust lifecycle tests below pass `{ trusted: false }` to exercise
 * the pre-consent state, and `plugins-import-gate.spec.ts` is the
 * dedicated guard for the gate itself.
 */
interface IDropOptions {
  trusted?: boolean;
}

function dropMockPlugin(scope: IScope, id: string, opts: IDropOptions = {}): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  if (opts.trusted !== false) grantTrust(scope.cwd, id);
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
    join(extDir, 'extension.json'),
    JSON.stringify({ version: '0.1.0', description: 'mock' }),
  );
  writeFileSync(
    join(extDir, 'index.js'),
    `export default {
       extract() {},
     };`,
  );
}

/**
 * Drop a Provider plugin under the project scope. The runtime contract
 * is just enough for the loader to accept it (or reject it
 * deterministically when fields are missing).
 */
function dropMockProvider(scope: IScope, id: string, opts: IDropOptions = {}): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  if (opts.trusted !== false) grantTrust(scope.cwd, id);
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
  writeFileSync(join(provDir, 'extension.json'), JSON.stringify({ version: '0.1.0', description: 'fixture extension' }));
  writeFileSync(join(provDir, 'extension.json'), JSON.stringify({ version: '0.1.0', description: 'fixture extension' }));
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

/** Map a qualified `<plugin>/<ext>` (or bare) id to its enable config key. */
function enableConfigKey(id: string): string {
  const slash = id.indexOf('/');
  if (slash < 0) return `plugins.${id}.enabled`;
  return `plugins.${id.slice(0, slash)}.extensions.${id.slice(slash + 1)}.enabled`;
}

/**
 * Read the persisted per-extension `enabled` from the CONFIG layers via
 * `sm config get`. Returns `undefined` when no layer set it (the verb
 * exits 5 "Unknown config key"), mirroring the old `getPluginEnabled`
 * "no override" return so the existing assertions read identically.
 */
function readEnabled(scope: IScope, id: string): boolean | undefined {
  const r = sm(['config', 'get', enableConfigKey(id), '--json'], scope);
  if (r.status !== 0) return undefined;
  return JSON.parse(r.stdout) as boolean;
}

/** Read the per-plugin trust grant. */
function readTrusted(scope: IScope, pluginId: string): boolean {
  // Trust lives in the scope lock, keyed to the checkout, so this is
  // a file read rather than a DB open.
  return loadTrust(scope.cwd).trusted.has(pluginId);
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

    // Config layer reflects disabled (qualified key, the macro path expands).
    assert.equal(readEnabled(scope, 'mock-a/mock-a-extractor'), false);

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

    assert.equal(readEnabled(scope, 'mock-b/mock-b-extractor'), true);

    const list = sm(['plugins', 'list'], scope);
    assert.match(list.stdout, /✓\s+mock-b\b/);
  });

  it('disable cascades over the queue: cancels the disabled extension queued jobs only', async () => {
    // Disable cascade (spec/job-lifecycle.md §Cancellation, user decision
    // 2026-07-21). Seed two queued jobs straight into the scope DB, one
    // for the plugin being disabled and one for another extension; the
    // verb must cancel the first and leave the second queued.
    const scope = freshScope('disable-cascade');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-j');

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const seed = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await seed.init();
    try {
      const base = {
        extensionVersion: '1.0.0',
        extensionKind: 'action' as const,
        contentHash: 'h'.repeat(64),
        nonce: 'n'.repeat(32),
        priority: 0,
        status: 'queued' as const,
        ttlSeconds: 3600,
        createdAt: Date.now(),
      };
      for (const [id, extensionId] of [
        ['casc-1', 'mock-j/mock-j-extractor'],
        ['casc-2', 'core/ai-tagger-action'],
      ] as const) {
        await seed.jobs.submit(
          { ...base, id, extensionId, nodeId: `${id}.md` },
          { contentHash: base.contentHash, content: `RENDERED ${id}`, createdAt: base.createdAt },
        );
      }
    } finally {
      await seed.close();
    }

    const r = sm(['plugins', 'disable', 'mock-j'], scope);
    assert.equal(r.status, 0, r.stderr);

    const check = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await check.init();
    try {
      assert.equal((await check.jobs.get('casc-1'))?.status, 'cancelled', 'disabled ext cancelled');
      assert.equal((await check.jobs.get('casc-2'))?.status, 'queued', 'other ext untouched');
    } finally {
      await check.close();
    }

    // The cascade appended the aggregated ops-log line.
    const opsLog = readFileSync(join(scope.cwd, '.skill-map', 'operations.log'), 'utf8');
    assert.match(opsLog, /"op":"jobs\.cancel"/);
    assert.match(opsLog, /extension-disabled cancelled=1/);
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
    // Built-in counts (per the current catalog): claude=4, antigravity=1,
    // codex=1, agent-skills=1, core=26. User mocks: mock-c=1, mock-d=1.
    // Total = 4+1+1+1+26+1+1 = 35 extensions cascaded.
    assert.match(r.stdout, /disabled: \d+ extension\(s\)/);
    assert.match(r.stdout, /- claude\/at-directive/);
    assert.match(r.stdout, /- core\/markdown-link/);
    assert.match(r.stdout, /- mock-c\/mock-c-extractor/);
    assert.match(r.stdout, /- mock-d\/mock-d-extractor/);

    assert.equal(readEnabled(scope, 'mock-c/mock-c-extractor'), false);
    assert.equal(readEnabled(scope, 'mock-d/mock-d-extractor'), false);
    assert.equal(readEnabled(scope, 'claude/at-directive'), false);
    assert.equal(readEnabled(scope, 'core/markdown-link'), false);
    // Bare plugin ids are NEVER persisted, the cascade always expands to
    // the per-extension config keys.
    assert.equal(readEnabled(scope, 'claude'), undefined);
    assert.equal(readEnabled(scope, 'core'), undefined);
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

  it('settings.local.json (--local) overrides the committed settings.json baseline', async () => {
    const scope = freshScope('precedence');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-f');
    // The team-shared settings.json disables the extension; a per-checkout
    // `--local` enable (settings.local.json) flips it back on. Resolution
    // is layered (project-local over project), so the local override wins.
    sm(['plugins', 'disable', 'mock-f'], scope); // writes settings.json
    sm(['plugins', 'enable', 'mock-f', '--local'], scope); // writes settings.local.json

    // The merged config reads the local override as the effective value.
    assert.equal(readEnabled(scope, 'mock-f/mock-f-extractor'), true);

    const list = sm(['plugins', 'list'], scope);
    assert.equal(list.status, 0);
    // Effective enabled → status enabled (aggregate over the single child)
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

    assert.equal(readEnabled(scope, 'mock-many-a/mock-many-a-extractor'), false);
    assert.equal(readEnabled(scope, 'mock-many-b/mock-many-b-extractor'), false);
    assert.equal(readEnabled(scope, 'mock-many-c/mock-many-c-extractor'), false);
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

    assert.equal(readEnabled(scope, 'mock-en-a/mock-en-a-extractor'), true);
    assert.equal(readEnabled(scope, 'mock-en-b/mock-en-b-extractor'), true);
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
    // the first bad entry, before the persist phase. `readEnabled`
    // returns `undefined` when no config override exists (the plugin is
    // enabled by default via discovery).
    assert.equal(readEnabled(scope, 'mock-batch-a/mock-batch-a-extractor'), undefined);
    assert.equal(readEnabled(scope, 'mock-batch-b/mock-batch-b-extractor'), undefined);
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

// Pair toggle (spec/plugin-author-guide.md §Paired extensions): a fixer
// Action and the analyzer(s) in its `precondition.analyzerIds` move as a
// unit. Enable is symmetric and eager; disable is reference-counted over
// the direct edges. Companions surface as informational stderr lines and
// ride every downstream side effect (config write, purge, job cancel).
describe('sm plugins enable / disable, pair toggle', () => {
  it('disabling a finder also disables its paired fixer', () => {
    const scope = freshScope('pair-disable-finder');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/ai-verbosity-analyzer'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Informational pair line on stderr, naming the companion + the via key.
    assert.match(r.stderr, /pair toggle: 1 paired extension\(s\) also disabled/);
    assert.match(r.stderr, /core\/ai-verbosity-action \(paired with core\/ai-verbosity-analyzer\)/);
    // The applied receipt covers BOTH keys (companion inside `keys`).
    assert.match(r.stdout, /disabled: 2 extension\(s\)/);

    assert.equal(readEnabled(scope, 'core/ai-verbosity-analyzer'), false);
    assert.equal(readEnabled(scope, 'core/ai-verbosity-action'), false);
  });

  it('enabling a fixer re-enables its paired finder', () => {
    const scope = freshScope('pair-enable-fixer');
    sm(['init', '--no-scan'], scope);
    sm(['plugins', 'disable', 'core/ai-verbosity-analyzer'], scope); // pulls both off

    const r = sm(['plugins', 'enable', 'core/ai-verbosity-action'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /pair toggle: 1 paired extension\(s\) also enabled/);
    assert.match(r.stderr, /core\/ai-verbosity-analyzer \(paired with core\/ai-verbosity-action\)/);

    assert.equal(readEnabled(scope, 'core/ai-verbosity-analyzer'), true);
    assert.equal(readEnabled(scope, 'core/ai-verbosity-action'), true);
  });

  it('disabling a fixer also disables its finder (mirrored refcount)', () => {
    const scope = freshScope('pair-disable-fixer');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/ai-verbosity-action'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /core\/ai-verbosity-analyzer \(paired with core\/ai-verbosity-action\)/);

    assert.equal(readEnabled(scope, 'core/ai-verbosity-analyzer'), false);
    assert.equal(readEnabled(scope, 'core/ai-verbosity-action'), false);
  });

  it('deterministic pairs participate: disabling name-mismatch pulls ai-name-action', () => {
    // Uniform cascade (user decision 2026-07-22): edges to deterministic
    // analyzers behave exactly like probabilistic finder edges.
    const scope = freshScope('pair-deterministic');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/name-mismatch'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(readEnabled(scope, 'core/name-mismatch'), false);
    assert.equal(readEnabled(scope, 'core/ai-name-action'), false);
  });

  it('companion disable cancels the companion queued jobs too', async () => {
    const scope = freshScope('pair-job-cancel');
    sm(['init', '--no-scan'], scope);

    // Seed a queued job for the FIXER only; disabling the FINDER must
    // cascade the disable to the fixer and cancel the fixer's job.
    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const seed = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await seed.init();
    try {
      await seed.jobs.submit(
        {
          id: 'pair-1',
          extensionId: 'core/ai-verbosity-action',
          extensionVersion: '1.0.0',
          extensionKind: 'action',
          nodeId: 'pair-1.md',
          contentHash: 'h'.repeat(64),
          nonce: 'n'.repeat(32),
          priority: 0,
          status: 'queued',
          ttlSeconds: 3600,
          createdAt: Date.now(),
        },
        { contentHash: 'h'.repeat(64), content: 'RENDERED pair-1', createdAt: Date.now() },
      );
    } finally {
      await seed.close();
    }

    const r = sm(['plugins', 'disable', 'core/ai-verbosity-analyzer'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const check = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await check.init();
    try {
      assert.equal((await check.jobs.get('pair-1'))?.status, 'cancelled');
    } finally {
      await check.close();
    }
    const opsLog = readFileSync(join(scope.cwd, '.skill-map', 'operations.log'), 'utf8');
    assert.match(opsLog, /extension-disabled cancelled=1/);
  });

  it('--local carries the companion into settings.local.json', () => {
    const scope = freshScope('pair-local');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/ai-trigger-analyzer', '--local'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const local = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.local.json'), 'utf8'),
    ) as { plugins?: { core?: { extensions?: Record<string, { enabled?: boolean }> } } };
    assert.equal(local.plugins?.core?.extensions?.['ai-trigger-analyzer']?.enabled, false);
    assert.equal(local.plugins?.core?.extensions?.['ai-trigger-action']?.enabled, false);
  });

  it('bare-id macro emits no pair lines (companions already in the set)', () => {
    const scope = freshScope('pair-macro-silent');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core', '--yes'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(/pair toggle:/.test(r.stderr), false);
  });
});

// Trust is the SECURITY axis, orthogonal to enable. `sm plugins trust /
// untrust` write a per-plugin row to the `config_plugins` DB store
// (bare plugin id) and never touch the config-layer enable state. A
// project-local plugin runs only when it is BOTH enabled and trusted.
describe('sm plugins trust / untrust', () => {
  it('trust grants a per-plugin DB row; enable state in config is untouched', async () => {
    const scope = freshScope('trust-grant');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-trust', { trusted: false });

    const r = sm(['plugins', 'trust', 'mock-trust'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /trusted: mock-trust/);

    // DB trust row written; enable config untouched (no override).
    assert.equal(readTrusted(scope, 'mock-trust'), true);
    assert.equal(readEnabled(scope, 'mock-trust/mock-trust-extractor'), undefined);
  });

  it('untrust clears the trust row; enable state unchanged', async () => {
    const scope = freshScope('untrust-clear');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-untrust', { trusted: false });
    sm(['plugins', 'trust', 'mock-untrust'], scope);
    assert.equal(readTrusted(scope, 'mock-untrust'), true);

    const r = sm(['plugins', 'untrust', 'mock-untrust'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /untrusted: mock-untrust/);
    assert.equal(readTrusted(scope, 'mock-untrust'), false);
  });

  it('trust collapses a qualified <plugin>/<ext> id to its bare plugin', async () => {
    const scope = freshScope('trust-qualified');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-tq', { trusted: false });

    const r = sm(['plugins', 'trust', 'mock-tq/mock-tq-extractor'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /trusted: mock-tq/);
    assert.equal(readTrusted(scope, 'mock-tq'), true);
  });

  it('trust --all grants every discovered drop-in plugin (not built-ins)', async () => {
    const scope = freshScope('trust-all');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-all-a', { trusted: false });
    dropMockPlugin(scope, 'mock-all-b', { trusted: false });

    // `--all` now confirms; a non-TTY caller must opt in explicitly.
    const r = sm(['plugins', 'trust', '--all', '--yes'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(readTrusted(scope, 'mock-all-a'), true);
    assert.equal(readTrusted(scope, 'mock-all-b'), true);
    // Built-ins are never trust-gated, so they get no row.
    assert.equal(readTrusted(scope, 'core'), false);
    assert.equal(readTrusted(scope, 'claude'), false);
  });

  it('trust --all lists the ids and grants nothing without confirmation', () => {
    // `--all` is the reach for anyone who just wants the untrusted
    // advisory to stop, which is exactly when a hostile repo's plugin
    // would ride along. The operator has to see the names first.
    const scope = freshScope('trust-all-confirm');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-confirm-a', { trusted: false });
    dropMockPlugin(scope, 'mock-confirm-b', { trusted: false });

    const r = sm(['plugins', 'trust', '--all'], scope);
    assert.match(r.stderr, /About to grant import trust to 2 project-local plugin/);
    assert.match(r.stderr, /mock-confirm-a/);
    assert.equal(readTrusted(scope, 'mock-confirm-a'), false, 'nothing granted without a yes');
    assert.equal(readTrusted(scope, 'mock-confirm-b'), false);
  });

  it('trust rejects a built-in id (never trust-gated) with exit 5', async () => {
    const scope = freshScope('trust-builtin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'trust', 'core'], scope);
    assert.equal(r.status, 5, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /built-in \(or host-locked\) and is never import-trust-gated/);
    assert.equal(readTrusted(scope, 'core'), false);
  });

  it('trust on an unknown plugin id exits 5', () => {
    const scope = freshScope('trust-unknown');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'trust', 'no-such-plugin'], scope);
    assert.equal(r.status, 5, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /Plugin not found/);
  });

  it('exit 2 when both <id> and --all are passed to trust', () => {
    const scope = freshScope('trust-both');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-tb', { trusted: false });

    const r = sm(['plugins', 'trust', 'mock-tb', '--all'], scope);
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /not both/);
  });

  it('sm plugins list still surfaces an enabled-but-untrusted plugin', () => {
    // The list resolver passes only `resolveEnabled` (no import-trust
    // gate), so an untrusted drop-in is still enumerated rather than
    // hidden, the operator can see what is waiting for a trust grant.
    const scope = freshScope('trust-list-surface');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-untrusted-list', { trusted: false });

    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /mock-untrusted-list\b.*user/);
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
    assert.match(r.stdout, /- claude\/tools-counter/);

    // Every child extension flipped; the bare plugin id is never
    // persisted (the macro path always expands to qualified config keys).
    assert.equal(readEnabled(scope, 'claude/claude'), false);
    assert.equal(readEnabled(scope, 'claude/at-directive'), false);
    assert.equal(readEnabled(scope, 'claude/tools-counter'), false);
    assert.equal(readEnabled(scope, 'claude'), undefined);
  });

  it('disable claude/at-directive (qualified id) flips just that extension, no prompt', async () => {
    const scope = freshScope('macro-claude-qualified');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'claude/at-directive'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: claude\/at-directive/);

    assert.equal(readEnabled(scope, 'claude/at-directive'), false);
    // Sibling extensions untouched.
    assert.equal(readEnabled(scope, 'claude/claude'), undefined);
    assert.equal(readEnabled(scope, 'claude/tools-counter'), undefined);
  });

  it('disable core (multi-extension built-in) requires --yes', () => {
    const scope = freshScope('macro-core-no-yes');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core'], scope);
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /Refusing to disable multiple extensions/);
  });

  it('disable core/name-collision (qualified id) flips just that analyzer', async () => {
    const scope = freshScope('macro-core-qualified');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/name-collision'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: core\/name-collision/);

    assert.equal(readEnabled(scope, 'core/name-collision'), false);
    // Other core extensions and the claude plugin untouched.
    assert.equal(readEnabled(scope, 'claude'), undefined);
    assert.equal(readEnabled(scope, 'core/reference-broken'), undefined);
  });

  it('(i) sm plugins list shows every plugin + user plugin', () => {
    const scope = freshScope('granularity-list');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-list');

    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // The index renders one row per plugin (built-in or user) with the
    // `built-in` / `user` source label. The per-extension breakdown moved
    // to `sm plugins list <id>`, so the index no longer prints names.
    assert.match(r.stdout, /✓\s+claude\b.*built-in/);
    assert.match(r.stdout, /✓\s+core\b.*built-in/);
    // User plugin row carries `user` instead of `built-in`.
    assert.match(r.stdout, /✓\s+mock-list\b.*user/);
    // Names no longer appear in the index, they live in `list <id>`.
    assert.doesNotMatch(r.stdout, /\breference-broken\b/);
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
    // Disabled is intentional, never an error: exit stays 0. The count
    // is 4: the disabled `mock-h` drop-in (all five optimization pairs,
    // `core/ai-frontmatter-action`, and the two security finders have
    // all graduated stable/enabled) plus the three built-in
    // extensions that ship disabled by default: the sidecar writers
    // `core/node-bump` and `core/node-set-stability` (both STABLE with
    // `defaultEnabled: false` since 2026-07-21, the orthogonal opt-in
    // axis) and the declared-network provenance verifier
    // `github/enrichment` (experimental). The `core/auto-fix` hook was
    // REMOVED the same day (redundant with the per-job flag) and the
    // universal summarizer `core/ai-summarizer-action` graduated to
    // stable / enabled (its header affordance landed), so neither
    // counts here. The drift analyzer
    // `core/annotation-stale` graduated to stable (2026-07-19) and now
    // ships enabled, so it no longer counts here (its writer `core/node-bump`
    // stays experimental, the pair is no longer gated as a unit), joining
    // the deterministic-analyzer fixer `core/ai-reference-action`, the
    // three probabilistic finders (`core/ai-redundancy-analyzer` /
    // `core/ai-contradiction-analyzer` / `core/ai-incoherence-analyzer`)
    // and the three finder-paired fixers (`core/ai-redundancy-action` /
    // `core/ai-contradiction-action` / `core/ai-incoherence-action`) that
    // graduated earlier. (`core/mcp-tools` is now beta and ships enabled,
    // so it no longer counts here; `antigravity/antigravity` and
    // `codex/codex` are beta and `agent-skills/agent-skills` is stable +
    // locked, so all ship enabled.)
    assert.match(r.stdout, /disabled\s+4/);
  });
});

// "off-shape visible" follow-up. The doctor reads the last scan's
// persisted `scan_contribution_errors` rows, renders a "Runtime
// contribution errors (last scan)" section, promotes the exit code to 1
// when any exist, and carries them in the `--json` envelope.
describe('sm plugins doctor, runtime contribution errors (last scan)', () => {
  /**
   * Seed `scan_contribution_errors` against the project DB the doctor
   * resolves (`<cwd>/.skill-map/skill-map.db`). Mirrors the
   * round-trip seeding in `view-contributions.spec.ts`, the replace-all
   * writer inside the same transaction the adapter exposes.
   */
  async function seedContribErrors(
    scope: IScope,
    records: IContributionErrorRecord[],
  ): Promise<void> {
    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.db.transaction().execute(async (trx) => {
        await replaceAllScanContributionErrors(trx, records);
      });
    } finally {
      await adapter.close();
    }
  }

  it('renders the section, exits 1, and lists a sample message (human mode)', async () => {
    const scope = freshScope('doctor-contrib-errors');
    sm(['init', '--no-scan'], scope);
    await seedContribErrors(scope, [
      {
        pluginId: 'mock-bad',
        extensionId: 'mock-bad-extractor',
        nodePath: 'a.md',
        reason: 'must have required property `value`',
        message: 'Extractor "mock-bad/mock-bad-extractor" emitted contribution "count" on a.md; payload failed the schema.',
        contributionId: 'count',
        slot: 'card.footer.right',
        emittedAt: 1000,
      },
      {
        pluginId: 'mock-bad',
        extensionId: 'mock-bad-extractor',
        nodePath: 'b.md',
        reason: 'undeclared-contribution-ref',
        message: 'Extension "mock-bad/mock-bad-extractor" emitted a view contribution on b.md whose object is not declared.',
        emittedAt: 2000,
      },
    ]);

    const r = sm(['plugins', 'doctor'], scope);
    // Any persisted runtime contribution error promotes the exit code.
    assert.equal(r.status, 1, `stderr: ${r.stderr}`);
    // The gated section header (with the total count) appears.
    assert.match(r.stdout, /Runtime contribution errors \(last scan\) \(2\)/);
    // The per-plugin group entry carries the plugin id + its error count.
    assert.match(r.stdout, /mock-bad\s+\(2\)/);
    // At least one sample message line is rendered.
    assert.match(r.stdout, /payload failed the schema/);
  });

  it('carries every error in the --json envelope and exits 1', async () => {
    const scope = freshScope('doctor-contrib-errors-json');
    sm(['init', '--no-scan'], scope);
    await seedContribErrors(scope, [
      {
        pluginId: 'mock-bad',
        extensionId: 'mock-bad-extractor',
        nodePath: 'a.md',
        reason: 'must have required property `value`',
        message: 'payload failed the schema',
        contributionId: 'count',
        slot: 'card.footer.right',
        emittedAt: 1000,
      },
    ]);

    const r = sm(['plugins', 'doctor', '--json'], scope);
    assert.equal(r.status, 1, `stderr: ${r.stderr}`);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.kind, 'plugins.doctor');
    assert.ok(Array.isArray(payload.contributionErrors), 'contributionErrors is an array');
    assert.equal(payload.contributionErrors.length, 1);
    const err = payload.contributionErrors[0];
    assert.equal(err.pluginId, 'mock-bad');
    assert.equal(err.extensionId, 'mock-bad-extractor');
    assert.equal(err.nodePath, 'a.md');
    assert.equal(err.contributionId, 'count');
    assert.equal(err.slot, 'card.footer.right');
    assert.equal(err.reason, 'must have required property `value`');
  });

  it('cold start: no rows means no section and exit 0', () => {
    const scope = freshScope('doctor-contrib-errors-cold');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'doctor'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /Runtime contribution errors/);

    // The --json envelope still carries the (empty) array.
    const json = sm(['plugins', 'doctor', '--json'], scope);
    assert.equal(json.status, 0, `stderr: ${json.stderr}`);
    const payload = JSON.parse(json.stdout);
    assert.deepEqual(payload.contributionErrors, []);
  });
});

// `sm plugins list <id>` renders a plugin's extensions as qualified
// `<plugin>/<ext>` rows (kind / version / per-extension glyph) so the id
// pastes straight into enable/disable/show. `sm plugins show
// <plugin>/<ext>` renders one extension's detail block. The top-level
// index (`sm plugins list`) carries no per-extension names; they live one
// level down in `list <id>`.
describe('sm plugins list <id> + show <plugin>/<ext>, extension detail', () => {
  it('list <id> resolves on the plugin id and lists every extension by name', () => {
    const scope = freshScope('list-plugin-detail');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-q');

    const r = sm(['plugins', 'list', 'mock-q'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Header line: `  ✓  mock-q   v0.1.0   user   1 extension`.
    assert.match(r.stdout, /✓\s+mock-q\s+v/);
    // Extension row uses qualified name + version: `extractor  mock-q/mock-q-extractor  v…`.
    assert.match(r.stdout, /extractor\s+mock-q\/mock-q-extractor\s+v/);
  });

  it('list <id> surfaces every loaded extension name under its plugin', () => {
    const scope = freshScope('list-plugin-extensions');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-l');

    const r = sm(['plugins', 'list', 'mock-l'], scope);
    assert.equal(r.status, 0);
    // The extension renders qualified (`<plugin>/<ext>`) in the detail
    // block so the id pastes straight into enable/disable/show.
    assert.match(r.stdout, /\bmock-l\/mock-l-extractor\b/);
  });

  // Qualified `<plugin>/<ext>` ids now render a single-extension detail
  // (header + Kind / Version / Stability / Description / Preconditions /
  // Entry) instead of the parent plugin's full listing. The reader asked
  // about one extension; the output answers that question.
  it('show with qualified `<plugin>/<ext>` id renders single-extension detail (built-in)', () => {
    const scope = freshScope('show-qualified-builtin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'show', 'core/reference-broken'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Header: qualified id + built-in source. (`core/reference-broken`
    // is a stable analyzer, enabled by default, used here as a generic
    // built-in example since the supersession family is experimental.)
    assert.match(r.stdout, /✓\s+core\/reference-broken\s+built-in/);
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

    // Baseline: enabled → green ✓. (`core/reference-broken` is a stable
    // analyzer, enabled by default; the supersession family is now
    // experimental so it can't be the enabled baseline anymore.)
    const before = sm(['plugins', 'show', 'core/reference-broken'], scope);
    assert.equal(before.status, 0, `stderr: ${before.stderr}`);
    assert.match(before.stdout, /✓\s+core\/reference-broken/);

    // Disable the single extension via the qualified id.
    const off = sm(['plugins', 'disable', 'core/reference-broken'], scope);
    assert.equal(off.status, 0, `stderr: ${off.stderr}`);

    // The single-ext header glyph flips to ✕; bare-plugin output would
    // keep `core` itself ✓ and only mark the inner row, this test
    // guards that we render the EXTENSION header, not the plugin.
    const after = sm(['plugins', 'show', 'core/reference-broken'], scope);
    assert.equal(after.status, 0, `stderr: ${after.stderr}`);
    assert.match(after.stdout, /✕\s+core\/reference-broken/);
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

  it('show with a bare plugin id is rejected with a redirect to list', () => {
    const scope = freshScope('show-bare-plugin');
    sm(['init', '--no-scan'], scope);

    // `show` is extension-only; a bare plugin id is the wrong
    // granularity, the verb redirects to `sm plugins list <id>`.
    const r = sm(['plugins', 'show', 'core'], scope);
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /needs a qualified/);
    assert.match(r.stderr, /sm plugins list core/);
  });

  it('list <id> renders the full plugin detail', () => {
    const scope = freshScope('list-bare-plugin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'list', 'core'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Plugin header signature: "N extensions" counter.
    assert.match(r.stdout, /✓\s+core\s+built-in\s+\d+\s+extensions/);
    // Per-extension rows appear (at least one sibling we can spot-check).
    assert.match(r.stdout, /\breference-broken\b/);
    assert.match(r.stdout, /\bexternal-url-counter\b/);
  });

  it('list rejects a qualified <plugin>/<ext> id with a redirect to show', () => {
    const scope = freshScope('list-qualified-redirect');
    sm(['init', '--no-scan'], scope);

    // `list` is plugin-level; a qualified id targets one extension, so the
    // verb redirects to `sm plugins show`. The id shape alone decides.
    const r = sm(['plugins', 'list', 'core/reference-broken'], scope);
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /takes a plugin id, not a qualified/);
    assert.match(r.stderr, /sm plugins show core\/reference-broken/);
  });

  it('list <id> on an unknown plugin id exits NotFound', () => {
    const scope = freshScope('list-unknown-plugin');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'list', 'no-such-plugin'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Plugin not found: no-such-plugin/);
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

  it('list <id> marks individually-disabled extensions with ✕', () => {
    const scope = freshScope('list-disabled-ext-marker');
    sm(['init', '--no-scan'], scope);

    // Baseline: a stable core extension shows ✓ on its detail row.
    // (`reference-broken` is enabled by default; the supersession family
    // is experimental so it already shows ✕ and can't be the baseline.)
    const before = sm(['plugins', 'list', 'core'], scope);
    assert.equal(before.status, 0, `stderr: ${before.stderr}`);
    assert.match(before.stdout, /✓\s+analyzer\s+core\/reference-broken\b/);

    // Disable one core extension by qualified id; siblings stay
    // enabled and the plugin header aggregates ✓ (any child enabled).
    const disable = sm(['plugins', 'disable', 'core/reference-broken'], scope);
    assert.equal(disable.status, 0, `stderr: ${disable.stderr}`);

    // The detail now shows the ✕ marker on the disabled row. The plugin
    // header glyph stays ✓ because most of `core` is still on.
    const after = sm(['plugins', 'list', 'core'], scope);
    assert.equal(after.status, 0, `stderr: ${after.stderr}`);
    assert.match(after.stdout, /✓\s+core\s+built-in/);
    assert.match(after.stdout, /✕\s+analyzer\s+core\/reference-broken\b/);
  });
});



// `sm plugins show <plugin>/<ext>` for PROBABILISTIC extensions renders
// the two contract files (spec/cli-contract.md, the show row): a `Prompt`
// section with the verbatim template and a `Report schema` section with
// the pretty-printed report schema; `--json` carries the raw
// `promptTemplate` / `reportSchema` fields. Deterministic extensions are
// byte-identical to the pre-feature shape (no sections, no fields).
describe('sm plugins show, probabilistic contract sections', () => {
  const FINDER_FIXTURE = resolve(
    HERE,
    '..',
    '..',
    '__tests__',
    'fixtures',
    'prob-finder',
  );

  /**
   * Copy the prob-finder fixture into the scope's plugins dir and grant
   * it trust, the same "installed and consented to" precondition
   * `dropMockPlugin` models. `sm plugins show` reads per-extension
   * fields that live in the module, so it needs the import the gate
   * would otherwise deny.
   */
  function dropFinderFixture(scope: IScope): string {
    const dest = join(scope.cwd, '.skill-map', 'plugins', 'prob-finder');
    cpSync(FINDER_FIXTURE, dest, { recursive: true });
    grantTrust(scope.cwd, 'prob-finder');
    return dest;
  }

  it('on-disk probabilistic analyzer: Prompt + Report schema sections in human mode', () => {
    const scope = freshScope('show-prob-finder');
    sm(['init', '--no-scan'], scope);
    dropFinderFixture(scope);

    const r = sm(['plugins', 'show', 'prob-finder/quality-check'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /^  Prompt$/m, 'Prompt section heading');
    assert.match(r.stdout, /Judge the quality of the skill below\./, 'template verbatim');
    assert.match(r.stdout, /^  Report schema$/m, 'Report schema section heading');
    assert.match(
      r.stdout,
      /findings\/report\.schema\.json/,
      'pretty-printed schema carries the findings envelope $ref',
    );
  });

  it('on-disk probabilistic analyzer: --json gains raw promptTemplate + reportSchema', () => {
    const scope = freshScope('show-prob-finder-json');
    sm(['init', '--no-scan'], scope);
    const dest = dropFinderFixture(scope);

    const r = sm(['plugins', 'show', 'prob-finder/quality-check', '--json'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const payload = JSON.parse(r.stdout);
    assert.equal(
      payload.promptTemplate,
      readFileSync(join(dest, 'analyzers', 'quality-check', 'prompt.md'), 'utf8'),
      'raw prompt bytes on the machine surface',
    );
    assert.equal(
      payload.reportSchema.allOf[0].$ref,
      'https://skill-map.ai/spec/v0/findings/report.schema.json',
      'reportSchema rides as an object',
    );
  });

  it('built-in probabilistic action (ai-summarizer-action): sections + json fields', () => {
    const scope = freshScope('show-prob-builtin');
    sm(['init', '--no-scan'], scope);

    const human = sm(['plugins', 'show', 'core/ai-summarizer-action'], scope);
    assert.equal(human.status, 0, `stderr: ${human.stderr}`);
    assert.match(human.stdout, /^  Prompt$/m);
    assert.match(human.stdout, /\{\{userContent\}\}/, 'template placeholder verbatim');
    assert.match(human.stdout, /^  Report schema$/m);

    const json = sm(['plugins', 'show', 'core/ai-summarizer-action', '--json'], scope);
    assert.equal(json.status, 0, `stderr: ${json.stderr}`);
    const payload = JSON.parse(json.stdout);
    assert.equal(typeof payload.promptTemplate, 'string');
    assert.ok(payload.promptTemplate.includes('{{userContent}}'));
    assert.ok(
      JSON.stringify(payload.reportSchema).includes(
        'https://skill-map.ai/spec/v0/summaries/markdown.schema.json',
      ),
      'built-in reportSchema extends the summaries envelope',
    );
  });

  it('deterministic extension: no sections, no json fields (unchanged output)', () => {
    const scope = freshScope('show-deterministic');
    sm(['init', '--no-scan'], scope);

    const human = sm(['plugins', 'show', 'core/link-counter'], scope);
    assert.equal(human.status, 0, `stderr: ${human.stderr}`);
    assert.doesNotMatch(human.stdout, /^  Prompt$/m);
    assert.doesNotMatch(human.stdout, /^  Report schema$/m);

    const json = sm(['plugins', 'show', 'core/link-counter', '--json'], scope);
    assert.equal(json.status, 0, `stderr: ${json.stderr}`);
    const payload = JSON.parse(json.stdout);
    assert.equal('promptTemplate' in payload, false);
    assert.equal('reportSchema' in payload, false);
  });

  it('ANSI-hostile prompt content is sanitized in human mode but raw in --json', () => {
    const scope = freshScope('show-hostile-prompt');
    sm(['init', '--no-scan'], scope);
    const dest = dropFinderFixture(scope);
    // A hostile template trying to clear the screen + fake a prompt.
    const hostile = 'Judge this.\n\n\u001b[2J\u001b[1;1Hpwned> {{userContent}}\n';
    writeFileSync(join(dest, 'analyzers', 'quality-check', 'prompt.md'), hostile);

    const human = sm(['plugins', 'show', 'prob-finder/quality-check'], scope);
    assert.equal(human.status, 0, `stderr: ${human.stderr}`);
    assert.ok(human.stdout.includes('pwned>'), 'text content survives');
    assert.equal(
      human.stdout.includes('\u001b['),
      false,
      'escape sequences stripped at render',
    );

    const json = sm(['plugins', 'show', 'prob-finder/quality-check', '--json'], scope);
    assert.equal(json.status, 0, `stderr: ${json.stderr}`);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.promptTemplate, hostile, 'machine surface stays raw');
  });
});
