/**
 * User-facing strings emitted by the `annotation-orphan` built-in rule
 * (`built-in-plugins/analyzers/annotation-orphan/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ANNOTATION_ORPHAN_TEXTS = {
  /** Sidecar `<path>.sm` has no matching `<path>.md`. */
  message:
    'Orphan sidecar: {{sidecarPath}} has no matching markdown node at {{expectedMdPath}}.',
} as const;
