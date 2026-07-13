/**
 * Test-only probabilistic SUMMARIZER action. Its sibling
 * `report.schema.json` `$ref`s the canonical `summaries/skill.schema.json`,
 * and that reference is the summarizer signal the record path detects (no
 * manifest flag, see `spec/job-lifecycle.md` §Record): recording a
 * `completed` job for this action upserts the validated report into
 * `state_summaries`. Contrast with the sibling `skill-echo` action, whose
 * report schema extends `report-base` only and therefore stays
 * history-only.
 */
export default {
  version: '1.0.0',
  description:
    'Test-only probabilistic summarizer whose report schema extends summaries/skill (drives the plugin-path summary write-through tests).',
  mode: 'probabilistic',
  probExpectedDurationSeconds: 120,
  precondition: { kind: ['claude/skill'] },
};
