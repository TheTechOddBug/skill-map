/**
 * changeset-changelog.cjs, custom Changesets changelog formatter.
 *
 * Changesets `require()`s this module (CommonJS) when it generates the
 * per-package `CHANGELOG.md` files during `changeset version`. It
 * controls exactly two lines of output:
 *
 *   - `getReleaseLine` formats the bullet for each consumed changeset.
 *     We return just the trimmed summary, with NO commit-hash prefix
 *     and NO PR / author chrome (the default `@changesets/cli/changelog`
 *     prepends `<shortHash>: ` and the GitHub variant adds PR links).
 *
 *   - `getDependencyReleaseLine` formats the "Updated dependencies"
 *     block that fires when an internal dependency bump cascades a
 *     patch. We return an empty string so those bumps add zero noise to
 *     the published changelog (the consolidated root `CHANGELOG.md`
 *     already maps each CLI release to its spec release explicitly).
 *
 * Wired via `.changeset/config.json` `"changelog": "../scripts/changeset-changelog.cjs"`
 * (the path is resolved relative to `.changeset/`, not the repo root, so it
 * climbs one level out before reaching `scripts/`).
 * Only affects FUTURE `changeset version` output; existing history in
 * `src/CHANGELOG.md` / `spec/CHANGELOG.md` is a generated artefact and
 * is not retro-rewritten.
 *
 * Signatures follow the Changesets `ChangelogFunctions` contract:
 *   getReleaseLine(changeset, type, changelogOpts) => Promise<string>
 *   getDependencyReleaseLine(changesets, dependenciesUpdated, changelogOpts) => Promise<string>
 */

/**
 * @param {{ summary: string }} changeset
 * @returns {Promise<string>}
 */
async function getReleaseLine(changeset) {
  const summary = (changeset.summary || '').trim();
  // Collapse a multi-line summary into a single leading line, then keep
  // any continuation lines verbatim (Changesets joins these into one
  // bullet). No hash, no PR link, no author.
  const [firstLine, ...rest] = summary.split('\n');
  let line = `\n\n- ${firstLine.trim()}`;
  for (const continuation of rest) {
    line += `\n  ${continuation}`;
  }
  return line;
}

/**
 * Empty string drops the "Updated dependencies [...]" block entirely.
 * @returns {Promise<string>}
 */
async function getDependencyReleaseLine() {
  return '';
}

module.exports = {
  getReleaseLine,
  getDependencyReleaseLine,
};

// Changesets resolves the module via the `default` export when it is an
// ESM-interop shape; expose it too so either resolution path works.
module.exports.default = module.exports;
