/**
 * Kernel-templated `state_findings.message` statements for the safety
 * lane (`spec/db-schema.md` §state_findings): the `origin = 'kernel'`
 * rows the record path synthesizes under the reserved type slugs when a
 * probabilistic report's `safety` block flags trouble. Wording is
 * implementation-defined per the spec; `safety.injectionDetails` travels
 * on the row's `detail` column, never inside these messages.
 *
 * English-only catalog (externalized, not internationalized) per the
 * project i18n stance. No `{{placeholder}}` interpolation: the row's
 * `extension_id` / `node_id` columns already carry the attribution, so
 * the statements stay self-contained.
 */

export const FINDINGS_TEXTS = {
  /** Reserved slug `injection-detected` (severity `warn`). */
  injectionDetected:
    'The model flagged a prompt-injection attempt inside the node content',
  /** Reserved slug `content-suspicious` (severity `info`). */
  contentSuspicious:
    'The model flagged the node content as suspicious (unusual patterns without a concrete injection)',
  /** Reserved slug `content-malformed` (severity `warn`). */
  contentMalformed:
    'The model flagged the node content as malformed (unparseable or structurally broken)',
} as const;
