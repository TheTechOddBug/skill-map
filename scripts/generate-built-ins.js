#!/usr/bin/env node
/**
 * Codegen for `src/plugins/built-ins.ts`.
 *
 * Walks `src/plugins/<plugin>/{plugin.json, <kind>s/<name>/index.ts}` and
 * emits a TypeScript module that statically imports every built-in
 * extension and exposes the same API as the hand-written predecessor
 * (`builtInPlugins`, `builtIns()`, `listBuiltIns()`).
 *
 * Plugin metadata (id, description) is read from each plugin's
 * `plugin.json#/...` at codegen time and inlined; no JSON files ship in
 * `dist/`. There is no toggle-granularity concept anymore: every
 * extension is independently toggle-able, the plugin row is purely a
 * presentational grouping.
 *
 * Convention: the named export inside each `<kind>s/<name>/index.ts`
 * follows `camelCase(<name>) + <Kind>` (e.g. `tools-count` extractor
 * exports `toolsCountExtractor`). The codegen derives the import binding
 * from this rule. AI (probabilistic) extensions follow the
 * `ai-<subject>-<kind>` folder pattern, which already ends in the kind, so
 * the export is just `camelCase(<name>)` with no doubled suffix
 * (`ai-redundancy-analyzer` exports `aiRedundancyAnalyzer`).
 *
 * Run:
 *   node scripts/generate-built-ins.js
 *
 * Wired as `prebuild` in `src/package.json`; also exposed as
 * `built-ins:check` (drift-check) that fails CI when the committed
 * `built-ins.ts` is stale.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PLUGINS_ROOT = resolve(REPO_ROOT, 'src', 'plugins');
const OUTPUT = join(PLUGINS_ROOT, 'built-ins.ts');

/**
 * Canonical plugin order. Vendor providers FIRST so the kindRegistry
 * composer encounters them before the markdown fallback in `core`
 * (`github` ships no provider, so its slot before `core` is
 * presentational only). The matching directories under
 * `src/plugins/<id>/` must all exist, and the inverse holds too:
 * every `src/plugins/<dir>/plugin.json` must be listed here
 * (checked by `assertOrderCoversDirectories`), so a new plugin
 * directory cannot be silently omitted from the generated registry.
 */
const PLUGIN_ORDER = ['claude', 'antigravity', 'codex', 'opencode', 'agent-skills', 'github', 'core', 'test-plugin'];

/**
 * Within a plugin, kinds register in this order so the resulting list
 * mirrors the legacy `built-ins.ts` snapshot ordering (providers first
 * within `core` so `kindRegistry` picks them up alongside vendors, then
 * extractors → analyzers → formatters → actions → hooks).
 */
const KIND_ORDER = ['provider', 'extractor', 'analyzer', 'formatter', 'action', 'hook'];

const KIND_TO_DIR = Object.fromEntries(KIND_ORDER.map((k) => [k, `${k}s`]));

/** TS interface name per kind, used for the bucket fields in `IBuiltIns`. */
const KIND_TO_TYPE = {
  provider: 'IProvider',
  extractor: 'IExtractor',
  analyzer: 'IAnalyzer',
  action: 'IAction',
  formatter: 'IFormatter',
  hook: 'IHook',
};

function camelCase(kebab) {
  const parts = kebab.split('-');
  return parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function exportNameFor(name, kind) {
  const base = camelCase(name);
  const suffix = capitalize(kind);
  // The AI-extension naming pattern encodes the kind in the folder name
  // itself (`ai-<subject>-analyzer` / `ai-<subject>-action`), so
  // `camelCase(name)` already ends with the capitalized kind. Appending it
  // again would double the suffix (`aiRedundancyAnalyzerAnalyzer`); skip it
  // when the base already carries the kind. Folders that do NOT encode the
  // kind (e.g. `node-stability`, `tools-count`) still get it appended.
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

/**
 * Emit a TypeScript single-quoted string literal. Escapes internal
 * single quotes and backslashes; preserves everything else verbatim
 * (template-literal characters like backticks are fine inside
 * single-quoted strings).
 */
function singleQuoted(str) {
  return `'${String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Emit a TypeScript template-literal (backtick) for a multi-line string,
 * escaping the three sequences that would otherwise break out of the
 * literal: backslash, backtick, and `${` interpolation. Used to inline a
 * probabilistic Action's `prompt.md` verbatim (newlines preserved) while
 * staying lint-clean under `@stylistic/quotes` (`allowTemplateLiterals`).
 */
function templateLiteral(str) {
  const body = String(str)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  return `\`${body}\``;
}

/**
 * Emit a `JSON.parse('...')` expression that rebuilds `value` at import
 * time. The JSON is wrapped in a single-quoted string (via `singleQuoted`)
 * so the generated line stays under the repo's single-quote lint rule even
 * though JSON itself is double-quote heavy. Used to inline a probabilistic
 * Action's parsed `report.schema.json`.
 */
function jsonParseLiteral(value) {
  return `JSON.parse(${singleQuoted(JSON.stringify(value))})`;
}

/** True when an extension manifest source declares `mode: 'probabilistic'`. */
function isProbabilisticSource(indexTsSource) {
  return /\bmode\s*:\s*['"]probabilistic['"]/.test(indexTsSource);
}

/** `$id` prefix of the canonical findings envelope (mirror of `kernel/jobs/findings-schema.ts`). */
const FINDINGS_SCHEMA_ID_PREFIX = 'https://skill-map.ai/spec/v1/findings/';

/**
 * Structural scan for a `$ref` under the canonical findings namespace,
 * mirror of `reportSchemaExtendsFindings` in
 * `src/kernel/jobs/findings-schema.ts` (this script is plain JS and
 * runs before the TS build, so it cannot import the kernel helper).
 */
function schemaExtendsFindings(value) {
  if (Array.isArray(value)) return value.some((item) => schemaExtendsFindings(item));
  if (typeof value !== 'object' || value === null) return false;
  const ref = value.$ref;
  if (typeof ref === 'string' && ref.startsWith(FINDINGS_SCHEMA_ID_PREFIX)) {
    const rest = ref.slice(FINDINGS_SCHEMA_ID_PREFIX.length);
    const file = rest.includes('#') ? rest.slice(0, rest.indexOf('#')) : rest;
    if (file.endsWith('.schema.json') && !file.slice(0, -'.schema.json'.length).includes('/')) {
      return true;
    }
  }
  return Object.values(value).some((item) => schemaExtendsFindings(item));
}

/**
 * Read a built-in Action's structure-as-truth sibling files. EVERY
 * Action carries `report.schema.json` by convention (it is the report
 * contract AND the summarizer / enricher detection signal), so the
 * codegen inlines it onto every emitted action manifest, deterministic
 * and probabilistic alike (built-ins have no source directory at
 * runtime to read it from). `prompt.md` is probabilistic-only: required
 * there, and FORBIDDEN on a deterministic Action (the spec calls that
 * combination a `load-error`, config inconsistent, see
 * `spec/schemas/extensions/action.schema.json`). Fails loudly on every
 * violation.
 */
function readActionAssets(entryDir, name, isProbabilistic) {
  const promptPath = join(entryDir, 'prompt.md');
  const reportPath = join(entryDir, 'report.schema.json');
  if (isProbabilistic && !existsSync(promptPath)) {
    throw new Error(
      `Probabilistic built-in action '${name}' is missing prompt.md at ${promptPath}. ` +
        'Every probabilistic Action carries a prompt template by convention.',
    );
  }
  if (!isProbabilistic && existsSync(promptPath)) {
    throw new Error(
      `Deterministic built-in action '${name}' carries a prompt.md at ${promptPath}. ` +
        'A deterministic Action with a prompt template is config-inconsistent (spec: load-error).',
    );
  }
  if (!existsSync(reportPath)) {
    throw new Error(
      `Built-in action '${name}' is missing report.schema.json at ${reportPath}. ` +
        'Every Action carries a report schema by convention.',
    );
  }
  let reportSchema;
  try {
    reportSchema = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Built-in action '${name}' has invalid report.schema.json at ${reportPath}: ${err.message}`,
    );
  }
  const assets = { reportSchema };
  if (isProbabilistic) assets.promptTemplate = readFileSync(promptPath, 'utf8');
  return assets;
}

/**
 * Read a built-in Analyzer's structure-as-truth sibling files, the
 * finder mirror of `readActionAssets`. Only PROBABILISTIC analyzers
 * carry the convention: `prompt.md` + `report.schema.json`, the latter
 * extending the canonical findings envelope
 * (`spec/schemas/findings/report.schema.json`) via `$ref`. Deterministic
 * analyzers ship neither (a stray `prompt.md` is config-inconsistent and
 * fails loudly, mirroring the loader's `invalid-manifest`). Returns
 * `null` for the deterministic case (nothing to inline).
 */
function readAnalyzerAssets(entryDir, name, isProbabilistic) {
  const promptPath = join(entryDir, 'prompt.md');
  const reportPath = join(entryDir, 'report.schema.json');
  if (!isProbabilistic) {
    if (existsSync(promptPath)) {
      throw new Error(
        `Deterministic built-in analyzer '${name}' carries a prompt.md at ${promptPath}. ` +
          'A deterministic Analyzer with a prompt template is config-inconsistent (spec: invalid-manifest).',
      );
    }
    return null;
  }
  if (!existsSync(promptPath)) {
    throw new Error(
      `Probabilistic built-in analyzer '${name}' is missing prompt.md at ${promptPath}. ` +
        'Every probabilistic Analyzer carries a prompt template by convention.',
    );
  }
  if (!existsSync(reportPath)) {
    throw new Error(
      `Probabilistic built-in analyzer '${name}' is missing report.schema.json at ${reportPath}. ` +
        'Every probabilistic Analyzer carries a findings report schema by convention.',
    );
  }
  let reportSchema;
  try {
    reportSchema = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Built-in analyzer '${name}' has invalid report.schema.json at ${reportPath}: ${err.message}`,
    );
  }
  if (!schemaExtendsFindings(reportSchema)) {
    throw new Error(
      `Built-in analyzer '${name}' has a report.schema.json at ${reportPath} that does not ` +
        `$ref the canonical findings envelope (${FINDINGS_SCHEMA_ID_PREFIX}report.schema.json).`,
    );
  }
  return { promptTemplate: readFileSync(promptPath, 'utf8'), reportSchema };
}

function discoverPlugin(pluginId) {
  const pluginDir = join(PLUGINS_ROOT, pluginId);
  const manifestPath = join(pluginDir, 'plugin.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing plugin.json for plugin '${pluginId}' at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const extensions = [];
  for (const kind of KIND_ORDER) {
    const kindDir = join(pluginDir, KIND_TO_DIR[kind]);
    if (!existsSync(kindDir)) continue;
    const entries = readdirSync(kindDir).sort();
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const entryDir = join(kindDir, entry);
      let isDir = false;
      try {
        isDir = statSync(entryDir).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      const indexTs = join(entryDir, 'index.ts');
      if (!existsSync(indexTs)) continue;
      // Lock guard: nothing experimental / deprecated is lockable (the
      // lock arm bypasses the config layers, so a locked-but-unready
      // extension could never be turned off). Source-level scan, same
      // posture as `isProbabilisticSource`.
      const indexSource = readFileSync(indexTs, 'utf8');
      if (
        /\block(ed)?\s*:\s*true/.test(indexSource) &&
        /\bstability\s*:\s*['"](experimental|deprecated)['"]/.test(indexSource)
      ) {
        throw new Error(
          `${pluginId}/${entry}: 'locked: true' on an experimental/deprecated extension. Nothing experimental is lockable; graduate it first.`,
        );
      }
      const extension = {
        kind,
        name: entry,
        exportName: exportNameFor(entry, kind),
        importFrom: `./${pluginId}/${KIND_TO_DIR[kind]}/${entry}/index.js`,
      };
      // Structure-as-truth: a built-in Action has no source directory
      // at runtime, so inline its sibling report.schema.json (every
      // Action) plus prompt.md (probabilistic only) onto the emitted
      // manifest (the built-in equivalent of the on-disk files a user
      // plugin resolves at load).
      if (kind === 'action') {
        const isProbabilistic = isProbabilisticSource(readFileSync(indexTs, 'utf8'));
        const { promptTemplate, reportSchema } = readActionAssets(entryDir, entry, isProbabilistic);
        if (promptTemplate !== undefined) extension.promptTemplate = promptTemplate;
        extension.reportSchema = reportSchema;
      }
      // Finder mirror: a built-in PROBABILISTIC analyzer inlines its
      // prompt.md + report.schema.json (validated to extend the
      // canonical findings envelope). Deterministic analyzers inline
      // nothing.
      if (kind === 'analyzer') {
        const isProbabilistic = isProbabilisticSource(readFileSync(indexTs, 'utf8'));
        const assets = readAnalyzerAssets(entryDir, entry, isProbabilistic);
        if (assets !== null) {
          extension.promptTemplate = assets.promptTemplate;
          extension.reportSchema = assets.reportSchema;
        }
      }
      extensions.push(extension);
    }
  }
  return { manifest, extensions };
}

function render(plugins) {
  const lines = [];
  lines.push('// AUTO-GENERATED by scripts/generate-built-ins.js. Do not edit by hand.');
  lines.push('// Regenerate with `pnpm --filter @skill-map/cli build-built-ins`.');
  lines.push('// Source of truth: each plugin\'s plugin.json + filesystem layout under');
  lines.push('// src/plugins/<plugin>/<kind>s/<name>/index.ts.');
  lines.push('');
  lines.push('import type {');
  lines.push('  IAction,');
  lines.push('  IProvider,');
  lines.push('  IExtractor,');
  lines.push('  IFormatter,');
  lines.push('  IHook,');
  lines.push('  IAnalyzer,');
  lines.push("} from '../kernel/extensions/index.js';");
  lines.push("import type { IExtension } from '../kernel/registry.js';");
  lines.push("import { bucketByKind } from '../kernel/util/bucket-by-kind.js';");
  lines.push("import { VERSION } from '../version.js';");
  lines.push('');

  // Imports (one per extension, alias-renamed so we can wrap with pluginId injection).
  for (const { pluginId, extensions } of plugins) {
    for (const ext of extensions) {
      lines.push(
        `import { ${ext.exportName} as _${ext.exportName} } from '${ext.importFrom}';`,
      );
    }
  }
  lines.push('');

  // Wrapped consts that stamp `pluginId` (from the plugin directory name)
  // and `version`. Authors of built-in manifests omit `version` since they
  // all ship inside the CLI bundle; the stamp here is what makes the
  // resulting object satisfy the full kind interface (e.g. `IAnalyzer`) at
  // the TypeScript level. `version` references the runtime `VERSION`
  // constant (which reads `src/package.json` at import time) instead of a
  // baked-in literal, so a version bump never rewrites this generated file.
  for (const { pluginId, extensions } of plugins) {
    for (const ext of extensions) {
      // Probabilistic built-in Actions carry their prompt.md /
      // report.schema.json inlined (read at codegen time); everything else
      // gets the plain pluginId + version stamp.
      const extras = [];
      if (ext.promptTemplate !== undefined) {
        extras.push(`promptTemplate: ${templateLiteral(ext.promptTemplate)}`);
      }
      if (ext.reportSchema !== undefined) {
        extras.push(`reportSchema: ${jsonParseLiteral(ext.reportSchema)}`);
      }
      const extraStr = extras.length > 0 ? `, ${extras.join(', ')}` : '';
      lines.push(
        `const ${ext.exportName} = { ..._${ext.exportName}, pluginId: '${pluginId}', version: VERSION${extraStr} };`,
      );
    }
  }
  lines.push('');

  lines.push('export interface IBuiltIns {');
  for (const kind of KIND_ORDER) {
    lines.push(`  ${KIND_TO_DIR[kind]}: ${KIND_TO_TYPE[kind]}[];`);
  }
  lines.push('}');
  lines.push('');
  lines.push(
    'export type TBuiltInExtension = IProvider | IExtractor | IAnalyzer | IAction | IFormatter | IHook;',
  );
  lines.push('');
  lines.push('export interface IBuiltInPlugin {');
  lines.push('  id: string;');
  lines.push('  description: string;');
  lines.push('  extensions: TBuiltInExtension[];');
  lines.push('}');
  lines.push('');

  lines.push('export const builtInPlugins: IBuiltInPlugin[] = [');
  for (const { pluginId, manifest, extensions } of plugins) {
    lines.push('  {');
    // Structure-as-truth: the plugin id comes from the directory name,
    // not from `plugin.json#/id` (the manifest no longer carries that
    // field). Every extension is independently toggle-able; the plugin
    // row is a presentational grouping only.
    lines.push(`    id: '${pluginId}',`);
    lines.push(`    description: ${singleQuoted(manifest.description)},`);
    lines.push('    extensions: [');
    for (const ext of extensions) {
      lines.push(`      ${ext.exportName},`);
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');

  lines.push('export function builtIns(): IBuiltIns {');
  lines.push('  const out: IBuiltIns = {');
  for (const kind of KIND_ORDER) {
    lines.push(`    ${KIND_TO_DIR[kind]}: [],`);
  }
  lines.push('  };');
  lines.push('  for (const plugin of builtInPlugins) {');
  lines.push('    for (const ext of plugin.extensions) {');
  lines.push('      bucketBuiltIn(ext, out);');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return out;');
  lines.push('}');
  lines.push('');

  lines.push('export function listBuiltIns(): IExtension[] {');
  lines.push('  const out: IExtension[] = [];');
  lines.push('  for (const plugin of builtInPlugins) {');
  lines.push('    for (const x of plugin.extensions) {');
  lines.push('      out.push(toExtensionRow(x));');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return out;');
  lines.push('}');
  lines.push('');

  lines.push('function bucketBuiltIn(ext: TBuiltInExtension, out: IBuiltIns): void {');
  lines.push('  bucketByKind(ext.kind, ext, {');
  for (const kind of KIND_ORDER) {
    lines.push(`    ${kind}: out.${KIND_TO_DIR[kind]},`);
  }
  lines.push('  });');
  lines.push('}');
  lines.push('');

  // `stability` / `defaultEnabled` MUST be carried onto the row.
  //
  // They were dropped here on the claim that "stability was retired with
  // the manifest refactor", which was simply wrong: it is declared on
  // `IExtension`, on `extension-manifest.schema.json`, and it drives the
  // installed default. Omitting it made `filterBuiltInManifests` read
  // `undefined` for both, so `installedDefaultEnabled` returned `true`
  // and the filter kept rows it should have dropped, e.g.
  // `github/enrichment` (experimental) and `core/node-bump`
  // (`defaultEnabled: false`) registering on a project with no config.
  // Execution was never affected (those gates read live instances, not
  // rows); this was registry VISIBILITY, so `sm help` and the registry
  // listed extensions that ship disabled.
  //
  // `preconditions` really is gone; `entry` is loader-runtime and not
  // surfaced on a built-in row.
  lines.push('function toExtensionRow(x: TBuiltInExtension): IExtension {');
  lines.push('  const row: IExtension = {');
  lines.push('    id: x.id,');
  lines.push('    pluginId: x.pluginId,');
  lines.push('    kind: x.kind,');
  lines.push('    version: x.version,');
  lines.push('    description: x.description ?? \'\',');
  lines.push('  };');
  lines.push('  if (x.stability !== undefined) row.stability = x.stability;');
  lines.push('  if (x.defaultEnabled !== undefined) row.defaultEnabled = x.defaultEnabled;');
  lines.push('  return row;');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/**
 * A plugin directory that ships a `plugin.json` but is missing from
 * `PLUGIN_ORDER` would be dropped from the generated registry with no
 * diagnostic: the downstream drift guards (loader reservation list,
 * telemetry allow-list) compare against the GENERATED output, so they
 * would agree with the omission instead of catching it. Fail loudly
 * here, in both write and `--check` mode.
 */
function assertOrderCoversDirectories() {
  const listed = new Set(PLUGIN_ORDER);
  const unlisted = readdirSync(PLUGINS_ROOT)
    .filter((entry) => statSync(join(PLUGINS_ROOT, entry)).isDirectory())
    .filter((dir) => existsSync(join(PLUGINS_ROOT, dir, 'plugin.json')))
    .filter((dir) => !listed.has(dir));
  if (unlisted.length > 0) {
    throw new Error(
      `Plugin directories with a plugin.json missing from PLUGIN_ORDER: ${unlisted.join(', ')}. ` +
        'Add them to PLUGIN_ORDER in scripts/generate-built-ins.js, otherwise the built-ins registry omits them.',
    );
  }
}

function main() {
  assertOrderCoversDirectories();
  const plugins = PLUGIN_ORDER.map((pluginId) => {
    const { manifest, extensions } = discoverPlugin(pluginId);
    return { pluginId, manifest, extensions };
  });

  const content = render(plugins);

  const mode = process.argv[2];
  if (mode === '--check') {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
    if (current !== content) {
      process.stderr.write(
        `${OUTPUT} is stale. Run \`pnpm --filter @skill-map/cli build-built-ins\` and commit the result.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${OUTPUT} is up to date.\n`);
    return;
  }

  writeFileSync(OUTPUT, content);
  const total = plugins.reduce((acc, b) => acc + b.extensions.length, 0);
  process.stdout.write(
    `${OUTPUT} written (${plugins.length} plugins, ${total} extensions).\n`,
  );
}

main();
