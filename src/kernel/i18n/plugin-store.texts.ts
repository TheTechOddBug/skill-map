/**
 * Kernel-side strings emitted by `kernel/adapters/plugin-store.ts` and
 * `kernel/adapters/plugin-store-errors.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation. See
 * `kernel/i18n/orchestrator.texts.ts` header for rationale.
 *
 * Two families live here:
 *
 *   - Spec § A.12, opt-in JSON Schema validation for plugin custom
 *     storage. Thrown synchronously from the wrapper when the plugin
 *     author's declared output schema rejects the value the plugin
 *     tried to persist.
 *   - `spec/plugin-kv-api.md` § Mode A, the key / value / backend
 *     rejections carried by the typed `Kv*Error` classes.
 *
 * The caller (the orchestrator's extractor loop) surfaces the throw to
 * the `extension.error` channel. Messages stay backend-agnostic on
 * purpose: no SQL, no file paths, per the spec's error-leak analyzer.
 */

export const PLUGIN_STORE_TEXTS = {
  kvValidationFailed:
    "plugin '{{pluginId}}' ctx.store.set('{{key}}', value): value violates declared schema " +
    '({{schemaPath}}): {{errors}}',

  dedicatedValidationFailed:
    "plugin '{{pluginId}}' ctx.store.write('{{table}}', row): row violates declared schema " +
    '({{schemaPath}}): {{errors}}',

  kvKeyNotAString:
    "plugin '{{pluginId}}' ctx.store: key must be a string, received {{received}}",

  kvKeyEmpty: "plugin '{{pluginId}}' ctx.store: key must be a non-empty string",

  kvKeyTooLong:
    "plugin '{{pluginId}}' ctx.store: key '{{key}}' is {{bytes}} bytes, above the " +
    '{{max}}-byte limit',

  // Advisories reach `printer.warn`, which does a bare `stderr.write`
  // and never appends a newline (see `core/runtime/printer.ts`), so the
  // template carries its own line ending. Rejection messages below go
  // into an Error and deliberately do NOT.
  kvKeyLongWarning:
    "plugin '{{pluginId}}' ctx.store: key '{{key}}' is {{bytes}} bytes, above the " +
    '{{soft}}-byte soft limit (still accepted, hard limit is {{max}})\n',

  kvBudgetExceeded:
    "plugin '{{pluginId}}' ctx.store.set('{{key}}'): this write would put the plugin at " +
    '{{would}} bytes for this scan, over its {{budget}}-byte budget. Nothing was persisted. ' +
    'Plugin storage grows the project database, so the KV store is for metadata, not bulk ' +
    'content; a plugin that needs relational volume declares dedicated storage instead.',

  kvNodePathEmpty:
    "plugin '{{pluginId}}' ctx.store: nodePath must not be an empty string, it is reserved " +
    'as the internal global-scope sentinel. Omit the option (or pass null) for the global scope.',

  kvNodePathNotAString:
    "plugin '{{pluginId}}' ctx.store: nodePath must be a string, null, or omitted, received " +
    '{{received}}',

  kvValueNotSerializable:
    "plugin '{{pluginId}}' ctx.store.set('{{key}}', value): value is not JSON-serializable " +
    '({{reason}})',

  kvValueNotSerializableReasonCyclic: 'cyclic reference or unsupported type',

  kvValueNotSerializableReasonUndefined: 'contains undefined',

  kvValueNotSerializableReasonFunction: 'contains a function',

  kvValueNotSerializableReasonBigint: 'contains a bigint',

  kvValueNotSerializableReasonSymbol: 'contains a symbol',

  kvValueTooLarge:
    "plugin '{{pluginId}}' ctx.store.set('{{key}}', value): encoded value is {{bytes}} bytes, " +
    'above the {{max}}-byte limit',

  kvValueDecodeFailed:
    "plugin '{{pluginId}}' ctx.store.{{op}}: the stored value for key '{{key}}' is not valid " +
    'JSON',

  kvOperationFailed:
    "plugin '{{pluginId}}' ctx.store.{{op}}: the storage backend rejected the operation",
} as const;
