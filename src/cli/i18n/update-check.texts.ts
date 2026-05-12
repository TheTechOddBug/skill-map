/**
 * Strings for the once-per-day "update available" banner emitted by
 * `cli/util/update-check-banner.ts` after every CLI verb. Rendered as a
 * 4-line block with a header line carrying a label inside a partial
 * border, two body lines, and a closing border. The renderer builds the
 * box with width-aware padding (see `writeBanner`); this catalog only
 * carries the label + the actionable hint so both strings stay
 * greppable.
 */

export const UPDATE_CHECK_TEXTS = {
  /** Label rendered inside the top border, between corner and fill. */
  availableHeader: 'Update available',
  /** Actionable hint shown on the second body line, in dim ANSI. */
  availableHint: 'Run `npm i -g @skill-map/cli@latest` to update.',
} as const;
