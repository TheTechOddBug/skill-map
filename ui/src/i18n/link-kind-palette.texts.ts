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
    mentions: 'Mentions',
    supersedes: 'Supersedes',
  },
  /**
   * Two-line tooltip per link kind. Format: `<Label>:\n<example>`.
   * The `\n` is rendered as a real line break by the
   * `link-kind-palette__tooltip` styleClass (`white-space: pre-line`).
   * The label is included inside the tooltip string (not concatenated
   * by the component) so each entry can drift independently (singular
   * vs plural, punctuation, etc.) without coupling to the `kinds` map.
   */
  tooltips: {
    invokes: 'Invokes:\n"/skill-command"',
    references: 'References:\n"[link](./link.md)"',
    mentions: 'Mention:\n"@agent.md"',
    supersedes: 'Supersedes:\n.sm annotation',
  },
} as const;
