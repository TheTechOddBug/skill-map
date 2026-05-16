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
    strictEqual(effective.autoMigrate, true);
    strictEqual(effective.tokenizer, 'cl100k_base');
    strictEqual(effective.scan.tokenize, true);
    strictEqual(effective.scan.maxFileSizeBytes, 1048576);
    strictEqual(effective.jobs.minimumTtlSeconds, 60);
    strictEqual(effective.jobs.retention.completed, 2592000);
    strictEqual(effective.jobs.retention.failed, null);
    strictEqual(effective.history.share, false);
    strictEqual(effective.i18n.locale, 'en');

    // Every key tracked back to defaults.
    strictEqual(sources.get('autoMigrate'), 'defaults');
    strictEqual(sources.get('scan.tokenize'), 'defaults');
    strictEqual(sources.get('jobs.retention.completed'), 'defaults');
    strictEqual(sources.get('jobs.retention.failed'), 'defaults');
  });
});

describe('config loader, layer precedence', () => {
  it('project overrides defaults', () => {
    const { cwd } = freshScope('project');
    writeSettings(cwd, 'settings', { tokenizer: 'gpt-4' });
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'gpt-4');
    strictEqual(sources.get('tokenizer'), 'project');
    strictEqual(sources.get('autoMigrate'), 'defaults');
  });

  it('project-local overrides project', () => {
    const { cwd } = freshScope('project-local');
    writeSettings(cwd, 'settings', { tokenizer: 'p50k_base' });
    writeSettings(cwd, 'settings.local', { tokenizer: 'r50k_base' });
    const { effective, sources } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'r50k_base');
    strictEqual(sources.get('tokenizer'), 'project-local');
  });

  it('overrides layer wins over every file layer', () => {
    const { cwd } = freshScope('override');
    writeSettings(cwd, 'settings.local', { tokenizer: 'r50k_base' });
    const { effective, sources } = loadConfig({
      cwd,
      overrides: { tokenizer: 'override-value' },
    });
    strictEqual(effective.tokenizer, 'override-value');
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
    strictEqual(effective.scan.followSymlinks, false); // from defaults
    strictEqual(sources.get('scan.tokenize'), 'project');
    strictEqual(sources.get('scan.strict'), 'project-local');
    strictEqual(sources.get('scan.followSymlinks'), 'defaults');
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
    writeSettings(cwd, 'settings', { tokenizer: 'gpt-4', bogus: 'nope' });
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'gpt-4'); // valid key preserved
    ok(!('bogus' in (effective as unknown as Record<string, unknown>)));
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /unknown key/);
    match(warnings[0]!, /bogus/);
  });

  it('strips type-mismatched values', () => {
    const { cwd } = freshScope('type-mismatch');
    writeSettings(cwd, 'settings', { autoMigrate: 'yes-please' }); // should be boolean
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.autoMigrate, true); // default kept
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /invalid value/);
    match(warnings[0]!, /autoMigrate/);
  });

  it('continues past one bad key to apply the rest of the file', () => {
    const { cwd } = freshScope('partial-bad');
    writeSettings(cwd, 'settings', { tokenizer: 'gpt-4', autoMigrate: 'string-not-bool' });
    const { effective, warnings } = loadConfig({ cwd });
    strictEqual(effective.tokenizer, 'gpt-4');     // good key applied
    strictEqual(effective.autoMigrate, true);       // bad key dropped, default kept
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
    writeSettings(cwd, 'settings', { autoMigrate: 42 });
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

  it('strips scan.extraFolders / scan.referencePaths from project layer', () => {
    const { cwd } = freshScope('plonly-scan');
    writeSettings(cwd, 'settings', {
      scan: {
        extraFolders: ['/etc'],
        referencePaths: ['/var/run'],
      },
    });
    const { effective, warnings } = loadConfig({ cwd });
    // Both stripped → defaults preserved.
    deepStrictEqual(effective.scan.extraFolders, []);
    deepStrictEqual(effective.scan.referencePaths, []);
    // Two warnings, one per stripped key.
    strictEqual(warnings.filter((w) => /project-local only/.test(w)).length, 2);
  });

  it('preserves project-local-only keys in project-local layer', () => {
    const { cwd } = freshScope('plonly-survives-local');
    writeSettings(cwd, 'settings.local', { allowEditSmFiles: true });
    const { effective, sources, warnings } = loadConfig({ cwd });
    strictEqual(effective.allowEditSmFiles, true);
    strictEqual(sources.get('allowEditSmFiles'), 'project-local');
    ok(!warnings.some((w) => /project-local only/.test(w)));
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

describe('config loader, prototype pollution defence (audit H1)', () => {
  it('skips __proto__ inside plugins[*].config (additionalProperties:true subtree)', () => {
    const { cwd } = freshScope('proto-plugins');
    writeSettings(cwd, 'settings', {
      plugins: {
        evil: {
          config: { __proto__: { polluted: 'yes' }, legitimate: 1 },
        },
      },
    });
    const { effective } = loadConfig({ cwd });
    // The legitimate sibling key still merges through.
    strictEqual(
      (effective.plugins['evil']?.config as Record<string, unknown>)?.['legitimate'],
      1,
    );
    // Nothing was written via the __proto__ setter on the merged config
    // or on Object.prototype itself.
    strictEqual(({} as Record<string, unknown>)['polluted'], undefined);
    strictEqual(
      Object.getPrototypeOf(effective.plugins['evil']?.config),
      Object.prototype,
    );
  });

  it('skips constructor / prototype keys', () => {
    const { cwd } = freshScope('proto-constructor');
    writeSettings(cwd, 'settings', {
      plugins: {
        evil: {
          config: { constructor: { polluted: 'no' }, prototype: { also: 'no' }, ok: 2 },
        },
      },
    });
    const { effective } = loadConfig({ cwd });
    const merged = effective.plugins['evil']?.config as Record<string, unknown>;
    strictEqual(merged['ok'], 2);
    ok(!Object.prototype.hasOwnProperty.call(merged, 'constructor'));
    ok(!Object.prototype.hasOwnProperty.call(merged, 'prototype'));
  });

  it('does not pollute Object.prototype across multiple loads', () => {
    const { cwd } = freshScope('proto-no-bleed');
    writeSettings(cwd, 'settings', {
      plugins: { x: { config: { __proto__: { leaked: true } } } },
    });
    loadConfig({ cwd });
    strictEqual(({} as Record<string, unknown>)['leaked'], undefined);
  });
});
