/**
 * At-directive extractor. Scans the node body for `@<token>` tokens
 * and emits one link per distinct handle, choosing the link kind
 * based on what the token looks like:
 *
 *   - `@<bare-handle>` (no path, no extension) → **`mentions`**.
 *     Reads as "a reference to a named entity", which is how every
 *     LLM-driven runtime (Claude Code, Gemini CLI, Cursor) treats a
 *     standalone `@name`: ambiguous between agent / handle / generic
 *     mention, but never a file path.
 *   - `@<...>.{ext}`, `@./<...>`, `@../<...>`, `@/<...>` → **`references`**.
 *     The extension or path shape is the same signal Claude Code and
 *     Gemini CLI use to recognise `@file.md` as a file reference (the
 *     runtime inlines the file's content). Emitting these as
 *     `references` (matching `markdown-link` / file-path links) puts
 *     them in the right semantic bucket: the operator wanted a
 *     pointer to a file, not a mention to a named entity.
 *   - Tokens inside fenced code blocks or inline backticks are
 *     skipped entirely (`stripCodeBlocks`), matching how runtimes
 *     read code regions as literal payload.
 *
 * Matching rules carried over from the prior version:
 *
 * - Token must start with a standalone `@` (SOL or non-word prefix) so
 *   emails (`foo@bar.com`) and `@@` don't match.
 * - The first identifier is `[a-z0-9_-]+`; namespace segments may
 *   follow with `/`, `:` or `.`. The match is case-insensitive; the
 *   original substring is preserved verbatim in `originalTrigger`.
 * - Deduplication is per (kind, normalizedTrigger) so a body
 *   mentioning `@foo` and `@foo.md` emits two distinct links (the
 *   second is a file reference, the first is a mention).
 */

import type { IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeBlocks } from '../../../../kernel/util/strip-code-blocks.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';

const ID = 'at-directive';

// Token grammar (after the leading `@`):
//   - Optional path prefix: `./`, `../`, or leading `/`.
//   - Required first identifier segment: `[a-z0-9][a-z0-9_-]*`.
//   - Optional path / namespace tail: any run of `[a-z0-9_./-]`,
//     anchored so the LAST char is alphanumeric or `_`. This excludes
//     a trailing `.` (sentence punctuation: `@foo.`) or `/`
//     (path separator without leaf: `@dir/`).
//   - Optional namespace marker `:` + identifier.
// The leading char must be non-word (so emails and `@@` don't match).
const AT_RE = /(?:^|[^A-Za-z0-9_@])(@(?:\.{1,2}\/|\/)?[a-z0-9](?:[a-z0-9_\-./]*[a-z0-9_])?(?::[a-z0-9][a-z0-9_-]*)?)/gi;

/**
 * File extensions skill-map treats as a strong "this is a file
 * reference, not an entity mention" signal. Kept conservative: only
 * the formats we routinely see authored in docs/skills. Adding new
 * extensions is safe; the cost of a false-positive `references` is
 * a misplaced link kind, not a broken-ref issue.
 */
const FILE_EXT_RE = /\.(md|mdx|js|jsx|ts|tsx|json|yml|yaml|toml|txt|html|css|scss|less|py|rb|go|rs|java|c|cpp|h|hpp|sh|sql|svg|png|jpg|jpeg|gif|webp|pdf)$/i;

/**
 * Read the body and decide, for each `@<token>` match, whether to
 * emit a `mentions` link (bare handle) or a `references` link (file
 * reference). The decision mirrors what an LLM-driven runtime would
 * do when given the same prose.
 */
export const atDirectiveExtractor: IExtractor = {
  id: ID,
  pluginId: 'claude',
  kind: 'extractor',
  version: '1.0.0',
  description: 'Detects `@<token>` directives in a node\'s body using Claude Code interpretation rules. A bare handle (e.g. `@team`) becomes a `mentions` link; a file-flavoured token (e.g. `@docs/api.md`, `@./readme.md`) becomes a `references` link. Gated by `precondition.provider: [\'claude\']` so Gemini / Cursor / Codex apply their own at-directive flavours via their own extractors.',
  scope: 'body',
  precondition: { provider: ['claude'] },

  extract(ctx: IExtractorContext): void {
    const seenMentions = new Set<string>();
    const seenReferences = new Set<string>();
    const body = stripCodeBlocks(ctx.body);

    for (const match of body.matchAll(AT_RE)) {
      const original = match[1]!;
      const bare = original.slice(1); // drop the leading `@`
      // File-reference signals:
      //  - explicit relative/absolute prefix (`./`, `../`, `/`); the
      //    author marked it as a path on purpose.
      //  - a known file extension at the tail; mirrors how Claude
      //    Code / Gemini CLI recognise `@foo.md` as a file ref.
      // A single slash WITHOUT either of the above (e.g.
      // `@my-plugin/foo-extractor`) stays a mention so the
      // skill-map-native "namespaced handle" convention keeps working.
      const isReference =
        bare.startsWith('./') ||
        bare.startsWith('../') ||
        bare.startsWith('/') ||
        FILE_EXT_RE.test(bare);

      if (isReference) {
        // Normalise the target the same way `markdown-link` would:
        // strip the leading `./` so dedup matches across syntaxes.
        const target = bare.replace(/^\.\//, '');
        if (seenReferences.has(target)) continue;
        seenReferences.add(target);
        ctx.emitLink({
          source: ctx.node.path,
          target,
          kind: 'references',
          // 0.85: strong file signal (path prefix `./` / `../` / `/` OR
          // a known file extension on the tail). One degree of inference
          // (the runtime still resolves the path).
          confidence: 0.85,
          sources: [ID],
          trigger: {
            originalTrigger: original,
            normalizedTrigger: target.toLowerCase(),
          },
        });
        continue;
      }

      const normalized = normalizeTrigger(original);
      if (seenMentions.has(normalized)) continue;
      seenMentions.add(normalized);
      ctx.emitLink({
        source: ctx.node.path,
        target: original,
        kind: 'mentions',
        // 0.5: genuine ambiguity. A bare `@handle` (no extension, no
        // path prefix) could be an agent, a handle, or generic prose.
        // The runtime decides at invocation time; the extractor leaves
        // the question open.
        confidence: 0.5,
        sources: [ID],
        trigger: {
          originalTrigger: original,
          normalizedTrigger: normalized,
        },
      });
    }
  },
};
