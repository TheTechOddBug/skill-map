/**
 * Spec § A.12, read and AJV-compile the storage output schema a plugin
 * declares in its manifest (`storage.schema`, the single value-shape
 * stored under the KV sentinel).
 *
 * Both helpers are pure functions that the loader's `loadOne` reaches
 * for in its last phase before declaring a plugin "enabled".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

import type { IPluginManifest, IPluginStorageSchema } from '../../types/plugin.js';
import { PLUGIN_LOADER_TEXTS } from '../../i18n/plugin-loader.texts.js';
import { applyAjvFormats } from '../../util/ajv-interop.js';
import { tx } from '../../util/tx.js';
import { KV_SCHEMA_KEY } from '../plugin-store.js';
import { describe, isInsidePlugin } from './id-utils.js';

type TAjv = InstanceType<typeof Ajv2020>;

/**
 * Spec § A.12, read and AJV-compile the storage output schema a
 * plugin declares in its manifest. Returns either:
 *
 *   - `{ ok: true, schemas: undefined }`, the plugin declared no schema
 *     (storage without `schema`, or no storage at all). Permissive,
 *     `storageSchemas` is omitted from the discovered row and the
 *     runtime store wrapper skips validation.
 *   - `{ ok: true, schemas }`, the declared schema was read and
 *     compiled, stored under the sentinel `KV_SCHEMA_KEY`.
 *   - `{ ok: false, reason }`, the schema file was missing, unparseable
 *     as JSON, or rejected by AJV's compiler. The caller surfaces the
 *     reason as `load-error`.
 *
 * One fresh Ajv instance per plugin keeps schema `$id` collisions from
 * leaking across plugins (and from polluting the kernel's spec
 * validators, which live on a separate cached instance, see
 * `schema-validators.ts`).
 */
export function loadStorageSchemas(
  pluginPath: string,
  pluginId: string,
  manifest: IPluginManifest,
):
  | { ok: true; schemas?: Record<string, IPluginStorageSchema> }
  | { ok: false; reason: string } {
  const storage = manifest.storage;
  if (!storage?.schema) return { ok: true };

  const compiled = compilePluginSchema(pluginPath, storage.schema);
  if (!compiled.ok) {
    const reason = tx(
      compiled.phase === 'read'
        ? PLUGIN_LOADER_TEXTS.loadErrorStorageKvSchemaRead
        : PLUGIN_LOADER_TEXTS.loadErrorStorageKvSchemaCompile,
      {
        pluginId,
        schemaPath: storage.schema,
        errDescription: compiled.errDescription,
      },
    );
    return { ok: false, reason };
  }
  return {
    ok: true,
    schemas: {
      [KV_SCHEMA_KEY]: {
        schemaPath: storage.schema,
        validate: compiled.validate,
      },
    },
  };
}

/**
 * Read a single JSON Schema file relative to the plugin directory and
 * compile it with a fresh Ajv2020 instance. Two failure modes:
 *   - `phase: 'read'` , file missing, unreadable, or not JSON.
 *   - `phase: 'compile'`, JSON parsed but AJV rejected it.
 * Both surface to the caller as `load-error` with a phase-specific
 * template message.
 */
export function compilePluginSchema(
  pluginPath: string,
  relPath: string,
):
  | {
      ok: true;
      validate: ValidateFunction & {
        errors?: { instancePath: string; message?: string; keyword: string }[] | null;
      };
    }
  | { ok: false; phase: 'read' | 'compile'; errDescription: string } {
  if (!isInsidePlugin(pluginPath, relPath)) {
    return {
      ok: false,
      phase: 'read',
      errDescription: tx(PLUGIN_LOADER_TEXTS.loadErrorSchemaPathEscapesPlugin, { relPath, pluginPath }),
    };
  }
  const abs = resolve(pluginPath, relPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    return { ok: false, phase: 'read', errDescription: describe(err) };
  }
  try {
    const ajv: TAjv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
    applyAjvFormats(ajv);
    const compiled = ajv.compile(raw as object) as ValidateFunction & {
      errors?: { instancePath: string; message?: string; keyword: string }[] | null;
    };
    return { ok: true, validate: compiled };
  } catch (err) {
    return { ok: false, phase: 'compile', errDescription: describe(err) };
  }
}
