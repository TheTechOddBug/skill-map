/**
 * User-facing strings emitted by the `frontmatter-yaml` built-in parser
 * (`plugins/core/parsers/frontmatter-yaml/index.ts`). Parse-error
 * messages travel through `IParseIssue` into warn-level kernel `Issue`
 * rows (audit L1 forwarding), landing in `scan_issues.message` and
 * surfacing through `sm check` / `sm show` / the UI inspector, so the
 * same i18n discipline as the CLI catalogs applies.
 *
 * Convention: flat strings; no placeholders needed today.
 */

export const FRONTMATTER_YAML_TEXTS = {
  /**
   * Appended to the sanitised js-yaml message when the failure matches
   * the unquoted-colon class: reason "bad indentation of a mapping
   * entry" with a second `:` inside a plain scalar on the offending
   * line. The raw YAML jargon alone does not tell the author that the
   * fix is quoting the value.
   */
  unquotedColonHint:
    "Hint: a ':' followed by a space (or ending the line) inside an unquoted value starts " +
    'a new YAML key and breaks the whole block; wrap the value in quotes, e.g. ' +
    'description: "use when: something".',
} as const;
