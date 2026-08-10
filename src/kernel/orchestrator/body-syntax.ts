/**
 * Body-syntax validation used by `node-build.ts`. Sibling to
 * `frontmatter.ts`: where that module asks "did the frontmatter arrive
 * intact?", this one asks "is the body's backtick structure intact?".
 *
 * An unclosed backtick (a fenced block with no closer, or an inline span
 * with no equal-length closer) corrupts the kernel code-strip policy:
 * `stripCodeBlocks` then treats the rest of the body as code, so the
 * prose-side extractors (`markdown-link`, `at-directive`, `slash`,
 * `external-url-counter`) see a blank body past the dangling backtick and
 * stop emitting edges. The verdict is derived from the SAME
 * `findBacktickImbalance` scanner that `stripCodeBlocks` is built on, so
 * this warning can never drift from the policy it protects.
 *
 * The reported line is FILE-absolute whenever the walker supplied a
 * `bodyLineOffset` (the frontmatter block's line count, see
 * `IRawNode.bodyLineOffset`), matching the author's editor. It degrades
 * to body-relative when no absolute mapping exists, e.g. a Provider
 * carrying the body inside a frontmatter field (`bodyField`). The
 * offending source line travels in `issue.detail` as the concrete
 * locator either way.
 */

import { ORCHESTRATOR_TEXTS } from '../i18n/orchestrator.texts.js';
import { tx } from '../util/tx.js';
import { findBacktickImbalance } from '../util/strip-code-blocks.js';
import { BACKTICK_ISSUE_ID } from './frontmatter-issue-ids.js';
import type { Issue } from '../types.js';

/**
 * Flag the first unclosed backtick in a node's body. Returns a single
 * `backtick-unbalanced` issue (severity `warn`, lifted to `error` under
 * `strict`), or `null` when every fence and inline span is balanced.
 */
export function detectUnclosedBacktick(
  body: string,
  path: string,
  strict: boolean,
  bodyLineOffset = 0,
): Issue | null {
  const imbalance = findBacktickImbalance(body);
  if (!imbalance) return null;
  const template =
    imbalance.kind === 'fence'
      ? ORCHESTRATOR_TEXTS.bodyBacktickUnclosedFence
      : ORCHESTRATOR_TEXTS.bodyBacktickUnclosedInline;
  const line = imbalance.line + bodyLineOffset;
  return {
    analyzerId: BACKTICK_ISSUE_ID,
    severity: strict ? 'error' : 'warn',
    nodeIds: [path],
    message: tx(template, { path, line }),
    detail: imbalance.sourceLine,
    data: { kind: imbalance.kind, line },
  };
}
