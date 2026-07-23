#!/usr/bin/env node
/**
 * build-changelog.js, consolidate every pending `.changeset/*.md` into
 * a single new entry keyed by the next `@skill-map/cli` version and
 * prepend it (as a collapsible `<details>` block) to the consolidated
 * root `CHANGELOG.md`.
 *
 * Runs as a step of `pnpm release:version`, right after
 * `build-user-changelog.js` and BEFORE `changeset version` consumes
 * (and deletes) the changeset files. Mirrors the forward-only,
 * idempotent contract of its sibling.
 *
 * Output shape per release (one `<details>` per CLI release, newest
 * first; the topmost is `<details open>`, all others collapsed):
 *
 *   <details open>
 *   <summary><b>0.43.0</b> · 2026-05-30</summary>
 *
 *   ### CLI Minor
 *   - <one tight line per changeset that bumps the CLI>
 *
 *   ### CLI Patch
 *   - ...
 *
 *   ### Spec Minor (0.40.0)
 *   - <one tight line per changeset that bumps the spec>
 *
 *   </details>
 *
 * Section order within an entry: CLI Minor, CLI Patch, Spec Minor,
 * Spec Patch. Sections only render when non-empty. The spec version in
 * the heading parenthesis is computed the same way the CLI version is.
 *
 * Each bullet is the changeset's TECHNICAL body (everything before any
 * `## User-facing` heading, which belongs only to the UI changelog),
 * collapsed to a single line. No commit hashes, no `Updated
 * dependencies` noise (those never appear in a changeset body; they are
 * a `changeset version` artefact this generator sidesteps entirely).
 *
 * Idempotent: if the top entry already targets the next CLI version,
 * the script no-ops, so re-running `release:version` on a dirty tree
 * won't double-add.
 *
 * `--check` validates the pending changeset bodies (the same
 * one-short-paragraph contract `build-user-changelog.js` enforces) and
 * exits without computing versions or writing the file. Used by the
 * pre-commit hook.
 *
 * Pre-1.0 cap: any `major` bump is downgraded to `minor` while the
 * package version is still in the `0.Y.Z` range (mirrors
 * `spec/versioning.md` § Pre-1.0).
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyBumpType,
  technicalBody,
  validateTechnicalBody,
} from './build-user-changelog.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const CHANGESET_DIR = join(REPO_ROOT, '.changeset');
const CLI_PACKAGE_JSON = join(REPO_ROOT, 'src', 'package.json');
const SPEC_PACKAGE_JSON = join(REPO_ROOT, 'spec', 'package.json');
const ROOT_CHANGELOG = join(REPO_ROOT, 'CHANGELOG.md');

const CLI_PACKAGE_NAME = '@skill-map/cli';
const SPEC_PACKAGE_NAME = '@skill-map/spec';

/** Bump-type rank; `max` of all changesets wins. */
const BUMP_RANK = { patch: 1, minor: 2, major: 3 };

function maxBumpType(types) {
  let best = null;
  for (const t of types) {
    if (best === null || BUMP_RANK[t] > BUMP_RANK[best]) best = t;
  }
  return best;
}

/**
 * Parse one `.changeset/*.md` file into its package -> bumpType map and
 * its raw markdown body. Mirrors `build-user-changelog.js`'s frontmatter
 * grammar so the two generators agree on what a changeset declares.
 */
function parseChangeset(content) {
  const fmMatch = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/.exec(content);
  if (!fmMatch) return null;
  const [, frontmatter, body] = fmMatch;

  const packages = {};
  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^["']?([^"'\s:]+)["']?\s*:\s*(patch|minor|major)\s*$/.exec(line);
    if (!m) continue;
    packages[m[1]] = m[2];
  }
  return { packages, body };
}

/**
 * Collapse a changeset's technical body to a single tight changelog
 * line: drop everything from the first blank-line paragraph break or
 * the first sub-bullet onward, then squeeze whitespace. The body
 * contract (`validateTechnicalBody`) already forbids tables /
 * sub-headings / sub-bullets / multiple paragraphs, so in practice this
 * just normalises the wrapped single paragraph into one line.
 */
function oneLine(body) {
  const tech = technicalBody(body);
  const firstParagraph = tech.split(/\n\s*\n/)[0] ?? '';
  const beforeList = firstParagraph.split(/\n(?:[-*]\s|#{1,6}\s)/)[0] ?? firstParagraph;
  return beforeList.replace(/\s+/g, ' ').trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function todayISO() {
  // Release-time Node script (not a workflow scheduler), so the local
  // wall-clock date is the right "release date" to stamp.
  return new Date().toISOString().slice(0, 10);
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

const BUMP_LABEL = { minor: 'Minor', patch: 'Patch', major: 'Major' };

/**
 * Render the four ordered sections of one release entry. Each non-empty
 * bucket becomes a `### CLI <Bump>` or `### Spec <Bump> (x.y.z)` block
 * with one bullet per body. Returns the joined markdown.
 */
function renderSections({ cliMinor, cliPatch, specMinor, specPatch, specVersion }) {
  const blocks = [];
  const section = (heading, bodies) => {
    if (bodies.length === 0) return;
    const bullets = bodies.map((b) => `- ${b}`).join('\n');
    blocks.push(`### ${heading}\n${bullets}`);
  };
  section('CLI Minor', cliMinor);
  section('CLI Patch', cliPatch);
  section(`Spec Minor (${specVersion})`, specMinor);
  section(`Spec Patch (${specVersion})`, specPatch);
  return blocks.join('\n\n');
}

function main() {
  const checkOnly = process.argv.slice(2).includes('--check');

  const files = listChangesetFiles();
  if (files.length === 0) {
    process.stdout.write('build-changelog: no pending changesets, skip.\n');
    return;
  }

  const cliBumpTypes = [];
  const specBumpTypes = [];
  const cliMinor = [];
  const cliPatch = [];
  const specMinor = [];
  const specPatch = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const parsed = parseChangeset(content);
    if (!parsed) continue;
    // Same one-short-paragraph body contract the published changelog
    // relies on. Runs in both the `--check` and release paths.
    validateTechnicalBody(file, parsed.body);

    const cliBump = parsed.packages[CLI_PACKAGE_NAME];
    const specBump = parsed.packages[SPEC_PACKAGE_NAME];

    // A spec bump cascades an implicit `patch` onto the CLI via
    // `updateInternalDependencies: 'patch'` (see `.changeset/config.json`),
    // so the entry is keyed by the CLI version even when only spec bumped.
    if (cliBump || specBump) {
      cliBumpTypes.push(cliBump ?? 'patch');
    } else {
      continue; // unrelated workspace, skip
    }

    const line = oneLine(parsed.body);

    if (cliBump === 'minor' || cliBump === 'major') {
      cliMinor.push(line);
    } else if (cliBump === 'patch') {
      cliPatch.push(line);
    }

    if (specBump) {
      specBumpTypes.push(specBump);
      if (specBump === 'minor' || specBump === 'major') {
        specMinor.push(line);
      } else {
        specPatch.push(line);
      }
    }
  }

  if (checkOnly) {
    process.stdout.write('build-changelog: --check OK.\n');
    return;
  }

  if (cliBumpTypes.length === 0) {
    process.stdout.write(
      'build-changelog: no changesets bump @skill-map/cli or @skill-map/spec, skip.\n',
    );
    return;
  }

  const currentCliVersion = readJson(CLI_PACKAGE_JSON).version;
  const nextCliVersion = applyBumpType(currentCliVersion, maxBumpType(cliBumpTypes));

  let specVersion = null;
  if (specBumpTypes.length > 0) {
    const currentSpecVersion = readJson(SPEC_PACKAGE_JSON).version;
    specVersion = applyBumpType(currentSpecVersion, maxBumpType(specBumpTypes));
  }

  const existing = readFileSync(ROOT_CHANGELOG, 'utf8');

  // Idempotent: if the top entry already targets the next CLI version,
  // a previous run created it, skip.
  if (new RegExp(`<summary><b>${nextCliVersion.replace(/\./g, '\\.')}</b>`).test(existing)) {
    process.stdout.write(
      `build-changelog: entry for ${nextCliVersion} already present, skip.\n`,
    );
    return;
  }

  const sections = renderSections({
    cliMinor,
    cliPatch,
    specMinor,
    specPatch,
    specVersion,
  });

  const entry =
    `<details open>\n` +
    `<summary><b>${nextCliVersion}</b> · ${todayISO()}</summary>\n\n` +
    `${sections}\n\n` +
    `</details>`;

  // Split the file into the header block (everything up to the first
  // `<details`) and the body of existing entries. Demote the previously
  // open entry to collapsed before prepending the new open one.
  const firstDetailsIdx = existing.indexOf('<details');
  if (firstDetailsIdx === -1) {
    // No entries yet, append after the header.
    const next = `${existing.trimEnd()}\n\n${entry}\n`;
    writeFileSync(ROOT_CHANGELOG, next, 'utf8');
  } else {
    const header = existing.slice(0, firstDetailsIdx);
    const rest = existing.slice(firstDetailsIdx).replace('<details open>', '<details>');
    const next = `${header}${entry}\n\n${rest.trimEnd()}\n`;
    writeFileSync(ROOT_CHANGELOG, next, 'utf8');
  }

  process.stdout.write(
    `build-changelog: prepended ${nextCliVersion}` +
      (specVersion ? ` (spec ${specVersion})` : '') +
      '.\n',
  );
}

// Run main() only when invoked directly (release pipeline). Importing
// helpers from this module elsewhere MUST NOT trigger the release flow.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
