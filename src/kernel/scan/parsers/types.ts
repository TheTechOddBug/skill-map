/**
 * Parser contract for the kernel walker. A parser converts a raw file
 * (string) into the canonical `IRawNode`-shaped triple of
 * `{ frontmatter, frontmatterRaw, body }`. Pure: same input → same output,
 * no I/O, no side effects beyond the returned value.
 *
 * Parsers are kernel-internal. The set is closed by design — user
 * plugins cannot register their own. Built-ins ship as `frontmatter-yaml`
 * (markdown with `--- … ---` YAML frontmatter, prototype-pollution-safe,
 * `js-yaml` JSON_SCHEMA-pinned) and `plain` (entire body, empty
 * frontmatter — used by Providers walking files that carry no frontmatter
 * convention, e.g. Roo / Windsurf rules).
 *
 * `path` is supplied for diagnostics only (parsers MAY include it in
 * thrown errors); it MUST NOT influence the parsed output.
 */
export interface IFileParser {
  /** Stable identifier referenced by Provider manifests via `read.parser`. */
  readonly id: string;
  parse(raw: string, path: string): IParsedFile;
}

export interface IParsedFile {
  /** Parsed frontmatter as a plain object. `{}` when absent or unparseable. */
  frontmatter: Record<string, unknown>;
  /** Raw frontmatter text (between the fences). Empty string when absent. */
  frontmatterRaw: string;
  /** Body text (everything after the closing fence, or the entire raw when no fence). */
  body: string;
}
