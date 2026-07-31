# Plugin KV API

Normative contract for plugin-accessible persistence: the kernel-provided `ctx.store.*` accessor, backed by the shared `state_plugin_kvs` table (see [`db-schema.md`](./db-schema.md) for the catalog entry).

Implementations MUST expose this API to every plugin that declares `"storage": { "mode": "kv" }` in its manifest.

---

## Overview

A plugin extension receives a `ctx` object at construction time. `ctx.store` is present if and only if the plugin declared storage:

| Manifest | `ctx.store` shape |
|---|---|
| No storage declared | `undefined`. |
| `"storage": { "mode": "kv" }` | `KvStore` (this document). |

`kv` is the only storage mode. It requires no migrations and is ready the moment the plugin loads; a plugin that needs relational shape keeps that data outside skill-map's database.

---

## `ctx.store` KV accessor

### Interface

```typescript
interface KvStore {
  get<T = unknown>(key: string, options?: { nodePath?: string }): Promise<T | null>;
  set<T = unknown>(key: string, value: T, options?: { nodePath?: string }): Promise<void>;
  delete(key: string, options?: { nodePath?: string }): Promise<boolean>;
  list(options?: { nodePath?: string; prefix?: string }): Promise<KvEntry[]>;
}

interface KvEntry {
  key: string;
  value: unknown;
  nodePath: string | null;
  updatedAt: number;
}
```

Implementations in other languages MUST expose the same semantic surface.

### Scoping

Every operation is scoped by the caller's `pluginId`. The plugin cannot specify, override, or observe another plugin's `pluginId`. The kernel enforces this when constructing `ctx.store`: the `pluginId` is captured at registration time and is not an argument.

Operations MAY be additionally scoped by `nodePath`:

- **Global KV (no `nodePath`)**: `{pluginId, nodePath: null, key}`. One row per plugin + key.
- **Node-scoped KV (with `nodePath`)**: `{pluginId, nodePath: "<path>", key}`. One row per plugin + node + key.

Both scopes share the `state_plugin_kvs` table (see [`db-schema.md`](./db-schema.md)). The `nodePath` column is nullable; implementations MUST use a sentinel empty string internally when the backing engine rejects NULL in composite primary keys. Because that sentinel is internal, an implementation MUST reject a caller-supplied empty `nodePath` (`KvNodePathInvalidError`) rather than silently routing it to global scope.

### Semantics

| Operation | Behaviour |
|---|---|
| `get(key, { nodePath })` | Returns the stored value (JSON-decoded) or `null` if no row exists. Never throws for "missing". |
| `set(key, value, { nodePath })` | Upsert. Replaces any existing value, updates `updatedAt`. The kernel JSON-encodes the value; it MUST be JSON-serializable. Cyclic or non-serializable values MUST be rejected with a typed error. |
| `delete(key, { nodePath })` | Deletes the row if present. Returns `true` if a row was deleted, `false` otherwise. Idempotent. |
| `list({ nodePath, prefix })` | Returns all entries matching the scope. `nodePath` omitted: returns global entries (`nodePath IS NULL`). `nodePath: null` (explicit): same as omitted. `nodePath: "<path>"`: returns entries for that node. `prefix`: filters keys starting with the given string. |

Return order of `list` is NOT specified; consumers MUST NOT rely on ordering. Implementations SHOULD order by `key ASC` for developer ergonomics.

### Key constraints

- `key` MUST be a non-empty string, length ≤ 256 bytes (UTF-8).
- `key` SHOULD be dot-separated namespaces (`foo.bar.baz`) for discoverability, but this is not enforced.
- The kernel MAY log a warning when `key` exceeds a reasonable length (e.g. 128), but MUST NOT reject below 256.

### Value constraints

- Value MUST be JSON-serializable (plain objects, arrays, strings, numbers, booleans, null).
- Values containing `undefined` or functions MUST be rejected with a typed error before writing.
- The kernel MAY impose a per-value size limit (reference impl: 1 MiB). Exceeding it is a typed error, not a silent truncation.
- The kernel SHOULD also impose an AGGREGATE budget per plugin, because a per-value ceiling bounds nothing on its own: an Extractor runs once per node, so a plugin on a large tree can write within the per-value limit on every call and still grow the project database without limit. The reference impl budgets 4 MiB per plugin per scan and rejects the write that would cross it with `KvBudgetExceededError`, persisting nothing. A rejected write does NOT consume budget, so the plugin is throttled rather than bricked, and the scan itself continues: the Extractor sees a typed rejection and decides, exactly as it does for an oversized value. Implementations MAY choose a different number; they MUST NOT silently truncate or silently drop the write.

### Transactions

The `KvStore` operations are individually atomic. There is NO multi-operation transaction: a plugin that needs transactional semantics across several rows keeps that data outside skill-map's database.

Implementations MUST NOT expose a `transaction()` method on `KvStore`. The shape is minimal to keep the backing table simple.

### Errors

All errors are typed. An implementation MUST expose these error classes (or language equivalents):

| Error | Cause |
|---|---|
| `KvKeyInvalidError` | Key is empty, non-string, or too long. |
| `KvNodePathInvalidError` | `nodePath` is a non-string, or the empty string. The empty string is REJECTED rather than treated as global: it is the internal sentinel for global scope, so accepting it would make a write that said "node-scoped" read back as global, silently collapsing every per-node row into one. Omit the option (or pass `null`) for global scope. |
| `KvValueNotSerializableError` | Value cannot be JSON-encoded. |
| `KvValueTooLargeError` | Encoded value exceeds the per-value size limit. |
| `KvBudgetExceededError` | The write would push the plugin past its aggregate storage budget. Distinct from `KvValueTooLargeError`, which is about one value being too big: this fires when many individually-legal writes add up, the shape a plugin looping over every node produces. |
| `KvOperationFailedError` | Unexpected backend failure (e.g., DB full, IO error). Wraps the underlying cause. |

Errors MUST NOT leak backend-specific details (SQL strings, file paths) to plugin code unless wrapped in `KvOperationFailedError.cause`.

---

## Visibility analyzers

- A plugin MUST NOT read or write rows outside its scope. The accessor is scoped by construction: the plugin id is captured when the accessor is built and is never an argument.
- The kernel MAY expose read-only introspection for diagnostics (e.g., `sm plugins show <id> --storage` lists key counts). Authoritative, not a plugin-level API.
- `sm db shell` can read any table. Operator-level escape hatch; plugins MUST NOT rely on it.

---

## Backup and retention

- Plugin rows live in `state_plugin_kvs` and are backed up with `sm db backup`.
- `sm plugins disable <id>` does NOT drop the plugin's data; disabled plugins keep their KV rows. (`scan_contributions` rows ARE purged eagerly on disable, see `db-schema.md` § `scan_contributions`, because those are scan-derived and would otherwise keep rendering in the UI until the next scan. KV data is plugin-managed and survives toggle cycles so re-enabling restores state.) `sm plugins forget <id>` (deferred to post-`v1.0`) wipes everything.
- `sm db reset` (no modifier) drops only `scan_*`. Plugin KV rows are **preserved** (non-destructive to plugin storage).
- `sm db reset --state` drops `state_*`, which includes `state_plugin_kvs`. The CLI MUST require interactive confirmation unless `--yes` is passed.
- `sm db reset --hard` deletes the DB file entirely, destroying all plugin storage.

---

## Honest note on isolation

The accessor is isolated at the row level: it physically cannot see another plugin's rows, because the plugin id is captured at construction and is never an argument.

That isolation holds against **accidents, not hostile code**. A malicious plugin runs in the same JavaScript process and can reach any table regardless, by importing raw engine bindings directly. Plugins are user-placed code; the kernel trusts the user's judgement at install time.

Hardening that would change this posture (signed manifests, sandboxed worker-thread isolation, a per-plugin database file) is out of scope for v1 and not scheduled here. Each is additive, so none of them needs a major bump to land.

---

## See also

- [`db-schema.md`](./db-schema.md), table catalog and migration analyzers.
- [`architecture.md`](./architecture.md), extension contract analyzers and `ctx.store` injection via the kernel.

---

## Stability

- The `KvStore` interface (method names, options, return shapes) is **stable** as of spec v1.0.0.
- Adding a method to `KvStore` is a minor bump; removing or changing a signature is a major bump.
- The mode name (`kv`) is **stable**. Adding a second mode is a minor bump.
- Key and value size limits are implementation-defined and MAY change without a spec bump; implementations MUST document their limits in their own changelog.
- Error class names are **stable**; adding a new error class is a minor bump.
