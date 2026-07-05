/**
 * Replace markdown fenced code blocks (` ``` ... ``` `, `~~~ ... ~~~`)
 * and inline code spans (``` `foo` ```) with whitespace of the same
 * length, preserving line counts and byte offsets so callers that
 * report positions stay aligned.
 *
 * Why: extractors that match author-intent tokens like `@handle` and
 * `/command` should NOT match inside code blocks. Mixed prose +
 * code is the common case in markdown docs; without this filter,
 * `\`@team\`` or `\`/Volumes/foo\`` produce false-positive graph
 * edges. Mirrors how Claude Code / Antigravity CLI / Cursor read code
 * regions as literal payload, not as invocation surface.
 *
 * Implementation notes:
 *
 *  - Fenced blocks are detected line-wise so a ` ``` ` mid-line does
 *    not open a block (matches commonmark behaviour); the fence MUST
 *    start the line (after optional indent ≤ 3 spaces) and the
 *    closing fence MUST use the same character and length.
 *  - Inline spans use single backticks; we tolerate backtick run
 *    lengths up to 3 (` ``code`` ` and ` ```code``` ` close with the
 *    matching run). Longer runs are rare in human prose.
 *  - Replacement preserves whitespace + newlines exactly. Any other
 *    char inside the span becomes a single space so a downstream
 *    regex with a `.*` greedy match cannot collapse the line into a
 *    single token.
 */

const FENCE_RE = /^(?<indent> {0,3})(?<fence>`{3,}|~{3,})/;

export function stripCodeBlocks(input: string): string {
  if (!input) return input;
  const fenceless = stripFences(input);
  return stripInline(fenceless);
}

/**
 * The verdict surfaced by `findBacktickImbalance`: which kind of
 * backtick was left open, and where.
 */
export interface IBacktickImbalance {
  /** `'fence'` for an unclosed ``` / ~~~ block; `'inline'` for an open span. */
  kind: 'fence' | 'inline';
  /** 1-indexed line WITHIN `body` (callers add any frontmatter offset). */
  line: number;
  /** The offending source line, trimmed, for the issue `detail`. */
  sourceLine: string;
}

/**
 * Find the FIRST unclosed backtick in `body`, deriving the verdict from
 * the exact same fence + inline scanners `stripCodeBlocks` uses, so a
 * "backtick balance" warning can never drift from the code-strip policy
 * it protects. Two checks, in order:
 *
 *   1. Fenced block: an opener (``` / ~~~) with no same-char closer of
 *      length >= the opener (the CommonMark rule `matchClosingFence`
 *      enforces). An open fence at EOF wins and short-circuits: the
 *      dangling fence has already corrupted the mask, so the inline pass
 *      below would be noise.
 *   2. Inline span: after blanking fenced lines (`scanFences`) and
 *      masking backslash-escaped chars (a literal `` \` `` is text in
 *      CommonMark, never opens a span), any backtick that survives
 *      `stripInline` has no equal-length closer. The first survivor is
 *      the open span.
 *
 * Returns `null` when every fence and every inline span is balanced.
 */
export function findBacktickImbalance(body: string): IBacktickImbalance | null {
  if (!body) return null;
  const { stripped, openFenceLine } = scanFences(body);
  if (openFenceLine > 0) {
    return { kind: 'fence', line: openFenceLine, sourceLine: sourceLineAt(body, openFenceLine) };
  }
  const survivor = stripInline(maskEscapes(stripped)).indexOf('`');
  if (survivor < 0) return null;
  const line = lineOfIndex(stripped, survivor);
  return { kind: 'inline', line, sourceLine: sourceLineAt(body, line) };
}

/**
 * Mask backslash-escaped chars (`\x` -> two spaces) so a literal `` \` ``
 * is not read as a span opener. Two spaces keep offsets + line numbers
 * stable. CommonMark: a backslash escapes the next character.
 */
function maskEscapes(text: string): string {
  return text.replace(/\\[^\n]/g, '  ');
}

/** 1-indexed line number of char `idx` within `text`. */
function lineOfIndex(text: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i++) if (text[i] === '\n') line++;
  return line;
}

/** The trimmed source line at 1-indexed `line` within `text`. */
function sourceLineAt(text: string, line: number): string {
  return text.split('\n')[line - 1]?.trim() ?? '';
}

/**
 * The exact inverse mask of `stripCodeBlocks`: code-region characters
 * survive, everything else (prose) is blanked to same-length whitespace.
 * Newlines are preserved everywhere, so byte offsets and line numbers
 * computed against the mask map 1:1 onto the original body.
 *
 * Consumer: the `core/backtick-path` extractor, which matches relative
 * `.md` file paths ONLY inside code regions, the deliberate, bounded
 * exception to the code-strip policy (see
 * `spec/architecture.md` §Extractor · code-region file references and
 * `context/runtime-quirks.md`). Implemented as a character diff against
 * `stripCodeBlocks` output so the mask can never drift from the
 * blanking rules: a position belongs to a code region exactly when the
 * stripped text differs from the input there.
 *
 * Two intentional artifacts of the diff approach, both harmless to the
 * pinned path regex and pinned by tests:
 *
 *  - The backtick / fence characters themselves resurrect in the mask
 *    (stripCodeBlocks blanks them, so they differ from the input).
 *  - Fence info-strings (` ```bash `) resurrect for the same reason.
 *
 * Whitespace INSIDE a code region is indistinguishable from blanked
 * prose (both are whitespace in the stripped text), so it stays
 * whitespace in the mask. Fine for path matching: paths carry no
 * spaces, and newlines survive untouched.
 */
export function extractCodeRegions(input: string): string {
  if (!input) return input;
  return inverseMask(input, stripCodeBlocks(input));
}

/**
 * The fenced-block subset of `extractCodeRegions`: only characters
 * inside ``` / ~~~ fences survive, inline spans and prose are blanked.
 * Consumers use it to CLASSIFY a code-region match rather than to find
 * one: a position that survives here sits in a fence
 * (`Signal.context: 'code-block'`); a position that survives the full
 * inverse mask but not this one sits in an inline span
 * (`'inline-code'`). Same diff-against-the-stripper construction as
 * `extractCodeRegions`, so the verdict can never drift from the
 * blanking rules.
 */
export function extractFencedRegions(input: string): string {
  if (!input) return input;
  return inverseMask(input, stripFences(input));
}

/**
 * Character diff between `input` and its stripped projection: positions
 * the stripper blanked resurrect (they were code), everything else is
 * whitespace. Newlines survive everywhere so offsets and line numbers
 * stay valid against the original body.
 */
function inverseMask(input: string, stripped: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    out += ch === stripped[i] ? (ch === '\n' ? '\n' : ' ') : ch;
  }
  return out;
}

// HTML comment, possibly multi-line: `<!-- ... -->`. Non-greedy so two
// comments on one line stay separate. A markdown link commented out as
// `<!-- [x](old.md) -->` must not reach a prose extractor as a real edge.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// HTML tag (open / close / self-closing): `<tag ...>`, `</tag>`, `<tag/>`.
// The name MUST start with a letter, so `a < b` and `x <3 y` in prose are
// left alone. Attributes, when present, MUST be introduced by a single
// whitespace separator (`\s`), so a token like `<https://example.com>`
// (name immediately followed by `:`, no separator) is NOT a tag and the
// autolink survives for the url counter. After that separator the
// attribute run is one flat loop of three FIRST-CHARACTER-DISJOINT
// alternatives: a double-quoted string, a single-quoted string, or any
// one char that is not a quote or `>` (this branch absorbs inner
// whitespace, `=`, and `/`). Non-overlapping alternatives are
// load-bearing for security: the pre-audit pattern used a `\s+` prefix,
// an inner `[^"'>]*`, AND a trailing `\s*` before `>`, three quantifiers
// all matching whitespace, so an unterminated tag (`<div ` + a long
// whitespace run, no `>`) drove catastrophic (~cubic) backtracking that
// hung `sm scan` / `sm watch` on a single small file (audit H1). Here the
// separator is a single fixed `\s` and there is no trailing `\s*`, so
// only ONE quantifier ranges over the whitespace run and the match is
// linear. The trailing `\/?` keeps bare self-closing `<br/>` matching
// (no separator, so the run stays empty and `/` is consumed here).
// Quoted strings are matched explicitly so a `>` inside an attribute
// value does not close the tag early. This blanks the tag token only
// (including its attributes), never the content between an open and close
// tag, so a `[x](y.md)` hiding in `<img alt="...">` is removed while
// markdown nested inside a `<div>` block survives.
const HTML_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s(?:"[^"]*"|'[^']*'|[^"'>])*)?\/?>/g;

/**
 * Replace raw HTML (comments and tag tokens) with same-length whitespace,
 * the HTML half of the strip policy. Mirrors `stripCodeBlocks`'s offset-
 * and line-preserving contract so callers keep accurate `location` ranges.
 *
 * Why: markdown allows raw HTML, but no supported runtime renders it to
 * follow `<a href>` or load `<img src>`; the `.md` reaches the LLM as
 * text. References hidden in HTML are therefore not deterministic edges,
 * exactly like `@handle` / `/command` inside backticks (see
 * `context/runtime-quirks.md` §5). Two concrete bugs this closes:
 *   - a link commented out as `<!-- [x](old.md) -->` no longer emits a
 *     phantom edge;
 *   - a `[x](y.md)`-shaped token hiding in an attribute value
 *     (`<img alt="[see](ref.md)">`) no longer false-matches.
 *
 * Scope is deliberately bounded to comments + tag tokens, NOT the content
 * between an open and close tag: markdown nested inside a `<div>` block is
 * authored intent and must survive. Replicating CommonMark's full HTML-
 * block algorithm is out of scope and would risk dropping real links.
 *
 * Kept INDEPENDENT of `stripCodeBlocks` on purpose: `extractCodeRegions`
 * is defined as the diff against `stripCodeBlocks`, so folding HTML into
 * it would make `core/backtick-path` treat HTML regions as code and
 * resurrect their interior. HTML is not a code region.
 */
export function stripHtml(input: string): string {
  if (!input) return input;
  return input
    .replace(HTML_COMMENT_RE, (m) => blank(m))
    .replace(HTML_TAG_RE, (m) => blank(m));
}

/**
 * The full prose-only mask every prose-side body extractor matches
 * against: code regions blanked first (`stripCodeBlocks`), then raw HTML
 * (`stripHtml`). Length, byte offsets, and line count are preserved end
 * to end. `core/backtick-path` deliberately does NOT use this, it matches
 * code regions via `extractCodeRegions`; every other body extractor
 * (`markdown-link`, `external-url-counter`, `at-directive`, `slash`) does.
 */
export function stripCodeAndHtml(input: string): string {
  return stripHtml(stripCodeBlocks(input));
}

/**
 * Walk `input` line by line, blanking fenced-code lines AND tracking
 * whether a fence is left open at end of input. `stripFences` is the
 * blank-only projection of this walk; `findBacktickImbalance` reuses the
 * SAME walk for its fence verdict, so a "fence never closed" warning can
 * never drift from the code-strip policy it protects.
 *
 * `openFenceLine` is the 1-indexed line of the still-open opener, or 0
 * when every fence is balanced.
 */
function scanFences(input: string): { stripped: string; openFenceLine: number } {
  const out: string[] = [];
  const lines = input.split('\n');
  let openFence: string | null = null;
  let openFenceLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (openFence) {
      // Inside a fenced block; check if this line closes it.
      if (matchClosingFence(line, openFence)) openFence = null;
      out.push(blank(line));
      continue;
    }
    const open = FENCE_RE.exec(line);
    if (open?.groups) {
      openFence = open.groups['fence']!;
      openFenceLine = i + 1;
      out.push(blank(line));
      continue;
    }
    out.push(line);
  }
  return { stripped: out.join('\n'), openFenceLine: openFence ? openFenceLine : 0 };
}

function stripFences(input: string): string {
  return scanFences(input).stripped;
}

function matchClosingFence(line: string, openFence: string): boolean {
  const m = FENCE_RE.exec(line);
  if (!m?.groups) return false;
  const fence = m.groups['fence']!;
  // Closing fence: same character, length >= opening.
  return fence[0] === openFence[0] && fence.length >= openFence.length;
}

// Inline code span: a backtick run, then anything (lazy), then a matching
// run of backticks. The opener run is CAPPED at 32 (`` `{1,32} ``, not an
// unbounded `` `+ ``) to defuse audit L1: with an unbounded opener, a body
// carrying a long backtick run with no equal-length closer forced the lazy
// `[\s\S]*?` to rescan the whole remainder once per opener-backtrack
// length, giving quadratic blow-up (~66 s on a 500k-backtick file, hanging
// `sm scan` near the 1 MiB file cap). The cap makes the opener-backtrack a
// small constant, so the match is linear. 32 is a wide safety margin over
// real markdown (CommonMark spans in human prose use runs of 1-3; this
// module documents "up to 3"); a delimiter run longer than 32 is not
// valid authored content, only a DoS payload, so declining to treat it as
// a span (rather than hanging) is the correct outcome.
const INLINE_SPAN_RE = /(`{1,32})([\s\S]*?)\1/g;

function stripInline(input: string): string {
  return input.replace(INLINE_SPAN_RE, (_full, ticks: string, body: string) => {
    return ticks.replace(/`/g, ' ') + blank(body) + ticks.replace(/`/g, ' ');
  });
}

function blank(s: string): string {
  // Preserve newlines + whitespace; replace any other char with a
  // single space so the line length matches the original.
  return s.replace(/[^\s]/g, ' ');
}
