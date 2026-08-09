/**
 * Strings emitted from `core/skill-actions/catalog.ts` (the skill-action
 * discovery warnings, `spec/skill-actions.md` §Discovery).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation (single
 * pass, so a defect VALUE that itself carries a literal placeholder
 * token is emitted verbatim and never re-scanned).
 *
 * `skillSkipped` (and `defectUnreadable`, which carries the read error)
 * are tx TEMPLATES; the other `defect*` entries are plain constants
 * interpolated INTO `skillSkipped` as the `{{defect}}` var, never run
 * through `tx` themselves (`defectBodyPlaceholder` names the literal
 * placeholder token, which `tx` would reject as a missing variable).
 */

export const SKILL_ACTIONS_CATALOG_TEXTS = {
  /**
   * One warn line per rejected candidate, naming the directory and the
   * defect (`spec/skill-actions.md` §Discovery: a defective skill never
   * blocks the rest of the catalog, mirroring plugin discovery warnings).
   */
  skillSkipped: 'skill-actions: skipped {{dir}}: {{defect}}',
  defectNameMissing: 'frontmatter name is not a non-empty string',
  defectDescriptionMissing: 'frontmatter description is not a non-empty string',
  defectBodyEmpty: 'body is empty after the frontmatter',
  defectBodyDelimiter: 'body contains a literal <user-content tag opening',
  defectBodyPlaceholder: 'body contains the literal {{userContent}} placeholder',
  defectUnreadable: 'SKILL.md is unreadable: {{detail}}',
} as const;
