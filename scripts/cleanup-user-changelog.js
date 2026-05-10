#!/usr/bin/env node
/**
 * cleanup-user-changelog.js — one-shot pass that rewrites every
 * highlight body in `ui/src/data/user-changelog.json` through the
 * same `cleanBody` filter the release pipeline applies on new
 * changesets, then truncates any leftover above
 * `MAX_HIGHLIGHT_CHARS` at the nearest sentence boundary.
 *
 * Idempotent: rerunning the script on an already-cleaned JSON is a
 * no-op (every body fits the cap and the cleanup produces the same
 * single-paragraph shape as the previous run).
 *
 * Run via: `node scripts/cleanup-user-changelog.js`.
 *
 * Why a separate script (vs a flag on build-user-changelog.js)?
 * `build-user-changelog.js` runs as the first step of
 * `release:version` and consumes pending `.changeset/*.md` files —
 * its job is forward-only. Backfilling the existing JSON is a
 * different operation (no changesets involved, idempotent rewrite),
 * so it gets its own entry point.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cleanBody,
  truncateToCap,
  MAX_HIGHLIGHT_CHARS,
} from './build-user-changelog.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const USER_CHANGELOG_JSON = join(REPO_ROOT, 'ui', 'src', 'data', 'user-changelog.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const changelog = readJson(USER_CHANGELOG_JSON);
  let rewrittenBodies = 0;
  let truncatedBodies = 0;

  for (const entry of changelog.entries ?? []) {
    for (const h of entry.highlights ?? []) {
      const originalLength = h.body.length;
      const cleaned = cleanBody(h.body);
      const finalBody = truncateToCap(cleaned, MAX_HIGHLIGHT_CHARS);
      if (finalBody !== h.body) {
        rewrittenBodies += 1;
        if (cleaned.length > MAX_HIGHLIGHT_CHARS) truncatedBodies += 1;
        process.stdout.write(
          `  v${entry.version}: ${originalLength} chars → ${finalBody.length} chars` +
            (cleaned.length > MAX_HIGHLIGHT_CHARS ? ' (truncated)' : '') +
            '\n',
        );
      }
      h.body = finalBody;
    }
  }

  if (rewrittenBodies === 0) {
    process.stdout.write('cleanup-user-changelog: already clean.\n');
    return;
  }

  writeJson(USER_CHANGELOG_JSON, changelog);
  process.stdout.write(
    `cleanup-user-changelog: rewrote ${rewrittenBodies} highlight(s); ${truncatedBodies} truncated.\n`,
  );
}

main();
