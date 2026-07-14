/**
 * Test-only probabilistic Analyzer half of the dual `judge` extension
 * id. See the sibling `actions/judge` for the ambiguity contract.
 */
export default {
  version: '1.0.0',
  description:
    'Test-only probabilistic analyzer sharing its extension id with a probabilistic action (drives the kind-prefix disambiguation tests).',
  mode: 'probabilistic',
  probExpectedDurationSeconds: 45,
  precondition: { kind: ['claude/skill'] },
};
