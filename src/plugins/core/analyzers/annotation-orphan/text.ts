/**
 * User-facing strings emitted by the `annotation-orphan` built-in rule
 * (`plugins/core/analyzers/annotation-orphan/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ANNOTATION_ORPHAN_TEXTS = {
  /**
   * Compact finding grammar: line 1 = the orphan sidecar file, line 2
   * = the diagnosis. The expected markdown path IS the finding's
   * `nodeIds[0]` (the issue files under the path the sidecar points
   * at), so it never appears in the message.
   */
  message: '{{sidecarPath}}:\nOrphan sidecar; no matching markdown node.',
} as const;
