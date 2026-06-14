/**
 * User-facing strings emitted by the `annotation-field-unknown`
 * built-in rule
 * (`plugins/core/analyzers/annotation-field-unknown/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ANNOTATION_FIELD_UNKNOWN_TEXTS = {
  // Diagnosis bodies (`<what>; <why>`). The shared `formatFinding` helper
  // owns the subject (the offending key, built before the call); the
  // affected node is the finding's own node, so its path never appears.
  /** Key inside `annotations:` is not in the curated catalog. */
  unknownAnnotationKey: 'Unknown sidecar key; not in the annotations catalog',
  /** Top-level key is neither reserved, nor a registered plugin namespace, nor a registered root key. */
  unknownRootKey:
    'Unknown top-level sidecar key; not a reserved block, plugin namespace, or root contribution',
  /** Value under a registered plugin namespace fails the contributed schema. */
  pluginNamespaceInvalid: 'Sidecar block fails the plugin schema; {{errors}}',
  // Tooltips for the per-node view-contribution badges. Singular vs
  // plural keeps the count grammar correct without a sub-template.
  alertTooltipSingle:
    'This node has 1 unknown field in its sidecar. Open the inspector for details.',
  alertTooltipMany:
    'This node has {{count}} unknown fields in its sidecar. Open the inspector for details.',
} as const;
