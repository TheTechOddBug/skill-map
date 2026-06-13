/**
 * Backtick-path extractor. Scans the node body's CODE REGIONS (inline
 * backtick spans + fenced blocks) for relative `.md` file paths and
 * emits one `points` link per distinct resolved target. Normative
 * contract: `spec/architecture.md` §Extractor · code-region file
 * references (`core/backtick-path`).
 *
 * Why this extractor inverts the code-strip policy
 * ------------------------------------------------
 * Every other body extractor runs `stripCodeBlocks` first: invocation
 * tokens (`@handle`, `/command`, URLs) inside backticks are literal
 * payload the runtime never follows (`context/runtime-quirks.md`).
 * Relative file paths are the documented exception: prose like
 * ``Read `references/rules.md` for the full rules`` is the dominant
 * cross-reference shape in agent-authored skills, and the consuming
 * runtime DOES follow it (the Agent Skills open standard mandates
 * "agents load these on demand", and Codex / Gemini CLI / Antigravity /
 * Copilot docs all document the same model-driven following). This
 * extractor therefore matches ONLY inside code regions, via
 * `extractCodeRegions` (the exact inverse mask of `stripCodeBlocks`),
 * so it can never overlap the prose-side extractors by construction.
 *
 * What this catches and what it skips
 * -----------------------------------
 * Captured (relative `.md` paths inside spans / fences):
 *   - ``Read `references/rules.md` ``            , prose-wrapped span
 *   - `` `cat refs/a.md refs/b.md` ``            , several paths in ONE span
 *   - fenced blocks, every line, same grammar
 *   - `./` and `../` prefixes, POSIX-normalised away
 *
 * Skipped (the pinned grammar rejects them by construction):
 *   - URL interiors (`https://example.com/docs/x.md`), the lookbehind
 *     refuses a match start after `/`, `:`, `.` or a word char.
 *   - Template placeholders / globs (`{PROJECT}-x.md`, `*-S.md`), `{`,
 *     `}` and `*` are outside the segment character class.
 *   - Near-miss suffixes (`.mdx`, `.md_var`), the `\b` + lookahead pair.
 *   - Slashless filenames (`SKILL.md`), at least one `/` is required.
 *   - Absolute paths (`/abs/x.md`), the leading `/` fails the lookbehind.
 *
 * Path resolution mirrors `core/markdown-link`: POSIX-normalised against
 * `dirname(node.path)`, per-node dedup on the resolved target (first
 * occurrence wins). The extractor emits unconditionally, whether or not
 * the resolved path matches an existing node; `core/reference-broken`
 * flags unresolved targets, exactly like the sibling extractors. A
 * backticked path pointing at a deleted bundled doc is a real authoring
 * bug worth a red chip; out-of-scope paths (resolved by the consuming
 * runtime against a different root) are silenced via the existing
 * `scan.referencePaths` escape hatch, not by weakening the extractor.
 *
 * Confidence / kind
 * -----------------
 * `points` (the code-region path pointer kind, Decision #127), at
 * `0.85`: a strong file signal with one degree of inference (the
 * author wrote a path, not an explicit link syntax), the same value
 * and rationale as a path-style at-directive. The candidate's
 * `normalizedTrigger` is the resolved target so resolution and the
 * confidence lift behave exactly like `markdown-link`. Because the
 * kind differs from `references`, a prose `[x](refs/a.md)` and a
 * backticked `` `refs/a.md` `` to the same target COEXIST as two Link
 * rows (the dedup keys on kind); `core/link-conflict` excludes
 * `points` from disagreement detection, so the pair never warns.
 */

import { posix as pathPosix } from 'node:path';

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { extractCodeRegions } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'backtick-path';

// The pinned token grammar (spec carries it verbatim; do not "improve"
// it locally, grammar changes are spec changes):
//   - `(?<![\w/:.-])`     , a match cannot start mid-URL, mid-path or
//                           mid-word; backticks and whitespace qualify
//                           as boundaries, `/` `:` `.` `-` do not.
//   - `(?:\.{1,2}\/)?`    , optional `./` or `../` prefix.
//   - `[\w.-]+(?:\/[\w.-]+)+`, two or more `/`-separated segments, so a
//                           slashless `SKILL.md` never matches. `{`,
//                           `}`, `*` are deliberately outside the class
//                           (placeholders and globs drop here).
//   - `\.md\b(?![\w/])`   , a real `.md` suffix: `.mdx`, `.md_var` and
//                           `x.md/y` tails are refused.
const PATH_RE = /(?<![\w/:.-])(?:\.{1,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.md\b(?![\w/])/g;

export const backtickPathExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Turns relative .md paths written inside code spans and fenced blocks into arrows between nodes in the graph. Example: a backticked `references/rules.md` path draws an arrow to that file.',
  scope: 'body',

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    // The inverse mask keeps ONLY code-region characters (same length,
    // newlines preserved), so offsets and line numbers computed against
    // the mask are valid against the original body. See the helper's
    // doc-comment for the two resurrect artifacts (backtick / fence
    // glyphs and fence info-strings), both rejected by PATH_RE anyway.
    const body = extractCodeRegions(ctx.body);
    const lineStarts = computeLineStarts(body);
    const sourceDir = pathPosix.dirname(ctx.node.path);

    for (const match of body.matchAll(PATH_RE)) {
      const original = match[0]!;
      const resolved = resolveTarget(sourceDir, original);
      if (resolved === null) continue;
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const offset = match.index ?? 0;
      const line = lineFor(lineStarts, offset);
      ctx.emitSignal({
        source: ctx.node.path,
        scope: 'body',
        range: { start: offset, end: offset + original.length, line },
        raw: original,
        candidates: [
          {
            extractorId: ID,
            kind: 'points',
            target: resolved,
            // 0.85: a strong file signal with one degree of inference,
            // the author wrote a path inside a code region rather than
            // an explicit `[text](path)` link. Whether the path resolves
            // to a real node is a separate concern (`core/reference-broken`
            // flags unresolved targets), not a confidence question.
            confidence: 0.85,
            rationale: 'relative .md path inside a code region',
            trigger: {
              originalTrigger: original,
              normalizedTrigger: resolved,
            },
          },
        ],
      });
    }
  },
};

/**
 * POSIX-normalise `raw` against `sourceDir`. The pinned grammar already
 * guarantees a relative, scheme-less, non-empty token, so the guards
 * here are cheap explicit belts mirroring `markdown-link`'s contract
 * rather than reachable branches.
 */
function resolveTarget(sourceDir: string, raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Unreachable via PATH_RE (leading `/` fails the lookbehind), kept
  // explicit so the contract survives a future grammar edit.
  if (trimmed.startsWith('/')) return null;

  const joined = sourceDir === '.' ? trimmed : `${sourceDir}/${trimmed}`;
  return pathPosix.normalize(joined);
}
