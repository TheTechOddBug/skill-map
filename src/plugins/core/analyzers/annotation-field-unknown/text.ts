/**
 * User-facing strings emitted by the `annotation-field-unknown`
 * built-in rule
 * (`plugins/core/analyzers/annotation-field-unknown/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ANNOTATION_FIELD_UNKNOWN_TEXTS = {
  // Compact finding grammar: the affected node is the finding's own
  // node, so its path never appears in the message.
  /** Key inside `annotations:` is not in the curated catalog. */
  unknownAnnotationKey:
    "Unknown sidecar key '{{key}}'; not in the annotations catalog.",
  /** Top-level key is neither reserved, nor a registered plugin namespace, nor a registered root key. */
  unknownRootKey:
    "Unknown sidecar top-level key '{{key}}'; not a reserved block, a plugin namespace, or a root contribution.",
  /** Value under a registered plugin namespace fails the contributed schema. */
  pluginNamespaceInvalid:
    "Sidecar block '{{pluginId}}.{{key}}' fails the schema from plugin '{{pluginId}}': {{errors}}.",
  // Tooltips for the per-node view-contribution badges. Singular vs
  // plural keeps the count grammar correct without a sub-template.
  alertTooltipSingle:
    'This node has 1 unknown field in its sidecar. Open the inspector for details.',
  alertTooltipMany:
    'This node has {{count}} unknown fields in its sidecar. Open the inspector for details.',
} as const;
