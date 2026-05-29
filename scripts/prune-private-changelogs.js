#!/usr/bin/env node
/**
 * prune-private-changelogs.js — delete the `CHANGELOG.md` of every
 * PRIVATE workspace after `changeset version` ran.
 *
 * Runs as a step of `release:version`, AFTER `changeset version`
 * (which regenerates a `CHANGELOG.md` for every package it bumps,
 * private ones included). Private workspaces (`ui/`, `web/`) are not
 * installed or read by anyone: `ui/` ships bundled inside
 * `@skill-map/cli`, `web/` is the marketing-site deploy. Their
 * changelog is pure generated noise, so we remove it on every release.
 *
 * The PUBLIC packages keep their changelog: `src/CHANGELOG.md`
 * (@skill-map/cli) and `spec/CHANGELOG.md` (@skill-map/spec) render on
 * their npm package pages.
 *
 * Idempotent: a missing file is a no-op.
 */

import { rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** Private workspaces whose CHANGELOG.md must never ship. */
const PRIVATE_WORKSPACE_CHANGELOGS = ['ui', 'web'].map((w) =>
  join(REPO_ROOT, w, 'CHANGELOG.md'),
);

let removed = 0;
for (const path of PRIVATE_WORKSPACE_CHANGELOGS) {
  if (existsSync(path)) {
    rmSync(path);
    removed += 1;
    process.stdout.write(`prune-private-changelogs: removed ${path}\n`);
  }
}

if (removed === 0) {
  process.stdout.write('prune-private-changelogs: nothing to prune.\n');
}
