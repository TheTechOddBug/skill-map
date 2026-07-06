/**
 * Parser contract for the kernel walker. A parser converts a raw file
 * (string) into the canonical `IRawNode`-shaped triple of
 * `{ frontmatter, frontmatterRaw, body }`. Pure: same input → same output,
 * no I/O, no side effects beyond the returned value.
 *
 * Parsers are kernel-internal. The set is closed by design, user
 * plugins cannot register their own. Built-ins ship as `frontmatter-yaml`
 * (markdown with `--- … ---` YAML frontmatter, prototype-pollution-safe,
 * `js-yaml` JSON_SCHEMA-pinned) and `plain` (entire body, empty
 * frontmatter, used by Providers walking files that carry no frontmatter
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

/**
 * Diagnostic surfaced by a parser when the raw input was structurally
 * malformed (e.g. YAML parse error). The parser MUST still return a
 * usable `{ frontmatter, frontmatterRaw, body }` triple (defaults are
 * fine) so the scan keeps making progress; this carries the message
 * the orchestrator translates into a kernel `Issue` with severity
 * `warn` (and `error` under `--strict`).
 *
 * Pure data: parsers never log or throw; they describe the failure
 * here and let the orchestrator decide how to surface it.
 */
export interface IParseIssue {
  /**
   * Stable tag describing the failure class. The only emitter today
   * is `frontmatter-yaml` reporting a YAML parse error
   * (`'frontmatter-parse-error'`); the set may grow as new parsers
   * land.
   */
  code: string;
  /**
   * Human-readable message, sanitised. Never includes the raw input
   * (a hostile YAML could embed multi-line garbage); only the
   * parser-error string is interpolated.
   */
  message: string;
}

export interface IParsedFile {
  /** Parsed frontmatter as a plain object. `{}` when absent or unparseable. */
  frontmatter: Record<string, unknown>;
  /** Raw frontmatter text (between the fences). Empty string when absent. */
  frontmatterRaw: string;
  /** Body text (everything after the closing fence, or the entire raw when no fence). */
  body: string;
  /**
   * `true` when the input DECLARED a frontmatter block, even an empty
   * one. Disambiguates `frontmatterRaw: ''`, which otherwise conflates
   * "no fence at all" with "fence declared, zero content" (`---`, blank
   * line, `---`). The orchestrator branches on this to decide whether
   * the per-kind AJV validation runs: a declared-but-empty block on a
   * kind with required fields is a real defect (`frontmatter-invalid`),
   * not a legitimate frontmatter-less file. Absent / `false` means the
   * parser recognised no metadata block (`plain`, or `frontmatter-yaml`
   * when the fence regex did not match); the orchestrator then falls
   * back to `frontmatterRaw.length > 0` so custom-walk Providers that
   * never set the flag keep their historic behaviour.
   */
  frontmatterDeclared?: boolean;
  /**
   * Optional diagnostics describing structural failures the parser
   * recovered from (e.g. malformed YAML). Empty / undefined on the
   * happy path; the orchestrator maps non-empty entries to warn-level
   * kernel `Issue` rows so the author sees the typo instead of a
   * silent `frontmatter: {}`.
   */
  issues?: readonly IParseIssue[];
}
