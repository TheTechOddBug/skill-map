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
   * Body copy, shown when the current SELECTION has more nodes than the
   * render cap ("selection", not "folder": the rail scope can span
   * several folders). Renders as:
   *   "This selection has {total} nodes; showing {rendered} on the map.
   *    Pick a sub-folder to narrow it."
   * The counts ride as parameters so the SPA swaps them without touching
   * the string at every render.
   */
  body: (total: number, rendered: number): string =>
    `This selection has ${total} ${total === 1 ? 'node' : 'nodes'}; showing ${rendered} on the map. Pick a sub-folder to narrow it.`,
} as const;
