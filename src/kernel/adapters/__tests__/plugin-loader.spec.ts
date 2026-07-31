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

/** What `writePlugin` puts in `extension.json` when a test says nothing. */
const DEFAULT_EXT_META = { version: '0.1.0', description: 'fixture extension' };

/**
 * Per-extension `extension.json` overrides, keyed by the same relPath as
 * the `extensions` record. `null` writes NO file (the missing-manifest
 * negative case); a string is written verbatim (unparseable JSON); an
 * object replaces the default wholesale.
 */
type TExtMetaOverrides = Record<string, unknown | null>;

function writePlugin(
  rootDir: string,
  id: string,
  manifest: unknown,
  extensions: Record<string, string> = {},
  extMeta: TExtMetaOverrides = {},
): string {
  const pluginDir = join(rootDir, id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest));
  for (const [relPath, contents] of Object.entries(extensions)) {
    const placed = placeExtension(relPath);
    const target = join(pluginDir, placed);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
    // Only real `<kind>s/<name>/index.*` layouts get a manifest; the
    // verbatim paths are negative tests that misplace a file on purpose.
    if (placed === relPath) continue;
    const meta = relPath in extMeta ? extMeta[relPath] : DEFAULT_EXT_META;
    if (meta === null) continue;
    writeFileSync(
      join(target, '..', 'extension.json'),
      typeof meta === 'string' ? meta : JSON.stringify(meta),
    );
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
      allOf: [{ $ref: 'https://skill-map.ai/spec/v1/frontmatter/base.schema.json' }],
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

  it('stamps the stability lifecycle label declared in extension.json', async () => {
    // `stability` moved out of the module: the loader must know it BEFORE
    // deciding whether to import, and it cannot read a field off a module
    // without running that module first. `beta` is presentation-only, so
    // the extension still loads.
    const root = makePluginsDir('stability-beta');
    const extractorSource = `
      export default {
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
      { 'extractor/url-counter.mjs': { ...DEFAULT_EXT_META, stability: 'beta' } },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]!.status, 'enabled');
    strictEqual(result[0]!.extensions?.[0]?.stability, 'beta');
  });

  it('an experimental extension is NOT imported without an explicit opt-in', async () => {
    // The guarantee, at the loader level: `experimental` flips the
    // installed default to disabled, and disabled now means the module
    // body never runs. Before this, it was imported and only filtered out
    // afterwards, at registration.
    const root = makePluginsDir('experimental-skipped');
    writePlugin(
      root,
      'exp-plugin',
      {
        version: '0.1.0',
        description: 'test',
        specCompat: '>=0.0.0',
        catalogCompat: '*',
      },
      { 'extractor/url-counter.mjs': 'export default {};' },
      { 'extractor/url-counter.mjs': { ...DEFAULT_EXT_META, stability: 'experimental' } },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]!.status, 'enabled');
    strictEqual(result[0]!.extensions?.length, 0);
    const skipped = result[0]!.unloadedExtensions ?? [];
    strictEqual(skipped.length, 1);
    strictEqual(skipped[0]?.id, 'url-counter');
    strictEqual(skipped[0]?.kind, 'extractor');
    strictEqual(skipped[0]?.reason, 'extension-disabled');
    // Readable without importing, which is the whole point.
    strictEqual(skipped[0]?.version, '0.1.0');
    strictEqual(skipped[0]?.stability, 'experimental');
  });

  it('a module that still declares the relocated fields is rejected', async () => {
    // The migration guard. AJV would reject these anyway via
    // `unevaluatedProperties: false`, but the directed message is what
    // tells an author the fields MOVED rather than vanished.
    const root = makePluginsDir('relocated-in-module');
    const extractorSource = [
      'export default {',
      "  version: '0.1.0',",
      "  description: 'declared in the module, no longer allowed',",
      '};',
    ].join('\n');
    writePlugin(
      root,
      'stale-plugin',
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
    match(result[0]!.reason!, /`version`, `description`/u);
    match(result[0]!.reason!, /extension\.json/u);
  });

  it('invalid-manifest: extension.json missing entirely', async () => {
    const root = makePluginsDir('meta-missing');
    writePlugin(
      root,
      'no-meta-plugin',
      { version: '0.1.0', description: 'test', specCompat: '>=0.0.0', catalogCompat: '*' },
      { 'extractor/url-counter.mjs': 'export default {};' },
      { 'extractor/url-counter.mjs': null },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]!.status, 'invalid-manifest');
    match(result[0]!.reason!, /missing `extension\.json`/u);
  });

  it('invalid-manifest: extension.json is not parseable JSON', async () => {
    const root = makePluginsDir('meta-unparseable');
    writePlugin(
      root,
      'bad-json-plugin',
      { version: '0.1.0', description: 'test', specCompat: '>=0.0.0', catalogCompat: '*' },
      { 'extractor/url-counter.mjs': 'export default {};' },
      { 'extractor/url-counter.mjs': '{ not json' },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]!.status, 'invalid-manifest');
    match(result[0]!.reason!, /not readable as JSON/u);
  });

  it('invalid-manifest: extension.json missing a required field', async () => {
    const root = makePluginsDir('meta-incomplete');
    writePlugin(
      root,
      'partial-meta-plugin',
      { version: '0.1.0', description: 'test', specCompat: '>=0.0.0', catalogCompat: '*' },
      { 'extractor/url-counter.mjs': 'export default {};' },
      { 'extractor/url-counter.mjs': { version: '0.1.0' } },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]!.status, 'invalid-manifest');
    match(result[0]!.reason!, /description/u);
  });

  it('stamps the declared defaultEnabled override on the loaded extension', async () => {
    // The orthogonal opt-in axis (spec base.schema.json#/defaultEnabled,
    // 2026-07-21): the loader must surface it as a typed field so the
    // enabled resolvers apply the declared installed default.
    const root = makePluginsDir('default-enabled');
    const extractorSource = `
      export default {
      };
    `;
    writePlugin(
      root,
      'optin-plugin',
      {
        version: '0.1.0',
        description: 'test',
        specCompat: '>=0.0.0',
        catalogCompat: '*',
      },
      { 'extractor/url-counter.mjs': extractorSource },
      { 'extractor/url-counter.mjs': { ...DEFAULT_EXT_META, defaultEnabled: false } },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    // `defaultEnabled: false` IS the installed default here, and with no
    // resolver supplied the loader honours it: declared, not imported.
    strictEqual(result[0]!.status, 'enabled');
    strictEqual(result[0]!.extensions?.length, 0);
    strictEqual(result[0]!.unloadedExtensions?.length, 1);
    strictEqual(result[0]!.unloadedExtensions?.[0]?.defaultEnabled, false);
    strictEqual(result[0]!.unloadedExtensions?.[0]?.reason, 'extension-disabled');
  });

  it('invalid-manifest: stability outside the closed enum', async () => {
    const root = makePluginsDir('stability-invalid');
    const extractorSource = `
      export default {
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
      { 'extractor/url-counter.mjs': { ...DEFAULT_EXT_META, stability: 'alpha' } },
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

  // Per spec/architecture.md §Plugin discovery, the loader AJV-validates
  // every extension export against its KIND schema and reports a failure
  // as `invalid-manifest`: the module imported fine, only the exported
  // shape is wrong. The original variant pinned `emitsLinkKinds` /
  // `defaultConfidence`, both retired with structure-as-truth. The pair
  // below pins the same gate against a field the kind catalog still
  // requires today, `provider.schema.json#/required: ['presentation']`
  // (`version` / `description` moved to `extension.json`, so they are no
  // longer candidates).
  it('invalid-manifest: extension default export fails its kind schema (provider without `presentation`)', async () => {
    const root = makePluginsDir('load-schema');
    // `detect` is a runtime method (stripped before AJV), so the export
    // reaches the validator as `{}`: structurally a provider, missing
    // the one field the kind schema requires.
    const badProvider = `
      export default {
        detect() { return null; },
      };
    `;
    writePlugin(
      root,
      'bad-provider',
      {
        version: '1.0.0',
        description: 'test',
        specCompat: '>=0.0.0',
        catalogCompat: '*',
      },
      { 'provider/p.mjs': badProvider },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'invalid-manifest');
    // Precise on BOTH halves so the test cannot pass on an unrelated
    // rejection: the AJV keyword that fired, and the schema the
    // diagnostic points the author at.
    match(result[0]!.reason!, /required property.*presentation|presentation.*required/);
    match(result[0]!.reason!, /spec\/schemas\/extensions\/provider\.schema\.json/);
  });

  it('the same provider loads once `presentation` is declared (the AJV pass is the only thing rejecting it)', async () => {
    // Control for the negative above: identical fixture plus the one
    // required field. If this ever fails, the negative test is passing
    // for the wrong reason and must be re-read.
    const root = makePluginsDir('load-schema-ok');
    const goodProvider = `
      export default {
        presentation: { label: 'Good', color: '#0891b2' },
        detect() { return null; },
      };
    `;
    writePlugin(
      root,
      'good-provider',
      {
        version: '1.0.0',
        description: 'test',
        specCompat: '>=0.0.0',
        catalogCompat: '*',
      },
      { 'provider/p.mjs': goodProvider },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'enabled');
    strictEqual(result[0]?.extensions?.[0]?.kind, 'provider');
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
            `export default { id: 'x', kind: 'extractor' };`,
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
            `export default { kinds: { agent: {} }, detect() { return null; } };`,
        },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'invalid-manifest');
      match(r[0]!.reason!, /declares `kinds`/);
    });

    it('accepts an EXTERNAL provider declaring activity.install.projectDirEnvVar', async () => {
      // Regression on the spec-first rule. The field was added to the TS
      // interface and to the built-in Claude adapter, but not to
      // `provider.schema.json`, which is `additionalProperties: false`.
      // Nothing was red: built-ins never reach the disk loader, so no
      // built-in and no test exercised that schema. An external provider
      // plugin declaring the field was the only thing that would have
      // failed, at load, in someone else's project.
      const root = makePluginsDir('provider-project-dir-env');
      writePlugin(
        root,
        'ext-provider',
        {
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',
          catalogCompat: '*',
        },
        {
          'provider/p.mjs': [
            'export default {',
            "  presentation: { label: 'Ext', color: '#0891b2' },",
            '  activity: {',
            "    install: { kind: 'json-hooks', configPath: '.ext/hooks.json', projectDirEnvVar: 'EXT_PROJECT_DIR' },",
            '    mapEvent: () => null,',
            '  },',
            "  classify() { return 'agent'; },",
            '};',
          ].join('\n'),
        },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'enabled', r[0]?.reason ?? '');
    });

    it('rejects projectDirEnvVar on a plugin-file descriptor (nothing is spawned)', async () => {
      // Same reasoning as `commandCwd`: an in-process plugin has no
      // command whose path could be anchored, so accepting the field
      // would let an author believe they configured something.
      const root = makePluginsDir('provider-env-on-plugin-file');
      writePlugin(
        root,
        'bad-provider',
        {
          version: '1.0.0',
          description: 'test',
          specCompat: '>=0.0.0',
          catalogCompat: '*',
        },
        {
          'provider/p.mjs': [
            'export default {',
            "  presentation: { label: 'Ext', color: '#0891b2' },",
            '  activity: {',
            "    install: { kind: 'plugin-file', configPath: '.ext/p.js', projectDirEnvVar: 'EXT_PROJECT_DIR' },",
            '    mapEvent: () => null,',
            '  },',
            "  classify() { return 'agent'; },",
            '};',
          ].join('\n'),
        },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      strictEqual(r[0]?.status, 'invalid-manifest');
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
            `export default { presentation: { label: 'Ext', color: '#0891b2' }, classify() { return 'agent'; } };`,
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
            `export default { presentation: { label: 'Ext', color: '#0891b2' }, classify() { return 'agent'; } };`,
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
            `export default { formatId: 'csv', render() { return ''; } };`,
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
        // `contentType` must be a string → fails formatter.schema.json,
        // surfacing the directed "points at its kind schema" diagnostic.
        // (It used to be a MISSING `description`; that field moved to
        // `extension.json`, so its absence is no longer a schema defect.)
        { 'formatter/f.mjs': `export default { contentType: 42 };` },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /spec\/schemas\/extensions\/formatter\.schema\.json/);
    });
  });

  // Action file conventions (structure-as-truth). The retired
  // `reportSchemaRef` / `promptTemplateRef` manifest fields became a
  // folder convention enforced by `validateActionFileConventions`:
  // every Action carries `report.schema.json` next to its `index.*`,
  // and a probabilistic one additionally carries `prompt.md` (a
  // deterministic one must NOT). The AJV conditional in
  // `action.schema.json` still requires `probExpectedDurationSeconds`
  // when `mode: 'probabilistic'`. Mirrors the finder-Analyzer suite
  // below; note the statuses differ by design (a missing convention
  // FILE is `load-error`, a manifest that contradicts the files on disk
  // is `invalid-manifest`).
  describe('Action file conventions (structure-as-truth)', () => {
    const MANIFEST = {
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    };
    /** Minimal report schema; the loader only checks the file EXISTS. */
    const REPORT_SCHEMA = JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:test:action-report',
      type: 'object',
    });

    /** Drop a sibling file into `<plugin>/actions/<name>/`. */
    function writeActionSibling(
      pluginDir: string,
      name: string,
      file: string,
      contents: string,
    ): void {
      writeFileSync(join(pluginDir, 'actions', name, file), contents);
    }

    it('loads a deterministic action carrying report.schema.json', async () => {
      const root = makePluginsDir('action-deterministic');
      const pluginDir = writePlugin(root, 'det-action', MANIFEST, {
        'action/validate-frontmatter.mjs': `
          export default {
            mode: 'deterministic',
            invoke: () => ({ ok: true }),
          };
        `,
      });
      writeActionSibling(pluginDir, 'validate-frontmatter', 'report.schema.json', REPORT_SCHEMA);

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      strictEqual(ext?.kind, 'action');
      strictEqual(ext?.id, 'validate-frontmatter');
      const instance = (ext as { instance?: Record<string, unknown> }).instance;
      strictEqual(instance?.['mode'], 'deterministic');
    });

    it('loads a probabilistic action carrying report.schema.json + prompt.md', async () => {
      const root = makePluginsDir('action-probabilistic');
      const pluginDir = writePlugin(root, 'prob-action', MANIFEST, {
        'action/skill-summarizer.mjs': `
          export default {
            mode: 'probabilistic',
            probExpectedDurationSeconds: 30,
          };
        `,
      });
      writeActionSibling(pluginDir, 'skill-summarizer', 'report.schema.json', REPORT_SCHEMA);
      writeActionSibling(pluginDir, 'skill-summarizer', 'prompt.md', 'Summarize.\n');

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      strictEqual(ext?.kind, 'action');
      const instance = (ext as { instance?: Record<string, unknown> }).instance;
      strictEqual(instance?.['mode'], 'probabilistic');
      strictEqual(instance?.['probExpectedDurationSeconds'], 30);
    });

    it('load-error: action without report.schema.json in its folder', async () => {
      const root = makePluginsDir('action-no-report-schema');
      writePlugin(root, 'schemaless-action', MANIFEST, {
        'action/validate-frontmatter.mjs': `
          export default {
            mode: 'deterministic',
            invoke: () => ({ ok: true }),
          };
        `,
      });

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'load-error');
      match(result[0]!.reason!, /report\.schema\.json/);
      match(result[0]!.reason!, /actions\/validate-frontmatter/);
    });

    it('load-error: probabilistic action without prompt.md in its folder', async () => {
      const root = makePluginsDir('action-prob-no-prompt');
      const pluginDir = writePlugin(root, 'promptless-action', MANIFEST, {
        'action/skill-summarizer.mjs': `
          export default {
            mode: 'probabilistic',
            probExpectedDurationSeconds: 30,
          };
        `,
      });
      writeActionSibling(pluginDir, 'skill-summarizer', 'report.schema.json', REPORT_SCHEMA);

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'load-error');
      match(result[0]!.reason!, /prompt\.md/);
      match(result[0]!.reason!, /Probabilistic Action/);
    });

    it('invalid-manifest: deterministic action carrying a stray prompt.md', async () => {
      // The mirror image of the case above: the files on disk say
      // "probabilistic", the manifest says otherwise. The author has to
      // pick one, so the manifest is what the loader blames.
      const root = makePluginsDir('action-det-stray-prompt');
      const pluginDir = writePlugin(root, 'stray-prompt-action', MANIFEST, {
        'action/validate-frontmatter.mjs': `
          export default {
            mode: 'deterministic',
            invoke: () => ({ ok: true }),
          };
        `,
      });
      writeActionSibling(pluginDir, 'validate-frontmatter', 'report.schema.json', REPORT_SCHEMA);
      writeActionSibling(pluginDir, 'validate-frontmatter', 'prompt.md', 'stray\n');

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /prompt\.md/);
      match(result[0]!.reason!, /Deterministic Action/);
    });

    it('invalid-manifest: probabilistic action without probExpectedDurationSeconds (AJV conditional)', async () => {
      const root = makePluginsDir('action-prob-no-duration');
      const pluginDir = writePlugin(root, 'durationless-action', MANIFEST, {
        'action/skill-summarizer.mjs': `
          export default {
            mode: 'probabilistic',
          };
        `,
      });
      writeActionSibling(pluginDir, 'skill-summarizer', 'report.schema.json', REPORT_SCHEMA);
      writeActionSibling(pluginDir, 'skill-summarizer', 'prompt.md', 'Summarize.\n');

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /probExpectedDurationSeconds/);
      match(result[0]!.reason!, /spec\/schemas\/extensions\/action\.schema\.json/);
    });
  });

  // Findings pipeline, finder (probabilistic Analyzer) file conventions.
  // `spec/schemas/extensions/analyzer.schema.json`: a probabilistic
  // analyzer ships `prompt.md` + `report.schema.json` (extending the
  // canonical findings envelope) by convention; missing either, an
  // unparseable schema, or a schema that does not $ref the envelope is
  // `invalid-manifest`. The AJV conditional additionally requires
  // `probExpectedDurationSeconds` when `mode: 'probabilistic'`.
  describe('finder Analyzer file conventions (structure-as-truth)', () => {
    const FINDER_SOURCE = `
      export default {
        mode: 'probabilistic',
        probExpectedDurationSeconds: 45,
      };
    `;
    const FINDINGS_REPORT_SCHEMA = JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:test:finder-report',
      allOf: [{ $ref: 'https://skill-map.ai/spec/v1/findings/report.schema.json' }],
    });

    /** Drop a sibling file into `<plugin>/analyzers/<name>/`. */
    function writeAnalyzerSibling(
      pluginDir: string,
      name: string,
      file: string,
      contents: string,
    ): void {
      writeFileSync(join(pluginDir, 'analyzers', name, file), contents);
    }

    const MANIFEST = {
      version: '0.1.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    };

    it('loads a valid probabilistic analyzer (prompt.md + findings-extending schema)', async () => {
      const root = makePluginsDir('finder-valid');
      const pluginDir = writePlugin(root, 'finder-plugin', MANIFEST, {
        'analyzer/finder.mjs': FINDER_SOURCE,
      });
      writeAnalyzerSibling(pluginDir, 'finder', 'prompt.md', 'Judge this.\n\n{{userContent}}\n');
      writeAnalyzerSibling(pluginDir, 'finder', 'report.schema.json', FINDINGS_REPORT_SCHEMA);

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      strictEqual(ext?.kind, 'analyzer');
      strictEqual(ext?.id, 'finder');
      const instance = (ext as { instance?: Record<string, unknown> }).instance;
      strictEqual(instance?.['mode'], 'probabilistic');
      strictEqual(instance?.['probExpectedDurationSeconds'], 45);
    });

    it('invalid-manifest: probabilistic analyzer missing prompt.md', async () => {
      const root = makePluginsDir('finder-no-prompt');
      const pluginDir = writePlugin(root, 'finder-plugin', MANIFEST, {
        'analyzer/finder.mjs': FINDER_SOURCE,
      });
      writeAnalyzerSibling(pluginDir, 'finder', 'report.schema.json', FINDINGS_REPORT_SCHEMA);

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /prompt\.md/);
    });

    it('invalid-manifest: probabilistic analyzer missing report.schema.json', async () => {
      const root = makePluginsDir('finder-no-schema');
      const pluginDir = writePlugin(root, 'finder-plugin', MANIFEST, {
        'analyzer/finder.mjs': FINDER_SOURCE,
      });
      writeAnalyzerSibling(pluginDir, 'finder', 'prompt.md', 'Judge this.\n\n{{userContent}}\n');

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /report\.schema\.json/);
    });

    it('invalid-manifest: report schema does not extend the findings envelope', async () => {
      const root = makePluginsDir('finder-wrong-schema');
      const pluginDir = writePlugin(root, 'finder-plugin', MANIFEST, {
        'analyzer/finder.mjs': FINDER_SOURCE,
      });
      writeAnalyzerSibling(pluginDir, 'finder', 'prompt.md', 'Judge this.\n\n{{userContent}}\n');
      writeAnalyzerSibling(
        pluginDir,
        'finder',
        'report.schema.json',
        JSON.stringify({
          $id: 'urn:test:not-findings',
          allOf: [{ $ref: 'https://skill-map.ai/spec/v1/report-base.schema.json' }],
        }),
      );

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /findings/);
    });

    it('invalid-manifest: probabilistic analyzer without probExpectedDurationSeconds (AJV conditional)', async () => {
      const root = makePluginsDir('finder-no-duration');
      const pluginDir = writePlugin(root, 'finder-plugin', MANIFEST, {
        'analyzer/finder.mjs': `
          export default {
            mode: 'probabilistic',
          };
        `,
      });
      writeAnalyzerSibling(pluginDir, 'finder', 'prompt.md', 'Judge this.\n\n{{userContent}}\n');
      writeAnalyzerSibling(pluginDir, 'finder', 'report.schema.json', FINDINGS_REPORT_SCHEMA);

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /spec\/schemas\/extensions\/analyzer\.schema\.json/);
    });

    it('a modeless (deterministic-default) analyzer validates without probExpectedDurationSeconds', async () => {
      // The schema conditional carries `required: ['mode']` inside its
      // if-block, so an absent `mode` (defaulting to deterministic)
      // never trips the probabilistic-only requirement.
      const root = makePluginsDir('finder-modeless-det');
      writePlugin(root, 'modeless-plugin', MANIFEST, {
        'analyzer/det-rule.mjs': `
          export default {
            evaluate: () => [],
          };
        `,
      });

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'enabled');
      strictEqual(result[0]?.extensions?.[0]?.kind, 'analyzer');
    });

    it('invalid-manifest: deterministic analyzer carrying a stray prompt.md', async () => {
      const root = makePluginsDir('finder-det-prompt');
      const pluginDir = writePlugin(root, 'det-plugin', MANIFEST, {
        'analyzer/det-rule.mjs': `
          export default {
            mode: 'deterministic',
            evaluate: () => [],
          };
        `,
      });
      writeAnalyzerSibling(pluginDir, 'det-rule', 'prompt.md', 'stray\n');

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /prompt\.md/);
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
        export default {};
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
        export default { extract() {} };
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

  // Spec § A.5, plugin id global uniqueness. The old suite had two
  // enforcement points; only one survives.
  //   (a) "directory name MUST equal manifest id" is GONE by
  //       construction: with structure-as-truth the manifest carries no
  //       `id`, the directory name IS the id (`pathId`), so the two can
  //       no longer disagree. Nothing to test.
  //   (b) cross-root same-id collision → `id-collision` on every member
  //       of the group, rewritten below against the path-derived id
  //       (`applyIdCollisions` in `plugin-loader/id-utils.ts`).
  // The sibling lane, a drop-in directory shadowing a BUILT-IN plugin
  // id, lives in `plugin-builtin-shadowing.spec.ts` (it runs before this
  // pass and cannot be exercised from here: built-ins never appear in
  // `IDiscoveredPlugin[]`).
  describe('Step A.5, cross-root id collision', () => {
    const MANIFEST = {
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    };
    const EXTRACTOR_SRC = `export default { scope: 'body', extract() {} };`;

    it('id-collision: two plugins in different roots resolve to the same id', async () => {
      const rootA = makePluginsDir('collide-A');
      const rootB = makePluginsDir('collide-B');
      // Same directory name 'twin' under two different parent roots.
      // Each plugin is individually valid; only the pair is not.
      writePlugin(rootA, 'twin', { ...MANIFEST, version: '1.0.0' }, {
        'extractor/d.mjs': EXTRACTOR_SRC,
      });
      writePlugin(rootB, 'twin', { ...MANIFEST, version: '2.0.0' }, {
        'extractor/d.mjs': EXTRACTOR_SRC,
      });

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 2);
      // Both members of the collision pair receive the status, no
      // precedence rule applies (neither root wins).
      for (const p of result) {
        strictEqual(p.status, 'id-collision');
        match(p.reason!, /Plugin 'twin' at .* collides with the plugin at .*\. Rename one and rerun\./);
      }
      // Each reason names the OTHER path, not its own, so the operator
      // can tell the two directories apart.
      const a = result.find((p) => p.path.includes('collide-A'))!;
      const b = result.find((p) => p.path.includes('collide-B'))!;
      ok(a.reason!.includes(b.path), `A's reason must name B's path; got: ${a.reason}`);
      ok(b.reason!.includes(a.path), `B's reason must name A's path; got: ${b.reason}`);
      // Extensions are stripped from a colliding plugin so a careless
      // caller cannot register them; the manifest stays for diagnostics.
      strictEqual(result[0]?.extensions, undefined);
      strictEqual(result[1]?.extensions, undefined);
      ok(result[0]?.manifest, 'manifest kept for `sm plugins list/show`');
    });

    it('id-collision: three-way collision lists every other path in the reason', async () => {
      const rootA = makePluginsDir('collide-3-A');
      const rootB = makePluginsDir('collide-3-B');
      const rootC = makePluginsDir('collide-3-C');
      for (const root of [rootA, rootB, rootC]) {
        writePlugin(root, 'triplet', MANIFEST, { 'extractor/d.mjs': EXTRACTOR_SRC });
      }

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB, rootC],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 3);
      for (const p of result) {
        strictEqual(p.status, 'id-collision');
        // The rare 3-way case joins the remaining paths, so every
        // member's reason names BOTH of its neighbours.
        for (const other of result.filter((q) => q.path !== p.path)) {
          ok(p.reason!.includes(other.path), `reason must name ${other.path}; got: ${p.reason}`);
        }
      }
    });

    it('id-collision: a non-colliding plugin alongside a colliding pair is unaffected', async () => {
      const rootA = makePluginsDir('mix-A');
      const rootB = makePluginsDir('mix-B');
      writePlugin(rootA, 'twin', MANIFEST, { 'extractor/d.mjs': EXTRACTOR_SRC });
      writePlugin(rootB, 'twin', MANIFEST, { 'extractor/d.mjs': EXTRACTOR_SRC });
      // Independent plugin in rootA, its id is unique across the search set.
      writePlugin(rootA, 'solo', MANIFEST, { 'extractor/d.mjs': EXTRACTOR_SRC });

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 3);
      const solo = result.find((p) => p.id === 'solo');
      strictEqual(solo?.status, 'enabled');
      strictEqual(solo?.extensions?.length, 1, 'a bystander keeps its extensions');
      // Both 'twin' entries collide.
      const twins = result.filter((p) => p.id === 'twin');
      strictEqual(twins.length, 2);
      strictEqual(twins.every((p) => p.status === 'id-collision'), true);
    });

    it('id-collision: a parse-failed sibling does not muddy the trusted-id collision report', async () => {
      // A plugin whose plugin.json fails to parse exposes an *untrusted*
      // id (the directory basename). It must NOT be confused with a real
      // id collision: the loader excludes manifest-less entries from
      // the collision-detection set.
      const rootA = makePluginsDir('mud-A');
      const rootB = makePluginsDir('mud-B');
      // A real, valid plugin with id 'sibling' under rootA.
      writePlugin(rootA, 'sibling', MANIFEST, { 'extractor/d.mjs': EXTRACTOR_SRC });
      // A directory under rootB also called 'sibling', but with a broken
      // plugin.json: its fall-back id is 'sibling' (path basename) while
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
      strictEqual(valid?.extensions?.length, 1);
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
        'extractor/d.mjs': `export default { extract() {} };`,
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

  // Spec § A.6, qualified extension ids. The contract is unchanged (the
  // registry keys by `<pluginId>/<id>`, so the loader stamps `pluginId`
  // onto every loaded extension); only the SOURCE moved. It used to be
  // `plugin.json#/id`; with structure-as-truth it is the plugin
  // DIRECTORY name, exactly like `id` is the extension's leaf folder.
  describe('Step A.6, qualified id injection', () => {
    const MANIFEST = {
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    };

    it('injects the plugin DIRECTORY name as pluginId on every loaded extension', async () => {
      const root = makePluginsDir('a6-injection');
      // Neither id nor pluginId is declared anywhere in the fixture: both
      // halves of `my-plugin/greet` come from the path.
      writePlugin(root, 'my-plugin', MANIFEST, {
        'extractor/greet.mjs': `export default { scope: 'body', extract() {} };`,
      });
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      ok(ext, 'expected one loaded extension');
      strictEqual(ext.id, 'greet');
      strictEqual(ext.pluginId, 'my-plugin');
      // The runtime instance handed to the registry carries the same
      // stamp, not just the `ILoadedExtension` envelope.
      const instance = (ext as { instance?: Record<string, unknown> }).instance;
      strictEqual(instance?.['pluginId'], 'my-plugin');
      strictEqual(instance?.['id'], 'greet');
    });

    it('tolerates a matching pluginId hand-coded in the extension', async () => {
      // Defensive: an author who copies built-ins style and includes
      // `pluginId` matching the directory name is accepted (no-op). The
      // loader strips the field before AJV so it doesn't violate
      // `unevaluatedProperties: false`. Unlike `id` / `kind`, which are
      // rejected outright even when they match.
      const root = makePluginsDir('a6-tolerate');
      writePlugin(root, 'my-plugin', MANIFEST, {
        'extractor/greet.mjs':
          `export default { pluginId: 'my-plugin', scope: 'body', extract() {} };`,
      });
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'enabled');
      strictEqual(result[0]?.extensions?.[0]?.pluginId, 'my-plugin');
    });

    it('invalid-manifest: extension declares a pluginId that disagrees with its directory', async () => {
      const root = makePluginsDir('a6-mismatch');
      writePlugin(root, 'my-plugin', MANIFEST, {
        'extractor/greet.mjs':
          `export default { pluginId: 'someone-else', scope: 'body', extract() {} };`,
      });
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      ok(result[0]?.reason, 'reason populated');
      match(result[0]!.reason!, /pluginId 'someone-else'/);
      match(result[0]!.reason!, /id 'my-plugin'/);
    });

    // The `granularity` manifest field was removed (every extension is
    // independently toggle-able by its qualified id). `plugin.json` is
    // validated with `additionalProperties: false`, so a manifest that
    // still declares it is rejected as `invalid-manifest`.
    describe('granularity field removed', () => {
      it('manifest declaring granularity is rejected as invalid-manifest', async () => {
        const root = makePluginsDir('granularity-rejected');
        writePlugin(
          root,
          'legacy',
          { ...MANIFEST, granularity: 'plugin' },
          { 'extractor/one.mjs': `export default { scope: 'body', extract() {} };` },
        );
        const result = await loaderFor(root).discoverAndLoadAll();
        strictEqual(result.length, 1);
        strictEqual(result[0]?.status, 'invalid-manifest');
        match(result[0]!.reason!, /granularity/);
        match(result[0]!.reason!, /plugins-registry\.schema\.json/);
      });
    });
  });

  // Spec § A.10's Extractor `applicableKinds` was retired in favour of
  // `precondition.kind` (qualified `<provider-plugin>/<kindName>`). The
  // FILTER behaviour (which nodes the extractor is invoked against, and
  // that `extract()` is never called for excluded kinds) moved to
  // `src/__tests__/integration/extractor-applicable-kinds.spec.ts`; do
  // not re-add it here, the loader cannot observe invocation.
  //
  // What stays is the loader half of the old suite: the two declaration
  // shapes the loader accepts / rejects at load time. They are NOT
  // covered by the integration file, which builds its extractors in
  // memory and never goes through AJV.
  describe('Step A.10, precondition.kind declaration (loader half)', () => {
    const MANIFEST = {
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    };

    it('an unknown qualified kind loads OK (status: enabled), it is a doctor warning, not a load failure', async () => {
      const root = makePluginsDir('a10-unknown-kind');
      writePlugin(root, 'maybe-someday', MANIFEST, {
        'extractor/d.mjs': `
          export default {
            scope: 'body',
            precondition: { kind: ['nobody/unknownKind'] },
            extract() {},
          };
        `,
      });
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      ok(ext, 'extension loaded');
      // The declaration survives the load: the loader does not strip it,
      // the orchestrator's matcher and `sm plugins doctor` both read it
      // off the runtime instance afterwards.
      const instance = (ext as { instance?: Record<string, unknown> }).instance;
      deepStrictEqual(
        (instance?.['precondition'] as { kind?: unknown } | undefined)?.kind,
        ['nobody/unknownKind'],
      );
    });

    it('invalid-manifest: precondition.kind: [] is rejected by AJV (minItems: 1)', async () => {
      const root = makePluginsDir('a10-empty-array');
      writePlugin(root, 'empty-applies', MANIFEST, {
        'extractor/d.mjs': `
          export default {
            scope: 'body',
            precondition: { kind: [] },
            extract() {},
          };
        `,
      });
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      // AJV rejects the exported extension shape against the kind schema
      // (`extractor.schema.json#/properties/precondition/properties/kind/minItems`).
      // Per spec/architecture.md §Plugin discovery that surfaces as
      // `invalid-manifest`: the module imported fine, only the declared
      // shape is wrong.
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /precondition\/kind/);
      match(result[0]!.reason!, /fewer than 1|minItems/i);
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
        `export default { id: 'x', kind: 'extractor' };`,
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
        'extractor/url-counter.mjs': "export default {};",
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
        'extractor/url-counter.mjs': "export default {};",
      });
      // No resolveImportTrust option at all.
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]!.status, 'enabled');
      strictEqual(result[0]!.extensions?.length, 1);
    });
  });
});
