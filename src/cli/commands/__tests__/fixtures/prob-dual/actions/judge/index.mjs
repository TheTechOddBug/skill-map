/**
 * Test-only probabilistic Action half of the dual `judge` extension id.
 * Together with the sibling `analyzers/judge`, it makes the unprefixed
 * submit target `judge` (and `prob-dual/judge`) ambiguous across kinds;
 * the `action:` / `analyzer:` prefixed forms disambiguate.
 */
export default {
  version: '1.0.0',
  description:
    'Test-only probabilistic action sharing its extension id with a probabilistic analyzer (drives the kind-prefix disambiguation tests).',
  mode: 'probabilistic',
  probExpectedDurationSeconds: 60,
  precondition: { kind: ['claude/skill'] },
};
