/**
 * Test-only probabilistic Analyzer half of the dual `judge` extension
 * id. See the sibling `actions/judge` for the ambiguity contract.
 */
export default {
  mode: 'probabilistic',
  probExpectedDurationSeconds: 45,
  precondition: { kind: ['claude/skill'] },
};
