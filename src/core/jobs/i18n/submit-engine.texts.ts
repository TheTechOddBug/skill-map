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
   * `detail` of an `unreadable` submit outcome, one COMPLETE sentence per
   * diagnosed cause (`diagnoseUnreadable`). Four distinct situations used
   * to collapse into one generic "file missing or not readable as a node"
   * whose remedy (`sm scan`) was wrong for half of them; the live case
   * that surfaced it was a healthy symlink whose target the submit-time
   * read refused for POLICY, reported as if the file did not exist.
   *
   * Each sentence names the node and carries its own remedy, so every
   * host (CLI single + fan-out lines, BFF envelope, MCP `submit_job`,
   * which returns `detail` verbatim) renders it as-is without composing
   * its own framing.
   */
  submitReadMissing:
    '{{node}} is no longer on disk. The map still lists it from the last scan; ' +
    'run sm scan to bring the map up to date.',
  submitReadBrokenSymlink:
    '{{node}} is a broken symlink: it points at something that is not there anymore. ' +
    'Fix the link, or run sm scan to drop the node from the map.',
  submitReadExternalBlocked:
    '{{node}} is a symlink that leads outside the project, and following external ' +
    'links is off. If you authored this link, enable scan.followExternalSymlinks ' +
    'in the project settings.',
  submitReadPermission:
    '{{node}} cannot be opened: permission denied. Check the file permissions ' +
    'and try again.',
  /**
   * Fallback when none of the lstat-based diagnoses match (e.g. the file
   * exists and is readable but no longer parses as a node, or a custom
   * Provider walk threw). `{{detail}}` carries whatever concrete hint is
   * in hand, `formatErrorMessage(err)` on the throw path or the generic
   * not-yielded wording below.
   */
  submitReadUnknown:
    '{{node}} cannot be read right now ({{detail}}); run sm scan to refresh the map.',
  /**
   * `{{detail}}` of `submitReadUnknown` when the provider walk simply
   * yields no record and nothing else explains why.
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
