#!/usr/bin/env node
/**
 * Generate `references/_manifest.json` from `_manifest.yml` for the
 * sm-tutorial skill.
 *
 * The `.yml` stays the human-authored book ToC. The shipped
 * `scripts/state.js` reads the generated `.json` instead (zero-dep
 * `JSON.parse`) because the `.yml` uses a bespoke chapter shorthand
 * (`- id: x ; title: "y" ; est_min: N`) that is NOT standard YAML, so
 * a parser for it would be fragile code embarked to the tester. This
 * generator runs in the repo with the full toolchain and emits a clean
 * JSON sidecar that ships via `copySkillFolder` and is locked by the
 * byte-for-byte payload test.
 *
 * Usage:
 *   node scripts/generate-tutorial-manifest.js           # write the sidecar
 *   node scripts/generate-tutorial-manifest.js --check   # verify in sync (CI / validate)
 *
 * Paths are anchored from `import.meta.url`, not cwd, so the script is
 * invocable from any directory (mirrors `scripts/dev-serve.js`).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const REF_DIR = resolve(REPO_ROOT, '.claude/skills/sm-tutorial/references');
const YML = resolve(REF_DIR, '_manifest.yml');
const JSON_OUT = resolve(REF_DIR, '_manifest.json');

/**
 * Strip a trailing ` # ...` inline comment (space + hash). Hashes
 * inside the quoted chapter titles never reach here, those segments are
 * parsed separately.
 */
function stripComment(value) {
  const i = value.indexOf(' #');
  return (i >= 0 ? value.slice(0, i) : value).trim();
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function parseManifest(text) {
  const parts = [];
  let findingsFile = null;
  let cur = null;
  let inChapters = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (/^findings_file:/.test(line)) {
      findingsFile = unquote(stripComment(line.slice(line.indexOf(':') + 1).trim()));
      inChapters = false;
      continue;
    }
    if (/^parts:/.test(line)) continue;

    const indent = line.length - line.trimStart().length;

    // New part: `  - id: <id>` at 2-space indent.
    if (indent === 2 && trimmed.startsWith('- id:')) {
      cur = { id: stripComment(trimmed.slice('- id:'.length).trim()), chapters: [] };
      parts.push(cur);
      inChapters = false;
      continue;
    }

    // Chapter row under `    chapters:` (6-space `- id: x ; title: "y" ; est_min: N`).
    if (inChapters && trimmed.startsWith('- id:')) {
      const ch = {};
      // Split on `;` tolerating inconsistent surrounding whitespace
      // (the shorthand convention is ` ; ` but the source has had a
      // missing-space typo); titles are quoted and carry no `;`.
      for (const seg of trimmed.split(/\s*;\s*/)) {
        const s = seg.replace(/^- /, '');
        const ci = s.indexOf(':');
        if (ci < 0) continue;
        const key = s.slice(0, ci).trim();
        const val = s.slice(ci + 1).trim();
        if (key === 'est_min') ch.est_min = Number(val);
        else if (key === 'id') ch.id = val;
        else if (key === 'title') ch.title = unquote(val);
      }
      cur.chapters.push(ch);
      continue;
    }

    // Part-level field at 4-space indent.
    if (cur && indent === 4) {
      const ci = trimmed.indexOf(':');
      if (ci < 0) continue;
      const key = trimmed.slice(0, ci).trim();
      const rest = trimmed.slice(ci + 1).trim();
      if (key === 'chapters') { inChapters = true; continue; }
      if (key === 'step_files') { inChapters = false; continue; }
      const val = unquote(stripComment(rest));
      if (key === 'order') cur.order = Number(val);
      else if (key === 'title') cur.title = val;
      else if (key === 'status') cur.status = val;
      else if (key === 'preflight') cur.preflight = val;
      else if (key === 'seed') cur.seed = val;
      else if (key === 'prereq') cur.prereq = val;
      else if (key === 'pace') cur.pace = val;
      else if (key === 'track') cur.track = val;
      continue;
    }

    // `step_files` list items (6-space `- part-...`): not needed, skip.
  }

  parts.sort((a, b) => a.order - b.order);
  return {
    parts: parts.map((p) => ({
      id: p.id,
      order: p.order,
      title: p.title,
      status: p.status,
      preflight: p.preflight ?? null,
      seed: p.seed ?? null,
      prereq: p.prereq ?? null,
      pace: p.pace ?? null,
      track: p.track ?? null,
      chapters: p.chapters.map((c) => ({ id: c.id, title: c.title, est_min: c.est_min })),
    })),
    findings_file: findingsFile,
  };
}

function render() {
  const text = readFileSync(YML, 'utf8');
  return JSON.stringify(parseManifest(text), null, 2) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const next = render();

  if (check) {
    if (!existsSync(JSON_OUT)) {
      process.stderr.write(
        'tutorial-manifest: _manifest.json missing. Run `pnpm tutorial-manifest`.\n',
      );
      process.exit(1);
    }
    const current = readFileSync(JSON_OUT, 'utf8');
    if (current !== next) {
      process.stderr.write(
        'tutorial-manifest: _manifest.json is stale. Run `pnpm tutorial-manifest` and commit.\n',
      );
      process.exit(1);
    }
    process.stdout.write('tutorial-manifest: --check OK (_manifest.json in sync).\n');
    return;
  }

  writeFileSync(JSON_OUT, next);
  process.stdout.write(`tutorial-manifest: wrote ${JSON_OUT}\n`);
}

main();
