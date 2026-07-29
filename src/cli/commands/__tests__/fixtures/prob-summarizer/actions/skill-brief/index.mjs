/**
 * Test-only probabilistic SUMMARIZER action. Its sibling
 * `report.schema.json` `$ref`s the canonical `summaries/markdown.schema.json`,
 * and that reference is the summarizer signal the record path detects (no
 * manifest flag, see `spec/job-lifecycle.md` §Record): recording a
 * `completed` job for this action upserts the validated report into
 * `state_summaries`. Contrast with the sibling `skill-echo` action, whose
 * report schema extends `report-base` only and therefore stays
 * history-only.
 */
export default {
  mode: 'probabilistic',
  probExpectedDurationSeconds: 120,
  precondition: { kind: ['claude/skill'] },
};
