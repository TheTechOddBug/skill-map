/**
 * At-file extractor. Scans a node body for `@<token>` tokens and emits a
 * `references` link ONLY for file-shaped tokens (a relative path prefix
 * `@./x` / `@../x`, or a known file extension `@foo.md` / `@builder.toml`).
 * A BARE `@handle` (no path, no extension) emits NOTHING here.
 *
 * Vendor-neutral, lens-gated. The `@`-as-file-picker grammar is shared by the
 * runtimes that read `@` as a workspace file pointer: OpenAI Codex (`@` is a
 * file-path picker), Google Antigravity (documented `@filename` in rules /
 * skill / workflow bodies, resolved relative to the file), and Claude Code
 * (Claude's `@file.md` is also a file ref). So this lives in the neutral
 * `core` plugin (not owned by any vendor) and runs under those three lenses
 * via `precondition.provider`. The `agent-skills` / `markdown` lenses read
 * `@` as nothing, so it is NOT gated there (no phantom edges). Claude's OTHER
 * `@` half, a bare `@handle` → agent `mentions`, stays in `claude/at-directive`
 * (claude-only), which defers file-shaped tokens to this extractor.
 *
 * File-shaped tokens resolve by PATH (lens-independent): the emitted `target`
 * is the canonical root-relative `Node.path`, identical to what
 * `core/markdown-link` produces, so a `[x](./y)` and an `@./y` from the same
 * source collapse into one edge. Absolute paths (`@/abs/x`) are skipped to
 * mirror `core/markdown-link`. The `@`-token grammar is shared with
 * `at-directive` via `kernel/util/at-token.ts` (single source, no drift).
 */

import { posix as pathPosix } from 'node:path';

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeAndHtml } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { AT_TOKEN_RE, classifyAtFileToken, resolveAtFileTarget } from '../../../../kernel/util/at-token.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'at-file';

export const atFileExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  description: 'Detects `@<file>` references in a node\'s body for the `@`-file-picker lenses (Codex, Antigravity, Claude), where `@` points at a workspace file. A path- or extension-shaped token becomes a `references` link to that file; a bare `@handle` forms no edge. Example: `@builder.toml` in a body draws an arrow to the `builder` file.',
  scope: 'body',
  // The lenses whose runtime reads `@` as a file-path picker. Codex (`@` is a
  // file picker, `$` invokes skills), Antigravity (documented `@filename` file
  // refs), and Claude (`@file.md` file ref; its bare-handle MENTION half lives
  // in `claude/at-directive`). NOT gated under `agent-skills` / `markdown`,
  // whose runtimes read `@` as nothing (no phantom edges).
  precondition: { provider: ['claude', 'codex', 'antigravity'] },

  extract(ctx: IExtractorContext): void {
    const seenReferences = new Set<string>();
    const body = stripCodeAndHtml(ctx.body);
    const lineStarts = computeLineStarts(body);
    const sourceDir = pathPosix.dirname(ctx.node.path);

    for (const match of body.matchAll(AT_TOKEN_RE)) {
      const original = match[1]!;
      const bare = original.slice(1); // drop the leading `@`
      // Classify the token: a file-shaped one yields its rationale; a bare
      // handle or an absolute path yields null and forms no edge.
      const rationale = classifyAtFileToken(bare);
      if (rationale === null) continue;

      const target = resolveAtFileTarget(sourceDir, bare);
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
