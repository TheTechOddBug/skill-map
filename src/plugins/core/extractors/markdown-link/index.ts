/**
 * Markdown link extractor. Scans the node body for `[text](path)` tokens
 * and emits one `references` link per distinct file path that resolves
 * inside the scan scope. The natural sibling to the slash and
 * at-directive extractors: those cover authored Claude-style triggers
 * (`/foo`, `@bar`); this one covers plain markdown links, the
 * dominant cross-reference shape in real knowledge bases.
 *
 * What this catches and what it skips
 * -----------------------------------
 * Captured (relative file paths):
 *   - `[overview](./overview.md)`
 *   - `[parent readme](../README.md)`
 *   - `[bare](api.md)`           , no leading `./` is fine
 *   - `[anchor inside](./api.md#install)`, anchor stripped, link goes to api.md
 *
 * Skipped (the extractor emits no link):
 *   - `![alt](./img.png)`, image syntax. The `(?<!\!)` lookbehind drops it.
 *   - `[home](https://...)` / `mailto:` / `tel:`, has a URL scheme. URLs are
 *     counted by `external-url-counter`, not mapped to nodes.
 *   - `[#section](#section)`, same-doc anchor. No file to link to.
 *   - `[abs](/abs/path)`, leading `/` would be ambiguous (root of scope?
 *     filesystem root?) and almost never what an author means in a markdown
 *     body. Skipped to keep the contract simple; revisit if a use case appears.
 *
 * Path resolution
 * ---------------
 * Targets are resolved POSIX-style against the source node's directory:
 *   `dirname(node.path) + '/' + target` then `path.posix.normalize` to
 *   collapse `.` / `..`. The result is the candidate node path.
 *
 * The extractor emits the link unconditionally, whether or not the
 * resolved path matches an existing node. The `reference-broken` rule is the
 * one that decides whether to report it as an issue, exactly like
 * slash / at-directive do today. This keeps the extractor cheap and
 * testable in isolation.
 *
 * Confidence / kind
 * -----------------
 * `references` is the closest semantic match in the spec's link.kind
 * enum: a markdown link IS a reference, by definition. Confidence is
 * emitted at `0.95` (the spec's "unambiguous syntax" tier for
 * `[text](file.md)`), NOT `1.0`: the syntax is unambiguous, but `1.0`
 * is reserved for structured input (sidecar annotations) and is earned
 * on the merged graph by the post-walk confidence-lift transform when
 * the target resolves to a real node. A markdown link whose target
 * does not resolve stays below `1.0` and is downgraded to the broken
 * floor (`0.5`) by that transform, so a dangling reference renders
 * visibly fainter than a resolved one. Resolution itself remains the
 * `core/reference-broken` analyzer's concern for issue reporting; the
 * confidence value is the graph's visual signal of the same fact.
 *
 * Per-node dedup: the first occurrence of a normalized resolved target
 * wins; later duplicates within the same body are skipped. Matches the
 * other extractors' behaviour.
 */

import { posix as pathPosix } from 'node:path';

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeAndHtml } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'markdown-link';

// `[text](url)` where:
//   - `(?<!\!)`, not preceded by `!` (skip image syntax `![alt](src)`).
//   - `\[([^\]]*)\]`, the visible text. Square brackets cannot nest in CommonMark.
//   - `\(([^)\s]+)(?:\s+"[^"]*")?\)`, the destination + optional title:
//       - `[^)\s]+`       , URL portion: anything that is not whitespace or `)`.
//       - `(?:\s+"[^"]*")?`, optional ` "title"` (CommonMark allows it; we
//         capture only the URL group, the title is decorative).
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Schemes we treat as "not a file path", the extractor skips these so
// `external-url-counter` can do its job for http(s) and so non-resolvable
// schemes (`mailto:`, `tel:`, `data:`, `ftp:` etc.) don't generate
// guaranteed-broken links. Matched case-insensitively.
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export const markdownLinkExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Turns markdown links (`[text](path)`) in a node\'s body into arrows between nodes in the graph. Example: `[the guide](docs/guide.md)` draws an arrow to `docs/guide.md`.',
  scope: 'body',

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    // Fenced blocks, inline code spans, and raw HTML are literal payload,
    // not link surface. The sibling `at-directive` and `slash` extractors
    // strip the same regions; markdown-link must too, otherwise a
    // `[label](path.md)` shown inside backticks (a documentation example),
    // commented out as `<!-- [x](path.md) -->`, or hiding in an attribute
    // (`<img alt="[x](path.md)">`) gets emitted as a real link.
    // `stripCodeAndHtml` replaces those regions with same-length
    // whitespace, so line numbers remain accurate for `location`.
    const body = stripCodeAndHtml(ctx.body);
    const lineStarts = computeLineStarts(body);
    const sourceDir = pathPosix.dirname(ctx.node.path);

    for (const match of body.matchAll(LINK_RE)) {
      const original = match[2]!;
      const resolved = resolveTarget(sourceDir, original);
      if (resolved === null) continue;
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const offset = match.index ?? 0;
      const line = lineFor(lineStarts, offset);
      ctx.emitSignal({
        source: ctx.node.path,
        scope: 'body',
        range: { start: offset, end: offset + match[0].length, line },
        raw: match[0],
        candidates: [
          {
            extractorId: ID,
            kind: 'references',
            target: resolved,
            // 0.95: the `[text](path)` syntax is unambiguous (the spec's
            // "unambiguous syntax" tier), but NOT 1.0. `1.0` is reserved
            // for structured input and is earned post-walk by the
            // confidence-lift transform when `target` resolves to a real
            // node; an unresolved (broken) target is downgraded to the
            // broken floor (0.5) by the same transform. Emitting 1.0 here
            // would short-circuit the lift and make a broken link
            // indistinguishable from a resolved one.
            confidence: 0.95,
            rationale: 'unambiguous markdown link syntax',
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
 * Strip `#anchor` and `?query`, reject URL schemes / absolute paths /
 * empty targets, then POSIX-normalise against `sourceDir`. Returns
 * `null` when the target should not produce a link.
 */
function resolveTarget(sourceDir: string, raw: string): string | null {
  // Strip fragment first (anchors live "after" the path) and then query.
  const noFragment = raw.split('#', 1)[0]!;
  const noQuery = noFragment.split('?', 1)[0]!;
  const trimmed = noQuery.trim();
  if (trimmed.length === 0) return null;

  // URL schemes (http, mailto, tel, data, ftp, ...), skip. The
  // external-url-counter handles http/https; the others have no node
  // to link to.
  if (URL_SCHEME_RE.test(trimmed)) return null;

  // Leading `/` is ambiguous in a markdown body, skip per the doc
  // comment.
  if (trimmed.startsWith('/')) return null;

  const joined = sourceDir === '.' ? trimmed : `${sourceDir}/${trimmed}`;
  return pathPosix.normalize(joined);
}

