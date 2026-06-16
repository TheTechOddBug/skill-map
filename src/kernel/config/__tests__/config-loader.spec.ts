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
    strictEqual(effective.allowSidecarWriters, true);
    strictEqual(effective.tokenizer, 'cl100k_base');
    strictEqual(effective.scan.tokenize, true);
    strictEqual(effective.scan.maxFileSizeBytes, 1048576);
    strictEqual(effective.jobs.minimumTtlSeconds, 60);
    strictEqual(effective.jobs.retention.completed, 2592000);
    strictEqual(effective.jobs.retention.failed, null);

    // Every key tracked back to defaults.
    strictEqual(sources.get('tokenizer'), 'defaults');
    strictEqual(sources.get('scan.tokenize'), 'defaults');
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
