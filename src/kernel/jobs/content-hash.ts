/**
 * Content-hash computation for jobs. Two stable hashes:
 *
 *   1. `computePromptTemplateHash({ preamble, template })` produces the
 *      `promptTemplateHash` component. Per `spec/prompt-preamble.md`
 *      ("Included in the `contentHash` computation via `promptTemplateHash`,
 *      which hashes the preamble + action template concatenation") the
 *      hash covers the canonical preamble PLUS the raw action template
 *      (the `prompt.md` bytes, before user content is interpolated). This
 *      is what makes a preamble bump invalidate prior content hashes
 *      (`spec/prompt-preamble.md` §How the kernel applies the preamble,
 *      point 6): a changed preamble MUST NOT collide with prior jobs.
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
 *      `(actionId, actionVersion, node.path, bodyHash, frontmatterHash,
 *      promptTemplateHash)`, hex, lowercase. The NUL delimiter prevents
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
  actionId: string;
  actionVersion: string;
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
 * `promptTemplateHash` = sha256 of the canonical preamble concatenated
 * with the raw action template (`prompt.md`). Direct concatenation, no
 * separator: the preamble already ends with its own trailing newline, so
 * a fixed-order concat is deterministic. Folding the preamble in is the
 * whole point (see file docstring): a preamble bump changes this hash and
 * therefore the downstream `contentHash`.
 */
export function computePromptTemplateHash(input: {
  preamble: string;
  template: string;
}): string {
  return sha256Hex(input.preamble + input.template);
}

/**
 * `contentHash` = sha256 over the NUL-joined tuple. The field order is
 * fixed by the spec and MUST NOT be reordered.
 */
export function computeContentHash(input: IContentHashInput): string {
  const tuple = [
    input.actionId,
    input.actionVersion,
    input.nodePath,
    input.bodyHash,
    input.frontmatterHash,
    input.promptTemplateHash,
  ].join(NUL);
  return sha256Hex(tuple);
}
