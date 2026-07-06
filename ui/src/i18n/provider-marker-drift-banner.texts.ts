/**
 * `<sm-provider-marker-drift-banner>` copy. A centered topbar notice
 * shown when the filesystem-detected provider markers diverge from the
 * project's saved snapshot (e.g. a `.claude/` folder appeared after the
 * lens was pinned elsewhere). Two actions: switch the active lens or
 * dismiss (accept the new markers).
 */
export const PROVIDER_MARKER_DRIFT_BANNER_TEXTS = {
  /** Leading copy, followed by the added-markers code chip. */
  bodyPrefix: 'New provider markers detected:',
  /** Trailing copy after the markers chip. */
  bodySuffix: 'Switch lens or dismiss.',
  /** Switch-lens button label. */
  switchLens: 'Switch lens',
  /** Switch-lens button aria-label. */
  switchLensAria: 'Open settings to switch the active lens',
  /** Dismiss (accept-markers) button aria-label. */
  dismissAria: 'Dismiss the provider markers notice',
} as const;
