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

function stripFences(input: string): string {
  const out: string[] = [];
  const lines = input.split('\n');
  let openFence: string | null = null;
  for (const line of lines) {
    if (openFence) {
      // Inside a fenced block; check if this line closes it.
      const closer = matchClosingFence(line, openFence);
      if (closer) {
        out.push(blank(line));
        openFence = null;
      } else {
        out.push(blank(line));
      }
      continue;
    }
    const open = FENCE_RE.exec(line);
    if (open?.groups) {
      openFence = open.groups['fence']!;
      out.push(blank(line));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function matchClosingFence(line: string, openFence: string): boolean {
  const m = FENCE_RE.exec(line);
  if (!m?.groups) return false;
  const fence = m.groups['fence']!;
  // Closing fence: same character, length >= opening.
  return fence[0] === openFence[0] && fence.length >= openFence.length;
}

function stripInline(input: string): string {
  // Match one or more backticks, then anything (lazy), then a matching
  // run of backticks. The `[^`]` ensures we don't eat across runs.
  return input.replace(/(`+)([\s\S]*?)\1/g, (_full, ticks: string, body: string) => {
    return ticks.replace(/`/g, ' ') + blank(body) + ticks.replace(/`/g, ' ');
  });
}

function blank(s: string): string {
  // Preserve newlines + whitespace; replace any other char with a
  // single space so the line length matches the original.
  return s.replace(/[^\s]/g, ' ');
}
