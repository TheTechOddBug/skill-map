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
} as const;
