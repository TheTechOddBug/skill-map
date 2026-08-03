/**
 * Canonical outbound URLs of the project, in one place.
 *
 * They used to live in `settings.texts.ts` alone, which was fine while
 * About was the only surface linking out. The topbar brand now does too
 * (the mark opens the site, the wordmark opens the repository), and two
 * catalogs holding the same literal is how one of them goes stale the
 * day a domain moves. Both catalogs read from here.
 *
 * Not URLs the CLI owns: the update-check banner points at npm from its
 * own side. These are the human-readable surfaces the UI links to.
 */
export const PROJECT_LINKS = {
  website: 'https://skill-map.ai/',
  github: 'https://github.com/crystian/skill-map',
} as const;
