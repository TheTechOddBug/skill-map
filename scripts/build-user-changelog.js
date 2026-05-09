#!/usr/bin/env node
/**
 * build-user-changelog.js — extract the optional `## User-facing`
 * section from every pending `.changeset/*.md`, consolidate them into
 * a single new entry keyed by the next `@skill-map/cli` version, and
 * prepend it to `ui/src/data/user-changelog.json`.
 *
 * Runs as the FIRST step of `npm run release:version`, BEFORE
 * `changeset version` consumes (and deletes) the changeset files.
 * Idempotent: if the same version is already at the top of the
 * changelog, the script no-ops — re-running `release:version` on a
 * dirty tree won't double-add.
 *
 * Workflow per `.changeset/*.md`:
 *
 *   ---
 *   "@skill-map/cli": minor
 *   "@skill-map/spec": minor
 *   ---
 *
 *   Verbose technical body for CHANGELOG.md (Changesets consumes this).
 *
 *   ## User-facing
 *
 *   Click a tag in the inspector to highlight every node that carries
 *   it. Same chip again to clear.
 *
 * The `## User-facing` heading is optional. Changesets that omit it
 * are treated as internal — they still bump the CLI but don't add a
 * highlight. If a release has zero user-facing sections, the entry
 * is written with `kind: 'internal'` and an empty highlights array
 * so the UI can show "Internal release — focus on stability and infra"
 * instead of vanishing the version.
 *
 * Pre-1.0 cap: any `major` bump gets downgraded to `minor` while the
 * package version is still in the `0.Y.Z` range. Mirrors the
 * pre-1.0 rule documented in `spec/versioning.md`.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const CHANGESET_DIR = join(REPO_ROOT, '.changeset');
const CLI_PACKAGE_JSON = join(REPO_ROOT, 'src', 'package.json');
const USER_CHANGELOG_JSON = join(REPO_ROOT, 'ui', 'src', 'data', 'user-changelog.json');
const CLI_PACKAGE_NAME = '@skill-map/cli';

/**
 * Parse one `.changeset/*.md` file: YAML frontmatter (between the
 * outer `---` fences) listing `"<package>": <bumpType>` pairs, then
 * the markdown body. The body MAY include a `## User-facing` heading;
 * everything between that heading and the next `## ` (or EOF) is the
 * user-facing markdown for the changeset.
 */
function parseChangeset(content) {
  const fmMatch = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/.exec(content);
  if (!fmMatch) return null;
  const [, frontmatter, body] = fmMatch;

  const packages = {};
  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^"?([^"\s:]+)"?\s*:\s*(patch|minor|major)\s*$/.exec(line);
    if (!m) continue;
    packages[m[1]] = m[2];
  }

  const userFacing = extractUserFacing(body);
  return { packages, userFacing };
}

/**
 * Find a `## User-facing` (case-insensitive) heading in the body and
 * return the markdown that follows, until the next `## ` heading or
 * EOF. Returns `null` if no such section. Trims surrounding blank
 * lines so the consumer's bullet renders without leading whitespace.
 */
function extractUserFacing(body) {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+user-facing\s*$/i.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const slice = lines.slice(start, end).join('\n').trim();
  return slice.length > 0 ? slice : null;
}

/** Bump-type rank; `max` of all changesets wins. */
const BUMP_RANK = { patch: 1, minor: 2, major: 3 };

/** Pre-1.0 cap: any major while still in 0.x.y → minor instead. */
function applyBumpType(currentVersion, bumpType) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);
  if (!m) {
    throw new Error(`build-user-changelog: cannot parse version "${currentVersion}"`);
  }
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let effective = bumpType;
  if (effective === 'major' && major === 0) effective = 'minor';
  if (effective === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (effective === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function maxBumpType(types) {
  let best = null;
  for (const t of types) {
    if (best === null || BUMP_RANK[t] > BUMP_RANK[best]) best = t;
  }
  return best;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function todayISO() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function listChangesetFiles() {
  let entries;
  try {
    entries = readdirSync(CHANGESET_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => join(CHANGESET_DIR, name))
    .sort();
}

function main() {
  const files = listChangesetFiles();
  if (files.length === 0) {
    process.stdout.write('build-user-changelog: no pending changesets — skip.\n');
    return;
  }

  const cliPkg = readJson(CLI_PACKAGE_JSON);
  const currentCliVersion = cliPkg.version;

  const cliBumpTypes = [];
  const userFacingHighlights = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const parsed = parseChangeset(content);
    if (!parsed) continue;
    const cliBump = parsed.packages[CLI_PACKAGE_NAME];
    if (!cliBump) continue; // changeset doesn't bump @skill-map/cli — skip
    cliBumpTypes.push(cliBump);
    if (parsed.userFacing !== null) {
      userFacingHighlights.push({
        body: parsed.userFacing,
        packages: Object.keys(parsed.packages).sort(),
      });
    }
  }

  if (cliBumpTypes.length === 0) {
    process.stdout.write(
      'build-user-changelog: no changesets bump @skill-map/cli — skip.\n',
    );
    return;
  }

  const bestBump = maxBumpType(cliBumpTypes);
  const nextVersion = applyBumpType(currentCliVersion, bestBump);

  let changelog;
  try {
    changelog = readJson(USER_CHANGELOG_JSON);
  } catch {
    changelog = { schemaVersion: 1, entries: [] };
  }

  // Idempotent: if the topmost entry already targets the same version,
  // assume a previous run created it and skip — re-running the release
  // pipeline on a dirty tree shouldn't double-add.
  const top = changelog.entries[0];
  if (top && top.version === nextVersion) {
    process.stdout.write(
      `build-user-changelog: entry for v${nextVersion} already present — skip.\n`,
    );
    return;
  }

  const entry = {
    version: nextVersion,
    date: todayISO(),
    kind: userFacingHighlights.length > 0 ? 'user-facing' : 'internal',
    highlights: userFacingHighlights,
  };

  changelog.entries = [entry, ...changelog.entries];
  writeJson(USER_CHANGELOG_JSON, changelog);

  process.stdout.write(
    `build-user-changelog: prepended v${nextVersion} (${entry.kind}, ${userFacingHighlights.length} highlight(s)).\n`,
  );
}

main();
