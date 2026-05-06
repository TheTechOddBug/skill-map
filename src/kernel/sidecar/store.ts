/**
 * Sidecar write channel (Step 9.6.3, Decision #125).
 *
 * `ISidecarStore` is the kernel's port for materialising patches against
 * `<basename>.sm` files. Mirrors `StoragePort`'s shape (port + driving
 * adapter) but writes co-located YAML files in the repo rather than rows
 * in SQLite. The built-in `bump` Action returns a deep-merge patch
 * (`TActionWrite { kind: 'sidecar', path, changes }`) and the kernel
 * dispatches each entry through the active `ISidecarStore`.
 *
 * Atomicity is owned by the Store, not the Action: Actions stay pure
 * (testable / dry-runnable), and the read-modify-write critical section
 * lives inside `applyPatch()`. Two concurrent `applyPatch()` calls on the
 * same path are serialised via a path-keyed in-process mutex (chained
 * promise pattern, no external dep — mirrors `AsyncMutex` in
 * `adapters/sqlite/dialect.ts`).
 *
 * The on-disk write itself is atomic via the standard write-to-`.tmp`
 * + POSIX `rename` pattern. The `.tmp` file is a sibling of the target
 * (same directory) so the rename is guaranteed atomic on POSIX. Per
 * AGENTS.md this is the established atomic-write pattern; the AGENTS.md
 * `.tmp/` baseline applies to scratch / smoke-test directories, not to
 * sibling temp files used for atomic rename.
 *
 * Comment / key-order preservation is OUT OF SCOPE for 9.6.3 — `js-yaml`
 * loses comments and stable key order on round-trip. Flagged for the
 * Step 9.6 review queue (see ROADMAP §Step 9.6).
 */

import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import yaml from 'js-yaml';

import { applyAjvFormats } from '../util/ajv-interop.js';

/**
 * Sidecar persistence port. Implementations MUST guarantee:
 *
 *   1. Two concurrent `applyPatch(samePath, ...)` calls are serialised.
 *   2. The read-modify-write cycle (read on-disk file → deep-merge patch
 *      → schema-validate the merged result → write) is atomic from any
 *      observer's view.
 *   3. A schema-invalid merge result throws and leaves the file
 *      unchanged on disk — no partial writes.
 *   4. First-time bump (file did not exist) creates the `.sm` file.
 */
export interface ISidecarStore {
  /**
   * Apply a deep-merge patch to the sidecar at `sidecarAbsPath`.
   *
   *   - `changes` is treated as a partial sidecar root. Object values
   *     are merged recursively into the existing object at the same
   *     path; array values REPLACE any existing array (no element-wise
   *     merge — arrays in the annotation catalog are inherently
   *     ordered or set-like and there is no safe element-merge
   *     semantics).
   *   - The merged result MUST validate against `sidecar.schema.json` +
   *     `annotations.schema.json` via the kernel AJV stack. Validation
   *     failure throws a structured `Error`; the file is unchanged.
   *
   * @param sidecarAbsPath absolute path to the `.sm` file to patch.
   * @param changes deep-merge patch; only the keys to set need be present.
   */
  applyPatch(sidecarAbsPath: string, changes: Record<string, unknown>): Promise<void>;
}

/**
 * Filesystem-backed `ISidecarStore`. Composed at the kernel boot site
 * and threaded through `IActionContext` consumers (the orchestrator's
 * Action dispatcher in 9.6.4 and beyond).
 */
export class FilesystemSidecarStore implements ISidecarStore {
  /**
   * Path-keyed in-process lock chain. Each path maps to the tail of a
   * promise chain; new requests await the tail and replace it with
   * their own completion promise. When the chain settles back to
   * `undefined`-equivalent the entry is GC-eligible (we don't bother
   * pruning because the keyspace is bounded by the number of `.sm`
   * files in the repo and entries are tiny).
   */
  #locks = new Map<string, Promise<void>>();

  async applyPatch(
    sidecarAbsPath: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    const prev = this.#locks.get(sidecarAbsPath) ?? Promise.resolve();
    let release: () => void;
    const settled = new Promise<void>((res) => {
      release = res;
    });
    // Chain: every newcomer waits for `prev` AND `settled` (this call
    // doing its work) before they enter. The chained tail is what we
    // store as the new tail, so the next caller waits for everything
    // that came before plus us.
    const tail = prev.then(() => settled);
    this.#locks.set(sidecarAbsPath, tail);
    try {
      await prev;
      this.#applyPatchSync(sidecarAbsPath, changes);
    } finally {
      release!();
      // If we are still the recorded tail, drop the entry to allow GC.
      if (this.#locks.get(sidecarAbsPath) === tail) {
        this.#locks.delete(sidecarAbsPath);
      }
    }
  }

  #applyPatchSync(sidecarAbsPath: string, changes: Record<string, unknown>): void {
    const current = readSidecarObject(sidecarAbsPath);
    const merged = deepMerge(current, changes);
    const validator = getSidecarValidator();
    if (!validator(merged)) {
      const errors = (validator.errors ?? [])
        .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
        .join('; ');
      throw new Error(
        `sidecar patch produces a schema-invalid result at ${sidecarAbsPath}: ${errors}`,
      );
    }
    const yamlText = yaml.dump(merged, {
      sortKeys: true,
      lineWidth: -1,
      noRefs: true,
      noCompatMode: true,
    });
    atomicWriteFile(sidecarAbsPath, yamlText);
  }
}

/**
 * Deep-merge `patch` into `base`, returning a new object. Semantics:
 *
 *   - Both values are plain objects → recurse key-by-key.
 *   - `patch` is an array → REPLACES `base` at this position (no
 *     element-wise merge).
 *   - `patch` is `null` → DELETES the key from the result (whether or
 *     not `base` had it). This is the patch's "erase" sentinel — the
 *     bump Action uses it to clear stale `audit.bumpReason` values when
 *     the current bump didn't supply a reason. Persisted sidecars
 *     never contain literal nulls because the schema rejects them on
 *     every typed property; the null only ever lives in the in-flight
 *     patch object.
 *   - `patch` is any other primitive → REPLACES `base` at this position.
 *   - Key only in `base` → carried through unchanged.
 *   - Key only in `patch` (and not `null`) → set on the result.
 *
 * Mirrors `lodash.merge` for the object/array decisions but written by
 * hand to avoid pulling in the dep. Pure (no input mutation).
 */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const a = out[key];
    const b = patch[key];
    if (b === null) {
      delete out[key];
      continue;
    }
    if (isPlainObject(b)) {
      // Always recurse when the patch carries an object so the null-as-
      // delete sentinel applies at every depth. When the base lacks the
      // key (or holds a non-object), recurse against an empty object so
      // the patch's nested nulls do not leak into the result.
      const baseSub = isPlainObject(a) ? a : {};
      out[key] = deepMerge(baseSub, b);
    } else {
      out[key] = b;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSidecarObject(sidecarAbsPath: string): Record<string, unknown> {
  if (!existsSync(sidecarAbsPath)) return {};
  const raw = readFileSync(sidecarAbsPath, 'utf8');
  const parsed = yaml.load(raw);
  if (parsed === null || parsed === undefined) return {};
  if (!isPlainObject(parsed)) {
    throw new Error(
      `sidecar at ${sidecarAbsPath} is not a YAML mapping; refusing to patch`,
    );
  }
  return parsed;
}

function atomicWriteFile(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.tmp`;
  try {
    writeFileSync(tmpPath, content, { encoding: 'utf8' });
    renameSync(tmpPath, targetPath);
  } catch (err) {
    // Best-effort cleanup; ignore secondary errors.
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* noop */
    }
    throw err;
  }
}

let cachedValidator: ValidateFunction | null = null;

function getSidecarValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  applyAjvFormats(ajv);
  const specRoot = resolveSpecRoot();
  const annotationsSchema = JSON.parse(
    readFileSync(resolve(specRoot, 'schemas/annotations.schema.json'), 'utf8'),
  );
  const sidecarSchema = JSON.parse(
    readFileSync(resolve(specRoot, 'schemas/sidecar.schema.json'), 'utf8'),
  );
  ajv.addSchema(annotationsSchema);
  cachedValidator = ajv.compile(sidecarSchema);
  return cachedValidator;
}

/**
 * Test-only: drop the cached AJV validator. Mirrors
 * `_resetSidecarValidatorCacheForTests` in `parse.ts`.
 */
export function _resetSidecarStoreValidatorCacheForTests(): void {
  cachedValidator = null;
}

function resolveSpecRoot(): string {
  const require = createRequire(import.meta.url);
  try {
    const indexPath = require.resolve('@skill-map/spec/index.json');
    return dirname(indexPath);
  } catch {
    throw new Error('@skill-map/spec not resolvable — sidecar store cannot load schemas.');
  }
}
