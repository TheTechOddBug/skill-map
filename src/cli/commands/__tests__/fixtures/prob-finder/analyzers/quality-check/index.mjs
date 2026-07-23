/**
 * Test-only probabilistic finder Analyzer. Ships the files-by-convention
 * pair (`prompt.md` + `report.schema.json` extending the canonical
 * findings envelope) and NO `evaluate()`: its judgment is a queued job an
 * external agent drains, and `sm record` writes the validated report's
 * `findings[]` through to `state_findings` (finder lane).
 */
export default {
  version: '1.0.0',
  description:
    'Test-only probabilistic finder whose report schema extends the canonical findings envelope (drives the state_findings write-through tests).',
  mode: 'probabilistic',
  probExpectedDurationSeconds: 90,
  precondition: { kind: ['claude/skill'] },
};
