/**
 * Test-only probabilistic Action half of the dual `judge` extension id.
 * Together with the sibling `analyzers/judge`, it makes the unprefixed
 * submit target `judge` (and `prob-dual/judge`) ambiguous across kinds;
 * the `action:` / `analyzer:` prefixed forms disambiguate.
 */
export default {
  mode: 'probabilistic',
  probExpectedDurationSeconds: 60,
  precondition: { kind: ['claude/skill'] },
};
