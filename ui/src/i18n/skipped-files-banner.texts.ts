/**
 * UI strings for the `<sm-skipped-files-banner>` (top-of-shell
 * persistent notice when one or more files were skipped during the scan
 * because they exceeded `scan.maxFileSizeBytes`).
 *
 * Sibling of `oversized-banner.texts.ts`: same warn palette, same
 * Settings -> Project CTA, different data + copy. The banner stays
 * English-only (the historical i18n directory name is legacy, there is
 * no locale switching yet).
 */
export const SKIPPED_FILES_BANNER_TEXTS = {
  /**
   * Headline copy. Renders as:
   *   "{count} file(s) skipped, they exceed the max file size"
   * The noun pluralizes on `count`. The count rides as a parameter so
   * the SPA can swap it without touching the string at every render.
   */
  headline: (count: number): string =>
    `${count} ${count === 1 ? 'file' : 'files'} skipped, ${count === 1 ? 'it exceeds' : 'they exceed'} the max file size.`,
  /**
   * Trailing "more files" affordance shown after the first file when
   * `count > 1`. Carries the rest-list (or the console message) as its
   * tooltip.
   */
  more: '...',
  /**
   * Tooltip fallback when the remaining list is too long to enumerate
   * (more than five files after the first). Points the operator at the
   * scan console, which prints the full skipped-files list.
   */
  seeConsole: 'See the full list in the console.',
  /**
   * Inline CTA: one click appends every skipped file to
   * `.skillmapignore` (root-anchored, exact paths) through
   * `PATCH /api/project-ignore`. The route restarts the watcher, whose
   * fresh initial batch drops the files from the walk, so the banner
   * clears itself on the next `scan.completed`. Replaced the former
   * "Open Project settings" CTA (user call 2026-08-07): the common
   * resolution IS ignoring the files, so the banner performs it instead
   * of navigating to where it could be performed. Raising
   * `scan.maxFileSizeBytes` stays available in Settings > Project.
   */
  cta: 'Add to ignore',
  /** Button label while the patch round-trip is in flight. */
  ctaBusy: 'Adding...',
  /**
   * Button label after a successful persist, held (disabled) until the
   * watcher's rescan clears the banner.
   */
  ctaDone: 'Added, rescanning...',
  ctaAria:
    'Add the skipped files to .skillmapignore so future scans leave them out on purpose',
  /** Inline error prefix when the ignore write fails; the message follows. */
  addFailed: 'Could not update .skillmapignore:',
} as const;
