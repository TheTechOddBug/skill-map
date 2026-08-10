/**
 * Canonical formatter for analyzer finding messages.
 *
 * Every `Issue.message` emitted by the built-in analyzers follows one
 * shape so `sm check` / `sm show` / the UI inspector read consistently:
 *
 *   `<subject>`:
 *   L<lines>: <what>; <why>
 *
 *   - **subject** (line 1, optional): the offending token / path / name,
 *     wrapped in backticks. Omitted when the finding has no single
 *     subject (node-level schema failures, sidecar-wide checks).
 *   - **location prefix** `L<lines>: ` (optional): the 1-indexed
 *     FILE-absolute line(s) the finding maps to (`L2: ` / `L2, 5: `),
 *     frontmatter counted, matching the author's editor (see
 *     `link.schema.json#/properties/location`). Omitted when the finding
 *     has no line (sidecar / frontmatter / abstract checks).
 *   - **body**: the diagnosis as `<what>; <why>` (what was detected, then
 *     why it matters). English, no remediation sentence, a fix hint, when
 *     present, belongs in `Issue.fix.summary`, not in the message.
 *
 * Analyzers own only the `body` string (in their `*.texts.ts`); this
 * helper owns the structural chrome so the message-emitting analyzers
 * cannot drift on subject / location placement.
 */

export interface IFindingFormat {
  /** Offending token / path / name. Backtick-wrapped; omitted when absent. */
  readonly subject?: string | undefined;
  /** 1-indexed file-absolute lines. Rendered as `L2: ` / `L2, 5: `; omitted when empty. */
  readonly lines?: readonly number[] | undefined;
  /** The diagnosis `<what>; <why>`, already interpolated via `tx`. */
  readonly body: string;
}

/** Assemble a finding message in the canonical shape. See the module doc. */
export function formatFinding(parts: IFindingFormat): string {
  const head = parts.subject ? `\`${parts.subject}\`:\n` : '';
  const loc = parts.lines && parts.lines.length > 0 ? `L${parts.lines.join(', ')}: ` : '';
  return `${head}${loc}${parts.body}`;
}
