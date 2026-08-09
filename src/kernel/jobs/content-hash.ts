/**
 * Content-hash computation for jobs. Two stable hashes:
 *
 *   1. `computePromptTemplateHash({ preamble, template, reportContract })`
 *      produces the `promptTemplateHash` component. Per
 *      `spec/prompt-preamble.md` ("hashes the kernel-authored prelude:
 *      the preamble + extension template + report-contract blocks
 *      concatenation") the hash covers the canonical preamble PLUS the
 *      raw extension template (the `prompt.md` bytes, before user
 *      content is interpolated) PLUS the rendered report-contract
 *      section (`report-contract.ts`). This is what makes a preamble
 *      bump OR a schema edit invalidate prior content hashes
 *      (`spec/prompt-preamble.md` §How the kernel applies the preamble,
 *      point 6): a changed prelude MUST NOT collide with prior jobs.
 *
 *      NOTE: the brief for this sub-step described `promptTemplateHash`
 *      as "sha256 of the action's prompt.md file content"; that omits the
 *      preamble and would let a preamble bump silently reuse a stale
 *      content row (violating the "same content_hash -> same content"
 *      invariant `state_job_contents` relies on). The spec wording wins
 *      per the repo authority order (spec > brief), so the preamble is
 *      folded in here.
 *
 *   2. `computeContentHash(input)` produces the `contentHash` the job
 *      lifecycle keys on. Per `spec/job-lifecycle.md` §Submit step 3 and
 *      `spec/db-schema.md` §state_job_contents it is the `sha256` over the
 *      NUL-joined (`0x00`) tuple
 *      `(extensionId, extensionVersion, node.path, bodyHash,
 *      frontmatterHash, promptTemplateHash)`, hex, lowercase. The queue is
 *      kind-agnostic: the extension is a probabilistic Action or a
 *      probabilistic finder Analyzer. The NUL delimiter prevents
 *      concatenation-ambiguity collisions; `node.path` participates
 *      because the render embeds it via the `<user-content id>` attribute.
 *
 * Both hashes are STABLE (`spec/job-lifecycle.md` §Stability): changing
 * either input set is a major spec bump.
 */

import { createHash } from 'node:crypto';

/**
 * NUL byte (`0x00`) delimiter joining the content-hash tuple. Built via
 * `String.fromCharCode(0)` so the source file carries no literal control
 * byte (keeps it greppable and text-tool friendly).
 */
const NUL = String.fromCharCode(0);

export interface IContentHashInput {
  extensionId: string;
  extensionVersion: string;
  /** `node.path`; embedded in the render via the `<user-content id>` attribute. */
  nodePath: string;
  bodyHash: string;
  frontmatterHash: string;
  /** Output of `computePromptTemplateHash` (preamble + action template). */
  promptTemplateHash: string;
}

/** sha256 of `data`, hex-encoded lowercase. */
function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * `promptTemplateHash` = sha256 of the kernel-authored prelude: the
 * canonical preamble, the raw extension template (`prompt.md`; the
 * canonical wrapper template for a skill-action job), the
 * skill-instructions section (skill-action jobs ONLY,
 * `skill-injection.ts`), the findings-to-resolve section (fixer jobs
 * ONLY, `findings-injection.ts`), the current-tags section (tagger jobs
 * ONLY, `current-tags-injection.ts`), and the report-contract section,
 * concatenated in that fixed order, the SAME order they render in
 * (`spec/prompt-preamble.md`: "the preamble + extension template + the
 * findings-to-resolve section for fixer jobs + report-contract blocks";
 * `spec/skill-actions.md` §Hashing for the skill fold).
 * Direct concatenation, no separator: the fixed order keeps it
 * deterministic. Folding the whole prelude in is the point (see file
 * docstring): a preamble bump, a report-schema edit, a changed finding
 * set, a changed tag set, OR a single edited `SKILL.md` byte changes
 * this hash and therefore the downstream `contentHash`.
 *
 * NON-SKILL / NON-FIXER / NON-TAGGER invariant: every optional section is
 * absent (undefined) for every other job, so it folds in as the empty
 * string and the concatenation reduces to
 * `preamble + template + reportContract`, byte-for-byte the pre-injection
 * formula. Those jobs' `promptTemplateHash` (and hence their
 * `contentHash`) is therefore UNCHANGED by any injection feature.
 */
export function computePromptTemplateHash(input: {
  preamble: string;
  template: string;
  /**
   * Rendered skill-instructions section (`skill-injection.ts`). Present
   * ONLY for skill-action jobs (`skill:<name>` submits); absent (folds
   * in as `''`) otherwise, so every non-skill hash stays byte-identical
   * to the pre-skill-actions formula (`spec/skill-actions.md` §Hashing).
   * Folded immediately after the template, the same order it renders in.
   */
  skillSection?: string;
  /**
   * Rendered findings-to-resolve section (`findings-injection.ts`).
   * Present ONLY for fixer jobs; absent (folds in as `''`) otherwise, so
   * non-fixer hashes stay byte-identical to the pre-fixer formula.
   */
  findingsSection?: string;
  /**
   * Rendered current-tags section (`current-tags-injection.ts`). Present
   * ONLY for a TAGGER job over a node that carries tags; absent (folds in
   * as `''`) otherwise. Folding it in is what re-keys a tagger's content
   * when the node's tags changed, instead of reusing a stale render
   * (`spec/job-lifecycle.md` §Current-tags injection for taggers).
   */
  currentTagsSection?: string;
  /** Rendered report-contract section (`report-contract.ts`). */
  reportContract: string;
}): string {
  return sha256Hex(
    input.preamble +
      input.template +
      (input.skillSection ?? '') +
      (input.findingsSection ?? '') +
      (input.currentTagsSection ?? '') +
      input.reportContract,
  );
}

/**
 * `contentHash` = sha256 over the NUL-joined tuple. The field order is
 * fixed by the spec and MUST NOT be reordered.
 */
export function computeContentHash(input: IContentHashInput): string {
  const tuple = [
    input.extensionId,
    input.extensionVersion,
    input.nodePath,
    input.bodyHash,
    input.frontmatterHash,
    input.promptTemplateHash,
  ].join(NUL);
  return sha256Hex(tuple);
}
