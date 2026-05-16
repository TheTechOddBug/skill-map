/**
 * `--json` envelope tests for the four verbs upgraded in this slice:
 *
 *   - `sm refresh <node.path> --json` and `sm refresh --stale --json`
 *     (schema: `spec/schemas/refresh-report.schema.json`).
 *   - `sm plugins doctor --json`
 *     (schema: `spec/schemas/plugins-doctor.schema.json`).
 *   - `sm graph --format json`
 *     (schema: `spec/schemas/scan-result.schema.json`).
 *   - `sm conformance run --json`
 *     (schema: `spec/schemas/conformance-result.schema.json`).
 *
 * Each verb is exercised twice at minimum: one happy-path test
 * asserting the envelope validates AJV-strict; one error-path test
 * asserting the verb emits the canonical
 * `{ ok: false, error: { code, message } }` envelope on a known
 * failure (missing DB for refresh, unknown scope for conformance).
 *
 * Uses temp file-based fixtures (mkdtempSync), never `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`. Each test isolates HOME
 * and cwd so the host's `~/.skill-map/` is never touched.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
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

import { Ajv2020 } from 'ajv/dist/2020.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', 'bin', 'sm.js');

interface IScope {
  cwd: string;
  home: string;
}

let root: string;
let counter = 0;

function freshScope(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function sm(args: string[], scope: IScope) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function plantClaudeFixture(scope: IScope): void {
  const file = join(scope.cwd, '.claude', 'agents', 'architect.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    ['---', 'name: architect', 'description: The architect', '---', 'Body.'].join('\n'),
  );
}

/**
 * AJV compilation shared across tests. `loadSchema` resolves
 * relative `$ref`s against the published `@skill-map/spec` payload so
 * `node.schema.json`, `link.schema.json`, `issue.schema.json` get
 * pulled in transparently when validating a `scan-result.schema.json`
 * envelope.
 */
function compileSchema(schemaName: string): ReturnType<Ajv2020['compile']> {
  const require = createRequire(import.meta.url);
  const indexPath = require.resolve('@skill-map/spec/index.json');
  const specRoot = dirname(indexPath);
  const schemaPath = resolve(specRoot, 'schemas', schemaName);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  // Pre-register every top-level schema so cross-$ref resolves
  // without per-test fetch hooks (scan-result references node / link
  // / issue; the doctor and refresh envelopes are self-contained).
  for (const dep of ['node', 'link', 'issue']) {
    const depPath = resolve(specRoot, 'schemas', `${dep}.schema.json`);
    ajv.addSchema(JSON.parse(readFileSync(depPath, 'utf8')) as object);
  }
  return ajv.compile(schema);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-cli-json-envelopes-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

// --- sm refresh ----------------------------------------------------------

describe('sm refresh --json', () => {
  it('happy path: validates against refresh-report.schema.json with refreshed>=0', () => {
    const scope = freshScope('refresh-happy');
    plantClaudeFixture(scope);

    const init = sm(['init'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    const r = sm(['refresh', '.claude/agents/architect.md', '--json'], scope);
    assert.equal(r.status, 0, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['ok'], true);
    assert.equal(payload['kind'], 'refresh.report');
    assert.ok(typeof payload['refreshed'] === 'number');
    assert.ok((payload['refreshed'] as number) >= 0);
    assert.ok(Array.isArray(payload['nodes']));
    assert.equal((payload['nodes'] as unknown[]).length, 1);
    const firstNode = (payload['nodes'] as Array<Record<string, unknown>>)[0]!;
    assert.equal(firstNode['path'], '.claude/agents/architect.md');
    assert.ok(typeof firstNode['enrichments'] === 'number');
    assert.ok(typeof payload['elapsedMs'] === 'number');

    const validate = compileSchema('refresh-report.schema.json');
    assert.ok(validate(payload), `schema errors: ${JSON.stringify(validate.errors)}`);
  });

  it('--stale with empty stale set emits a zero-count envelope (no error)', () => {
    const scope = freshScope('refresh-stale-empty');
    plantClaudeFixture(scope);

    const init = sm(['init'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    const r = sm(['refresh', '--stale', '--json'], scope);
    assert.equal(r.status, 0, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['ok'], true);
    assert.equal(payload['kind'], 'refresh.report');
    assert.equal(payload['refreshed'], 0);
    assert.deepEqual(payload['nodes'], []);

    const validate = compileSchema('refresh-report.schema.json');
    assert.ok(validate(payload), `schema errors: ${JSON.stringify(validate.errors)}`);
  });

  it('error path: missing node emits the not-found error envelope', () => {
    const scope = freshScope('refresh-not-found');
    plantClaudeFixture(scope);

    const init = sm(['init'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    const r = sm(['refresh', 'does/not/exist.md', '--json'], scope);
    assert.equal(r.status, 5, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['ok'], false);
    const error = payload['error'] as Record<string, unknown>;
    assert.equal(error['code'], 'not-found');
    assert.ok(typeof error['message'] === 'string');
    assert.match(String(error['message']), /does\/not\/exist\.md/);
  });

  it('error path: missing project DB emits the db-missing error envelope', () => {
    // No `sm init` here so the DB file is absent. The verb should
    // surface that as `db-missing` rather than the human "node not
    // found" advisory.
    const scope = freshScope('refresh-db-missing');
    plantClaudeFixture(scope);

    const r = sm(['refresh', '.claude/agents/architect.md', '--json'], scope);
    assert.equal(r.status, 5, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['ok'], false);
    const error = payload['error'] as Record<string, unknown>;
    assert.equal(error['code'], 'db-missing');
  });
});

// --- sm plugins doctor ---------------------------------------------------

describe('sm plugins doctor --json', () => {
  it('happy path: validates against plugins-doctor.schema.json', () => {
    const scope = freshScope('doctor-happy');
    const init = sm(['init', '--no-scan'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    const r = sm(['plugins', 'doctor', '--json'], scope);
    assert.equal(r.status, 0, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['ok'], true);
    assert.equal(payload['kind'], 'plugins.doctor');
    const counts = payload['counts'] as Record<string, unknown>;
    assert.ok(typeof counts['enabled'] === 'number');
    assert.ok((counts['enabled'] as number) > 0, 'built-ins should yield enabled > 0');
    assert.ok(typeof counts['loaded'] === 'number');
    assert.ok(typeof counts['incompatible'] === 'number');
    assert.ok(typeof counts['invalid'] === 'number');
    assert.ok(typeof counts['loadError'] === 'number');
    assert.ok(typeof counts['warnings'] === 'number');
    assert.ok(Array.isArray(payload['issues']));
    assert.ok(Array.isArray(payload['warnings']));
    assert.ok(typeof payload['elapsedMs'] === 'number');

    const validate = compileSchema('plugins-doctor.schema.json');
    assert.ok(validate(payload), `schema errors: ${JSON.stringify(validate.errors)}`);
  });

  it('surfaces an invalid-manifest plugin under issues[]', () => {
    const scope = freshScope('doctor-bad-plugin');
    const init = sm(['init', '--no-scan'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    // Drop a manifest missing required fields so the loader buckets
    // it under `invalid-manifest`.
    const pluginDir = join(scope.cwd, '.skill-map', 'plugins', 'mock-bad');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({ id: 'mock-bad' }),
    );

    const r = sm(['plugins', 'doctor', '--json'], scope);
    // Exit 1 (Issues) when at least one plugin failed; envelope still
    // carries `ok: true`, the issues live under `issues[]`.
    assert.equal(r.status, 1, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['ok'], true);
    const issues = payload['issues'] as Array<Record<string, unknown>>;
    assert.ok(issues.length > 0, 'expected at least one issue entry');
    const found = issues.find((i) => i['id'] === 'mock-bad');
    assert.ok(found, `expected mock-bad in issues; got ${JSON.stringify(issues)}`);
    assert.equal(found!['status'], 'invalid-manifest');

    const validate = compileSchema('plugins-doctor.schema.json');
    assert.ok(validate(payload), `schema errors: ${JSON.stringify(validate.errors)}`);
  });
});

// --- sm graph --format json ----------------------------------------------

describe('sm graph --format json', () => {
  it('happy path: emits a ScanResult envelope (validates against scan-result.schema.json)', () => {
    const scope = freshScope('graph-json');
    plantClaudeFixture(scope);

    const init = sm(['init'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    const r = sm(['graph', '--format', 'json'], scope);
    assert.equal(r.status, 0, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['schemaVersion'], 1);
    assert.ok(Array.isArray(payload['nodes']));
    assert.ok(Array.isArray(payload['links']));
    assert.ok(Array.isArray(payload['issues']));
    assert.ok((payload['nodes'] as unknown[]).length >= 1);

    const validate = compileSchema('scan-result.schema.json');
    assert.ok(validate(payload), `schema errors: ${JSON.stringify(validate.errors)}`);
  });

  it('error path: unknown format still exits 2 with a human hint (global --json ignored)', () => {
    // Spec: the global `--json` flag is ignored on `sm graph` (formats
    // are picked via `--format`). An unknown `--format` value goes
    // through the normal "no formatter registered" error path; the
    // error is emitted to stderr, not as a JSON envelope.
    const scope = freshScope('graph-json-unknown');
    plantClaudeFixture(scope);

    const init = sm(['init'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    const r = sm(['graph', '--format', 'no-such', '--json'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /No formatter registered/);
  });
});

// --- sm conformance run --------------------------------------------------

describe('sm conformance run --json', () => {
  it('happy path: validates against conformance-result.schema.json', () => {
    const scope = freshScope('conformance-spec');

    const r = sm(['conformance', 'run', '--scope', 'spec', '--json'], scope);
    assert.equal(r.status, 0, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['ok'], true);
    assert.equal(payload['kind'], 'conformance.result');
    const totals = payload['totals'] as Record<string, unknown>;
    assert.ok(typeof totals['scopes'] === 'number');
    assert.ok(typeof totals['cases'] === 'number');
    assert.ok(typeof totals['passCount'] === 'number');
    assert.ok(typeof totals['failCount'] === 'number');
    assert.ok(Array.isArray(payload['scopes']));
    const scopes = payload['scopes'] as Array<Record<string, unknown>>;
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0]!['label'], 'spec');
    assert.ok(Array.isArray(scopes[0]!['cases']));
    // The spec scope always ships at least the kernel-empty-boot case.
    assert.ok((scopes[0]!['cases'] as unknown[]).length >= 1);
    assert.ok(typeof payload['elapsedMs'] === 'number');

    const validate = compileSchema('conformance-result.schema.json');
    assert.ok(validate(payload), `schema errors: ${JSON.stringify(validate.errors)}`);
  });

  it('error path: unknown scope emits the bad-query error envelope', () => {
    const scope = freshScope('conformance-bad-scope');

    const r = sm(['conformance', 'run', '--scope', 'bogus-scope', '--json'], scope);
    assert.equal(r.status, 2, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(payload['ok'], false);
    const error = payload['error'] as Record<string, unknown>;
    assert.equal(error['code'], 'bad-query');
    assert.match(String(error['message']), /unknown.*scope/i);
  });
});
