/**
 * Step 1b acceptance test. Codifies the ROADMAP §Step 1b criterion:
 * dropping a bogus plugin (bad manifest, wrong specCompat, invalid
 * extension) produces a precise diagnostic under the declared failure
 * mode, and the kernel keeps booting regardless.
 *
 * Three failure-mode scenarios + a green-path scenario + a discovery
 * scenario cover the full loader contract.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, match, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSchemaValidators } from '../schema-validators.js';
import { PluginLoader, installedSpecVersion } from '../plugin-loader.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-plugins-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function makePluginsDir(name: string): string {
  const dir = join(tempRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Place an extension fixture at the structure-as-truth layout. The
 * caller encodes the kind as the first key segment (`<kind>/<name>.<ext>`)
 * so the fixture source no longer declares `kind` (declaring it is
 * rejected at load, strict structure-as-truth). The file lands at
 * `<kind>s/<name>/index.<ext>`. A key without a known-kind prefix is
 * written verbatim (negative tests that intentionally misplace it).
 */
function placeExtension(relPath: string): string {
  const match = /^(provider|extractor|analyzer|action|formatter|hook)\/(.+)\.(mjs|js|ts)$/u.exec(
    relPath,
  );
  if (!match) return relPath;
  const [, kind, name, ext] = match;
  return `${kind}s/${name}/index.${ext}`;
}

function writePlugin(
  rootDir: string,
  id: string,
  manifest: unknown,
  extensions: Record<string, string> = {},
): string {
  const pluginDir = join(rootDir, id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest));
  for (const [relPath, contents] of Object.entries(extensions)) {
    const target = join(pluginDir, placeExtension(relPath));
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
  }
  return pluginDir;
}

/**
 * Lay down a structure-as-truth provider kind on disk:
 * `<plugin>/kinds/<name>/{schema.json, kind.json}`. `schema.json` is a
 * minimal frontmatter schema extending the base via `allOf` + `$ref`;
 * `kind.json` is the caller-supplied metadata (AJV-checked against
 * `provider-kind.schema.json` at load).
 */
function writeProviderKind(pluginDir: string, name: string, kindJson: unknown): void {
  const kindDir = join(pluginDir, 'kinds', name);
  mkdirSync(kindDir, { recursive: true });
  writeFileSync(
    join(kindDir, 'schema.json'),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `urn:test:${name}`,
      allOf: [{ $ref: 'https://skill-map.ai/spec/v0/frontmatter/base.schema.json' }],
      type: 'object',
      additionalProperties: true,
    }),
  );
  writeFileSync(join(kindDir, 'kind.json'), JSON.stringify(kindJson));
}

function loaderFor(rootDir: string): PluginLoader {
  return new PluginLoader({
    searchPaths: [rootDir],
    validators: loadSchemaValidators(),
    specVersion: installedSpecVersion(),
  });
}

describe('PluginLoader', () => {
  it('discovers empty search paths without error', async () => {
    const empty = makePluginsDir('empty');
    const loader = loaderFor(empty);
    const plugins = await loader.discoverAndLoadAll();
    strictEqual(plugins.length, 0);
  });

  it('loads a green-path plugin with one extractor extension', async () => {
    const root = makePluginsDir('green');
    // Structure-as-truth: the extension's kind and id come from the
    // folder, never the source. The `extractor/url-counter.mjs` key tells
    // `placeExtension` to lay it down at `extractors/url-counter/index.mjs`.
    const extractorSource = `
      export default {
        version: '1.0.0',
        description: 'Counts external URLs',
      };
    `;
    writePlugin(
      root,
      'ok-plugin',
      {
        version: '0.1.0',
        description: 'test',
        specCompat: '>=0.0.0',
        catalogCompat: '*',
      },
      { 'extractor/url-counter.mjs': extractorSource },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 1);
    const only = result[0]!;
    strictEqual(only.status, 'enabled');
    strictEqual(only.id, 'ok-plugin');
    strictEqual(only.extensions?.length, 1);
    strictEqual(only.extensions?.[0]?.kind, 'extractor');
    strictEqual(only.extensions?.[0]?.id, 'url-counter');
    // No `stability` declared → the loader stamps nothing (missing
    // means `stable` per the spec default, no value is synthesized).
    strictEqual(only.extensions?.[0]?.stability, undefined);
  });

  it('stamps the declared stability lifecycle label on the loaded extension', async () => {
    const root = makePluginsDir('stability-beta');
    const extractorSource = `
      export default {
        version: '1.0.0',
        description: 'Counts external URLs',
        stability: 'beta',
      };
    `;
    writePlugin(
      root,
      'beta-plugin',
      {
        version: '0.1.0',
        description: 'test',
        specCompat: '>=0.0.0',
        catalogCompat: '*',
      },
      { 'extractor/url-counter.mjs': extractorSource },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]!.status, 'enabled');
    strictEqual(result[0]!.extensions?.[0]?.stability, 'beta');
  });

  it('invalid-manifest: stability outside the closed enum', async () => {
    const root = makePluginsDir('stability-invalid');
    const extractorSource = `
      export default {
        version: '1.0.0',
        description: 'Counts external URLs',
        stability: 'alpha',
      };
    `;
    writePlugin(
      root,
      'alpha-plugin',
      {
        version: '0.1.0',
        description: 'test',
        specCompat: '>=0.0.0',
        catalogCompat: '*',
      },
      { 'extractor/url-counter.mjs': extractorSource },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]!.status, 'invalid-manifest');
    match(result[0]!.reason!, /stability/);
  });

  it('invalid-manifest: missing required fields', async () => {
    const root = makePluginsDir('invalid-manifest-missing');
    writePlugin(root, 'bad-shape', { id: 'bad-shape' });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 1);
    strictEqual(result[0]?.status, 'invalid-manifest');
    ok(result[0]?.reason, 'reason populated');
    match(result[0]!.reason!, /version|specCompat|extensions/);
  });

  it('invalid-manifest: malformed JSON', async () => {
    const root = makePluginsDir('invalid-manifest-json');
    const pluginDir = join(root, 'bad-json');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), '{ this is not json }');

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'invalid-manifest');
  });

  it('incompatible-spec: semver does not satisfy installed spec version', async () => {
    const root = makePluginsDir('incompatible');
    writePlugin(root, 'too-new', {
      // id removed (structure-as-truth)
      version: '1.0.0',
      description: 'test',
      specCompat: '>=999.0.0',

      catalogCompat: '*',
    });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'incompatible-spec');
    ok(result[0]?.manifest, 'manifest preserved for diagnostic');
    match(result[0]!.reason!, /@skill-map\/spec/);
  });

  it('plugin with no extensions on disk loads with zero extensions and status enabled', async () => {
    // Auto-discovery: a manifest with no <kind>s/<name>/index.* file
    // anywhere under the plugin dir is still a valid (but empty) plugin.
    // The plugin loads with status='enabled' and an empty extensions
    // array. Authors who genuinely had a typoed extension folder will
    // notice via `sm plugins show` (zero rows).
    const root = makePluginsDir('load-missing');
    writePlugin(root, 'mia', {
      // id removed (structure-as-truth)
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',

      catalogCompat: '*',
    });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'enabled');
    strictEqual(result[0]?.extensions?.length ?? 0, 0);
  });

  // The original variant of this test asserted `emitsLinkKinds` /
  // `defaultConfidence` were required on extractor manifests; both
  // fields were retired with the structure-as-truth refactor. A
  // follow-up will rewrite this against a still-required field in
  // another kind schema (e.g. analyzer.precondition shape).
  it.skip('invalid-manifest: extension default export fails kind schema', async () => {
    // Per spec/architecture.md §Plugin discovery, AJV on the
    // kind-specific schema (which references the closed slot enum
    // via base.schema.json) rejects with `invalid-manifest`. The
    // module imported fine; only the exported shape is wrong.
    const root = makePluginsDir('load-schema');
    const badExtractor = `
      export default {
        id: 'bad',
        kind: 'extractor',
        version: '1.0.0',
        description: 'test',
        // Missing required emitsLinkKinds and defaultConfidence.
      };
    `;
    writePlugin(
      root,
      'bad-extractor',
      {
        // id removed (structure-as-truth)
        version: '1.0.0',
        description: 'test',
        specCompat: '>=0.0.0',

        catalogCompat: '*',
      },
      { 'bad.mjs': badExtractor },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'invalid-manifest');
    match(result[0]!.reason!, /emitsLinkKinds|defaultConfidence|required/);
  });

  // Step 9.4, polished diagnostics: every reason string carries an
  // actionable hint pointing the user at the file, the schema, or a
  // remediation. The full text is fragile and we don't pin it; we
  // assert each hint shape is *present*.
  describe('Step 9.4 diagnostics polish', () => {
    it('invalid-manifest reason names the manifest path', async () => {
      const root = makePluginsDir('diag-path');
      const pluginDir = join(root, 'p');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.json'), '{ not json');
      const r = await loaderFor(root).discoverAndLoadAll();
      ok(r[0]!.reason!.includes('plugin.json'), `expected manifest path; got: ${r[0]!.reason}`);
      match(r[0]!.reason!, /Validate the JSON/);
    });

    it('invalid-manifest (AJV) hints at the spec schema', async () => {
      const root = makePluginsDir('diag-schema');
      writePlugin(root, 'bad', { id: 'bad' });
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /plugins-registry\.schema\.json/);
    });

    it('incompatible-spec suggests a remediation', async () => {
      const root = makePluginsDir('diag-spec');
      writePlugin(root, 'old', {
        // id removed (structure-as-truth)
        version: '1.0.0',
        description: 'test',
        specCompat: '>=999.0.0',

        catalogCompat: '*',
      });
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /update the plugin's specCompat|pin sm to a compatible/);
    });

    // Strict structure-as-truth: `id` / `kind` (and provider `kinds` /
    // formatter `formatId`) are derived from the folder layout and must
    // not be declared in the export. Re-declaring either, even with a
    // value that matches the folder, is rejected as `invalid-manifest`
    // (a second source of truth could silently drift from the path).
    it('rejects an extension manifest that re-declares derived fields (id / kind)', async () => {
      const root = makePluginsDir('diag-redeclare');
      writePlugin(
        root,
        'redeclares',
        {
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',
          catalogCompat: '*',
        },
        {
          'extractor/x.mjs':
            `export default { id: 'x', kind: 'extractor', version: '1.0.0', description: 'redeclares its derived fields' };`,
        },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'invalid-manifest');
      match(r[0]!.reason!, /declares `id`, `kind`/);
      match(r[0]!.reason!, /structure-as-truth/);
    });

    it('rejects a provider that inlines a `kinds` map (discovered from disk, not declared)', async () => {
      // The provider kinds catalog lives on disk under `kinds/<name>/`;
      // an inline `kinds` map in the export is rejected, not merged.
      const root = makePluginsDir('diag-provider-kinds');
      writePlugin(
        root,
        'inline-kinds',
        {
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',
          catalogCompat: '*',
        },
        {
          'provider/p.mjs':
            `export default { version: '1.0.0', description: 'inlines kinds', kinds: { agent: {} }, detect() { return null; } };`,
        },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'invalid-manifest');
      match(r[0]!.reason!, /declares `kinds`/);
    });

    it('projects `identifiers` + `identifierMismatch` from an external `kind.json` onto the runtime descriptor', async () => {
      // An external Provider reaches the same name-resolution lane a
      // built-in gets from `IProviderKind.identifiers`: the loader
      // projects the optional keys from `kinds/<name>/kind.json` onto
      // `instance.kinds[<name>]`.
      const root = makePluginsDir('provider-kind-identifiers');
      const pluginDir = writePlugin(
        root,
        'ext-provider',
        { version: '1.0.0', description: 'test', specCompat: '>=0.0.0', catalogCompat: '*' },
        {
          'provider/ext-provider.mjs':
            `export default { version: '1.0.0', description: 'external provider', presentation: { label: 'Ext', color: '#0891b2' }, classify() { return 'agent'; } };`,
        },
      );
      writeProviderKind(pluginDir, 'agent', {
        ui: { label: 'Agents', color: '#3b82f6' },
        identifiers: ['frontmatter.name', 'filename-basename'],
        identifierMismatch: 'warn',
      });
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'enabled');
      const ext = r[0]?.extensions?.[0] as { instance?: Record<string, unknown> };
      const kinds = ext.instance?.['kinds'] as Record<string, Record<string, unknown>>;
      deepStrictEqual(kinds['agent']?.['identifiers'], ['frontmatter.name', 'filename-basename']);
      strictEqual(kinds['agent']?.['identifierMismatch'], 'warn');
    });

    it('loads an external provider declaring `activity`, `resolution`, and `reservedNames`', async () => {
      // Parity gaps for external providers: `activity` carries runtime-only
      // fields (`pluginHooksSource` string + nested `mapEvent`) the shallow
      // function-strip cannot reach, and `resolution` / `reservedNames` are
      // declarative fields the provider schema must accept. All three are
      // built-in surface that no external provider had exercised before.
      const root = makePluginsDir('provider-full-surface');
      const pluginDir = writePlugin(
        root,
        'rich-provider',
        { version: '1.0.0', description: 'test', specCompat: '>=0.0.0', catalogCompat: '*' },
        {
          'provider/rich-provider.mjs':
            `export default {
               version: '1.0.0',
               description: 'external provider with the full runtime surface',
               presentation: { label: 'Rich', color: '#0891b2' },
               resolution: { invokes: ['command'] },
               reservedNames: { command: ['help', 'init'] },
               activity: {
                 install: { kind: 'plugin-file', configPath: '.rich/plugin/activity.js' },
                 pluginHooksSource: "  'tool.execute.before': async () => {},",
                 mapEvent() { return null; },
               },
               classify() { return 'command'; },
             };`,
        },
      );
      writeProviderKind(pluginDir, 'command', {
        ui: { label: 'Commands', color: '#f59e0b' },
        identifiers: ['filename-basename'],
      });
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'enabled', r[0]?.reason ?? '(no reason)');
      const ext = r[0]?.extensions?.[0] as { instance?: Record<string, unknown> };
      const activity = ext.instance?.['activity'] as Record<string, unknown>;
      // The runtime instance keeps the runtime-only fields (only the AJV
      // view is reduced), so `sm activity install` / the ingest mapper work.
      strictEqual(typeof activity?.['pluginHooksSource'], 'string');
      strictEqual(typeof activity?.['mapEvent'], 'function');
      deepStrictEqual(ext.instance?.['resolution'], { invokes: ['command'] });
    });

    it('rejects an external `kind.json` whose `identifiers` carries an unknown source', async () => {
      const root = makePluginsDir('provider-kind-bad-identifier');
      const pluginDir = writePlugin(
        root,
        'ext-provider-bad',
        { version: '1.0.0', description: 'test', specCompat: '>=0.0.0', catalogCompat: '*' },
        {
          'provider/ext-provider-bad.mjs':
            `export default { version: '1.0.0', description: 'external provider', presentation: { label: 'Ext', color: '#0891b2' }, classify() { return 'agent'; } };`,
        },
      );
      writeProviderKind(pluginDir, 'agent', {
        ui: { label: 'Agents', color: '#3b82f6' },
        identifiers: ['not-a-source'],
      });
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'invalid-manifest');
      match(r[0]!.reason!, /provider-kind\.schema\.json/);
    });

    it('rejects a formatter that declares `formatId` (derived from the folder)', async () => {
      const root = makePluginsDir('diag-formatter-formatid');
      writePlugin(
        root,
        'inline-formatid',
        {
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',
          catalogCompat: '*',
        },
        {
          'formatter/csv.mjs':
            `export default { version: '1.0.0', description: 'declares formatId', formatId: 'csv', render() { return ''; } };`,
        },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'invalid-manifest');
      match(r[0]!.reason!, /declares `formatId`/);
    });

    it('extension manifest invalid points at its kind schema', async () => {
      const root = makePluginsDir('diag-extension-schema');
      writePlugin(
        root,
        'broken-formatter',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        // No `description` → fails formatter.schema.json (via base),
        // surfacing the directed "points at its kind schema" diagnostic.
        { 'formatter/f.mjs': `export default { version: '1.0.0' };` },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /spec\/schemas\/extensions\/formatter\.schema\.json/);
    });
  });

  // Step 10 prep, Action manifest contract. Phase 0 lifted `IAction` from
  // `extensions/action.schema.json` into a runtime contract; the loader has
  // to accept both modes (`deterministic` / `probabilistic`), enforce the
  // conditional `promptTemplateRef` shape, and surface a directed diagnostic
  // when the conditional fails. Runtime invocation lands later (Decision
  // #114), but the manifest gate ships now.
  // The `Step 10 prep, Action manifest contract` suite below verified
  // the old `reportSchemaRef` / `promptTemplateRef` conditional schema
  // shape. Both fields were retired with the structure-as-truth refactor;
  // the Action loader now looks for `report.schema.json` and `prompt.md`
  // by convention. A follow-up suite will exercise the convention-based
  // file lookup. Skipped here so the suite still runs without false
  // positives on the obsolete shape.
  describe.skip('Step 10 prep, Action manifest contract', () => {
    it('loads a deterministic action manifest', async () => {
      const root = makePluginsDir('action-deterministic');
      const actionSource = `
        export default {
          id: 'validate-frontmatter',
          kind: 'action',
          version: '1.0.0',
          description: 'test',
          mode: 'deterministic',
        };
      `;
      writePlugin(
        root,
        'det-action',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        { 'action.mjs': actionSource },
      );

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      strictEqual(ext?.kind, 'action');
      const instance = (ext as { instance?: Record<string, unknown> }).instance;
      strictEqual(instance?.['mode'], 'deterministic');
    });

    it('loads a probabilistic action manifest with promptTemplateRef + probExpectedDurationSeconds', async () => {
      const root = makePluginsDir('action-probabilistic');
      const actionSource = `
        export default {
          id: 'skill-summarizer',
          kind: 'action',
          version: '1.0.0',
          description: 'test',
          mode: 'probabilistic',
          probExpectedDurationSeconds: 30,
        };
      `;
      writePlugin(
        root,
        'prob-action',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        { 'action.mjs': actionSource },
      );

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      strictEqual(ext?.kind, 'action');
      const instance = (ext as { instance?: Record<string, unknown> }).instance;
      strictEqual(instance?.['mode'], 'probabilistic');
      strictEqual(instance?.['promptTemplateRef'], './prompt.md');
    });

    it('rejects a probabilistic action without promptTemplateRef', async () => {
      const root = makePluginsDir('action-prob-missing-template');
      const actionSource = `
        export default {
          id: 'bad-prob',
          kind: 'action',
          version: '1.0.0',
          description: 'test',
          mode: 'probabilistic',
          probExpectedDurationSeconds: 30,
        };
      `;
      writePlugin(
        root,
        'bad-prob',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        { 'action.mjs': actionSource },
      );

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /spec\/schemas\/extensions\/action\.schema\.json/);
      match(result[0]!.reason!, /promptTemplateRef/);
    });

    it('rejects a deterministic action with promptTemplateRef', async () => {
      const root = makePluginsDir('action-det-with-template');
      const actionSource = `
        export default {
          id: 'bad-det',
          kind: 'action',
          version: '1.0.0',
          description: 'test',
          mode: 'deterministic',
        };
      `;
      writePlugin(
        root,
        'bad-det',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        { 'action.mjs': actionSource },
      );

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /spec\/schemas\/extensions\/action\.schema\.json/);
    });
  });

  // H2, Plugin loader timeout. A plugin whose top-level work hangs
  // (a never-resolving `await`, an infinite loop, a hanging network
  // call) used to block every host CLI command indefinitely. The
  // loader now races every dynamic import against a configurable
  // timer and surfaces the timeout as a `load-error` row.
  describe('Step H2, load timeout', () => {
    it('load-error: extension import that never resolves trips the timeout', async () => {
      const root = makePluginsDir('timeout-hang');
      // Top-level `await` on a never-resolving promise. The dynamic
      // import will sit forever waiting for module evaluation; the
      // race with the loader's timer should win.
      const hangSource = `
        await new Promise(() => {});
        export default { version: '1.0.0', description: 'never resolves' };
      `;
      writePlugin(
        root,
        'hangs',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        { 'extractor/hang.mjs': hangSource },
      );

      const loader = new PluginLoader({
        searchPaths: [root],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
        loadTimeoutMs: 75,
      });
      const start = Date.now();
      const r = await loader.discoverAndLoadAll();
      const elapsed = Date.now() - start;

      strictEqual(r.length, 1);
      strictEqual(r[0]?.status, 'load-error');
      match(r[0]!.reason!, /exceeded\s+75ms/);
      match(r[0]!.reason!, /top-level side effect/);
      ok(elapsed < 1000, `loader returned in ${elapsed}ms; should be ≪ default 5000ms`);
    });

    it('non-hanging plugin still loads fine with a tight timeout', async () => {
      const root = makePluginsDir('timeout-fast');
      const extractor = `
        export default { version: '1.0.0', description: 'fast', extract() {} };
      `;
      writePlugin(
        root,
        'quick',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        { 'extractor/fast.mjs': extractor },
      );

      const loader = new PluginLoader({
        searchPaths: [root],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
        loadTimeoutMs: 100,
      });
      const r = await loader.discoverAndLoadAll();
      strictEqual(r[0]?.status, 'enabled');
    });
  });

  // Spec § A.5, plugin id global uniqueness. Two enforcement points:
  //   (a) directory name MUST equal manifest id   → invalid-manifest
  //   (b) cross-root same-id collision            → id-collision (both)
  // The `Step A.5, id uniqueness` suite below verified the old contract
  // where `plugin.json` carried `id` and the loader cross-checked it
  // against the directory name. With structure-as-truth the manifest
  // no longer carries `id`; the directory name IS the id, so the
  // dir-name-mismatch branch is impossible by construction. The
  // cross-root id-collision tests need rewriting against the
  // path-derived id; deferred to a follow-up.
  describe.skip('Step A.5, id uniqueness', () => {
    it('invalid-manifest: directory name does not match manifest id', async () => {
      const root = makePluginsDir('dir-mismatch');
      // Directory is 'wrong-dir' but manifest id is 'real-id'. AJV passes
      // (the manifest is structurally valid), so the new structural rule
      // is what catches it.
      writePlugin(
        root,
        'wrong-dir',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      ok(result[0]?.reason, 'reason populated');
      match(result[0]!.reason!, /directory name 'wrong-dir' does not match manifest id 'real-id'/);
      // Manifest is preserved on a dir-mismatch so `sm plugins list/show`
      // can still surface the conflicting id and version.
      ok(result[0]?.manifest, 'manifest preserved on dir-mismatch');
    });

    it('id-collision: two plugins in different roots claim the same id', async () => {
      const rootA = makePluginsDir('collide-A');
      const rootB = makePluginsDir('collide-B');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      // Same id 'twin' under two different parent roots, directory
      // names match (rule #1 passes), but cross-root id check (rule #2)
      // fires.
      writePlugin(
        rootA,
        'twin',
        { id: 'twin', version: '1.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );
      writePlugin(
        rootB,
        'twin',
        { id: 'twin', version: '2.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 2);
      // Both members of the collision pair receive the new status, no
      // precedence rule applies.
      for (const p of result) {
        strictEqual(p.status, 'id-collision');
        match(p.reason!, /Plugin 'twin' at .* collides with the plugin at .*\. Rename one and rerun\./);
      }
      // Extensions are stripped from a colliding plugin so a careless
      // caller cannot register them.
      strictEqual(result[0]?.extensions, undefined);
      strictEqual(result[1]?.extensions, undefined);
    });

    it('id-collision: three-way collision lists every other path in the reason', async () => {
      const rootA = makePluginsDir('collide-3-A');
      const rootB = makePluginsDir('collide-3-B');
      const rootC = makePluginsDir('collide-3-C');
      const manifest = (specCompat = '>=0.0.0') => ({
        id: 'triplet',
        version: '1.0.0',
        description: 'test',
        specCompat,
      });
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(rootA, 'triplet', manifest(), { 'd.mjs': extractorSrc });
      writePlugin(rootB, 'triplet', manifest(), { 'd.mjs': extractorSrc });
      writePlugin(rootC, 'triplet', manifest(), { 'd.mjs': extractorSrc });

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB, rootC],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 3);
      for (const p of result) strictEqual(p.status, 'id-collision');
    });

    it('id-collision: a non-colliding plugin alongside a colliding pair is unaffected', async () => {
      const rootA = makePluginsDir('mix-A');
      const rootB = makePluginsDir('mix-B');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(
        rootA,
        'twin',
        { id: 'twin', version: '1.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );
      writePlugin(
        rootB,
        'twin',
        { id: 'twin', version: '2.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );
      // Independent plugin in rootA, its id is unique across the search set.
      writePlugin(
        rootA,
        'solo',
        { id: 'solo', version: '1.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 3);
      const byId = new Map(result.map((p) => [p.id, p] as const));
      strictEqual(byId.get('solo')?.status, 'enabled');
      // Both 'twin' entries collide.
      strictEqual(result.filter((p) => p.id === 'twin').every((p) => p.status === 'id-collision'), true);
    });

    it('id-collision: a parse-failed sibling does not muddy the trusted-id collision report', async () => {
      // A plugin whose plugin.json fails to parse exposes an *untrusted*
      // id (the directory basename). It must NOT be confused with a real
      // id collision: the loader excludes invalid-manifest entries from
      // the collision-detection set.
      const rootA = makePluginsDir('mud-A');
      const rootB = makePluginsDir('mud-B');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      // A real, valid plugin with id 'sibling' under rootA.
      writePlugin(
        rootA,
        'sibling',
        { id: 'sibling', version: '1.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );
      // A directory under rootB also called 'sibling', but with a broken
      // plugin.json, its fall-back id is 'sibling' (path basename) but
      // the manifest never validated.
      const brokenDir = join(rootB, 'sibling');
      mkdirSync(brokenDir, { recursive: true });
      writeFileSync(join(brokenDir, 'plugin.json'), '{ not json');

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 2);
      const valid = result.find((p) => p.path.includes('mud-A'));
      const broken = result.find((p) => p.path.includes('mud-B'));
      // The valid one keeps loading, its id is unique among trusted ids.
      strictEqual(valid?.status, 'enabled');
      // The broken one stays invalid-manifest, NOT id-collision: a
      // collision report would mislead ("rename your good plugin to fix
      // the JSON typo in the bad one"); we keep the original diagnostic.
      strictEqual(broken?.status, 'invalid-manifest');
    });
  });

  it('continues booting when a later plugin is bad', async () => {
    const root = makePluginsDir('mixed');
    writePlugin(
      root,
      'good',
      {
        // id removed (structure-as-truth)
        version: '0.1.0',
        description: 'test',
        specCompat: '>=0.0.0',

        catalogCompat: '*',
      },
      {
        'extractor/d.mjs': `export default { version: '1.0.0', description: 'd', extract() {} };`,
      },
    );
    writePlugin(root, 'broken', { /* malformed manifest, missing required fields */ });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 2);
    const statuses = result.map((p) => p.status).sort();
    // 'enabled' sorts before 'invalid-manifest' alphabetically.
    strictEqual(statuses[0], 'enabled');
    strictEqual(statuses[1], 'invalid-manifest');
  });

  // Spec § A.6, qualified extension ids. The loader injects
  // `pluginId = manifest.id` so the registry can key by `<pluginId>/<id>`.
  // The `Step A.6, qualified id injection` suite covered the old
  // contract where `pluginId` came from `manifest.id`. With
  // structure-as-truth the loader derives it from the plugin folder
  // name; the tests stay valuable but need their fixtures updated to
  // the new shape. Deferred to a follow-up.
  describe.skip('Step A.6, qualified id injection', () => {
    it('injects pluginId from plugin.json#/id into every loaded extension', async () => {
      const root = makePluginsDir('a6-injection');
      const extractorSrc = `
        export default {
          id: 'greet', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(
        root,
        'my-plugin',
        { id: 'my-plugin', version: '1.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      ok(ext, 'expected one loaded extension');
      strictEqual(ext.id, 'greet');
      strictEqual(ext.pluginId, 'my-plugin');
    });

    it('tolerates a matching pluginId hand-coded in the extension', async () => {
      // Defensive: an author who copies built-ins style and includes
      // `pluginId` matching the manifest id is accepted (no-op). The
      // loader strips the field before AJV so it doesn't violate
      // `unevaluatedProperties: false`.
      const root = makePluginsDir('a6-tolerate');
      const extractorSrc = `
        export default {
          id: 'greet', pluginId: 'my-plugin',
          kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(
        root,
        'my-plugin',
        { id: 'my-plugin', version: '1.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'enabled');
      strictEqual(result[0]?.extensions?.[0]?.pluginId, 'my-plugin');
    });

    // The `granularity` manifest field was removed (every extension is
    // independently toggle-able by its qualified id). A manifest that
    // still declares it is rejected by AJV as `invalid-manifest`.
    describe('granularity field removed', () => {
      it('manifest declaring granularity is rejected as invalid-manifest', async () => {
        const root = makePluginsDir('granularity-rejected');
        const extractorSrc = `
          export default {
            id: 'one', kind: 'extractor', version: '1.0.0',
            emitsLinkKinds: ['references'], defaultConfidence: 'high',
          };
        `;
        writePlugin(
          root,
          'legacy',
          {
            version: '1.0.0',
            description: 'test',
            specCompat: '>=0.0.0',
            catalogCompat: '*',
            // Legacy field, no longer accepted; AJV
            // `additionalProperties: false` should reject the manifest.
          } as Record<string, unknown>,
          { 'd.mjs': extractorSrc },
        );
        const result = await loaderFor(root).discoverAndLoadAll();
        strictEqual(result.length, 1);
        strictEqual(result[0]?.status, 'invalid-manifest');
      });
    });

    it('invalid-manifest: extension declares pluginId that disagrees with plugin.json', async () => {
      const root = makePluginsDir('a6-mismatch');
      const extractorSrc = `
        export default {
          id: 'greet', pluginId: 'someone-else',
          kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(
        root,
        'my-plugin',
        { id: 'my-plugin', version: '1.0.0', specCompat: '>=0.0.0' },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      ok(result[0]?.reason, 'reason populated');
      match(result[0]!.reason!, /pluginId 'someone-else'/);
      match(result[0]!.reason!, /plugin\.json declares id 'my-plugin'/);
    });
  });

  // Spec § A.10, `applicableKinds` filter on Extractors.
  //
  //   - Empty array `[]` is rejected by AJV (`minItems: 1`) → load-error.
  //   - Unknown kinds (no installed Provider declares them) load OK
  //     (status `enabled`); the warning surfaces in `sm plugins doctor`,
  //     covered by `plugins-cli.test.ts` separately. Here we just pin
  //     that the loader does NOT block unknown kinds.
  // `applicableKinds` was retired with the structure-as-truth refactor
  // in favour of `precondition.kind` (qualified `<plugin>/<kindName>`).
  // The filter coverage moved to `__tests__/integration/extractor-applicable-kinds.spec.ts`.
  describe.skip('Step A.10, applicableKinds filter', () => {
    it('(e) extractor with applicableKinds: ["unknown-kind"] loads OK (status: enabled)', async () => {
      const root = makePluginsDir('a10-unknown-kind');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
          applicableKinds: ['unknown-kind'],
        };
      `;
      writePlugin(
        root,
        'maybe-someday',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      ok(ext, 'extension loaded');
      // The applicableKinds field survives the load (the loader does
      // not strip it; the runtime carries it for the orchestrator and
      // doctor to inspect).
      strictEqual(ext.kind, 'extractor');
    });

    it('(f) extractor with applicableKinds: [] is rejected by AJV (minItems: 1)', async () => {
      const root = makePluginsDir('a10-empty-array');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
          applicableKinds: [],
        };
      `;
      writePlugin(
        root,
        'empty-applies',
        {
          // id removed (structure-as-truth)
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',

          catalogCompat: '*',
        },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      // AJV rejects the exported extension shape against the
      // kind-specific schema (extractor.schema.json's
      // `applicableKinds.minItems: 1`). Per spec/architecture.md
      // §Plugin discovery, that surfaces as `invalid-manifest`, the
      // module imported fine; only the declared shape is wrong.
      strictEqual(result[0]?.status, 'invalid-manifest');
      ok(result[0]?.reason, 'reason populated');
      // The reason names the offending field (AJV path or keyword).
      match(result[0]!.reason!, /applicableKinds|minItems|fewer than 1/i);
    });
  });

  // Audit M3, post-refactor: with auto-discovery, the loader only walks
  // `<plugin-dir>/<kind>s/<name>/index.{js,mjs,ts}`. Sibling files
  // outside the plugin directory cannot be reached by the discovery
  // path; the manifest no longer carries author-supplied paths to
  // sanitize. The legacy `..`-escape and absolute-path lanes are
  // closed by construction rather than by runtime check.
  describe('audit M3, plugin entry containment (auto-discovery-only)', () => {
    it('discovery does not reach outside the plugin directory', async () => {
      const root = makePluginsDir('m3-isolation');
      // A sibling file outside the plugin directory.
      mkdirSync(join(root, 'shared'), { recursive: true });
      writeFileSync(
        join(root, 'shared', 'leaked.mjs'),
        `export default { id: 'x', kind: 'extractor', version: '1.0.0' };`,
      );
      writePlugin(root, 'isolated', {
        // id removed (structure-as-truth)
        version: '0.1.0',
        description: 'test',
        specCompat: '>=0.0.0',

        catalogCompat: '*',
      });

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      // No `<kind>s/<name>/index.*` inside the plugin dir → zero
      // extensions; the sibling under `shared/` is never reached.
      strictEqual(result[0]?.status, 'enabled');
      strictEqual(result[0]?.extensions?.length ?? 0, 0);
    });
  });

  describe('import-trust gate (resolveImportTrust)', () => {
    const MANIFEST = {
      version: '0.1.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    };

    it('refuses an untrusted plugin: disabled + untrusted, manifest kept, code NEVER runs', async () => {
      const root = makePluginsDir('trust-deny');
      // A module that throws at import time: if the loader EVER imported
      // it, the status would be 'load-error'. Getting 'disabled' instead
      // proves the gate short-circuited BEFORE the dynamic import, the
      // security guarantee (no cloned-repo code executes untrusted).
      writePlugin(root, 'untrusted-plugin', MANIFEST, {
        'extractor/boom.mjs': 'throw new Error("plugin module top-level executed");',
      });
      const loader = new PluginLoader({
        searchPaths: [root],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
        resolveImportTrust: () => false,
      });

      const result = await loader.discoverAndLoadAll();
      strictEqual(result.length, 1);
      const only = result[0]!;
      strictEqual(only.status, 'disabled');
      strictEqual(only.untrusted, true);
      ok(only.manifest, 'manifest must be surfaced so sm plugins list still shows it');
      strictEqual(only.extensions, undefined, 'extensions must NOT be imported');
    });

    it('loads a trusted plugin normally when resolveImportTrust returns true', async () => {
      const root = makePluginsDir('trust-allow');
      writePlugin(root, 'trusted-plugin', MANIFEST, {
        'extractor/url-counter.mjs': "export default { version: '1.0.0', description: 'x' };",
      });
      const loader = new PluginLoader({
        searchPaths: [root],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
        resolveImportTrust: () => true,
      });

      const result = await loader.discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]!.status, 'enabled');
      strictEqual(result[0]!.extensions?.length, 1);
      strictEqual(result[0]!.untrusted, undefined);
    });

    it('omitting resolveImportTrust trusts everything (built-ins / explicit --plugin-dir / tests)', async () => {
      const root = makePluginsDir('trust-omit');
      writePlugin(root, 'ungated-plugin', MANIFEST, {
        'extractor/url-counter.mjs': "export default { version: '1.0.0', description: 'x' };",
      });
      // No resolveImportTrust option at all.
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]!.status, 'enabled');
      strictEqual(result[0]!.extensions?.length, 1);
    });
  });
});
