# Plugin KV API

Normative contract for plugin-accessible persistence. Two modes exist (see [`db-schema.md`](./db-schema.md) for the catalog entries):

- **Mode A, KV**: plugin uses the kernel-provided `ctx.store.*` accessor. Backed by the shared `state_plugin_kvs` table.
- **Mode B, Dedicated**: plugin owns its own tables with the `plugin_<normalizedId>_` prefix, migrated by the kernel.

This document defines mode A in full and the boundary with mode B. Implementations MUST expose this API to every plugin that declares `"storage": { "mode": "kv" }` in its manifest.

---

## Overview

A plugin extension receives a `ctx` object at construction time. `ctx.store` is present if and only if the plugin declared storage. Its shape depends on the mode:

| Mode | `ctx.store` shape |
|---|---|
| No storage declared | `undefined`. |
| `mode: "kv"` | `KvStore` (this document). |
| `mode: "dedicated"` | `DedicatedStore` (scoped Database wrapper). See mode B below. |

Plugins SHOULD pick the minimum mode they need. Mode A is simpler and requires no migrations. Mode B is for plugins that need relational shape, indexes, or cross-row queries.

---

## Mode A: `ctx.store` KV accessor

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

The `KvStore` operations are individually atomic. There is NO multi-operation transaction in mode A, plugins that need transactional semantics across several rows MUST use mode B.

Implementations MUST NOT expose a `transaction()` method on `KvStore` in mode A. The shape is minimal to keep the backing table simple.

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

## Mode B: dedicated tables

Mode B is governed by [`db-schema.md`](./db-schema.md) (catalog analyzers + triple protection). This section restates the API surface.

### Declaration

```json
{
  "storage": {
    "mode": "dedicated",
    "tables": ["rule_exceptions", "cache_entries"],
    "migrations": ["migrations/001_initial.sql"]
  }
}
```

The `tables` array lists logical table names **without** the `plugin_<id>_` prefix. The prefix is the kernel's namespace boundary, and it is ENFORCED rather than applied for you: migration SQL MUST write the physical, prefixed name (`CREATE TABLE plugin_<normalizedId>_rule_exceptions`), and a runtime query MUST reference it the same way. The manifest stays logical so the plugin id can be normalised into the prefix without the author restating it.

### Accessor

```typescript
interface DedicatedStore {
  db: Database;   // scoped wrapper, see below
}
```

`DedicatedStore.db` is a wrapper, NOT a raw handle. Every query passes through a validator that rejects:

- References to tables whose name doesn't start with this plugin's prefix.
- DDL statements (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`). Mode B DDL is runtime-immutable after migrations; plugins change shape via a new migration.
- `ATTACH DATABASE` statements.
- `PRAGMA` statements that aren't scoped to the plugin's own tables.

A query that fails validation raises `ScopedDbViolationError`. The plugin continues to run; only the offending query is rejected.

### Transaction support

Mode B plugins MAY call `db.transaction(async (tx) => { ... })`. The kernel provides transaction isolation consistent with the backing engine. Nested transactions are NOT supported; the kernel MUST reject a nested `transaction()` call with a typed error.

### Migrations

- Location: `<plugin-dir>/migrations/NNN_snake_case.sql`.
- Applied in order after kernel migrations on boot.
- Prefix enforcement: every object a migration creates MUST already carry the `plugin_<normalizedId>_` prefix. The kernel REJECTS an unprefixed or out-of-namespace name (`object "<name>" is outside the plugin's namespace`); it does NOT rewrite the statement to add the prefix. Rejecting rather than rewriting keeps one name in play: the author reads the same table name in the migration, in the runtime query and in a `sm db dump`, and a typo surfaces as an error instead of silently creating a differently-named table.
- The rule is literal and applies to EVERY object, indexes and constraints included: the name must START with the prefix. The kernel's own `ix_<table>_<cols>` convention is therefore unavailable to a plugin, since `ix_plugin_foo_bar` starts with `ix_`. Put the namespace first and the convention after (`plugin_foo_bar_ix`).
- A failing plugin migration fails the `sm db migrate` invocation (exit 2) and applies none of that plugin's migrations; other plugins and the kernel are unaffected. The plugin itself stays loadable, its extensions keep working, and only the storage its migration would have created is missing, because the migration runs at `sm db migrate` time rather than at load time.

See [`db-schema.md`](./db-schema.md) for the normative migration analyzers.

---

## Mode selection guidance

Non-normative guidance for plugin authors.

**Prefer mode A when**:

- Each value is a small JSON blob (preferences, per-node flags, hash pins).
- Queries are "get by key" or "list under a prefix".
- You need to ship without asking the user to run a migration.

**Prefer mode B when**:

- You need indexes beyond `(pluginId, nodePath, key)`.
- You need to `JOIN` rows, aggregate, or do relational queries.
- Your data model is tabular (cache with TTL, observation log, provider registry).
- You are willing to own migrations forever.

A plugin MUST declare **exactly one** storage mode; mixing modes is forbidden. [`plugins-registry.schema.json`](./schemas/plugins-registry.schema.json) enforces this at the manifest level (`storage` is a `oneOf` between `kv` and `dedicated`), and at runtime `ctx.store` exposes either the `KvStore` or the `DedicatedStore` shape, never both. A plugin that needs both KV-like and relational access MUST use mode B and implement KV-style rows as a dedicated table.

---

## Visibility analyzers

- A plugin MUST NOT read or write rows outside its scope. Mode A: the accessor is scoped. Mode B: the validator enforces the prefix.
- The kernel MAY expose read-only introspection for diagnostics (e.g., `sm plugins show <id> --storage` lists key counts). Authoritative, not a plugin-level API.
- `sm db shell` can read any table. Operator-level escape hatch; plugins MUST NOT rely on it.

---

## Backup and retention

- Mode A rows live in `state_plugin_kvs` and are backed up with `sm db backup`.
- Mode B rows live in the plugin's dedicated tables (prefixed `plugin_<id>_`) and are likewise backed up.
- `sm plugins disable <id>` does NOT drop the plugin's data; disabled plugins keep their KV rows and dedicated tables. (`scan_contributions` rows ARE purged eagerly on disable, see `db-schema.md` § `scan_contributions`, because those are scan-derived and would otherwise keep rendering in the UI until the next scan. KV / dedicated-table data is plugin-managed and survives toggle cycles so re-enabling restores state.) `sm plugins forget <id>` (deferred to post-`v1.0`) wipes everything.
- `sm db reset` (no modifier) drops only `scan_*`. Plugin KV rows (mode A) and plugin-dedicated tables (mode B) are **preserved** (non-destructive to plugin storage).
- `sm db reset --state` drops `state_*` AND every `plugin_<normalized_id>_*` table, which includes `state_plugin_kvs` (mode A) AND the plugin-dedicated tables (mode B). The CLI MUST require interactive confirmation unless `--yes` is passed.
- `sm db reset --hard` deletes the DB file entirely, destroying all plugin storage regardless of mode.

---

## Honest note on isolation

Mode A is isolated at the row level: the accessor physically cannot see another plugin's rows.

Mode B is **isolated against accidents, not hostile code**. The scoped `Database` wrapper rejects cross-namespace queries at runtime, but a malicious plugin in the same JavaScript process can bypass it by importing raw engine bindings directly. Plugins are user-placed code; the kernel trusts the user's judgement at install time.

Post-v1.0 work: signed manifest, sandboxed worker-thread isolation, per-plugin DB file. None land before `v0.5.0`.

---

## See also

- [`db-schema.md`](./db-schema.md), table catalog, migration analyzers, triple protection for mode B.
- [`architecture.md`](./architecture.md), extension contract analyzers and `ctx.store` injection via the kernel.

---

## Stability

- The `KvStore` interface (method names, options, return shapes) is **stable** as of spec v1.0.0.
- Adding a method to `KvStore` is a minor bump; removing or changing a signature is a major bump.
- Mode names (`kv`, `dedicated`) are **stable**. Adding a third mode is a minor bump.
- Key and value size limits are implementation-defined and MAY change without a spec bump; implementations MUST document their limits in their own changelog.
- Error class names are **stable**; adding a new error class is a minor bump.
