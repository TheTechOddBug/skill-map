/**
 * `frontmatter-yaml` parser. Splits a `--- yaml --- body` document and
 * parses the frontmatter via `js-yaml`. Carries the audit-cleared
 * defences:
 *
 *   - **Symlink / TOCTOU**, out of scope here (lives in the walker;
 *     this parser receives the raw string after the kernel walker has
 *     already vetted the file).
 *   - **Prototype pollution (audit L2/L3 + M2)**, the parsed object is
 *     run through `stripPrototypePollution` so `__proto__`,
 *     `constructor`, and `prototype` keys are removed at EVERY depth,
 *     not just at the root. js-yaml stores `__proto__:` as an own
 *     data property at any nesting level (rather than mutating
 *     `Object.prototype`), but the value still flows into downstream
 *     `Object.assign`-style merges where the `__proto__` setter fires.
 *     Deep stripping at parse time keeps the returned object safe to
 *     spread, copy, and persist regardless of nesting.
 *   - **`!!js/function` & friends (audit L3)**, `yaml.load` runs with
 *     `schema: JSON_SCHEMA` explicitly. js-yaml 5's default schema
 *     (`CORE_SCHEMA`) is already safe (no `!!js/function` tag), but the
 *     explicit selection documents intent and protects against an
 *     upstream default flip.
 *     Frontmatter values that are valid JSON (string, number, bool,
 *     null, sequence, mapping) round-trip unchanged; YAML-only
 *     conveniences like unquoted timestamps degrade to strings, but the
 *     kernel's node schema does not depend on parsed Date objects so
 *     the tradeoff is safe.
 *   - **Malformed YAML surfacing (audit L1)**, when `yaml.load` throws
 *     the parser still returns `frontmatter: {}` (the historic
 *     fallback) so the scan keeps making progress, but it ALSO emits
 *     an `IParseIssue` with code `frontmatter-parse-error` and the
 *     sanitised `err.message`. The walker forwards it on `IRawNode`
 *     and the orchestrator translates it into a warn-level kernel
 *     `Issue` so authors see the typo instead of silently losing
 *     their metadata.
 *
 * Lives under `src/plugins/core/parsers/` even though the parser
 * registry stays kernel-internal (no `kind: 'parser'` is exposed to
 * plugin authors). The location aligns the file layout with the
 * other built-ins (Provider / Extractor / Analyzer / Formatter /
 * Action / Hook), every shipped extension-shaped artifact lives under
 * `src/plugins/`. The registry in `kernel/scan/parsers/index.ts`
 * imports from here and stays the single resolution surface.
 */

import { YAMLException } from 'js-yaml';

import { loadYamlSafe } from '../../../../kernel/util/safe-yaml.js';

import type {
  IFileParser,
  IParsedFile,
  IParseIssue,
} from '../../../../kernel/scan/parsers/types.js';
import { sanitiseParseErrorMessage } from '../../../../kernel/scan/parsers/sanitise-parse-error.js';
import { stripPrototypePollution } from '../../../../kernel/util/strip-prototype-pollution.js';
import { FRONTMATTER_YAML_TEXTS } from './frontmatter-yaml.texts.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export const frontmatterYamlParser: IFileParser = {
  id: 'frontmatter-yaml',
  parse(raw: string, _path: string): IParsedFile {
    const match = FRONTMATTER_RE.exec(raw);
    if (!match) return { frontmatterRaw: '', frontmatter: {}, body: raw };
    const frontmatterRaw = match[1]!;
    const body = match[2]!;
    let parsed: Record<string, unknown> = {};
    const issues: IParseIssue[] = [];
    try {
      const doc = loadYamlSafe(frontmatterRaw);
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
        // Deep strip (audit M2). The helper returns a fresh
        // own-property-clean object; nested `__proto__` / `constructor`
        // / `prototype` keys are dropped at every depth.
        parsed = stripPrototypePollution(doc as Record<string, unknown>);
      }
    } catch (err) {
      // Malformed YAML (audit L1), keep the historic `parsed = {}`
      // fallback so the scan keeps making progress, but surface a
      // diagnostic so the author sees the typo. Only the parser-error
      // message is interpolated; the raw frontmatter is NEVER folded
      // into the message (a hostile YAML could embed multi-line
      // garbage; `frontmatterRaw` stays available on `IParsedFile` for
      // downstream diagnostics that opt in). One deliberate exception:
      // js-yaml 5 throws on content-free input (empty string,
      // whitespace, comments-only) where v4 returned `undefined`. A
      // declared-but-empty block is legitimate YAML-nothing, not an
      // authoring defect; its meaningful signal is the per-kind AJV
      // pass validating `{}`, which a parse-error here would suppress.
      if (!isEmptyDocumentError(err)) {
        issues.push({
          code: 'frontmatter-parse-error',
          message: buildParseErrorMessage(err),
        });
      }
    }
    // The fence regex matched: the author DECLARED a frontmatter block,
    // even when its content is empty (`---`, blank line, `---`) or the
    // YAML failed to load. The flag lets the orchestrator route the
    // empty-content case through the per-kind AJV pass instead of
    // conflating it with "no frontmatter at all".
    const out: IParsedFile = { frontmatterRaw, frontmatter: parsed, body, frontmatterDeclared: true };
    if (issues.length > 0) {
      return { ...out, issues };
    }
    return out;
  },
};

/**
 * The sanitised js-yaml message, plus an actionable quoting hint when
 * the failure is the unquoted-colon class, the single most common
 * authored mistake (`description: use this when: something`). The raw
 * reason ("bad indentation of a mapping entry") reads as indentation
 * jargon and points the author away from the real fix. Detection is
 * deliberately narrow (see `isUnquotedColonError`) so tab-indentation
 * errors and other mapping mistakes keep the plain message without a
 * misleading hint.
 */
function buildParseErrorMessage(err: unknown): string {
  const base = sanitiseParseErrorMessage(err);
  return isUnquotedColonError(err) ? `${base} ${FRONTMATTER_YAML_TEXTS.unquotedColonHint}` : base;
}

/**
 * `true` when the throw is js-yaml 5's "no document content" signal
 * (empty string, whitespace-only, comments-only input). Not an error
 * for a frontmatter block: the block exists and simply carries no
 * fields, so the parser returns `{}` silently and the per-kind AJV
 * validation supplies the meaningful diagnostic (missing required
 * fields, when the kind declares any).
 *
 * The `reason` comparison pins js-yaml 5.1.0's exact wording, safe
 * only under the repo's exact-pin dependency policy: re-verify the
 * string on ANY js-yaml bump. The declared-but-empty-block case in
 * `__tests__/frontmatter-yaml.spec.ts` goes red if the wording drifts
 * (the empty block would surface a spurious parse error), so a silent
 * break is not possible.
 */
function isEmptyDocumentError(err: unknown): boolean {
  return (
    err instanceof YAMLException && err.reason === 'expected a document, but the input is empty'
  );
}

/**
 * `true` when the throw matches the unquoted-colon class: js-yaml's
 * mapping-indentation reason AND an offending line of the shape
 * `key: value with: colon`, an unquoted plain scalar carrying a second
 * `:` at end of line or before whitespace. A value opening with a quote
 * never raises this reason; the line check keeps the hint honest for
 * every other mapping-indentation defect (which shares the reason but
 * not the fix).
 */
function isUnquotedColonError(err: unknown): boolean {
  if (!(err instanceof YAMLException) || err.reason !== 'bad indentation of a mapping entry') {
    return false;
  }
  const line = err.mark ? (err.mark.buffer.split('\n')[err.mark.line] ?? '') : '';
  return /^[ \t]*[^:\n]+:\s+[^'"\s][^\n]*:(\s|$)/.test(line);
}

