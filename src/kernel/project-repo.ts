/**
 * The project's own GitHub coordinates, in one place.
 *
 * Consumed by the server's star-count probe and by anything else that
 * needs to name the repository. The UI has its own copy of the URLs
 * (`ui/src/i18n/project-links.ts`) because it cannot import from the
 * kernel; these two are the only places the owner / name appear, and
 * they describe the same repository by construction (the URL is derived
 * here, so a fork editing one value does not leave the other pointing at
 * the original).
 */

export const PROJECT_REPO = {
  owner: 'crystian',
  name: 'skill-map',
} as const;

/** Canonical https URL of the repository, no trailing slash. */
export const PROJECT_REPO_URL = `https://github.com/${PROJECT_REPO.owner}/${PROJECT_REPO.name}`;
