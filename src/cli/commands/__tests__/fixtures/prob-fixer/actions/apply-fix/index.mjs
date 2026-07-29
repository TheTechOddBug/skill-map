/**
 * Test-only probabilistic FIXER Action (`spec/job-lifecycle.md` §Findings
 * injection for fixers). `mode: 'probabilistic'` so `sm jobs submit`
 * enqueues it, and `precondition.analyzerIds` names the finder whose
 * findings it resolves (`prob-finder/quality-check`), which makes it the
 * inverse-Modelo-B match the `core/auto-fix` hook queues. It carries only a
 * manifest; the render reads the sibling `prompt.md` by convention and the
 * kernel injects the node's matching findings into a `## Findings to
 * resolve` section at submit.
 */
export default {
  mode: 'probabilistic',
  probExpectedDurationSeconds: 120,
  precondition: { analyzerIds: ['prob-finder/quality-check'] },
};
