/**
 * Typed surface over `user-changelog.json`, the user-facing release
 * notes rendered by the Settings → Changelog tab.
 *
 * Source of truth is the JSON; this module provides type-safe access
 * for the consumer component. The JSON itself is regenerated on
 * `npm run release:version` by `scripts/build-user-changelog.js`,
 * which:
 *
 *   - Walks every `.changeset/*.md`.
 *   - Extracts the optional `## User-facing` markdown section + the
 *     bumped packages from the YAML frontmatter.
 *   - Computes the next `@skill-map/cli` version from the pending
 *     bumps (pre-1.0 cap: major→minor).
 *   - Prepends a single new entry consolidating every changeset that
 *     bumps `@skill-map/cli`. Entries with no `## User-facing`
 *     section produce a `kind: 'internal'` placeholder so the
 *     UI can render "Internal release, focus on stability and infra"
 *     instead of vanishing the version.
 *
 * Demo-mode safe: this is bundled-in static data, not a BFF call,
 * the same JSON ships with the SPA in both live and demo runs.
 */

import data from './user-changelog.json';

/** One bullet, the text the author wrote in `## User-facing`. */
export interface IUserChangelogHighlight {
  /** Markdown body. Rendered through the shared `MarkdownRenderer`. */
  readonly body: string;
  /**
   * Workspaces this changeset bumped, surfaced as small chips after
   * the bullet so the user knows which package(s) the change affects
   * (`@skill-map/cli`, `@skill-map/spec`, …).
   */
  readonly packages: readonly string[];
}

/** One released version. Newest first in the entries array. */
export interface IUserChangelogEntry {
  /** Semver of `@skill-map/cli` for this release. */
  readonly version: string;
  /** Release date (ISO-8601, `YYYY-MM-DD`). */
  readonly date: string;
  /**
   * `'user-facing'`, at least one changeset shipped a `## User-facing`
   * section. Render highlights as bullets.
   *
   * `'internal'`, the release happened (CLI bump) but no changeset
   * carried a user-facing note. Render as a single placeholder line
   * (e.g. "Internal release, focus on stability and infra").
   */
  readonly kind: 'user-facing' | 'internal';
  /** Empty array iff `kind === 'internal'`. */
  readonly highlights: readonly IUserChangelogHighlight[];
}

export interface IUserChangelog {
  readonly schemaVersion: 1;
  readonly entries: readonly IUserChangelogEntry[];
}

export const USER_CHANGELOG: IUserChangelog = data as IUserChangelog;
