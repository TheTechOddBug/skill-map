/**
 * Step 6.2, Layered config loader. Asserts the four-layer precedence
 * (defaults → project → project-local → overrides), deep-merge
 * semantics, sources tracking, JSON / schema resilience, and
 * strict-mode escalation.
 *
 * Post the no-`$HOME`-reads cleanup (per `spec/cli-contract.md` §Scope
 * is always project-local), the historical `user` /  `user-local`
 * layers are gone; the loader only walks `<cwd>/.skill-map/settings.json`
 * and `<cwd>/.skill-map/settings.local.json`.
 */

import { grantLocalKey } from '../local-key-grants.js';
import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual, ok, throws, match } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../loader.js';

let root: string;
let counter = 0;

function freshScope(label: string): { cwd: string } {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  const cwd = join(dir, 'cwd');
  mkdirSync(cwd, { recursive: true });
  return { cwd };
}

function writeSettings(scopeRoot: string, kind: 'settings' | 'settings.local', body: unknown): void {
  const dir = join(scopeRoot, '.skill-map');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${kind}.json`), JSON.stringify(body));
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-config-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('config loader, defaults', () => {
  it('applies defaults when no files exist', () => {
    const { cwd } = freshScope('defaults');
    const { effective, sources, warnings } = loadConfig({ cwd });

    strictEqual(warnings.length, 0);
    strictEqual(effective.schemaVersion, 1);
    strictEqual(effective.allowSidecarWriters, true);
    strictEqual(effective.tokenizer, 'cl100k_base');
    strictEqual(effective.scan.tokenize, true);
    strictEqual(effective.scan.maxFileSizeBytes, 1048576);
    strictEqual(effective.jobs.ttlSeconds, undefined, 'no default TTL policy (opt-in, Decision #139)');
    strictEqual(effective.jobs.claimWaitSeconds, 2, 'default poll cadence for a blocking claim --wait');
    strictEqual(effective.jobs.retention.completed, 2592000);
    strictEqual(effective.jobs.retention.failed, null);

    // Every key tracked back to defaults.
    strictEqual(sources.get('tokenizer'), 'defaults');
    strictEqual(sources.get('scan.tokenize'), 'defaults');
    strictEqual(sources.get('jobs.claimWaitSeconds'), 'defaults');
    strictEqual(sources.get('jobs.retention.completed'), 'defaults');
    strictEqual(sources.get('jobs.retention.failed'), 'defaults');
  });
});

describe('config loader, layer precedence', () => {
  // `tokenizer` is a closed enum (cl100k_base / o200k_base), so these
  // precedence cases use real enum members; the default is cl100k_base,
  // so o200k_base is the visible "override" value.
  it('project overrides defaults', () => {
    const { cwd } = freshScope('project');
    writeSettings(cwd, 'settings', { tokenizer: 'o200k_base' });
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'o200k_base');
    strictEqual(sources.get('tokenizer'), 'project');
    strictEqual(sources.get('scan.tokenize'), 'defaults');
  });

  it('project jobs.claimWaitSeconds overrides the default poll cadence', () => {
    const { cwd } = freshScope('claim-wait');
    writeSettings(cwd, 'settings', { jobs: { claimWaitSeconds: 15 } });
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.jobs.claimWaitSeconds, 15, 'the operator default wins over the shipped 2');
    strictEqual(sources.get('jobs.claimWaitSeconds'), 'project');
    // Sibling defaults survive the partial jobs object (deep merge).
    strictEqual(effective.jobs.retention.completed, 2592000);
  });

  it('project-local overrides project', () => {
    const { cwd } = freshScope('project-local');
    writeSettings(cwd, 'settings', { tokenizer: 'cl100k_base' });
    writeSettings(cwd, 'settings.local', { tokenizer: 'o200k_base' });
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'o200k_base');
    strictEqual(sources.get('tokenizer'), 'project-local');
  });

  it('overrides layer wins over every file layer', () => {
    const { cwd } = freshScope('override');
    writeSettings(cwd, 'settings.local', { tokenizer: 'cl100k_base' });
    const { effective, sources } = loadConfig({
      cwd,
      overrides: { tokenizer: 'o200k_base' },
    });
    strictEqual(effective.tokenizer, 'o200k_base');
    strictEqual(sources.get('tokenizer'), 'override');
  });
});

describe('config loader, deep merge semantics', () => {
  it('merges nested objects per key', () => {
    const { cwd } = freshScope('deep-merge');
    writeSettings(cwd, 'settings', { scan: { tokenize: false } });
    writeSettings(cwd, 'settings.local', { scan: { strict: true } });
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.scan.tokenize, false);  // from project
    strictEqual(effective.scan.strict, true);     // from project-local
    strictEqual(effective.scan.maxFileSizeBytes, 1048576); // from defaults
    strictEqual(sources.get('scan.tokenize'), 'project');
    strictEqual(sources.get('scan.strict'), 'project-local');
    strictEqual(sources.get('scan.maxFileSizeBytes'), 'defaults');
  });

  it('replaces arrays whole-cloth (no element-wise merge)', () => {
    const { cwd } = freshScope('arrays');
    writeSettings(cwd, 'settings', { ignore: ['a', 'b'] });
    writeSettings(cwd, 'settings.local', { ignore: ['c'] });
    const { effective } = loadConfig({ cwd });
    deepStrictEqual(effective.ignore, ['c']);
  });

  it('preserves null values (e.g. retention.failed)', () => {
    const { cwd } = freshScope('null-preserve');
    writeSettings(cwd, 'settings', { jobs: { retention: { completed: 1000 } } });
    const { effective } = loadConfig({ cwd });
    strictEqual(effective.jobs.retention.completed, 1000);
    strictEqual(effective.jobs.retention.failed, null);
    strictEqual(effective.jobs.retention.cancelled, 2592000, 'cancelled default mirrors completed (30d)');
  });
});

describe('config loader, resilience', () => {
  it('warns + skips on malformed JSON', () => {
    const { cwd } = freshScope('malformed');
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    writeFileSync(join(cwd, '.skill-map', 'settings.json'), '{ this is not json');
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'cl100k_base'); // defaults applied
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /invalid JSON/);
    match(warnings[0]!, /\[config:project\]/);
  });

  it('strips unknown keys (additionalProperties: false)', () => {
    const { cwd } = freshScope('unknown-key');
    writeSettings(cwd, 'settings', { tokenizer: 'o200k_base', bogus: 'nope' });
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'o200k_base'); // valid key preserved
    ok(!('bogus' in (effective as unknown as Record<string, unknown>)));
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /unknown key/);
    match(warnings[0]!, /bogus/);
  });

  it('strips type-mismatched values', () => {
    const { cwd } = freshScope('type-mismatch');
    writeSettings(cwd, 'settings', { scan: { tokenize: 'yes-please' } }); // should be boolean
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.scan.tokenize, true); // default kept
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /invalid value/);
    match(warnings[0]!, /scan/);
  });

  it('drops an out-of-enum tokenizer with a warning and keeps the default', () => {
    // `tokenizer` is a closed enum (cl100k_base / o200k_base). An
    // unknown encoder is rejected by the AJV enum check: the key is
    // stripped, a warning is pushed, and the merged value falls back to
    // the default. No bespoke scan-time validation, this is the loader's
    // generic invalid-value path.
    const { cwd } = freshScope('tokenizer-enum');
    writeSettings(cwd, 'settings', { tokenizer: 'p50k_base' });
    const { effective, sources, warnings } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'cl100k_base'); // default kept
    strictEqual(sources.get('tokenizer'), 'defaults'); // stripped key never recorded as project
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /invalid value/);
    match(warnings[0]!, /tokenizer/);
  });

  it('continues past one bad key to apply the rest of the file', () => {
    const { cwd } = freshScope('partial-bad');
    writeSettings(cwd, 'settings', { tokenizer: 'o200k_base', scan: { tokenize: 'string-not-bool' } });
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'o200k_base'); // good key applied
    strictEqual(effective.scan.tokenize, true);     // bad key dropped, default kept
    strictEqual(warnings.length, 1);
  });

  it('warns + ignores when the file is not a JSON object', () => {
    const { cwd } = freshScope('not-object');
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    writeFileSync(join(cwd, '.skill-map', 'settings.json'), '[1, 2, 3]');
    const { warnings } = loadConfig({ cwd });
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /expected a JSON object/);
  });
});

describe('config loader, strict mode', () => {
  it('throws on malformed JSON', () => {
    const { cwd } = freshScope('strict-json');
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    writeFileSync(join(cwd, '.skill-map', 'settings.json'), '{');
    throws(
      () => loadConfig({ cwd, strict: true }),
      /invalid JSON/,
    );
  });

  it('throws on schema violation', () => {
    const { cwd } = freshScope('strict-schema');
    writeSettings(cwd, 'settings', { scan: { tokenize: 42 } });
    throws(
      () => loadConfig({ cwd, strict: true }),
      /invalid value/,
    );
  });

  it('throws on unknown key', () => {
    const { cwd } = freshScope('strict-unknown');
    writeSettings(cwd, 'settings', { unrecognised: 'key' });
    throws(
      () => loadConfig({ cwd, strict: true }),
      /unknown key/,
    );
  });
});

describe('config loader, project-local-only locality', () => {
  it('strips allowEditSmFiles from the project layer + warns', () => {
    const { cwd } = freshScope('plonly-allow');
    writeSettings(cwd, 'settings', { allowEditSmFiles: true });
    const { effective, sources, warnings } = loadConfig({ cwd });
    // Stripped → defaults (false) wins.
    strictEqual(effective.allowEditSmFiles, false);
    strictEqual(sources.get('allowEditSmFiles'), 'defaults');
    ok(warnings.some((w) => /allowEditSmFiles/.test(w) && /project-local only/.test(w)));
  });

  it('strips scan.referencePaths from project layer', () => {
    const { cwd } = freshScope('plonly-scan');
    writeSettings(cwd, 'settings', {
      scan: {
        referencePaths: ['/var/run'],
      },
    });
    const { effective, warnings } = loadConfig({ cwd });
    // Stripped → defaults preserved.
    deepStrictEqual(effective.scan.referencePaths, []);
    // One warning for the stripped key.
    strictEqual(warnings.filter((w) => /project-local only/.test(w)).length, 1);
  });

  it('preserves project-local-only keys in project-local layer', () => {
    const { cwd } = freshScope('plonly-survives-local');
    writeSettings(cwd, 'settings.local', { allowEditSmFiles: true });
    // Preservation is now GRANT-gated (audit H1): the layer is the only
    // legitimate home for these keys, but a shipped file is
    // indistinguishable from a hand-written one, so consent must have
    // been recorded in THIS checkout.
    ok(grantLocalKey(cwd, 'allowEditSmFiles', true), 'anchor available in the test scope');
    const { effective, sources, warnings } = loadConfig({ cwd });
    strictEqual(effective.allowEditSmFiles, true);
    strictEqual(sources.get('allowEditSmFiles'), 'project-local');
    ok(!warnings.some((w) => /project-local only/.test(w)));
  });

  it('STRIPS a project-local key that carries no grant (audit H1)', () => {
    // The exemption used to be unconditional, resting on
    // "settings.local.json is gitignored so it cannot arrive in a clone".
    // That is the default behaviour, not a boundary: `git add -f` ships
    // it. Without a grant minted here, the key degrades exactly like a
    // committed one.
    const { cwd } = freshScope('plonly-ungranted');
    writeSettings(cwd, 'settings.local', { scan: { followExternalSymlinks: true } });
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.scan.followExternalSymlinks, false, 'the shipped key is ignored');
    ok(warnings.some((w) => /was not granted in this copy/.test(w)), warnings.join(' | '));
  });

  it('a grant does NOT carry over to a different VALUE of the same key', () => {
    // Consent is for a key at a value; editing it on disk afterwards
    // invalidates that key alone.
    const { cwd } = freshScope('plonly-value-bound');
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    ok(grantLocalKey(cwd, 'tutorialReminderStep', 1));
    writeSettings(cwd, 'settings.local', { tutorialReminderStep: 2 });
    const { effective } = loadConfig({ cwd });
    strictEqual(effective.tutorialReminderStep, 0, 'tampered value falls back to defaults');
  });

  it('strips tutorialReminderStep from the project layer + warns', () => {
    const { cwd } = freshScope('plonly-tutorial-reminder');
    writeSettings(cwd, 'settings', { tutorialReminderStep: 1 });
    const { effective, sources, warnings } = loadConfig({ cwd });
    // Stripped → defaults (0) wins: a developer's UI dismissal sequence must
    // never leak to teammates through the committed layer.
    strictEqual(effective.tutorialReminderStep, 0);
    strictEqual(sources.get('tutorialReminderStep'), 'defaults');
    ok(
      warnings.some(
        (w) => /tutorialReminderStep/.test(w) && /project-local only/.test(w),
      ),
    );
  });

  it('strips allowNetworkActions from the project layer + warns', () => {
    // Audit finding 2026-08-01. The key shipped as a committed
    // team-shared policy while promising that a cloned repo could not
    // make skill-map fetch without consent, which the committed layer
    // cannot deliver: that file IS the cloned repo's. A hostile
    // project shipped `true` beside an enabled network action and the
    // victim's first `sm enrich` reached out unasked.
    const { cwd } = freshScope('plonly-network-actions');
    writeSettings(cwd, 'settings', { allowNetworkActions: true });
    const { effective, sources, warnings } = loadConfig({ cwd });
    strictEqual(effective.allowNetworkActions, false, 'the committed opt-in is ignored');
    strictEqual(sources.get('allowNetworkActions'), 'defaults');
    ok(
      warnings.some(
        (w) => /allowNetworkActions/.test(w) && /project-local only/.test(w),
      ),
      warnings.join(' | '),
    );
  });

  it('preserves a GRANTED allowNetworkActions in the project-local layer', () => {
    const { cwd } = freshScope('plonly-network-actions-local');
    writeSettings(cwd, 'settings.local', { allowNetworkActions: true });
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    ok(grantLocalKey(cwd, 'allowNetworkActions', true));
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.allowNetworkActions, true);
    strictEqual(sources.get('allowNetworkActions'), 'project-local');
  });

  it('preserves tutorialReminderStep in the project-local layer', () => {
    const { cwd } = freshScope('plonly-tutorial-reminder-local');
    writeSettings(cwd, 'settings.local', { tutorialReminderStep: 1 });
    // Preservation is grant-gated (audit H1).
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    ok(grantLocalKey(cwd, 'tutorialReminderStep', 1));
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.tutorialReminderStep, 1);
    strictEqual(sources.get('tutorialReminderStep'), 'project-local');
  });

  it('strips mcp.server.enabled from the project layer + warns', () => {
    const { cwd } = freshScope('plonly-mcp-server');
    writeSettings(cwd, 'settings', { mcp: { server: { enabled: true } } });
    const { effective, sources, warnings } = loadConfig({ cwd });
    // Stripped: exposing a local read-only server is a per-operator
    // decision, it must not travel to teammates through the committed layer.
    strictEqual(effective.mcp?.server?.enabled, undefined);
    ok(sources.get('mcp.server.enabled') !== 'project');
    ok(
      warnings.some(
        (w) => /mcp\.server\.enabled/.test(w) && /project-local only/.test(w),
      ),
    );
  });

  it('preserves mcp.server.enabled in the project-local layer', () => {
    const { cwd } = freshScope('plonly-mcp-server-local');
    writeSettings(cwd, 'settings.local', { mcp: { server: { enabled: true } } });
    // Preservation is grant-gated (audit H1).
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    ok(grantLocalKey(cwd, 'mcp.server.enabled', true));
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.mcp?.server?.enabled, true);
    strictEqual(sources.get('mcp.server.enabled'), 'project-local');
  });

  it('strips the github/enrichment base-URL overrides from the COMMITTED layer + warns', () => {
    // The token setting rides the Authorization header to whatever host
    // apiBaseUrl names, so a committed override in a cloned repo would
    // exfiltrate it on the first `sm enrich`. Both keys must be ignored
    // with a warning, never honoured.
    const { cwd } = freshScope('plonly-github-baseurl');
    writeSettings(cwd, 'settings', {
      plugins: {
        github: {
          extensions: {
            enrichment: {
              settings: {
                apiBaseUrl: 'https://attacker.example/api',
                rawBaseUrl: 'https://attacker.example/raw',
              },
            },
          },
        },
      },
    });
    const { effective, warnings } = loadConfig({ cwd });
    const settings = effective.plugins['github']?.extensions?.['enrichment']?.settings ?? {};
    strictEqual(settings['apiBaseUrl'], undefined, 'committed apiBaseUrl is ignored');
    strictEqual(settings['rawBaseUrl'], undefined, 'committed rawBaseUrl is ignored');
    strictEqual(
      warnings.filter(
        (w) => /enrichment\.settings\.(apiBaseUrl|rawBaseUrl)/.test(w) && /project-local only/.test(w),
      ).length,
      2,
      warnings.join(' | '),
    );
  });

  it('preserves the github/enrichment base-URL overrides in the project-local layer (granted)', () => {
    const { cwd } = freshScope('plonly-github-baseurl-local');
    writeSettings(cwd, 'settings.local', {
      plugins: {
        github: {
          extensions: {
            enrichment: {
              settings: { apiBaseUrl: 'http://127.0.0.1:4321/api' },
            },
          },
        },
      },
    });
    // Preservation is grant-gated (audit H1), same as every other member.
    ok(
      grantLocalKey(
        cwd,
        'plugins.github.extensions.enrichment.settings.apiBaseUrl',
        'http://127.0.0.1:4321/api',
      ),
    );
    const { effective, sources, warnings } = loadConfig({ cwd });
    strictEqual(
      effective.plugins['github']?.extensions?.['enrichment']?.settings?.['apiBaseUrl'],
      'http://127.0.0.1:4321/api',
    );
    strictEqual(
      sources.get('plugins.github.extensions.enrichment.settings.apiBaseUrl'),
      'project-local',
    );
    ok(!warnings.some((w) => /apiBaseUrl/.test(w)), warnings.join(' | '));
  });

  it('strict mode throws on a stripped project-layer entry', () => {
    const { cwd } = freshScope('plonly-strict');
    writeSettings(cwd, 'settings', { allowEditSmFiles: true });
    throws(
      () => loadConfig({ cwd, strict: true }),
      /project-local only/,
    );
  });
});

describe('config loader, server bind keys', () => {
  it('defaults: server.port 4242 / server.host 127.0.0.1', () => {
    const { cwd } = freshScope('server-defaults');
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.server.port, 4242);
    strictEqual(effective.server.host, '127.0.0.1');
    strictEqual(sources.get('server.port'), 'defaults');
  });

  it('project layer pins server.port; the untouched host keeps its default', () => {
    const { cwd } = freshScope('server-project');
    writeSettings(cwd, 'settings', { server: { port: 5050 } });
    const { effective, sources, warnings } = loadConfig({ cwd });
    strictEqual(effective.server.port, 5050);
    strictEqual(effective.server.host, '127.0.0.1');
    strictEqual(sources.get('server.port'), 'project');
    deepStrictEqual(warnings, []);
  });

  it('project-local overrides the committed project value', () => {
    const { cwd } = freshScope('server-local-wins');
    writeSettings(cwd, 'settings', { server: { port: 5050 } });
    writeSettings(cwd, 'settings.local', { server: { port: 6060 } });
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.server.port, 6060);
    strictEqual(sources.get('server.port'), 'project-local');
  });

  it('schema-invalid server.port is stripped with a warning and defaults apply', () => {
    const { cwd } = freshScope('server-invalid');
    writeSettings(cwd, 'settings', { server: { port: 'not-a-port' } });
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.server.port, 4242);
    ok(warnings.length > 0);
  });
});
