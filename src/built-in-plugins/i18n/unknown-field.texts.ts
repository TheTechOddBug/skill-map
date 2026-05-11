/**
 * User-facing strings emitted by the `unknown-field` built-in rule
 * (`built-in-plugins/analyzers/unknown-field/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const UNKNOWN_FIELD_TEXTS = {
  /** Key inside `annotations:` is not in the curated catalog. */
  unknownAnnotationKey:
    "{{path}}: sidecar annotations contain unknown key '{{key}}' (not in annotations.schema.json catalog).",
  /** Top-level key is neither reserved, nor a registered plugin namespace, nor a registered root key. */
  unknownRootKey:
    "{{path}}: sidecar declares unknown top-level key '{{key}}' — not a reserved block, not a registered plugin namespace, not a registered root contribution.",
  /** Value under a registered plugin namespace fails the contributed schema. */
  pluginNamespaceInvalid:
    "{{path}}: sidecar block '{{pluginId}}.{{key}}' fails the schema contributed by plugin '{{pluginId}}' — {{errors}}.",
  // Tooltips for the per-node view-contribution badges. Singular vs
  // plural keeps the count grammar correct without a sub-template.
  alertTooltipSingle:
    'This node has 1 unknown field in its sidecar. Open the inspector for details.',
  alertTooltipMany:
    'This node has {{count}} unknown fields in its sidecar. Open the inspector for details.',
} as const;
