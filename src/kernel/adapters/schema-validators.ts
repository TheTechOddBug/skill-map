/**
 * AJV validator loader. Compiles every JSON Schema the kernel needs into a
 * map of reusable validators keyed by a stable logical name. Schemas load
 * directly from the `@skill-map/spec` package at startup; any missing file
 * is a fatal boot error (the kernel cannot validate without them).
 *
 * Key design choices:
 *
 * - **Single Ajv instance per loader** so `$ref` resolution can reach sibling
 *   schemas (e.g. `extensions/base.schema.json` → extended by every kind).
 * - **`strict: false`** because the spec uses a few keywords AJV considers
 *   unknown under strict mode (`const` inside `oneOf`, tuple length hints)
 *   that are nevertheless valid Draft 2020-12.
 * - **`ajv-formats`** enabled for `uri`, `date`, `date-time`, all used by
 *   frontmatter base and plugin manifest.
 * - **Split eager/lazy load**: every schema file is read and JSON-parsed
 *   eagerly on `load()`, so a corrupt install (missing file, broken JSON)
 *   still fails fast at boot; the AJV codegen compiles per schema on
 *   first use instead. The historical fully-eager compile (~17 validators)
 *   cost ~150ms on EVERY CLI invocation (the update-check settings read
 *   triggers this loader), for validators most verbs never call.
 *   Registration skips AJV's meta-schema validation on purpose: these are
 *   spec-shipped schemas covered by the `spec/index.json` integrity block
 *   and the spec workspace's own schema validation in CI, so re-checking
 *   them against the 2020-12 meta-schema per process bought nothing.
 *
 * **Spec 0.8.0**. Per-kind frontmatter schemas (`skill`, `agent`,
 * `command`, `hook`, `note`) relocated from spec to the Provider that
 * owns them. Spec-only validators no longer cover those
 * five names. `buildProviderFrontmatterValidator(providers)` produces a
 * dedicated AJV instance pre-loaded with `frontmatter/base` (from spec)
 * plus every Provider's per-kind schemas, the kernel composes it once
 * per scan and the orchestrator validates each node's frontmatter
 * through it.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import type { Ajv2020, ValidateFunction } from 'ajv/dist/2020.js';

import type { IProvider, IBuiltInManifest } from '../extensions/index.js';
import type { ExtensionKind } from '../registry.js';
import { KNOWN_SLOT_NAMES } from '../types/view-catalog.js';
import { applyAjvFormats, loadAjv } from '../util/ajv-interop.js';

type TAjv = InstanceType<typeof Ajv2020>;

export type TSchemaName =
  | 'node'
  | 'link'
  | 'issue'
  | 'scan-result'
  | 'execution-record'
  | 'project-config'
  | 'user-settings'
  | 'plugins-registry'
  | 'job'
  | 'report-base'
  | 'conformance-case'
  | 'history-stats'
  | 'map-view'
  | 'session-recording'
  | 'extension-provider'
  | 'extension-provider-kind'
  | 'extension-extractor'
  | 'extension-analyzer'
  | 'extension-action'
  | 'extension-formatter'
  | 'extension-hook'
  | 'extension-manifest'
  | 'frontmatter-base';

/**
 * Re-export of `ExtensionKind` (canonical declaration in `kernel/registry.ts`)
 * for callers that already depend on this module for related schema names.
 * Single source of truth keeps the extension-kind set in lock-step with
 * `EXTENSION_KINDS`.
 */
export type { ExtensionKind } from '../registry.js';

const SCHEMA_FILES: Record<TSchemaName, string> = {
  node: 'schemas/node.schema.json',
  link: 'schemas/link.schema.json',
  issue: 'schemas/issue.schema.json',
  'scan-result': 'schemas/scan-result.schema.json',
  'execution-record': 'schemas/execution-record.schema.json',
  'project-config': 'schemas/project-config.schema.json',
  'user-settings': 'schemas/user-settings.schema.json',
  'plugins-registry': 'schemas/plugins-registry.schema.json',
  job: 'schemas/job.schema.json',
  'report-base': 'schemas/report-base.schema.json',
  'conformance-case': 'schemas/conformance-case.schema.json',
  'history-stats': 'schemas/history-stats.schema.json',
  'map-view': 'schemas/map-view.schema.json',
  'session-recording': 'schemas/session-recording.schema.json',
  'extension-provider': 'schemas/extensions/provider.schema.json',
  'extension-provider-kind': 'schemas/extensions/provider-kind.schema.json',
  'extension-extractor': 'schemas/extensions/extractor.schema.json',
  'extension-analyzer': 'schemas/extensions/analyzer.schema.json',
  'extension-action': 'schemas/extensions/action.schema.json',
  'extension-formatter': 'schemas/extensions/formatter.schema.json',
  'extension-hook': 'schemas/extensions/hook.schema.json',
  'extension-manifest': 'schemas/extensions/extension-manifest.schema.json',
  'frontmatter-base': 'schemas/frontmatter/base.schema.json',
};

/**
 * Canonical list of every logical schema name this loader serves. In
 * lock-step with `SCHEMA_FILES` by construction; exported so callers
 * (and the lazy-compile regression suite) can iterate the full catalog
 * without duplicating the name set.
 */
export const SCHEMA_NAMES: readonly TSchemaName[] = Object.freeze(
  Object.keys(SCHEMA_FILES) as TSchemaName[],
);

/**
 * Schemas that other schemas reference via $ref but aren't validated
 * directly. `summaries/markdown.schema.json` (the single canonical
 * node-summary shape; universal, not per-kind) is resolvable by `$id`,
 * so an Action's `report.schema.json` can `$ref` it (that reference is
 * the summarizer signal, see `kernel/jobs/summary-schema.ts`) and still
 * compile through `validateActionReport`. `enrichments/github.schema.json`
 * plays the same role for the mirror convention: an Action's report
 * schema `$ref`ing it is the enricher signal
 * (`kernel/enrichments/enrichment-schema.ts`) and `sm enrich` validates
 * the report through `validateActionReport` against it.
 * `tags/markdown.schema.json` mirrors summaries for the TAGGER signal
 * (`kernel/jobs/tags-schema.ts`, the sidecar tags write-through).
 * `findings/report.schema.json` (the canonical findings envelope) is the
 * probabilistic-Analyzer counterpart: a finder's `report.schema.json`
 * MUST `$ref` it (`kernel/jobs/findings-schema.ts`) and `sm record`
 * validates the report through `validateActionReport` against it.
 */
const SUPPORTING_SCHEMAS: string[] = [
  'schemas/extensions/base.schema.json',
  'schemas/frontmatter/base.schema.json',
  'schemas/summaries/markdown.schema.json',
  'schemas/tags/markdown.schema.json',
  'schemas/enrichments/github.schema.json',
  'schemas/findings/report.schema.json',
  'schemas/view-slots.schema.json',
  'schemas/input-types.schema.json',
];

export interface ISchemaValidators {
  validate<T = unknown>(name: TSchemaName, data: unknown): { ok: true; data: T } | { ok: false; errors: string };
  getValidator(name: TSchemaName): ValidateFunction;
  validatorForExtension(kind: ExtensionKind): ValidateFunction;
  /**
   * Validate raw plugin.json against `$defs/PluginManifest` inside
   * plugins-registry.schema.json. Returns the typed manifest on success.
   */
  validatePluginManifest<T = unknown>(data: unknown): { ok: true; data: T } | { ok: false; errors: string };
  /**
   * Validate a `ctx.emitContribution(id, payload)` payload against the
   * declared slot's payload schema in
   * `view-slots.schema.json#/$defs/payloads/<slot>`. Closed catalog:
   * passing an unknown slot returns `{ ok: false, errors:
   * 'unknown-slot' }` so the orchestrator can drop the emission
   * without crashing.
   */
  validateContributionPayload(
    slot: string,
    payload: unknown,
  ): { ok: true } | { ok: false; errors: string };
  /**
   * Validate a runner's JSON report against an action's OWN report schema
   * (the parsed `report.schema.json`, or the `reportSchema` object the
   * built-ins codegen inlined on a built-in Action manifest). The schema
   * `$ref`s `report-base.schema.json` by its absolute `$id`; this loader's
   * AJV instance already registers `report-base`, so the cross-file ref
   * resolves. Consumed by `sm record` to gate a `--status completed`
   * callback before the job is closed. Validators are reused by the
   * schema's `$id` (via AJV's own registry) so repeated `sm record` calls
   * in one process don't trip AJV's "schema already exists" guard; a
   * malformed report schema surfaces as `{ ok: false }` rather than a
   * crash.
   */
  validateActionReport(
    reportSchema: Record<string, unknown>,
    data: unknown,
  ): { ok: true } | { ok: false; errors: string };
}

// Module-level cache. Cold load compiles ~17 validators
// (~20 schemas counting supporting refs) which is ~100 ms cold for a CLI
// startup. Subsequent calls in the same process return the same instance,
// so future verbs that validate at multiple boundaries pay the cost once.
// `null` means "not yet loaded"; we never expose a way to invalidate
// because the schemas are static, baked-in, and the underlying spec
// package version doesn't change at runtime.
let cachedValidators: ISchemaValidators | null = null;

/** Test-only escape hatch, drop the cache so a test can re-trigger load. */
export function _resetSchemaValidatorsCacheForTests(): void {
  cachedValidators = null;
}

export function loadSchemaValidators(): ISchemaValidators {
  if (cachedValidators !== null) return cachedValidators;
  cachedValidators = buildSchemaValidators();
  return cachedValidators;
}

function buildSchemaValidators(): ISchemaValidators {
  const specRoot = resolveSpecRoot();
  const { Ajv2020 } = loadAjv();
  const ajv: TAjv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  applyAjvFormats(ajv);

  // Eager half of the split (see module docstring): read + parse every
  // schema file NOW so a corrupt install throws at load(), then register
  // without meta-validation (`_validateSchema: false`). Registration is
  // cheap; the expensive codegen defers to `getOrCompile` below.
  // Supporting schemas go first so `$ref` targets resolve at compile time.
  for (const rel of SUPPORTING_SCHEMAS) {
    const file = resolve(specRoot, rel);
    if (!existsSyncSafe(file)) continue;
    const schema = JSON.parse(readFileSync(file, 'utf8'));
    ajv.addSchema(schema, undefined, undefined, false);
  }

  const namedSchemas = new Map<TSchemaName, { $id?: string }>();
  for (const [name, rel] of Object.entries(SCHEMA_FILES) as Array<[TSchemaName, string]>) {
    const file = resolve(specRoot, rel);
    const schema = JSON.parse(readFileSync(file, 'utf8')) as { $id?: string };
    namedSchemas.set(name, schema);
    // A named schema can already sit in the registry via
    // SUPPORTING_SCHEMAS (`frontmatter-base` lives in both lists); AJV
    // throws on a duplicate `$id`, so only register the new ones.
    if (typeof schema.$id === 'string' && ajv.getSchema(schema.$id) !== undefined) continue;
    ajv.addSchema(schema, name, undefined, false);
  }

  // Lazy half of the split: `ajv.getSchema` runs codegen on demand for a
  // registered schema; the Map memoizes per name so every later call is
  // a lookup. Unknown names throw the same error the eager Map produced.
  const validators = new Map<TSchemaName, ValidateFunction>();
  function getOrCompile(name: TSchemaName): ValidateFunction {
    const cached = validators.get(name);
    if (cached) return cached;
    const schema = namedSchemas.get(name);
    if (!schema) throw new Error(`Unknown schema: ${name}`);
    const compiled =
      (typeof schema.$id === 'string' ? ajv.getSchema(schema.$id) : undefined) ?? ajv.getSchema(name);
    if (!compiled) throw new Error(`Unknown schema: ${name}`);
    validators.set(name, compiled);
    return compiled;
  }

  const extensionByKind: Record<ExtensionKind, TSchemaName> = {
    provider: 'extension-provider',
    extractor: 'extension-extractor',
    analyzer: 'extension-analyzer',
    action: 'extension-action',
    formatter: 'extension-formatter',
    hook: 'extension-hook',
  };

  // Dedicated validator that targets PluginManifest inside the oneOf of
  // plugins-registry.schema.json, so callers don't have to hand-filter
  // against the combined schema. Compiled on first use like the named
  // validators; verbs that never touch plugins skip the codegen.
  let pluginManifestValidator: ValidateFunction | null = null;
  function getPluginManifestValidator(): ValidateFunction {
    pluginManifestValidator ??= ajv.compile({
      $ref: 'https://skill-map.ai/spec/v1/plugins-registry.schema.json#/$defs/PluginManifest',
    });
    return pluginManifestValidator;
  }

  // Per-slot payload validators for `ctx.emitContribution`. Compiled
  // lazily on first use because not every CLI verb exercises the
  // contributions path; cold-CLI startup avoids paying for validators a
  // verb will never call. See `validateContributionPayload`.
  //
  // The closed catalog of slot ids mirrors
  // `view-slots.schema.json#/$defs/SlotName` exactly (`KNOWN_SLOT_NAMES`
  // from `types/view-catalog.ts` is the single runtime source). Entries
  // inside `$defs/payloads` whose key starts with an underscore
  // (`_counter`, `_tag`, `_TreeNode`) are internal `$ref` reuse targets,
  // NOT slot ids; querying them would compile but is meaningless at the
  // public API.
  const contributionValidators = new Map<string, ValidateFunction>();
  const VIEW_SLOTS_ID = 'https://skill-map.ai/spec/v1/view-slots.schema.json';

  function getContributionValidator(slot: string): ValidateFunction | null {
    if (!KNOWN_SLOT_NAMES.has(slot)) return null;
    const existing = contributionValidators.get(slot);
    if (existing) return existing;
    const ref = `${VIEW_SLOTS_ID}#/$defs/payloads/${slot}`;
    let compiled: ValidateFunction | undefined;
    try {
      compiled = ajv.compile({ $ref: ref });
    } catch {
      return null;
    }
    contributionValidators.set(slot, compiled);
    return compiled;
  }

  /**
   * Compile an action's report schema against the shared AJV (which has
   * `report-base` registered). Reuse a previously-compiled schema by its
   * `$id` so a second `sm record` in the same process (tests, the BFF)
   * does not re-register the same `$id` and throw. A schema with no
   * `$id` compiles fresh each call, harmless since AJV never registers
   * an anonymous schema.
   */
  function getActionReportValidator(reportSchema: Record<string, unknown>): ValidateFunction {
    const rawId = reportSchema['$id'];
    const id = typeof rawId === 'string' ? rawId : undefined;
    if (id !== undefined) {
      const existing = ajv.getSchema(id);
      if (existing) return existing;
    }
    return ajv.compile(reportSchema);
  }

  return {
    getValidator(name) {
      return getOrCompile(name);
    },
    validatorForExtension(kind) {
      return getOrCompile(extensionByKind[kind]);
    },
    validate<T = unknown>(name: TSchemaName, data: unknown) {
      const v = getOrCompile(name);
      if (v(data)) return { ok: true as const, data: data as T };
      const errors = formatAjvErrors(v.errors);
      return { ok: false as const, errors };
    },
    validatePluginManifest<T = unknown>(data: unknown) {
      const v = getPluginManifestValidator();
      if (v(data)) return { ok: true as const, data: data as T };
      const errors = formatAjvErrors(v.errors);
      return { ok: false as const, errors };
    },
    validateContributionPayload(slot: string, payload: unknown) {
      const validator = getContributionValidator(slot);
      if (!validator) {
        return { ok: false as const, errors: 'unknown-slot' };
      }
      if (validator(payload)) return { ok: true as const };
      const errors = formatAjvErrors(validator.errors);
      return { ok: false as const, errors };
    },
    validateActionReport(reportSchema: Record<string, unknown>, data: unknown) {
      let validator: ValidateFunction;
      try {
        validator = getActionReportValidator(reportSchema);
      } catch (err) {
        // A malformed report schema (bad `$ref`, invalid JSON Schema) fails
        // to compile; surface it as a report-validation failure the caller
        // reports, never an uncaught crash inside the callback path.
        return { ok: false as const, errors: err instanceof Error ? err.message : String(err) };
      }
      if (validator(data)) return { ok: true as const };
      const errors = formatAjvErrors(validator.errors);
      return { ok: false as const, errors };
    },
  };
}

/**
 * Validator for Provider-owned per-kind frontmatter schemas. Built from
 * the live set of registered Providers, each Provider declares its
 * `kinds[<kind>].schemaJson` and the loader compiles them into a single
 * AJV instance that also carries the spec's `frontmatter/base.schema.json`
 * so cross-package `$ref`-by-`$id` resolves. The orchestrator builds
 * one of these per scan via `buildProviderFrontmatterValidator`.
 */
export interface IProviderFrontmatterValidator {
  /**
   * Validate a node's frontmatter against the schema declared by
   * `provider.kinds[kind]`. `kind` is the value `provider.classify`
   * returned for the node, so the entry is guaranteed to exist for any
   * Provider implemented per spec; an absent entry returns
   * `{ ok: false, errors: 'no-schema' }` so the caller can emit a
   * directed `frontmatter-invalid` issue without crashing.
   */
  validate(
    // See `resolveProviderWalk` comment, accepts both the fully-loaded
    // shape and the codegen-input shape; this method reads `id` only.
    provider: IBuiltInManifest<IProvider>,
    kind: string,
    data: unknown,
  ): { ok: true } | { ok: false; errors: string };
}

/**
 * Build a Provider-frontmatter validator. Composes one AJV instance,
 * pre-registers `frontmatter/base.schema.json` from spec so per-kind
 * schemas can `$ref` it by `$id`, then compiles every Provider's
 * `kinds[<kind>].schemaJson` keyed by `(providerId, kind)`. Idempotent
 * across providers that share kinds (same `$id` → AJV's `addSchema`
 * dedupes silently); the keying is by `providerId` first so two
 * Providers exporting different schemas under the same kind name don't
 * collide.
 */
export function buildProviderFrontmatterValidator(
  // Same widening as `IProviderFrontmatterValidator.validate` above,
  // this function only inspects each provider's `id`, `kinds`, and
  // `schemas`; the version field is never read.
  providers: ReadonlyArray<IBuiltInManifest<IProvider>>,
): IProviderFrontmatterValidator {
  const specRoot = resolveSpecRoot();
  const { Ajv2020 } = loadAjv();
  const ajv: TAjv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  applyAjvFormats(ajv);

  // Register spec's frontmatter/base.schema.json so per-kind schemas can
  // resolve `$ref: 'https://skill-map.ai/spec/v1/frontmatter/base.schema.json'`.
  const baseFile = resolve(specRoot, 'schemas/frontmatter/base.schema.json');
  const baseSchema = JSON.parse(readFileSync(baseFile, 'utf8'));
  ajv.addSchema(baseSchema);

  registerProviderAuxiliarySchemas(ajv, providers);

  const compiled = new Map<string, ValidateFunction>();
  for (const provider of providers) {
    for (const [kind, entry] of Object.entries(provider.kinds)) {
      const key = `${provider.id}::${kind}`;
      // Reuse a previously-compiled schema (multiple Providers may legitimately
      // share the same `$id` if they bundle a copy of another's schema).
      const json = entry.schemaJson as { $id?: string };
      const existing = typeof json.$id === 'string' ? ajv.getSchema(json.$id) : undefined;
      compiled.set(key, existing ?? ajv.compile(entry.schemaJson as object));
    }
  }

  return {
    validate(provider, kind, data) {
      const key = `${provider.id}::${kind}`;
      const v = compiled.get(key);
      if (!v) return { ok: false as const, errors: 'no-schema' };
      if (v(data)) return { ok: true as const };
      const errors = formatAjvErrors(v.errors);
      return { ok: false as const, errors };
    },
  };
}

interface IAjvErrorLike {
  instancePath: string;
  message?: string;
  keyword: string;
  params?: unknown;
}

function formatError(err: IAjvErrorLike): string {
  const path = err.instancePath || '(root)';
  return `${path} ${err.message ?? err.keyword}`;
}

/**
 * Turn AJV's raw error list into ONE legible line.
 *
 * AJV runs with `allErrors: true` so a single bad value can produce a
 * wall of errors. The worst offender is a closed enum modelled as a
 * `oneOf` of `const` branches (the view-slot catalog `SlotName`, kept as
 * `oneOf` so each slot carries its own description): a wrong `slot`
 * yields one `must be equal to constant` per catalog member plus a
 * `must match exactly one schema in oneOf` umbrella, i.e. 15 near-
 * identical fragments. This collapses each such path to a single concise
 * `<path> is not a valid value`, drops the per-branch `const` noise and
 * the redundant `oneOf` umbrella, and dedupes the rest. The allowed list
 * is intentionally NOT inlined (the slot catalog alone is 14 entries);
 * the schema link in the surrounding message template points the author
 * to the authoritative list. Used everywhere the loader stringifies
 * validation errors.
 */
export function formatAjvErrors(errors: ReadonlyArray<IAjvErrorLike> | null | undefined): string {
  const list = errors ?? [];
  if (list.length === 0) return '';
  // Group by instancePath (Map preserves first-seen order) so the per-path
  // formatter sees every branch AJV emitted for one value, then flatten.
  const byPath = new Map<string, IAjvErrorLike[]>();
  for (const e of list) {
    const path = e.instancePath || '(root)';
    const bucket = byPath.get(path);
    if (bucket) bucket.push(e);
    else byPath.set(path, [e]);
  }
  const parts: string[] = [];
  for (const [path, errs] of byPath) parts.push(...formatPathErrors(path, errs));
  // Idempotent safety net against cross-path repeats.
  return [...new Set(parts)].join('; ');
}

/** Count of `const`-branch values at one path (the enum-of-consts tell). */
function constBranchValues(errs: IAjvErrorLike[]): number {
  let count = 0;
  for (const e of errs) {
    const isConst =
      e.keyword === 'const' &&
      typeof e.params === 'object' &&
      e.params !== null &&
      'allowedValue' in e.params;
    if (isConst) count += 1;
  }
  return count;
}

/** Format all of one instancePath's errors into deduped message lines. */
function formatPathErrors(path: string, errs: IAjvErrorLike[]): string[] {
  if (constBranchValues(errs) >= 2) {
    // enum-of-consts: one concise line, dropping the per-branch `const`
    // noise and the `oneOf` umbrella. The allowed values are not inlined
    // (see docstring); the message template's schema link carries them.
    const parts = [`${path} is not a valid value`];
    for (const e of errs) {
      if (e.keyword !== 'const' && e.keyword !== 'oneOf') parts.push(formatError(e));
    }
    return parts;
  }
  // Default: one message per distinct (path, message) pair.
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const e of errs) {
    const msg = formatError(e);
    if (!seen.has(msg)) {
      seen.add(msg);
      parts.push(msg);
    }
  }
  return parts;
}

/**
 * Register every Provider's auxiliary schemas (if any) on the AJV instance
 * BEFORE compiling per-kind schemas. Use case: Anthropic's merged
 * skill / command frontmatter, both kinds extend a shared
 * `skill-base.schema.json` declared as an auxiliary on the Provider, and
 * AJV resolves the cross-file `$ref` only after `addSchema` has registered
 * the auxiliary's `$id`.
 */
function registerProviderAuxiliarySchemas(
  ajv: TAjv,
  providers: ReadonlyArray<IBuiltInManifest<IProvider>>,
): void {
  for (const provider of providers) {
    if (!provider.schemas) continue;
    for (const aux of provider.schemas) {
      const auxJson = aux as { $id?: string };
      if (typeof auxJson.$id === 'string' && ajv.getSchema(auxJson.$id)) continue;
      ajv.addSchema(aux as object);
    }
  }
}

/**
 * Locate the installed `@skill-map/spec` package root. Prefer Node's
 * resolver (handles npm workspaces + published installs symmetrically)
 * and fall back to the package's `package.json` directory.
 *
 * Exported: `cli/util/user-settings-store.ts` compiles its OWN single
 * schema against this root (deliberately NOT through the full
 * validator catalog, see the store's doc) and must resolve the spec
 * package the same canonical way.
 */
export function resolveSpecRoot(): string {
  const require = createRequire(import.meta.url);
  // @skill-map/spec's exports field doesn't expose package.json, but
  // ./index.json is always exported and always lives at the package root.
  try {
    const indexPath = require.resolve('@skill-map/spec/index.json');
    return dirname(indexPath);
  } catch {
    throw new Error(
      '@skill-map/spec not resolvable: ensure the workspace is linked or the package is installed.',
    );
  }
}

function existsSyncSafe(path: string): boolean {
  try {
    readFileSync(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}
