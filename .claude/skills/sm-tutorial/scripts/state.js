#!/usr/bin/env node
/**
 * state.js, the sm-tutorial state engine.
 *
 * Owns `tutorial-state.json` entirely; the orchestrating agent calls
 * these verbs instead of hand-editing the file. Zero-dep, Node 24+,
 * ESM. This is backstage machinery (same class as `Write`), NOT a
 * teaching `sm` verb the tester runs.
 *
 * Every verb prints ONE JSON line to stdout and exits 0 on success, or
 * a `{ ok: false, code, error }` envelope with a non-zero exit on
 * failure. The agent parses stdout.
 *
 * Verbs:
 *   init --cwd <abs> --sm-version <s> --provider <p> --lang <l> [--force]
 *   pick <partId>
 *   mark <partId> <chapterId> <done|failed|skipped>
 *   set-part <partId> <not_started|in_progress|done|declined|skipped>
 *   set-identity --name <s> --tagline <s>
 *   status
 *   wipe-list
 *   wipe --confirm
 *
 * State path is `<cwd>/tutorial-state.json` (cwd = process.cwd()). The
 * stored `tutorial.cwd` is the safety anchor for wipe.
 */

import { join } from 'node:path';
import { rmSync, rmdirSync, readdirSync } from 'node:fs';

import { parseArgs } from './lib/args.js';
import { exists, readJson, writeJson, succeed, die } from './lib/io.js';
import { loadManifest, findPart } from './lib/manifest.js';
import { providerDir, trackFor } from './lib/paths.js';
import { loadFixturesManifest, resolveFootprint } from './lib/fixtures-manifest.js';

const STATE_FILE = 'tutorial-state.json';
const STATE_VERSION = 2;
const PART_STATUS = new Set(['not_started', 'in_progress', 'done', 'declined', 'skipped']);
const CHAPTER_STATUS = new Set(['done', 'failed', 'skipped']);

const statePath = () => join(process.cwd(), STATE_FILE);
const now = () => new Date().toISOString();

function loadState() {
  const p = statePath();
  if (!exists(p)) {
    die('no-state', `${STATE_FILE} not found in ${process.cwd()}; run \`state init\` first.`);
  }
  return readJson(p);
}

function saveState(state) {
  writeJson(statePath(), state);
}

function seedPart(manifest, id) {
  const def = findPart(manifest, id);
  if (!def) die('unknown-part', `part '${id}' is not in the manifest.`);
  const chapters = {};
  for (const ch of def.chapters) chapters[ch.id] = { status: 'pending' };
  return { status: 'in_progress', chapters };
}

const VERBS = {
  init(args) {
    const p = statePath();
    if (exists(p) && !args.flags.force) {
      die('exists', `${STATE_FILE} already exists; pass --force to overwrite.`);
    }
    const provider = args.flags.provider ?? 'claude';
    const state = {
      tutorial: {
        version: STATE_VERSION,
        started_at: now(),
        cwd: args.flags.cwd ?? process.cwd(),
        sm_version: args.flags['sm-version'] ?? null,
        provider,
        // Derived from the provider (`_core.md` §Provider detection): the
        // book renders this track's parts. `rich` = claude/codex,
        // `basic` = the open-standard family (agent-skills/antigravity).
        track: trackFor(provider),
        lang: args.flags.lang ?? 'en',
      },
      tester: { level: 2 },
      parts: {},
      findings_file: './findings.md',
    };
    saveState(state);
    succeed({ state });
  },

  pick(args) {
    const id = args.positional[0];
    if (!id) die('bad-args', 'usage: pick <partId>');
    const state = loadState();
    const manifest = loadManifest();
    if (!state.parts[id]) {
      state.parts[id] = seedPart(manifest, id);
      saveState(state);
    }
    succeed({ part: { id, ...state.parts[id] } });
  },

  mark(args) {
    const [id, chapterId, status] = args.positional;
    if (!id || !chapterId || !status) {
      die('bad-args', 'usage: mark <partId> <chapterId> <done|failed|skipped>');
    }
    if (!CHAPTER_STATUS.has(status)) {
      die('bad-status', `chapter status must be one of ${[...CHAPTER_STATUS].join(', ')}`);
    }
    const state = loadState();
    const part = state.parts[id];
    if (!part) die('not-picked', `part '${id}' has not been picked; run \`pick ${id}\` first.`);
    if (!part.chapters[chapterId]) die('unknown-chapter', `chapter '${chapterId}' not in part '${id}'.`);

    part.chapters[chapterId] = { status, at: now() };
    const statuses = Object.values(part.chapters).map((c) => c.status);
    const allDone = !statuses.includes('pending');
    // Auto-promote the part only on a clean finish (every chapter done
    // or skipped). A `failed` chapter leaves the part in_progress so the
    // agent decides how to surface it; `allDone` still reports the walk
    // is complete.
    if (allDone && !statuses.includes('failed')) part.status = 'done';
    saveState(state);
    succeed({ part: { id, ...part }, allDone });
  },

  'set-part'(args) {
    const [id, status] = args.positional;
    if (!id || !status) die('bad-args', 'usage: set-part <partId> <status>');
    if (!PART_STATUS.has(status)) {
      die('bad-status', `part status must be one of ${[...PART_STATUS].join(', ')}`);
    }
    const state = loadState();
    const manifest = loadManifest();
    if (!state.parts[id]) state.parts[id] = seedPart(manifest, id);
    state.parts[id].status = status;
    saveState(state);
    succeed({ part: { id, ...state.parts[id] } });
  },

  'set-identity'(args) {
    const { name, tagline } = args.flags;
    if (!name || !tagline) die('bad-args', 'usage: set-identity --name <s> --tagline <s>');
    const state = loadState();
    state.tester.site_identity = { name: String(name), tagline: String(tagline) };
    saveState(state);
    succeed({ site_identity: state.tester.site_identity });
  },

  status() {
    const state = loadState();
    const manifest = loadManifest();
    // Show only the active track's parts (plus `both`). The rich and basic
    // campaigns share titles and order, so a session sees exactly one book,
    // the track resolved at pre-flight (see `_core.md` §Routing + menu).
    const track = state.tutorial?.track ?? 'rich';
    const parts = manifest.parts
      .filter((p) => p.status === 'active' || state.parts[p.id])
      .filter((p) => !p.track || p.track === 'both' || p.track === track)
      .map((p) => {
        const tracked = state.parts[p.id];
        return {
          id: p.id,
          title: p.title,
          order: p.order,
          status: tracked?.status ?? 'not_started',
          chapters: p.chapters.map((c) => ({
            id: c.id,
            title: c.title,
            status: tracked?.chapters?.[c.id]?.status ?? 'pending',
          })),
        };
      });
    succeed({ tutorial: state.tutorial, tester: state.tester, parts });
  },

  'wipe-list'() {
    const state = loadState();
    const guard = cwdGuard(state);
    if (guard) die(guard.code, guard.error);
    succeed({ cwd: state.tutorial.cwd, paths: computeWipePaths(state) });
  },

  wipe(args) {
    if (!args.flags.confirm) {
      die('confirm-required', 'pass --confirm to delete; use `wipe-list` to preview.');
    }
    const state = loadState();
    const guard = cwdGuard(state);
    if (guard) die(guard.code, guard.error);
    const deleted = [];
    for (const rel of computeWipePaths(state)) {
      const abs = join(process.cwd(), rel);
      if (exists(abs)) {
        rmSync(abs, { recursive: true, force: true });
        deleted.push(rel);
      }
    }
    rmdirEmptyParents(state);
    succeed({ deleted });
  },
};

function cwdGuard(state) {
  const stored = state.tutorial?.cwd;
  if (stored && stored !== process.cwd()) {
    return {
      code: 'cwd-mismatch',
      error: `state cwd (${stored}) != current dir (${process.cwd()}); refusing. Move to the saved dir or delete ${STATE_FILE} by hand.`,
    };
  }
  return null;
}

/**
 * The exact paths to remove on start-over, derived from which parts the
 * state records as run. The per-fixture footprints (the on-disk reach
 * of each fixture, including files taught later in its chapters) live
 * once in `fixtures-data/manifest.json` and are shared with
 * `fixtures.js clear`; here we union the footprints of the tracked
 * parts with the universals. Never lists a bare user dir (`notes/`);
 * empty parents are rmdir'd afterwards.
 */
function computeWipePaths(state) {
  const provider = state.tutorial?.provider ?? 'claude';
  const has = (id) => Boolean(state.parts?.[id]);
  const manifest = loadFixturesManifest();
  const paths = new Set(['tutorial-state.json', 'findings.md', '.skillmapignore', '.skill-map']);
  const addFootprint = (name) => resolveFootprint(manifest, name, provider).forEach((p) => paths.add(p));

  // Each footprint covers both tracks: the rich and basic prologues /
  // campaigns lay the same fixtures (the basic one under the open-standard
  // provider), so either part's presence means that fixture is on disk.
  if (has('fundamentals') || has('basic-fundamentals')) addFootprint('prologue');
  if (
    has('project-kickoff') || has('connect-harness') || has('daily-loop')
    || has('basic-kickoff') || has('basic-connect') || has('basic-daily')
  ) addFootprint('portfolio');
  if (has('extend')) addFootprint('master');
  // `cli` seeds the prologue demo fixture plus its external-ref demo.
  if (has('cli')) { addFootprint('prologue'); addFootprint('cli-external'); }

  try {
    for (const entry of readdirSync(process.cwd())) {
      if (/^export\./.test(entry) || entry === 'dump.sql') paths.add(entry);
    }
  } catch { /* cwd unreadable, skip the glob */ }

  return [...paths];
}

function rmdirEmptyParents(state) {
  const pd = providerDir(state.tutorial?.provider ?? 'claude');
  // Children before parents; `rmdirSync` only removes empty dirs, so the
  // tutorial's own skill dir under `<pd>/skills/` keeps `<pd>` alive.
  const candidates = ['notes', 'docs', 'public', `${pd}/agents`, `${pd}/skills`, `${pd}/commands`, pd];
  for (const rel of candidates) {
    try {
      rmdirSync(join(process.cwd(), rel));
    } catch { /* not empty or missing, leave it */ }
  }
}

function main() {
  const [verb, ...rest] = process.argv.slice(2);
  const handler = VERBS[verb];
  if (!handler) {
    die('unknown-verb', `unknown verb '${verb ?? ''}'; expected one of ${Object.keys(VERBS).join(', ')}`);
  }
  handler(parseArgs(rest));
}

main();
