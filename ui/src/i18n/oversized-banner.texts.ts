/**
 * UI strings for the `<sm-oversized-banner>` (top-of-shell persistent
 * notice when the scanned graph is at or above `scan.maxNodes`).
 *
 * Convention: each component owns a `*.texts.ts` file under `src/i18n/`.
 * The banner stays English-only (the historical i18n directory name is
 * legacy, there is no locale switching yet).
 */
export const OVERSIZED_BANNER_TEXTS = {
  /**
   * Body copy. The full sentence renders as:
   *   "Your graph has {{actual}} nodes, at the recommended limit of {{limit}}."
   * The numbers ride as parameters so the SPA can swap them without
   * touching the string at every render.
   */
  bodyAtLimit: (actual: number, limit: number): string =>
    `Your graph has ${actual} ${actual === 1 ? 'node' : 'nodes'}, at the recommended limit of ${limit}. Past this point the map gets hard to read and analyzer signal degrades.`,
  /**
   * Body copy when the project is OVER the recommended limit (a previous
   * scan ran under `--max-nodes` larger than the default and the graph
   * is bigger than recommended). Mentions the override so the operator
   * understands why their scan went through despite the cap.
   */
  bodyOverLimit: (actual: number, limit: number, override: number): string =>
    `Your graph has ${actual} nodes, over the recommended limit of ${limit} (currently allowed via --max-nodes ${override}). Past this point the map gets hard to read and analyzer signal degrades.`,
  /**
   * Body copy when the walker actually capped the scan (files were
   * dropped). Reads strongest because data is being lost.
   */
  bodyCapped: (actual: number, limit: number, source: 'override' | 'setting'): string =>
    `Scan capped at ${limit} ${limit === 1 ? 'node' : 'nodes'} (${source === 'override' ? '--max-nodes' : 'scan.maxNodes'}). The walker stopped at ${actual} ${actual === 1 ? 'file' : 'files'}, additional files were dropped. The map and analyzers only see what made it through.`,
  /**
   * Inline CTA. The settings modal opens to Project → Ignored patterns
   * so the operator can trim `.skillmapignore` without leaving the SPA.
   */
  cta: 'Edit .skillmapignore',
  ctaAria: 'Open Settings to edit ignored patterns',
} as const;
