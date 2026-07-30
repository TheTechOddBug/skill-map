/**
 * Plugin store wrappers, runtime injection for `ctx.store`.
 *
 * Two shapes, mirroring the manifest's storage modes documented in
 * `spec/plugin-kv-api.md`:
 *
 *   - Mode A, `KvStore`: the full four-method accessor
 *     (`get` / `set` / `delete` / `list`) the spec declares as a MUST.
 *     `set` AJV-validates `value` against the schema declared by
 *     `manifest.storage.schema` (single value-shape) when present.
 *     Absent = permissive. `get` / `list` never validate, they return
 *     what is stored.
 *   - Mode B, `DedicatedStore.write(table, row)`. AJV-validates `row`
 *     against the per-table schema declared in `manifest.storage.schemas`
 *     when present. Tables absent from the map accept any shape.
 *
 * Both wrappers are storage-engine agnostic, they accept a `persist`
 * port the caller supplies. The persistence side (SQLite, in-memory,
 * mock) is the caller's concern; this wrapper owns the plugin-facing
 * contract: key validation, JSON encoding / decoding, size ceilings,
 * the AJV gate, the typed error taxonomy, and the `nodePath ↔ nodeId`
 * sentinel translation. That separation lets the test suite exercise
 * the semantics without spinning up a real DB and lets the SQLite
 * adapter (`kernel/adapters/sqlite/plugin-kvs.ts`) plug in unchanged.
 *
 * Scoping is structural, not conventional: `pluginId` is captured when
 * the wrapper is built and the `persist` port handed in is already
 * bound to that same plugin (see `core/runtime/plugin-stores.ts`).
 * A plugin has no way to name another plugin's rows, matching
 * `spec/plugin-kv-api.md` § Scoping.
 *
 * Universal validation (`emitLink` against `link.schema.json`,
 * `enrichNode` against `node.schema.json`) is unaffected, it lives on
 * the orchestrator side and runs regardless of the plugin's
 * `outputSchema` opt-in.
 */

import type {
  IDiscoveredPlugin,
  IPluginStorageSchema,
} from '../types/plugin.js';
import { tx } from '../util/tx.js';
import { sanitizeForTerminal } from '../util/safe-text.js';
import { truncateHead } from '../util/text.js';
import { PLUGIN_STORE_TEXTS } from '../i18n/plugin-store.texts.js';
import {
  KvBudgetExceededError,
  KvKeyInvalidError,
  KvNodePathInvalidError,
  KvOperationFailedError,
  KvValueNotSerializableError,
  KvValueTooLargeError,
} from './plugin-store-errors.js';

/**
 * Sentinel key under which Mode A stores its single value-shape schema
 * inside `IDiscoveredPlugin.storageSchemas`. The sentinel keeps the
 * shared `Record<string, IPluginStorageSchema>` map a single-typed
 * surface across both modes; consumers look up by sentinel for KV and
 * by table name for dedicated.
 */
export const KV_SCHEMA_KEY = '__kv__';

/**
 * Internal `node_id` value standing in for "global scope" (no
 * `nodePath`). `spec/plugin-kv-api.md` § Scoping mandates a sentinel
 * empty string because the backing table's composite primary key
 * `(plugin_id, node_id, key)` cannot carry NULL. Omitted, `undefined`
 * and explicit `null` all normalise to this on the way in; on the way
 * out it surfaces as `IKvEntry.nodePath === null`.
 */
export const KV_GLOBAL_NODE_ID = '';

/** Hard key ceiling, `spec/plugin-kv-api.md` § Key constraints. */
export const KV_KEY_MAX_BYTES = 256;

/**
 * Soft key ceiling. Above this the wrapper MAY warn (spec: "MAY log a
 * warning ... but MUST NOT reject below 256"), so crossing it is an
 * advisory, never a rejection.
 */
export const KV_KEY_WARN_BYTES = 128;

/**
 * Reference-implementation per-value ceiling (1 MiB). The spec leaves
 * the number to the implementation but requires a typed error rather
 * than silent truncation.
 */
export const KV_VALUE_MAX_BYTES = 1024 * 1024;

/**
 * Aggregate storage ceiling per plugin, counted per wrapper instance
 * (one scan) as BYTES ACCEPTED BY `set`, not net bytes stored.
 *
 * Why 4 MiB: an extractor runs once per node, so a plugin on a
 * 5,000-node tree writing a 200-byte record per node lands around
 * 1 MB, comfortably clear. Reaching 4 MiB means the plugin is either
 * storing bulk content (which belongs in Mode B, or nowhere) or
 * looping. It is 4x the single-value ceiling, so one legitimate large
 * write cannot trip it either.
 *
 * This is a HARD ceiling: the `set` that would cross it is rejected
 * with `KvBudgetExceededError` and nothing is persisted. An advisory
 * alone was the earlier design and it was the wrong call: the value of
 * a budget is that the database cannot grow without bound, and a
 * warning a plugin never reads bounds nothing. The scan itself is not
 * aborted, the extractor sees a typed rejection and decides, exactly
 * as it does for an oversized value.
 *
 * The budget is per plugin and per wrapper, so it resets each scan. It
 * therefore bounds the damage ONE scan can do, not the total a plugin
 * accumulates across many; the latter needs a stored running total,
 * which is a bigger change than this ceiling is worth.
 */
export const KV_PLUGIN_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

/**
 * How many distinct over-soft-limit keys one wrapper tracks before it
 * stops warning. Bounds BOTH the retained Set (a plugin generating a
 * unique long key per node would otherwise grow it for the whole scan)
 * and the advisory volume. The point of the advisory is "your key
 * naming is too long", which lands in the first few lines; the
 * hundredth repetition is noise the operator scrolls past.
 */
export const KV_KEY_WARN_MAX_TRACKED = 20;

/**
 * Display ceiling for plugin-controlled strings interpolated into an
 * error or advisory. Mirrors `PLUGIN_ID_DISPLAY_CAP` in
 * `core/runtime/plugin-runtime/warnings.ts`; a key is capped at 256
 * BYTES on the accept path but a REJECTED key is unbounded, so the cap
 * has to live on the render path too.
 */
export const KV_DISPLAY_CAP = 200;

/**
 * One stored Mode A row as the plugin sees it. Mirrors the spec's
 * `KvEntry`: `value` is already JSON-decoded and `nodePath` is `null`
 * for globally-scoped rows.
 */
export interface IKvEntry {
  key: string;
  value: unknown;
  nodePath: string | null;
  updatedAt: number;
}

/**
 * Per-call scope selector. `nodePath` omitted / `undefined` / `null`
 * all mean the global scope.
 */
export interface IKvScopeOptions {
  nodePath?: string | null;
}

/** `list` selector: scope plus an optional key-prefix filter. */
export interface IKvListOptions extends IKvScopeOptions {
  prefix?: string;
}

/**
 * One row as the persistence port speaks it: `nodeId` is the sentinel
 * form (`''` for global) and the value is still an encoded JSON string.
 * Translation to / from `IKvEntry` happens in the wrapper.
 */
export interface IKvPersistedRow {
  nodeId: string;
  key: string;
  valueJson: string;
  updatedAt: number;
}

/**
 * Engine-agnostic persistence port for Mode A, already bound to a
 * single `pluginId` by whoever constructs it. Every method may be sync
 * or async so an in-memory test double stays a plain object literal.
 *
 * Ordering is NOT required from `list`; the wrapper sorts by key ASC
 * so the spec's SHOULD holds for every backing engine. The SQLite
 * adapter still orders in SQL because the index makes it free.
 */
export interface IKvStorePersist {
  get(nodeId: string, key: string): IKvPersistedRow | null | Promise<IKvPersistedRow | null>;
  set(
    nodeId: string,
    key: string,
    valueJson: string,
    updatedAt: number,
  ): void | Promise<void>;
  delete(nodeId: string, key: string): boolean | Promise<boolean>;
  list(
    nodeId: string,
    prefix: string | undefined,
  ): readonly IKvPersistedRow[] | Promise<readonly IKvPersistedRow[]>;
}

export interface IDedicatedStorePersist {
  (table: string, row: unknown): void | Promise<void>;
}

/**
 * Mode A wrapper, the plugin-facing `KvStore` from
 * `spec/plugin-kv-api.md`.
 *
 * - `get` returns the decoded value or `null`; a missing row is not an
 *   error.
 * - `set` upserts. It runs the AJV gate (when the plugin declared a
 *   Mode A schema), JSON-encodes, checks the size ceiling, then
 *   forwards. Any rejection happens before persistence, so a failed
 *   `set` leaves no row.
 * - `delete` returns `true` iff a row was removed. Idempotent.
 * - `list` returns the scope's entries, optionally filtered by key
 *   prefix, ordered by key ASC.
 *
 * Every method is scoped to the wrapper's plugin and to the requested
 * `nodePath` (or the global sentinel). There is deliberately no
 * `transaction()`, mode A is single-operation atomic by contract.
 */
export interface IKvStoreWrapper {
  get<T = unknown>(key: string, options?: IKvScopeOptions): Promise<T | null>;
  set<T = unknown>(key: string, value: T, options?: IKvScopeOptions): Promise<void>;
  delete(key: string, options?: IKvScopeOptions): Promise<boolean>;
  list(options?: IKvListOptions): Promise<IKvEntry[]>;
}

/**
 * Union shape exposed to extractors via `ctx.store`. Mode A (`kv`)
 * returns the `KvStore` surface; Mode B (`dedicated`) returns
 * `write(table, row)`. Plugin authors narrow at the call site based on
 * the storage mode declared in their `plugin.json`.
 */
export type TPluginStore = IKvStoreWrapper | IDedicatedStoreWrapper;

/** Constructor bag for `makeKvStoreWrapper`. */
export interface IKvStoreWrapperOptions {
  pluginId: string;
  schema: IPluginStorageSchema | undefined;
  persist: IKvStorePersist;
  /**
   * Optional advisory sink for the soft key-length limit. Called at
   * most once per distinct key per wrapper instance so a plugin
   * writing the same long key on every node does not flood the
   * operator's terminal.
   */
  warn?: (message: string) => void;
}

export function makeKvStoreWrapper(opts: IKvStoreWrapperOptions): IKvStoreWrapper {
  const { pluginId, schema, persist } = opts;
  const warnLongKey = makeLongKeyWarner(pluginId, opts.warn);
  const chargeBudget = makeBudgetCounter(pluginId);

  return {
    async get<T = unknown>(key: string, options?: IKvScopeOptions): Promise<T | null> {
      assertKeyValid(pluginId, key);
      const nodeId = resolveNodeId(pluginId, options?.nodePath);
      const row = await runBackend(pluginId, 'get', () => persist.get(nodeId, key));
      if (!row) return null;
      return decodeValue(pluginId, 'get', key, row.valueJson) as T;
    },

    async set<T = unknown>(key: string, value: T, options?: IKvScopeOptions): Promise<void> {
      assertKeyValid(pluginId, key);
      warnLongKey(key);
      const nodeId = resolveNodeId(pluginId, options?.nodePath);
      assertSchemaAccepts(pluginId, schema, key, value);
      const valueJson = encodeValue(pluginId, key, value);
      // Charge the budget BEFORE persisting, so a rejected write leaves
      // no row and no accounting behind.
      chargeBudget(key, assertValueSize(pluginId, key, valueJson));
      await runBackend(pluginId, 'set', () =>
        persist.set(nodeId, key, valueJson, Date.now()),
      );
    },

    async delete(key: string, options?: IKvScopeOptions): Promise<boolean> {
      assertKeyValid(pluginId, key);
      const nodeId = resolveNodeId(pluginId, options?.nodePath);
      return runBackend(pluginId, 'delete', () => persist.delete(nodeId, key));
    },

    async list(options?: IKvListOptions): Promise<IKvEntry[]> {
      const nodeId = resolveNodeId(pluginId, options?.nodePath);
      const rows = await runBackend(pluginId, 'list', () =>
        persist.list(nodeId, options?.prefix),
      );
      return rows.map((row) => toEntry(pluginId, row)).sort(byKeyAsc);
    },
  };
}

/**
 * Mode B wrapper. `write(table, row)` AJV-validates `row` against
 * `storageSchemas[table]` when declared, then forwards to `persist`.
 * Tables absent from the map are permissive, the wrapper forwards
 * straight to `persist` without validation.
 *
 * The wrapper accepts the full `storageSchemas` map (rather than a
 * single schema) so a plugin author can declare schemas for some
 * tables and leave others permissive in the same map without the
 * caller having to lookup-then-narrow.
 */
export interface IDedicatedStoreWrapper {
  write(table: string, row: unknown): Promise<void>;
}

export function makeDedicatedStoreWrapper(opts: {
  pluginId: string;
  schemas: Record<string, IPluginStorageSchema> | undefined;
  persist: IDedicatedStorePersist;
}): IDedicatedStoreWrapper {
  const { pluginId, schemas, persist } = opts;
  return {
    async write(table, row) {
      const schema = schemas?.[table];
      if (schema) {
        if (!schema.validate(row)) {
          throw new Error(
            tx(PLUGIN_STORE_TEXTS.dedicatedValidationFailed, {
              pluginId,
              table,
              schemaPath: schema.schemaPath,
              errors: formatAjvErrors(schema.validate.errors ?? null),
            }),
          );
        }
      }
      await persist(table, row);
    },
  };
}

/** Constructor bag for `makePluginStore`. */
export interface IMakePluginStoreOptions {
  plugin: IDiscoveredPlugin;
  persistKv?: IKvStorePersist;
  persistDedicated?: IDedicatedStorePersist;
  warn?: (message: string) => void;
}

/**
 * Convenience entry point: build whichever wrapper matches the
 * discovered plugin's storage mode. Returns `undefined` when the
 * plugin declared no storage at all (the orchestrator omits
 * `ctx.store` in that case, per the existing contract), and also when
 * the caller supplied no persistence for the declared mode, which is
 * how Mode B stays dark while its scoped-`Database` wrapper is still
 * unbuilt.
 */
export function makePluginStore(
  opts: IMakePluginStoreOptions,
): TPluginStore | undefined {
  const storage = opts.plugin.manifest?.storage;
  if (!storage) return undefined;
  if (storage.mode === 'kv') return makeKvStoreForPlugin(opts);
  if (storage.mode === 'dedicated') return makeDedicatedStoreForPlugin(opts);
  return undefined;
}

/** Mode A branch of `makePluginStore`, sentinel-keyed schema lookup. */
function makeKvStoreForPlugin(
  opts: IMakePluginStoreOptions,
): IKvStoreWrapper | undefined {
  if (!opts.persistKv) return undefined;
  return makeKvStoreWrapper({
    pluginId: opts.plugin.id,
    schema: opts.plugin.storageSchemas?.[KV_SCHEMA_KEY],
    persist: opts.persistKv,
    ...(opts.warn ? { warn: opts.warn } : {}),
  });
}

/** Mode B branch of `makePluginStore`, forwards the full schema map. */
function makeDedicatedStoreForPlugin(
  opts: IMakePluginStoreOptions,
): IDedicatedStoreWrapper | undefined {
  if (!opts.persistDedicated) return undefined;
  return makeDedicatedStoreWrapper({
    pluginId: opts.plugin.id,
    schemas: opts.plugin.storageSchemas,
    persist: opts.persistDedicated,
  });
}

// --- Mode A internals -------------------------------------------------

/**
 * Render a plugin-controlled string for inclusion in an error or
 * advisory message.
 *
 * Every `Kv*` message below carries at least the plugin id, and most
 * carry the key, both of which the plugin authors. Those messages reach
 * `printer.warn` (a bare `stderr.write`), the logger, and any future
 * JSON envelope, so the cap + strip has to happen HERE, at
 * interpolation time, rather than at one consumer. Same treatment
 * `core/runtime/plugin-runtime/warnings.ts` gives plugin-authored
 * diagnostics.
 */
function safeText(value: string): string {
  return sanitizeForTerminal(truncateHead(value, KV_DISPLAY_CAP));
}

/**
 * `nodePath` → `node_id`, with the guard the sentinel requires.
 *
 * Omitted, `undefined` and explicit `null` mean the global scope and
 * collapse onto `KV_GLOBAL_NODE_ID`. An empty STRING is rejected: it is
 * indistinguishable from the sentinel on the way in and comes back out
 * as `nodePath: null`, so accepting it would make the round-trip lossy
 * and silently fold every per-node row of a plugin whose derived path
 * came out empty into one global row with last-write-wins. A non-string
 * is rejected here too, otherwise it reaches the driver and surfaces as
 * an opaque backend failure.
 */
function resolveNodeId(pluginId: string, nodePath: string | null | undefined): string {
  if (nodePath === null || nodePath === undefined) return KV_GLOBAL_NODE_ID;
  if (typeof nodePath !== 'string') {
    throw new KvNodePathInvalidError(
      tx(PLUGIN_STORE_TEXTS.kvNodePathNotAString, {
        pluginId: safeText(pluginId),
        received: typeof nodePath,
      }),
      nodePath,
    );
  }
  if (nodePath === KV_GLOBAL_NODE_ID) {
    throw new KvNodePathInvalidError(
      tx(PLUGIN_STORE_TEXTS.kvNodePathEmpty, { pluginId: safeText(pluginId) }),
      nodePath,
    );
  }
  return nodePath;
}

/** Key-ascending comparator, the spec's SHOULD for `list` ordering. */
function byKeyAsc(a: IKvEntry, b: IKvEntry): number {
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

/** Persisted row → plugin-facing entry (decode + sentinel reversal). */
function toEntry(pluginId: string, row: IKvPersistedRow): IKvEntry {
  return {
    key: row.key,
    value: decodeValue(pluginId, 'list', row.key, row.valueJson),
    nodePath: row.nodeId === KV_GLOBAL_NODE_ID ? null : row.nodeId,
    updatedAt: row.updatedAt,
  };
}

/**
 * `spec/plugin-kv-api.md` § Key constraints. The ceiling is measured in
 * UTF-8 BYTES, not code units, so a key of emoji does not sneak past a
 * `.length` check.
 */
function assertKeyValid(pluginId: string, key: string): void {
  if (typeof key !== 'string') {
    throw new KvKeyInvalidError(
      tx(PLUGIN_STORE_TEXTS.kvKeyNotAString, {
        pluginId: safeText(pluginId),
        received: typeof key,
      }),
      key,
    );
  }
  if (key.length === 0) {
    throw new KvKeyInvalidError(
      tx(PLUGIN_STORE_TEXTS.kvKeyEmpty, { pluginId: safeText(pluginId) }),
      key,
    );
  }
  const bytes = Buffer.byteLength(key, 'utf8');
  if (bytes > KV_KEY_MAX_BYTES) {
    throw new KvKeyInvalidError(
      tx(PLUGIN_STORE_TEXTS.kvKeyTooLong, {
        pluginId: safeText(pluginId),
        key: safeText(key),
        bytes,
        max: KV_KEY_MAX_BYTES,
      }),
      key,
    );
  }
}

/**
 * Build the once-per-key soft-limit advisory. Returns a no-op when the
 * caller supplied no warn sink, so the hot path costs one call.
 *
 * The seen-key Set is capped at `KV_KEY_WARN_MAX_TRACKED`: an extractor
 * runs once per node, so a plugin deriving a unique long key per node
 * would otherwise grow the Set (and the operator's terminal) linearly
 * with the corpus. Past the cap the advisory simply stops; the message
 * has already been made.
 */
function makeLongKeyWarner(
  pluginId: string,
  warn: ((message: string) => void) | undefined,
): (key: string) => void {
  if (!warn) return noWarn;
  const warned = new Set<string>();
  return (key: string): void => {
    if (warned.size >= KV_KEY_WARN_MAX_TRACKED) return;
    const bytes = Buffer.byteLength(key, 'utf8');
    if (bytes <= KV_KEY_WARN_BYTES || warned.has(key)) return;
    warned.add(key);
    warn(
      tx(PLUGIN_STORE_TEXTS.kvKeyLongWarning, {
        pluginId: safeText(pluginId),
        key: safeText(key),
        bytes,
        soft: KV_KEY_WARN_BYTES,
        max: KV_KEY_MAX_BYTES,
      }),
    );
  };
}

/**
 * Build the per-plugin storage budget counter, enforcing
 * `KV_PLUGIN_MAX_TOTAL_BYTES` across one wrapper's lifetime (one scan).
 *
 * The wrapper is the single choke point and already measures encoded
 * bytes for the per-value ceiling, so charging the budget here costs
 * nothing extra. The rejected write is not counted: a plugin that keeps
 * trying past its budget keeps getting the same total back rather than
 * an ever-growing one, which makes the error message stable and the
 * accounting honest about what was actually stored.
 */
function makeBudgetCounter(pluginId: string): (key: string, bytes: number) => void {
  let written = 0;
  return (key: string, bytes: number): void => {
    const would = written + bytes;
    if (would > KV_PLUGIN_MAX_TOTAL_BYTES) {
      throw new KvBudgetExceededError(
        tx(PLUGIN_STORE_TEXTS.kvBudgetExceeded, {
          pluginId: safeText(pluginId),
          key: safeText(key),
          would,
          budget: KV_PLUGIN_MAX_TOTAL_BYTES,
        }),
        key,
        would,
        KV_PLUGIN_MAX_TOTAL_BYTES,
      );
    }
    written = would;
  };
}

/**
 * Warner used when no sink was supplied: skips even the byte
 * measurement, so the no-advisory path costs one call.
 */
function noWarn(): void {
  // Intentionally empty, there is nowhere to write the advisory.
}

/**
 * The Mode A AJV gate. Only `set` runs it; `get` / `list` return what
 * is stored even if a schema landed after the row did.
 */
function assertSchemaAccepts(
  pluginId: string,
  schema: IPluginStorageSchema | undefined,
  key: string,
  value: unknown,
): void {
  if (!schema) return;
  if (schema.validate(value)) return;
  // `schemaPath` is a manifest field and the AJV `instancePath`
  // fragments echo the plugin's own value, so both are
  // plugin-controlled and get the same treatment as the key.
  throw new Error(
    tx(PLUGIN_STORE_TEXTS.kvValidationFailed, {
      pluginId: safeText(pluginId),
      schemaPath: safeText(schema.schemaPath),
      key: safeText(key),
      errors: safeText(formatAjvErrors(schema.validate.errors ?? null)),
    }),
  );
}

/**
 * JSON-encode with a replacer that turns every non-serializable member
 * into a typed rejection instead of `JSON.stringify`'s silent drop
 * (`{ a: undefined }` → `{}`) or a raw `TypeError` (cyclic).
 */
function encodeValue(pluginId: string, key: string, value: unknown): string {
  const reject: (reason: string, cause?: unknown) => never = (reason, cause) => {
    throw new KvValueNotSerializableError(
      tx(PLUGIN_STORE_TEXTS.kvValueNotSerializable, {
        pluginId: safeText(pluginId),
        key: safeText(key),
        reason,
      }),
      key,
      cause,
    );
  };
  let json: string | undefined;
  try {
    json = JSON.stringify(value, (_k, v: unknown) => assertMemberSerializable(v, reject));
  } catch (err) {
    if (err instanceof KvValueNotSerializableError) throw err;
    reject(PLUGIN_STORE_TEXTS.kvValueNotSerializableReasonCyclic, err);
  }
  if (json === undefined) {
    reject(PLUGIN_STORE_TEXTS.kvValueNotSerializableReasonUndefined);
  }
  return json;
}

/**
 * `JSON.stringify` replacer body. Runs on every member (after any
 * `toJSON`), so a nested `undefined` / function / bigint / symbol is
 * caught at whatever depth it sits.
 */
function assertMemberSerializable(
  value: unknown,
  reject: (reason: string) => never,
): unknown {
  const type = typeof value;
  if (type === 'undefined') reject(PLUGIN_STORE_TEXTS.kvValueNotSerializableReasonUndefined);
  if (type === 'function') reject(PLUGIN_STORE_TEXTS.kvValueNotSerializableReasonFunction);
  if (type === 'bigint') reject(PLUGIN_STORE_TEXTS.kvValueNotSerializableReasonBigint);
  if (type === 'symbol') reject(PLUGIN_STORE_TEXTS.kvValueNotSerializableReasonSymbol);
  return value;
}

/**
 * Per-value ceiling, measured on the encoded payload. Returns the byte
 * count so the caller can feed the aggregate counter without measuring
 * the same string twice.
 */
function assertValueSize(pluginId: string, key: string, valueJson: string): number {
  const bytes = Buffer.byteLength(valueJson, 'utf8');
  if (bytes <= KV_VALUE_MAX_BYTES) return bytes;
  throw new KvValueTooLargeError(
    tx(PLUGIN_STORE_TEXTS.kvValueTooLarge, {
      pluginId: safeText(pluginId),
      key: safeText(key),
      bytes,
      max: KV_VALUE_MAX_BYTES,
    }),
    key,
    bytes,
  );
}

/**
 * Decode a stored payload. Only an operator editing the DB by hand can
 * produce invalid JSON here, which is exactly the "unexpected backend
 * failure" bucket.
 */
function decodeValue(
  pluginId: string,
  op: string,
  key: string,
  valueJson: string,
): unknown {
  try {
    return JSON.parse(valueJson, prototypeSafeReviver);
  } catch (err) {
    throw new KvOperationFailedError(
      tx(PLUGIN_STORE_TEXTS.kvValueDecodeFailed, {
        pluginId: safeText(pluginId),
        op,
        key: safeText(key),
      }),
      op,
      err,
    );
  }
}

/**
 * `JSON.parse` reviver that drops the two keys a prototype-pollution
 * gadget travels under.
 *
 * `JSON.parse` never invokes the `__proto__` SETTER, so a stored
 * `{"__proto__":{"polluted":"yes"}}` decodes into an object carrying
 * `__proto__` as an OWN data property. Nothing in the kernel walks
 * these values today, but they are handed straight to plugin code, and
 * any future diagnostic / UI surface that merges or spreads one would
 * carry the gadget with it. Returning `undefined` from the reviver
 * deletes the property before the object is ever handed out.
 *
 * `constructor` rides along for the same reason. A legitimate payload
 * losing a data key literally named `constructor` is an acceptable
 * trade for a store whose keys are plugin-authored metadata; the spec
 * puts no constraint on member names, so this is documented behaviour
 * rather than a silent surprise.
 */
function prototypeSafeReviver(key: string, value: unknown): unknown {
  if (key === '__proto__' || key === 'constructor') return undefined;
  return value;
}

/**
 * Run one persistence call, wrapping anything the backend throws in
 * `KvOperationFailedError` so engine detail (SQL text, file paths)
 * only reaches plugin code through `.cause`.
 */
async function runBackend<T>(
  pluginId: string,
  op: string,
  call: () => T | Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof KvOperationFailedError) throw err;
    throw new KvOperationFailedError(
      tx(PLUGIN_STORE_TEXTS.kvOperationFailed, { pluginId: safeText(pluginId), op }),
      op,
      err,
    );
  }
}

/** Compact AJV error string suitable for the throw message. */
function formatAjvErrors(
  errors: { instancePath: string; message?: string; keyword: string }[] | null,
): string {
  if (!errors || errors.length === 0) return '(no AJV details)';
  return errors
    .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
    .join('; ');
}
