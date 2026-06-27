/**
 * At-directive extractor. Scans the node body for `@<token>` tokens
 * and emits one link per distinct handle, choosing the link kind
 * based on what the token looks like:
 *
 *   - `@<bare-handle>` (no path, no extension) → **`mentions`**.
 *     Reads as "a reference to a named entity", which is how every
 *     LLM-driven runtime (Claude Code, Antigravity CLI, Cursor) treats
 *     a standalone `@name`: ambiguous between agent / handle / generic
 *     mention, but never a file path.
 *   - `@<...>.{ext}`, `@./<...>`, `@../<...>`, `@/<...>` → **`references`**.
 *     The extension or path shape is the same signal Claude Code,
 *     Codex CLI, and Antigravity treat as a file pointer when the
 *     LLM reads the prose. Deterministic inlining only fires in the
 *     composer UI (autocomplete) and in line-start imports like
 *     `@AGENTS.md` inside `CLAUDE.md`; mid-prose `@file.md` is
 *     LLM-interpreted, see `context/runtime-quirks.md`. Emitting
 *     these as `references` (matching `markdown-link` / file-path
 *     links) puts them in the right semantic bucket: the operator
 *     wanted a pointer to a file, not a mention to a named entity.
 *   - Tokens inside fenced code blocks, inline backticks, or raw HTML
 *     (comments / tags) are skipped entirely (`stripCodeAndHtml`),
 *     matching how runtimes read those regions as literal payload.
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

import { posix as pathPosix } from 'node:path';

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeAndHtml } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { CLAUDE_PLUGIN_ID } from '../../../ids.js';

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
export const atDirectiveExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CLAUDE_PLUGIN_ID,
  kind: 'extractor',
  description: 'Detects `@<token>` directives in a node\'s body using Claude Code rules, choosing the link kind by token shape. Example: a bare handle `@team` becomes a `mentions` link, while a file-flavoured token `@docs/api.md` becomes a `references` link.',
  scope: 'body',
  // Claude-only. This is Claude's `@<name>` grammar, where a bare handle is
  // an agent / entity MENTION. OpenAI Codex's `@` is a file-path picker, not
  // a mention grammar, so codex is NOT gated here; the codex-owned `at-file`
  // extractor covers `@`-as-file-reference under the codex lens.
  precondition: { provider: ['claude'] },

  // eslint-disable-next-line complexity
  extract(ctx: IExtractorContext): void {
    const seenMentions = new Set<string>();
    const seenReferences = new Set<string>();
    const body = stripCodeAndHtml(ctx.body);
    const lineStarts = computeLineStarts(body);
    // POSIX dirname of the source node, used to resolve `./` and `../`
    // path-style targets the same way `core/markdown-link` does. The
    // result is the canonical root-relative `Node.path` for the
    // referenced file, so cross-extractor dedup collapses
    // `[link](./foo.md)` and `@./foo.md` from the same source into one
    // edge.
    const sourceDir = pathPosix.dirname(ctx.node.path);

    for (const match of body.matchAll(AT_RE)) {
      const original = match[1]!;
      const bare = original.slice(1); // drop the leading `@`
      // Offset of the `@` itself (the capture group skipped the
      // leading non-word boundary char that the outer pattern eats).
      const captureOffset = (match.index ?? 0) + match[0].indexOf(original);
      const line = lineFor(lineStarts, captureOffset);
      const range = { start: captureOffset, end: captureOffset + original.length, line };
      // File-reference signals:
      //  - explicit relative prefix (`./`, `../`); the author marked
      //    it as a path on purpose.
      //  - a known file extension at the tail; mirrors how Claude
      //    Code / Antigravity CLI recognise `@foo.md` as a file ref.
      // Absolute paths (`@/abs/foo.md`) are intentionally skipped to
      // mirror `core/markdown-link` (leading `/` is ambiguous in a
      // markdown body: filesystem root vs scope root). Same author
      // intent across the two syntaxes lands the same place.
      // A single slash WITHOUT either of the above (e.g.
      // `@my-plugin/foo-extractor`) stays a mention so the
      // skill-map-native "namespaced handle" convention keeps working.
      if (bare.startsWith('/')) continue;
      const isReference =
        bare.startsWith('./') ||
        bare.startsWith('../') ||
        FILE_EXT_RE.test(bare);

      if (isReference) {
        // Resolve via the source node's directory so the emitted
        // `target` matches the canonical root-relative `Node.path`,
        // identical to what `core/markdown-link` produces. This is
        // what unlocks cross-extractor dedup: same source + same
        // target + same kind + same normalizedTrigger → the
        // post-walk `dedupeLinks` merges them and unions `sources[]`.
        const target = resolveSourceRelative(sourceDir, bare);
        // Dedup against the lowercase form so `@foo.md` and `@FOO.MD`
        // collapse into one link rather than two siblings that later
        // trip `reference-redundant`. The emitted `target` keeps the
        // original author casing; `normalizedTrigger` is the same
        // resolved path so cross-extractor merge sees identical keys
        // across `markdown-link` and `at-directive`.
        const dedupKey = target.toLowerCase();
        if (seenReferences.has(dedupKey)) continue;
        seenReferences.add(dedupKey);
        ctx.emitSignal({
          source: ctx.node.path,
          scope: 'body',
          range,
          raw: original,
          candidates: [
            {
              extractorId: ID,
              kind: 'references',
              target,
              // 0.85: strong file signal (path prefix `./` / `../` OR
              // a known file extension on the tail). One degree of
              // inference (the runtime still resolves the path).
              confidence: 0.85,
              rationale: bare.startsWith('./') || bare.startsWith('../')
                ? 'relative path prefix'
                : 'known file extension',
              trigger: {
                originalTrigger: original,
                normalizedTrigger: target,
              },
            },
          ],
        });
        continue;
      }

      const normalized = normalizeTrigger(original);
      if (seenMentions.has(normalized)) continue;
      seenMentions.add(normalized);
      ctx.emitSignal({
        source: ctx.node.path,
        scope: 'body',
        range,
        raw: original,
        candidates: [
          {
            extractorId: ID,
            kind: 'mentions',
            target: original,
            // 0.5: genuine ambiguity. A bare `@handle` (no extension, no
            // path prefix) could be an agent, a handle, or generic prose.
            // The runtime decides at invocation time; the extractor leaves
            // the question open.
            confidence: 0.5,
            rationale: 'no extension, no path prefix',
            trigger: {
              originalTrigger: original,
              normalizedTrigger: normalized,
            },
          },
        ],
      });
    }
  },
};

/**
 * Resolve `bare` (the `@`-token minus the leading `@`) against the
 * source node's POSIX dirname. Mirrors what `core/markdown-link`'s
 * `resolveTarget` does, so an `[link](./x)` and an `@./x` from the
 * same source produce identical root-relative paths. The result is
 * the canonical `Node.path` for the referenced file.
 *
 * Inputs of the form `./x`, `../x`, or bare `x.ext` are accepted;
 * absolute (`/abs/x`) is handled by the caller (rejected earlier so
 * markdown-link and at-directive share the same skip semantics).
 */
function resolveSourceRelative(sourceDir: string, bare: string): string {
  const joined = sourceDir === '.' ? bare : `${sourceDir}/${bare}`;
  return pathPosix.normalize(joined);
}
