/**
 * UI strings for the `<sm-branch-cap-banner>` (in-view informational
 * banner shown over the graph map when the selected branch has more
 * nodes than the server render cap allows, so only the first slice is
 * drawn).
 *
 * Convention: each component owns a `*.texts.ts` file under `src/i18n/`.
 * English-only (the historical i18n directory name is legacy, there is
 * no locale switching).
 */
export const BRANCH_CAP_BANNER_TEXTS = {
  /**
   * Branch-scoped body copy, shown when the SELECTED branch itself has
   * more nodes than the render cap. Renders as:
   *   "This folder has {total} nodes; showing {rendered} on the map.
   *    Pick a sub-folder to narrow it."
   * The counts ride as parameters so the SPA swaps them without touching
   * the string at every render.
   */
  body: (total: number, rendered: number): string =>
    `This folder has ${total} ${total === 1 ? 'node' : 'nodes'}; showing ${rendered} on the map. Pick a sub-folder to narrow it.`,
  /**
   * Corpus-scoped body copy, shown when the current branch FITS under the
   * cap but the whole project exceeds it (so the signal survives drilling
   * into a small sub-folder). Renders as:
   *   "This project has {total} nodes; the map renders up to {cap} at a
   *    time. Narrow by folder or raise the render cap."
   */
  corpusBody: (total: number, cap: number): string =>
    `This project has ${total} ${total === 1 ? 'node' : 'nodes'}; the map renders up to ${cap} at a time. Narrow by folder or raise the render cap.`,
} as const;
