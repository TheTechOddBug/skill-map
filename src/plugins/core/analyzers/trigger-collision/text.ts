/**
 * User-facing strings emitted by the `trigger-collision` built-in rule
 * (`plugins/core/analyzers/trigger-collision/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const TRIGGER_COLLISION_TEXTS = {
  /**
   * Top-level message when `analyzeTriggerBucket` accumulated exactly one
   * cause part. Used for the advertiser-ambiguous-only, invocation-
   * ambiguous-only, and cross-kind-only branches.
   */
  messageOnePart: '"{{normalized}}":\nTrigger collision: {{part}}.',

  /**
   * Top-level message when `analyzeTriggerBucket` accumulated two cause
   * parts (advertiser-ambiguous AND invocation-ambiguous fire together).
   * The joiner lives inside the template so future locales can adapt it
   * (e.g. `'; y '` in Spanish) without touching the rule code.
   */
  messageTwoParts: '"{{normalized}}":\nTrigger collision: {{first}}; and {{second}}.',

  /** `<n> advertisers: <list>` part, fires on the advertiser-ambiguous branch. */
  partAdvertisers: '{{count}} advertisers: {{paths}}',

  /** `<n> invocation forms: <list>` part, fires on the invocation-ambiguous branch. */
  partInvocations: '{{count}} invocation forms: {{forms}}',

  /** Singular cross-kind cause: `non-canonical invocation <form> against advertiser <path>`. */
  partNonCanonicalSingular: 'non-canonical invocation {{forms}} against advertiser {{advertiser}}',

  /** Plural cross-kind cause: `non-canonical invocations <forms> against advertiser <path>`. */
  partNonCanonicalPlural: 'non-canonical invocations {{forms}} against advertiser {{advertiser}}',
} as const;
