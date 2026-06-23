/**
 * UI strings for the `<sm-oversized-banner>` (top-of-shell persistent
 * notice when the scan hit its file ceiling and dropped files from the
 * corpus).
 *
 * Convention: each component owns a `*.texts.ts` file under `src/i18n/`.
 * English-only (the historical i18n directory name is legacy, there is
 * no locale switching yet).
 */
export const OVERSIZED_BANNER_TEXTS = {
  /**
   * Body copy. Renders as:
   *   "The scan hit its ceiling of {ceiling} files; some files were
   *    dropped from the corpus. Trim .skillmapignore or raise
   *    --max-scan."
   * The ceiling rides as a parameter so the SPA swaps it without
   * touching the string at every render.
   */
  body: (ceiling: number): string =>
    `The scan hit its ceiling of ${ceiling} ${ceiling === 1 ? 'file' : 'files'}; some files were dropped from the corpus. Trim .skillmapignore or raise --max-scan.`,
  /**
   * Inline CTA. The settings modal opens to Project (Ignored patterns)
   * so the operator can trim `.skillmapignore` without leaving the SPA.
   */
  cta: 'Edit .skillmapignore',
  ctaAria: 'Open Settings to edit ignored patterns',
} as const;
