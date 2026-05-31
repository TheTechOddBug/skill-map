/**
 * Shared shapes for the `sm plugins create` scaffolder.
 *
 * A generator returns the files for ONE extension kind, as paths relative
 * to the plugin root. Most kinds emit a single `index.js`; the action and
 * provider kinds emit sibling files (a `report.schema.json`, a `kinds/`
 * folder) so the relative path is rooted at the plugin, not the extension
 * folder.
 */

export interface IScaffoldFile {
  /**
   * Path relative to the plugin root, e.g.
   * `extractors/<id>-extractor/index.js` or
   * `actions/<id>-action/report.schema.json`.
   */
  relPath: string;
  contents: string;
}

export interface IKindGenerator {
  /** Plural folder name for this kind (e.g. `extractors`). */
  folder: string;
  /** Files this kind emits for `<pluginId>`, relative to the plugin root. */
  files(pluginId: string): IScaffoldFile[];
}
