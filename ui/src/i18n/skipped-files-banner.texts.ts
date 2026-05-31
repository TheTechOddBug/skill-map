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
   * Inline CTA. The settings modal opens to Project, where
   * `scan.maxFileSizeBytes` and `.skillmapignore` live, so the operator
   * can raise the limit or ignore the file without leaving the SPA.
   */
  cta: 'Open Project settings',
  ctaAria: 'Open Settings to adjust the max file size or ignore patterns',
} as const;
