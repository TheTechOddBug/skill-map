/**
 * Job-content render helper. Produces the fully-rendered MD blob stored in
 * `state_job_contents` for a probabilistic Action against one node:
 *
 *   canonical preamble  (verbatim, spec)
 *   + a blank line
 *   + the extension's prompt template, with the node body interpolated
 *     into the `<user-content>` delimiter block; when a report contract
 *     is supplied (`spec/job-lifecycle.md` §Submit step 9), it renders
 *     immediately BEFORE the `<user-content>` block, after the template
 *     prose that precedes it, and always OUTSIDE the block (it is
 *     kernel-authored prelude, never user content).
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
 *   - A literal `</user-content>` close tag inside the body, matched
 *     CASE-INSENSITIVELY and tolerating internal whitespace
 *     (`</USER-CONTENT>`, `</user-content >`, ...), is neutralised by
 *     inserting `&#x200B;` (a zero-width-space entity, so the source
 *     carries no invisible byte) before the final `>`, preserving every
 *     other original byte. Tag semantics are case-insensitive to HTML
 *     consumers and LLMs, so an attacker-cased or padded close tag would
 *     otherwise still close the kernel's delimiter (prompt-injection
 *     escape). This is reversed ONLY for display
 *     (`unescapeUserContentClose`), never for hashing.
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

/**
 * Any `</user-content>` close-tag variant: case-insensitive, internal
 * whitespace tolerated (`</USER-CONTENT>`, `</user-content >`,
 * `</ user-content>`). The capture keeps the original bytes so the escape
 * only INSERTS the entity, never normalises the attacker's casing.
 */
const CLOSE_TAG_RE = /(<\/\s*user-content\s*)>/gi;
/**
 * Exact inverse of `CLOSE_TAG_RE`'s replacement: the same tag prefix
 * followed by the inserted `&#x200B;` entity and the closing `>`.
 */
const ESCAPED_CLOSE_TAG_RE = /(<\/\s*user-content\s*)&#x200B;>/gi;

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
 * Neutralise every literal `</user-content>` close tag inside `body`,
 * case- and internal-whitespace-insensitively, so no variant can
 * prematurely close the kernel's delimiter. The original bytes are
 * preserved except for the inserted `&#x200B;` entity. Reversed only for
 * display via `unescapeUserContentClose`.
 */
function escapeUserContentClose(body: string): string {
  return body.replace(CLOSE_TAG_RE, '$1&#x200B;>');
}

/**
 * Exact inverse of `escapeUserContentClose` (removes the inserted
 * `&#x200B;` entity, restoring the original bytes). For DISPLAY surfaces
 * only (`sm jobs preview`); MUST NOT be applied before hashing or the
 * content hash stops matching the stored blob.
 */
export function unescapeUserContentClose(content: string): string {
  return content.replace(ESCAPED_CLOSE_TAG_RE, '$1>');
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
  /**
   * Rendered findings-to-resolve section (`buildFindingsSection`). Present
   * ONLY for fixer jobs (probabilistic Actions declaring
   * `precondition.analyzerIds`). When present it is inserted at the
   * placeholder seam BEFORE the report contract, so the render order is
   * template-prose, findings, current-tags, report-contract,
   * `<user-content>` block. It is kernel-authored prelude, never user
   * content, so it stays outside the delimiter. Absent on non-fixer /
   * legacy callers.
   */
  findingsSection?: string;
  /**
   * Rendered current-tags section (`buildCurrentTagsSection`). Present ONLY
   * for TAGGER jobs (Actions whose report schema `$ref`s a canonical
   * `tags/*.schema.json`) over a node that actually carries tags. When
   * present it is inserted at the placeholder seam AFTER the findings
   * section and BEFORE the report contract, so the model sees the
   * vocabulary the node already uses and proposes only what is genuinely
   * missing (`spec/job-lifecycle.md` §Current-tags injection for taggers).
   * Kernel-authored prelude, never user content, so it stays outside the
   * delimiter. Absent for non-taggers and for tagged-nothing nodes.
   */
  currentTagsSection?: string;
  /**
   * Rendered report-contract section (`buildReportContract`). When
   * present it is inserted at the placeholder seam, immediately before
   * the `<user-content>` block, so the schema chain sits outside the
   * user-content delimiter. Absent on legacy/test callers.
   */
  reportContract?: string;
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
  // The kernel-authored prelude expands WITH the placeholder so it lands
  // right before the `<user-content>` block (and outside it), per
  // `spec/job-lifecycle.md` §Submit step 9 + §Findings injection for fixers
  // + §Current-tags injection for taggers. Order: findings-to-resolve
  // (fixer only), then current tags (tagger only), then report contract,
  // then the user-content block.
  const parts: string[] = [];
  if (input.findingsSection !== undefined) parts.push(input.findingsSection);
  if (input.currentTagsSection !== undefined) parts.push(input.currentTagsSection);
  if (input.reportContract !== undefined) parts.push(input.reportContract);
  parts.push(block);
  const expansion = parts.join('\n\n');
  const rendered = input.promptTemplate.split(USER_CONTENT_PLACEHOLDER).join(expansion);
  // The preamble fixture already ends with a trailing newline; the extra
  // `\n` yields one blank line between it and the action template.
  return `${preamble}\n${rendered}`;
}
