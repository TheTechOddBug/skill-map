/**
 * Strings emitted from `core/jobs/submit-engine.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Only the strings the engine itself authors live here; the framing
 * messages around the submit outcomes (queued / duplicate / drift lines,
 * refusal advisories, the `--all` summary) live in
 * `cli/i18n/jobs-queue.texts.ts` because they belong to the CLI verb's
 * presentation layer. The BFF maps the same structured outcomes to its
 * envelope error codes without touching either catalog.
 */

export const SUBMIT_ENGINE_TEXTS = {
  /**
   * `detail` of an `unreadable` submit outcome when the provider walk
   * yields no record for the target path (file deleted between scan and
   * submit, or no longer parseable as a node).
   */
  submitReadNotOnDisk: 'file missing or not readable as a node',
  /**
   * `detail` when the submit path and the target disagree about nodes: a
   * `probNodeless` Action routed through the per-node submit, or a
   * node-taking extension through the nodeless one. A caller bug (the two
   * paths are picked from the prepared context), never an operator state.
   */
  submitErrNodelessMismatch:
    'extension node expectation does not match the submit path used',
};
