/**
 * Test-only probabilistic Action. `mode: 'probabilistic'` so `sm job
 * submit` enqueues it (deterministic actions run in-process and are
 * refused by submit). It only carries a manifest, no `invoke` / `project`:
 * this sub-step builds the SUBMIT side of the queue, and the render reads
 * the sibling `prompt.md` by convention, not any runtime method.
 *
 * `precondition.kind` gates the `--all` fan-out to `claude/skill` nodes.
 * The sibling `report.schema.json` (extends `report-base.schema.json`)
 * satisfies the structure-as-truth loader check.
 */
export default {
  version: '1.0.0',
  description:
    'Test-only probabilistic action that wraps the node body in a one-line summary prompt.',
  mode: 'probabilistic',
  probExpectedDurationSeconds: 120,
  precondition: { kind: ['claude/skill'] },
};
