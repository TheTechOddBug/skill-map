/**
 * Public projection of a `Job` for the queue READ surfaces: every field
 * EXCEPT the `nonce`. The nonce is the sole `sm record` credential and
 * travels only on the contracted carriers, `sm jobs submit --json` (the
 * creator envelope) and `sm jobs claim --json` (the handover), per
 * `spec/job-lifecycle.md` §Atomic claim · Nonce exposure. Every passive
 * reader of the queue (`sm jobs list` / `sm jobs show`, and the BFF's
 * `GET /api/jobs`) MUST strip it, or a reader could forge callbacks for
 * jobs it never claimed.
 *
 * Single source of truth shared by the CLI verbs and the BFF route so the
 * strip cannot drift between the two operator surfaces.
 */

import type { Job } from '../types.js';

/** Every `Job` field except the record credential `nonce`. */
export type PublicJob = Omit<Job, 'nonce'>;

/** Strip the `nonce` off a `Job` for a read surface. */
export function toPublicJob(job: Job): PublicJob {
  const { nonce: _nonce, ...pub } = job;
  return pub;
}
