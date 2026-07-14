/**
 * Spec-driven per-extension validations the loader runs AFTER the
 * kind-specific AJV manifest pass.
 *
 *   - `validateAnnotationContributions`, spec § 9.6.6: root keys must
 *     be `exclusive`; every inline `schema` must AJV-compile.
 *   - `validateHookTriggers`, spec § A.11: a hook MUST declare at
 *     least one trigger and every trigger MUST appear in the curated
 *     hookable set.
 *
 * Both return either a populated `IDiscoveredPlugin` failure row or
 * `null` when the extension is well-formed.
 */

import * as nodeFs from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';

import type { IDiscoveredPlugin, IPluginManifest } from '../../types/plugin.js';
import type { ExtensionKind } from '../../registry.js';
import { PLUGIN_LOADER_TEXTS, SPEC_GITHUB_BASE } from '../../i18n/plugin-loader.texts.js';
import { reportSchemaExtendsFindings } from '../../jobs/findings-schema.js';
import { applyAjvFormats } from '../../util/ajv-interop.js';
import { tx } from '../../util/tx.js';
import { HOOK_TRIGGERS } from '../../extensions/hook.js';
import { describe, fail, isRecord } from './id-utils.js';

type TAjv = InstanceType<typeof Ajv2020>;

/**
 * Runtime descriptor the loader projects from one `kinds/<name>/`
 * folder pair. `ui` + `identifiers` + `identifierMismatch` come from
 * `kind.json` (AJV-validated against `provider-kind.schema.json`);
 * `schema` / `schemaJson` from the sibling `schema.json`. Structure-as-
 * truth replacement for the old inline `kinds` map on the manifest;
 * external Providers reach the same name-resolution lane built-ins get
 * from their TypeScript `IProviderKind.identifiers`.
 */
export interface IDiscoveredProviderKind {
  schema: string;
  schemaJson: unknown;
  ui: unknown;
  identifiers?: unknown;
  identifierMismatch?: unknown;
}

export const KNOWN_KINDS = new Set<ExtensionKind>([
  'provider',
  'extractor',
  'analyzer',
  'action',
  'formatter',
  'hook',
]);
export const KNOWN_KINDS_LIST = [...KNOWN_KINDS].join(' / ');

/**
 * Spec § A.11, curated hookable trigger set. Single source of truth lives
 * in `kernel/extensions/hook.ts` (`HOOK_TRIGGERS`); the loader imports it
 * directly so the loader and the runtime contract cannot drift apart.
 */
export const HOOKABLE_TRIGGERS_LIST = HOOK_TRIGGERS.join(', ');

/**
 * Spec § 9.6.6, Annotation-contribution validation. Runs AFTER the
 * kind-specific AJV manifest pass (the contribution shape, schema /
 * ownership / location, is already structurally validated by then via
 * the base schema). Two extra invariants:
 *
 *   (a) `location: 'root'` REQUIRES `ownership: 'exclusive'` (a
 *       top-level reserved key cannot be silently shared).
 *   (b) The inline `schema` MUST AJV-compile cleanly (catch typos in
 *       JSON-Schema-keyword usage at load time, not at first write).
 *
 * Returns a discovered-plugin failure (`invalid-manifest`) on either
 * violation, or `null` when the extension's contributions are well-formed.
 * Cross-plugin collision detection runs later in the runtime composer.
 */
// Linear validator with one branch per failure mode (root-shared,
// schema-not-object, schema-compile-fails) plus the per-entry guards.
// Each branch returns directly; cyclomatic count comes from the guard
// chain inside the entry loop, not from real nested logic.
// eslint-disable-next-line complexity
export function validateAnnotationContributions(
  pluginPath: string,
  pluginId: string,
  manifest: IPluginManifest,
  relEntry: string,
  manifestView: unknown,
): IDiscoveredPlugin | null {
  if (!isRecord(manifestView)) return null;
  // Structure-as-truth refactor: `annotationContributions` (mapa) became
  // `annotation` (singular, key = leaf folder name). The validation here
  // operates on the singular shape; legacy `annotationContributions`
  // entries are rejected by AJV via `additionalProperties: false` on the
  // extension base schema, so we do not need a fall-back branch.
  const raw = manifestView['annotation'];
  if (raw === undefined) return null;
  if (!isRecord(raw)) return null;
  const location = (raw['location'] as string | undefined) ?? 'namespaced';
  const ownership = (raw['ownership'] as string | undefined) ?? 'shared';
  if (location === 'root' && ownership !== 'exclusive') {
    return {
      ...fail(
        pluginPath,
        pluginId,
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestRootSharedAnnotation, {
          relEntry,
          key: '<annotation>',
          ownership,
        }),
      ),
      manifest,
    };
  }
  const schema = raw['schema'];
  if (!isRecord(schema)) {
    return {
      ...fail(
        pluginPath,
        pluginId,
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestAnnotationSchemaCompile, {
          relEntry,
          key: '<annotation>',
          errDescription: 'schema must be an object literal',
        }),
      ),
      manifest,
    };
  }
  try {
    const ajv: TAjv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
    applyAjvFormats(ajv);
    ajv.compile(schema);
  } catch (err) {
    return {
      ...fail(
        pluginPath,
        pluginId,
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestAnnotationSchemaCompile, {
          relEntry,
          key: '<annotation>',
          errDescription: describe(err),
        }),
      ),
      manifest,
    };
  }
  return null;
}

/**
 * Spec § A.11, Hook triggers validation. Runs BEFORE AJV so the user
 * gets a directed `invalid-manifest` reason (with offending trigger and
 * full hookable list) rather than a generic AJV enum error string under
 * `load-error`. Returns an `IDiscoveredPlugin` failure or `null` if the
 * triggers are valid.
 */
export function validateHookTriggers(
  pluginPath: string,
  pluginId: string,
  manifest: IPluginManifest,
  relEntry: string,
  exported: Record<string, unknown>,
  manifestView: unknown,
): IDiscoveredPlugin | null {
  const triggers = (manifestView as Record<string, unknown>)['triggers'];
  const hookId = (exported['id'] as string) ?? '?';
  if (!Array.isArray(triggers) || triggers.length === 0) {
    return {
      ...fail(
        pluginPath,
        pluginId,
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestHookEmptyTriggers, { hookId }),
      ),
      manifest,
    };
  }
  for (const trig of triggers) {
    if (typeof trig !== 'string' || !(HOOK_TRIGGERS as readonly string[]).includes(trig)) {
      return {
        ...fail(
          pluginPath,
          pluginId,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestHookUnknownTrigger, {
            hookId,
            trigger: String(trig),
            hookableList: HOOKABLE_TRIGGERS_LIST,
          }),
        ),
        manifest,
      };
    }
  }
  return null;
}

/**
 * Action file-conventions validation (structure-as-truth).
 *
 *   - `<action-dir>/report.schema.json` MUST exist for every Action.
 *   - `<action-dir>/prompt.md` MUST exist when `mode='probabilistic'`,
 *     and MUST NOT exist when `mode='deterministic'` (config conflict).
 *
 * The convention replaces the retired `reportSchemaRef` /
 * `promptTemplateRef` manifest fields; the loader resolves both files
 * by name so misconfigured Actions surface at load instead of at the
 * first invocation. Returns either a populated failure row or `null`.
 */
export function validateActionFileConventions(
  pluginPath: string,
  pluginId: string,
  manifest: IPluginManifest,
  relEntry: string,
  entryAbsPath: string,
  manifestView: unknown,
): IDiscoveredPlugin | null {
  const actionDir = dirname(entryAbsPath);
  const reportSchemaPath = join(actionDir, 'report.schema.json');
  const promptPath = join(actionDir, 'prompt.md');
  const mode = isRecord(manifestView) && typeof manifestView['mode'] === 'string'
    ? (manifestView['mode'] as 'deterministic' | 'probabilistic')
    : 'deterministic';

  if (!existsSync(reportSchemaPath)) {
    return {
      ...fail(
        pluginPath,
        pluginId,
        'load-error',
        `Action at \`${relEntry}\` is missing \`report.schema.json\` in its folder (structure-as-truth: every Action carries a report schema by convention).`,
      ),
      manifest,
    };
  }

  const promptExists = existsSync(promptPath);
  if (mode === 'probabilistic' && !promptExists) {
    return {
      ...fail(
        pluginPath,
        pluginId,
        'load-error',
        `Probabilistic Action at \`${relEntry}\` is missing \`prompt.md\` in its folder (structure-as-truth: probabilistic Actions carry a prompt template by convention).`,
      ),
      manifest,
    };
  }
  if (mode === 'deterministic' && promptExists) {
    return {
      ...fail(
        pluginPath,
        pluginId,
        'invalid-manifest',
        `Deterministic Action at \`${relEntry}\` carries an unexpected \`prompt.md\` (delete the file or switch \`mode\` to \`'probabilistic'\`).`,
      ),
      manifest,
    };
  }

  return null;
}

/**
 * Analyzer file-conventions validation (structure-as-truth), the mirror
 * of `validateActionFileConventions` for the finder half of the dual-mode
 * Analyzer contract (`spec/schemas/extensions/analyzer.schema.json`):
 *
 *   - `mode='probabilistic'`: `<analyzer-dir>/prompt.md` AND
 *     `<analyzer-dir>/report.schema.json` MUST exist; the report schema
 *     MUST parse and MUST extend the canonical findings envelope
 *     (`findings/report.schema.json`) via `$ref`. Every violation is
 *     `invalid-manifest` (spec wording: "missing either is
 *     `invalid-manifest`").
 *   - `mode='deterministic'`: `prompt.md` MUST NOT exist (config
 *     conflict, mirroring the Action posture). A stray
 *     `report.schema.json` on a deterministic analyzer is tolerated
 *     (inert data; analyzers have no deterministic report contract).
 *
 * A probabilistic analyzer declaring `evaluate()` is tolerated silently
 * (the export's functions are stripped before AJV and the orchestrator
 * never schedules probabilistic analyzers), the same posture the Action
 * loader takes for a probabilistic Action declaring `invoke()`.
 * Returns either a populated failure row or `null`.
 */
// Linear validator with one branch per failure mode (missing prompt,
// missing schema, unparseable schema, non-findings schema, stray prompt
// on deterministic), same shape as validateAnnotationContributions
// above; each branch returns directly, splitting would scatter the
// early-return pipeline.
// eslint-disable-next-line complexity
export function validateAnalyzerFileConventions(
  pluginPath: string,
  pluginId: string,
  manifest: IPluginManifest,
  relEntry: string,
  entryAbsPath: string,
  manifestView: unknown,
): IDiscoveredPlugin | null {
  const analyzerDir = dirname(entryAbsPath);
  const promptPath = join(analyzerDir, 'prompt.md');
  const reportSchemaPath = join(analyzerDir, 'report.schema.json');
  const mode = isRecord(manifestView) && typeof manifestView['mode'] === 'string'
    ? (manifestView['mode'] as 'deterministic' | 'probabilistic')
    : 'deterministic';

  const invalid = (reason: string): IDiscoveredPlugin => ({
    ...fail(pluginPath, pluginId, 'invalid-manifest', reason),
    manifest,
  });

  if (mode === 'deterministic') {
    if (existsSync(promptPath)) {
      return invalid(tx(PLUGIN_LOADER_TEXTS.invalidManifestAnalyzerUnexpectedPrompt, { relEntry }));
    }
    return null;
  }

  if (!existsSync(promptPath)) {
    return invalid(tx(PLUGIN_LOADER_TEXTS.invalidManifestAnalyzerMissingPrompt, { relEntry }));
  }
  if (!existsSync(reportSchemaPath)) {
    return invalid(
      tx(PLUGIN_LOADER_TEXTS.invalidManifestAnalyzerMissingReportSchema, { relEntry }),
    );
  }
  let reportSchema: unknown;
  try {
    reportSchema = JSON.parse(nodeFs.readFileSync(reportSchemaPath, 'utf8'));
  } catch (err) {
    return invalid(
      tx(PLUGIN_LOADER_TEXTS.invalidManifestAnalyzerReportSchemaUnparseable, {
        relEntry,
        errDescription: describe(err),
      }),
    );
  }
  if (!isRecord(reportSchema) || !reportSchemaExtendsFindings(reportSchema)) {
    return invalid(
      tx(PLUGIN_LOADER_TEXTS.invalidManifestAnalyzerReportSchemaNotFindings, { relEntry }),
    );
  }
  return null;
}

/**
 * Provider kind discovery from the filesystem (structure-as-truth).
 *
 * Reads every `<plugin>/kinds/<kindName>/` directory and projects the
 * pair `{ schema, schemaJson, ui }` per kind. The runtime descriptor
 * lives on the loaded Provider instance under `kinds[<kindName>]`.
 *
 * Failure modes (each returns a populated failure row):
 *   - kind folder exists without `schema.json` → load-error.
 *   - kind folder exists without `kind.json` → invalid-manifest.
 *   - `schema.json` is unparseable → load-error.
 *   - `kind.json` is unparseable → invalid-manifest.
 *   - `kind.json` fails AJV against `provider-kind.schema.json`
 *     (missing `ui`, malformed `ui.color`, etc.) → invalid-manifest.
 *
 * Returns `{ ok: true, kinds }` on success (`kinds` may be empty when
 * the plugin has no `kinds/` directory at all; the caller decides
 * whether the empty case is valid).
 */
export function discoverProviderKinds(
  pluginPath: string,
  pluginId: string,
  manifest: IPluginManifest,
  relEntry: string,
  validatorForKind: (data: unknown) => { ok: boolean; errors: string },
):
  | { ok: true; kinds: Record<string, IDiscoveredProviderKind> }
  | { ok: false; failure: IDiscoveredPlugin } {
  const kindsRoot = join(pluginPath, 'kinds');
  let entries: string[];
  try {
    entries = nodeFs.readdirSync(kindsRoot);
  } catch {
    return { ok: true, kinds: {} };
  }
  const out: Record<string, IDiscoveredProviderKind> = {};
  for (const entry of entries.sort()) {
    if (entry.startsWith('.')) continue;
    const kindDir = join(kindsRoot, entry);
    if (!isDirectorySafe(kindDir, nodeFs.statSync)) continue;
    const result = loadOneProviderKind({
      pluginPath,
      pluginId,
      manifest,
      relEntry,
      entry,
      kindDir,
      validatorForKind,
    });
    if (!result.ok) return result;
    out[entry] = result.kind;
  }
  return { ok: true, kinds: out };
}

interface ILoadOneKindOptions {
  pluginPath: string;
  pluginId: string;
  manifest: IPluginManifest;
  relEntry: string;
  entry: string;
  kindDir: string;
  validatorForKind: (data: unknown) => { ok: boolean; errors: string };
}

function loadOneProviderKind(opts: ILoadOneKindOptions):
  | { ok: true; kind: IDiscoveredProviderKind }
  | { ok: false; failure: IDiscoveredPlugin } {
  const schemaJson = readJsonFile(join(opts.kindDir, 'schema.json'));
  if ('error' in schemaJson) {
    return providerKindFailure(opts, 'load-error', 'schema.json', schemaJson.error);
  }
  const kindJson = readJsonFile(join(opts.kindDir, 'kind.json'));
  if ('error' in kindJson) {
    return providerKindFailure(opts, 'invalid-manifest', 'kind.json', kindJson.error);
  }
  const validation = opts.validatorForKind(kindJson.value);
  if (!validation.ok) {
    return {
      ok: false,
      failure: {
        ...fail(
          opts.pluginPath,
          opts.pluginId,
          'invalid-manifest',
          `Provider kind \`${opts.entry}\` (declared at \`${opts.relEntry}\`) failed validation in \`kinds/${opts.entry}/kind.json\`: ${validation.errors}. See ${SPEC_GITHUB_BASE}/spec/schemas/extensions/provider-kind.schema.json.`,
        ),
        manifest: opts.manifest,
      },
    };
  }
  return {
    ok: true,
    kind: projectProviderKind(opts.entry, kindJson.value, schemaJson.value),
  };
}

/**
 * Build the runtime kind descriptor from a validated `kind.json` value.
 * `ui` is required (AJV-guaranteed); `identifiers` / `identifierMismatch`
 * are optional and already enum-validated, so they are projected verbatim
 * (and only when present) so an external kind reaches the same
 * name-resolution lane a built-in gets from `IProviderKind.identifiers`.
 */
function projectProviderKind(
  entry: string,
  kindValue: unknown,
  schemaJson: unknown,
): IDiscoveredProviderKind {
  const record = isRecord(kindValue) ? (kindValue as Record<string, unknown>) : undefined;
  const identifiers = record?.['identifiers'];
  const identifierMismatch = record?.['identifierMismatch'];
  return {
    schema: `./kinds/${entry}/schema.json`,
    schemaJson,
    ui: record?.['ui'],
    ...(identifiers !== undefined ? { identifiers } : {}),
    ...(identifierMismatch !== undefined ? { identifierMismatch } : {}),
  };
}

function readJsonFile(path: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(nodeFs.readFileSync(path, 'utf8')) };
  } catch (err) {
    return { error: describe(err) };
  }
}

function providerKindFailure(
  opts: ILoadOneKindOptions,
  status: 'load-error' | 'invalid-manifest',
  fileName: 'schema.json' | 'kind.json',
  errDescription: string,
): { ok: false; failure: IDiscoveredPlugin } {
  return {
    ok: false,
    failure: {
      ...fail(
        opts.pluginPath,
        opts.pluginId,
        status,
        `Provider kind \`${opts.entry}\` (declared at \`${opts.relEntry}\`) is missing or has an unparseable \`kinds/${opts.entry}/${fileName}\` (${errDescription}).`,
      ),
      manifest: opts.manifest,
    },
  };
}

function isDirectorySafe(path: string, statSync: typeof nodeFs.statSync): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
