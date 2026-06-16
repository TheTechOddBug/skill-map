/**
 * Strings for `<sm-link-kind-palette>`. Mirror of
 * `kind-palette.texts.ts` but for the edge-kind toggles, the link
 * catalog is closed by spec so labels live here as plain English
 * strings (one per `TLinkKindApi` enum value).
 */

export const LINK_KIND_PALETTE_TEXTS = {
  a11y: {
    toolbarLabel: 'Link kind filters',
  },
  kinds: {
    invokes: 'Invokes',
    references: 'References',
    points: 'Points',
    mentions: 'Mentions',
  },
  /**
   * Multi-line tooltip per link kind. Format: `<Label>:` followed by
   * one example line per syntactic form that produces the kind.
   * The `\n` is rendered as a real line break by the
   * `link-kind-palette__tooltip` styleClass (`white-space: pre-line`).
   * The label is included inside the tooltip string (not concatenated
   * by the component) so each entry can drift independently (singular
   * vs plural, punctuation, etc.) without coupling to the `kinds` map.
   * The `references` entry lists the two prose forms: markdown link
   * (`core/markdown-link`) and path-style at-directive
   * (`claude/at-directive`); the backtick path inside code regions is
   * its own kind (`points`, from `core/backtick-path`). A mention
   * example must NOT carry a file extension: `@agent.md` is dispatched
   * as a reference, not a mention.
   */
  tooltips: {
    invokes: 'Invokes:\n"/skill-command"',
    references: 'References:\n"[link](./link.md)"\n"@./link.md"',
    points: 'Points:\n"`references/link.md`" (path in backticks or code blocks)',
    mentions: 'Mention:\n"@agent"',
  },
} as const;
