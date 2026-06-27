/**
 * At-file extractor (Codex). Scans a node body for `@<token>` tokens and
 * emits a `references` link ONLY for file-shaped tokens (a relative path
 * prefix `@./x` / `@../x`, or a known file extension `@foo.md` /
 * `@builder.toml`). A BARE `@handle` (no path, no extension) emits NOTHING.
 *
 * Why this differs from claude's `at-directive`: in OpenAI Codex, `@` is a
 * file-path picker (the composer inserts a real workspace file path), NOT
 * an agent-mention grammar. So under the codex lens a `@` token is always a
 * pointer to a FILE; a bare `@name` is prose, not an entity mention, and
 * must not form a phantom `mentions`/agent edge. The claude `at-directive`
 * (which DOES emit `mentions` for bare handles) is therefore gated off the
 * codex lens; this codex-owned extractor covers the file-reference half.
 *
 * File-shaped tokens resolve by PATH (universal, lens-independent): the
 * emitted `target` is the canonical root-relative `Node.path`, identical to
 * what `core/markdown-link` produces, so a `[x](./y)` and an `@./y` from the
 * same source collapse into one edge. Absolute paths (`@/abs/x`) are skipped
 * to mirror `core/markdown-link`.
 */

import { posix as pathPosix } from 'node:path';

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeAndHtml } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { OPENAI_PLUGIN_ID } from '../../../ids.js';

const ID = 'at-file';

// Same `@`-token grammar as the claude `at-directive` extractor: a
// standalone `@` (SOL or non-word prefix, so emails / `@@` don't match),
// optional `./` `../` `/` path prefix, then an identifier with an optional
// path / namespace tail anchored on an alphanumeric / `_`.
const AT_RE = /(?:^|[^A-Za-z0-9_@])(@(?:\.{1,2}\/|\/)?[a-z0-9](?:[a-z0-9_\-./]*[a-z0-9_])?(?::[a-z0-9][a-z0-9_-]*)?)/gi;

// Known file extensions that mark a token as a file reference. Kept in
// sync with the claude `at-directive` list (toml included, the Codex
// agent file format).
const FILE_EXT_RE = /\.(md|mdx|js|jsx|ts|tsx|json|yml|yaml|toml|txt|html|css|scss|less|py|rb|go|rs|java|c|cpp|h|hpp|sh|sql|svg|png|jpg|jpeg|gif|webp|pdf)$/i;

export const atFileExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: OPENAI_PLUGIN_ID,
  kind: 'extractor',
  description: 'Detects `@<file>` references in a node\'s body under the OpenAI Codex lens, where `@` is a file picker. A path- or extension-shaped token becomes a `references` link to that file; a bare `@handle` forms no edge. Example: `@builder.toml` in an agent\'s prompt draws an arrow to the `builder` agent file.',
  scope: 'body',
  // Codex-only: under the codex lens `@` is a file-path picker, so only
  // file-shaped tokens form references. The claude `at-directive` (bare
  // `@handle` → agent mention) is NOT gated under codex.
  precondition: { provider: ['codex'] },

  extract(ctx: IExtractorContext): void {
    const seenReferences = new Set<string>();
    const body = stripCodeAndHtml(ctx.body);
    const lineStarts = computeLineStarts(body);
    const sourceDir = pathPosix.dirname(ctx.node.path);

    for (const match of body.matchAll(AT_RE)) {
      const original = match[1]!;
      const bare = original.slice(1); // drop the leading `@`
      // Classify the token: a file-shaped one yields its rationale; a bare
      // handle or an absolute path yields null and forms no edge.
      const rationale = classifyAtToken(bare);
      if (rationale === null) continue;

      const target = resolveSourceRelative(sourceDir, bare);
      const dedupKey = target.toLowerCase();
      if (seenReferences.has(dedupKey)) continue;
      seenReferences.add(dedupKey);

      const captureOffset = (match.index ?? 0) + match[0].indexOf(original);
      const line = lineFor(lineStarts, captureOffset);
      ctx.emitSignal({
        source: ctx.node.path,
        scope: 'body',
        range: { start: captureOffset, end: captureOffset + original.length, line },
        raw: original,
        candidates: [
          {
            extractorId: ID,
            kind: 'references',
            target,
            // 0.85: strong file signal (path prefix or known extension),
            // one degree of inference (the runtime resolves the path).
            confidence: 0.85,
            rationale,
            trigger: {
              originalTrigger: original,
              normalizedTrigger: target,
            },
          },
        ],
      });
    }
  },
};

/**
 * Classify a `@`-token body (the token minus the leading `@`) under the
 * Codex file-picker grammar. Returns the Signal `rationale` for a file-shaped
 * token, a relative path prefix (`./` / `../`) or a known file extension, and
 * `null` for a token that forms no edge: a bare handle (prose, no phantom
 * mentions link) or an absolute path (`@/abs/x`, skipped to mirror
 * `core/markdown-link`'s leading-`/` ambiguity handling). Split out of
 * `extract` so that loop stays within the complexity budget.
 */
function classifyAtToken(bare: string): string | null {
  if (bare.startsWith('/')) return null;
  if (bare.startsWith('./') || bare.startsWith('../')) return 'relative path prefix';
  if (FILE_EXT_RE.test(bare)) return 'known file extension';
  return null;
}

/**
 * Resolve `bare` (the `@`-token minus the leading `@`) against the source
 * node's POSIX dirname, producing the canonical root-relative `Node.path`.
 * Mirrors `core/markdown-link`'s resolution (and claude `at-directive`'s
 * `resolveSourceRelative`) so `[x](./y)` and `@./y` collapse to one edge.
 */
function resolveSourceRelative(sourceDir: string, bare: string): string {
  const joined = sourceDir === '.' ? bare : `${sourceDir}/${bare}`;
  return pathPosix.normalize(joined);
}
