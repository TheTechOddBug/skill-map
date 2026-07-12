/**
 * Job-content render helper. Produces the fully-rendered MD blob stored in
 * `state_job_contents` for a probabilistic Action against one node:
 *
 *   canonical preamble  (verbatim, spec)
 *   + a blank line
 *   + the action's prompt template, with the node body interpolated into
 *     the `<user-content>` delimiter block.
 *
 * Template engine pick (ROADMAP §Tech picks deferred, "template engine for
 * job MDs"): the SIMPLEST mechanism, a single named placeholder token
 * (`{{userContent}}`). The kernel owns the delimiter, so the placeholder is
 * the ONLY sanctioned way for a template to embed user content; it is
 * replaced with a kernel-built `<user-content id="<node.path>">...`
 * block. No mustache/handlebars dependency. The scheme keeps the
 * `spec/prompt-preamble.md` delimiter contract enforceable by construction:
 *
 *   - The `id` attribute carries `node.path`, HTML-attribute-escaped
 *     (`&amp; &quot; &lt; &gt;`).
 *   - A literal `</user-content>` inside the body is neutralised to
 *     `</user-content&#x200B;>` (a zero-width space before `>`, written as
 *     the `&#x200B;` entity so the source carries no invisible byte). This
 *     is reversed ONLY for display (`unescapeUserContentClose`), never for
 *     hashing.
 *   - `<user-content>` blocks are never nested: the template MUST NOT
 *     author its own delimiter (rejected below).
 *   - Nothing user-authored ever lands outside a block: the only user text
 *     the render injects is the wrapped body, so "no user text outside a
 *     `<user-content>` block" holds by construction. A template that tries
 *     to author its own `<user-content>` (the mechanism by which an author
 *     could smuggle raw node fields out of the block) is rejected.
 *
 * `renderJobContent` throws `JobRenderError` (mapped to exit 2 by the CLI)
 * when the template violates the contract.
 */

import type { Node } from '../types.js';
import { JOB_TEXTS } from '../i18n/jobs.texts.js';
import { tx } from '../util/tx.js';
import { JobRenderError } from './errors.js';
import { loadCanonicalPreamble } from './preamble.js';

/** The one sanctioned placeholder marking where the node body is injected. */
export const USER_CONTENT_PLACEHOLDER = '{{userContent}}';

const CLOSE_TAG = '</user-content>';
/** Neutralised close tag: `&#x200B;` (zero-width space entity) before `>`. */
const ESCAPED_CLOSE_TAG = '</user-content&#x200B;>';

/**
 * HTML-attribute-escape a value for the `id="..."` attribute. `&` is
 * escaped first so the later replacements do not double-escape the
 * entities they introduce.
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Neutralise every literal `</user-content>` inside `body` so it cannot
 * prematurely close the kernel's delimiter. Reversed only for display via
 * `unescapeUserContentClose`.
 */
function escapeUserContentClose(body: string): string {
  return body.split(CLOSE_TAG).join(ESCAPED_CLOSE_TAG);
}

/**
 * Reverse of `escapeUserContentClose`. For DISPLAY surfaces only
 * (`sm job preview` in a later sub-step); MUST NOT be applied before
 * hashing or the content hash stops matching the stored blob.
 */
export function unescapeUserContentClose(content: string): string {
  return content.split(ESCAPED_CLOSE_TAG).join(CLOSE_TAG);
}

/**
 * Build the `<user-content>` block for one node: the opening tag with the
 * escaped `node.path` id, the escaped body on its own line, and the
 * closing tag on its own line (matching the shape in
 * `spec/prompt-preamble.md` §Delimiter contract).
 */
export function wrapUserContent(nodePath: string, body: string): string {
  const id = escapeHtmlAttribute(nodePath);
  const safeBody = escapeUserContentClose(body);
  return `<user-content id="${id}">\n${safeBody}\n</user-content>`;
}

/**
 * Enforce the delimiter contract on the raw template BEFORE substitution:
 *
 *   - It MUST reference `{{userContent}}` (otherwise the node body is
 *     never embedded, the template is malformed).
 *   - It MUST NOT contain a literal `<user-content` tag (the kernel owns
 *     the delimiter; an authored one risks nesting / out-of-block
 *     interpolation). The check runs pre-substitution, and the placeholder
 *     itself contains no `<user-content`, so it never trips this guard.
 */
function validateTemplate(template: string): void {
  if (!template.includes(USER_CONTENT_PLACEHOLDER)) {
    throw new JobRenderError(
      tx(JOB_TEXTS.renderMissingPlaceholder, { placeholder: USER_CONTENT_PLACEHOLDER }),
    );
  }
  if (/<user-content/i.test(template)) {
    throw new JobRenderError(
      tx(JOB_TEXTS.renderAuthoredDelimiter, { placeholder: USER_CONTENT_PLACEHOLDER }),
    );
  }
}

export interface IRenderJobContentInput {
  /** Target node (only `path` is consumed, for the `<user-content id>`). */
  node: Pick<Node, 'path'>;
  /** The node's raw body text (frontmatter fence already stripped). */
  nodeBody: string;
  /** The action's raw `prompt.md` template (with `{{userContent}}`). */
  promptTemplate: string;
  /**
   * Canonical preamble text. Defaults to the spec fixture via
   * `loadCanonicalPreamble()`; tests inject a fixed string to stay pure.
   */
  preamble?: string;
}

/**
 * Render the full job content: preamble + blank line + template with the
 * node body wrapped in `<user-content>`. Deterministic given
 * `(preamble, promptTemplate, node.path, nodeBody)`, which is exactly the
 * input set folded into `contentHash` (preamble + template via
 * `promptTemplateHash`; path + body hashes via the tuple), so two jobs
 * with the same `contentHash` render identical content.
 */
export function renderJobContent(input: IRenderJobContentInput): string {
  validateTemplate(input.promptTemplate);
  const preamble = input.preamble ?? loadCanonicalPreamble();
  const block = wrapUserContent(input.node.path, input.nodeBody);
  const rendered = input.promptTemplate.split(USER_CONTENT_PLACEHOLDER).join(block);
  // The preamble fixture already ends with a trailing newline; the extra
  // `\n` yields one blank line between it and the action template.
  return `${preamble}\n${rendered}`;
}
