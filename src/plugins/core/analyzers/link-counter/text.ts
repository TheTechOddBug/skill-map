/**
 * User-facing strings emitted by the `link-counter` built-in rule
 * (`plugins/core/analyzers/link-counter/index.ts`).
 *
 * Externalized per the repo convention (`context/kernel.md`): every
 * user-visible string from `plugins/core/*` lives in a co-located
 * `*.texts.ts`. These feed the two footer chips' `label` and the
 * first line of the per-kind tooltip breakdown.
 */

export const LINK_COUNTER_TEXTS = {
  /** Accessible label for the incoming-links chip. */
  linksInLabel: 'incoming links',
  /** Accessible label for the outgoing-links chip. */
  linksOutLabel: 'outgoing links',
  /** Tooltip header for the incoming breakdown (first line). */
  directionIn: 'in',
  /** Tooltip header for the outgoing breakdown (first line). */
  directionOut: 'out',
} as const;
