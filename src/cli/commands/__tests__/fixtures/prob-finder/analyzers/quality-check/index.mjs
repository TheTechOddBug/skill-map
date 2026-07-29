/**
 * Test-only probabilistic finder Analyzer. Ships the files-by-convention
 * pair (`prompt.md` + `report.schema.json` extending the canonical
 * findings envelope) and NO `evaluate()`: its judgment is a queued job an
 * external agent drains, and `sm record` writes the validated report's
 * `findings[]` through to `state_findings` (finder lane).
 */
export default {
  mode: 'probabilistic',
  probExpectedDurationSeconds: 90,
  precondition: { kind: ['claude/skill'] },
};
