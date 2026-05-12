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

import { Ajv2020 } from 'ajv/dist/2020.js';

import type { IDiscoveredPlugin, IPluginManifest } from '../../types/plugin.js';
import type { ExtensionKind } from '../../registry.js';
import { PLUGIN_LOADER_TEXTS } from '../../i18n/plugin-loader.texts.js';
import { applyAjvFormats } from '../../util/ajv-interop.js';
import { tx } from '../../util/tx.js';
import { HOOK_TRIGGERS } from '../../extensions/hook.js';
import { describe, fail, isRecord } from './id-utils.js';

type TAjv = InstanceType<typeof Ajv2020>;

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
  manifest: IPluginManifest,
  relEntry: string,
  manifestView: unknown,
): IDiscoveredPlugin | null {
  if (!isRecord(manifestView)) return null;
  const raw = manifestView['annotationContributions'];
  if (raw === undefined) return null;
  if (!isRecord(raw)) return null;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const location = (value['location'] as string | undefined) ?? 'namespaced';
    const ownership = (value['ownership'] as string | undefined) ?? 'shared';
    if (location === 'root' && ownership !== 'exclusive') {
      return {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestRootSharedAnnotation, {
            relEntry,
            key,
            ownership,
          }),
        ),
        manifest,
      };
    }
    const schema = value['schema'];
    if (!isRecord(schema)) {
      return {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestAnnotationSchemaCompile, {
            relEntry,
            key,
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
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestAnnotationSchemaCompile, {
            relEntry,
            key,
            errDescription: describe(err),
          }),
        ),
        manifest,
      };
    }
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
        manifest.id,
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
          manifest.id,
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
