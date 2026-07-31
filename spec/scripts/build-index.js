#!/usr/bin/env node
/**
 * Regenerate spec/index.json: the catalog blocks AND the integrity block.
 *
 * Source of truth for "what ships": `files` in spec/package.json.
 * The script walks every entry (file or directory), computes sha256 over
 * raw bytes, and writes a deterministic listing (lexicographically sorted).
 *
 * The catalog blocks (`schemas`, `prose`, `interfaces`, `conformance`)
 * are DERIVED from the tree on every run, never hand-maintained. They
 * used to be: the generator refreshed only `specPackageVersion` and
 * `integrity` and carried everything else forward, so the published
 * manifest froze at whatever the catalog looked like when someone last
 * hand-edited it (13 of 23 top-level schemas, 1 of 44 conformance
 * cases). A manifest whose own inventory lies is worse than none.
 * Only `indexPayloadVersion`, `dialect` and `canonicalUrlPrefix` remain
 * hand-maintained, they are policy, not inventory.
 *
 * Modes:
 *   npm run spec --workspace=@skill-map/spec          → write spec/index.json
 *   npm run spec:check --workspace=@skill-map/spec    → exit 1 on drift
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(HERE, '..');
const INDEX_PATH = join(SPEC, 'index.json');
const PKG_PATH = join(SPEC, 'package.json');
const CHECK = process.argv.includes('--check');

const SELF_REFERENCE = 'index.json';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function isDir(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function walk(absPath, out) {
  const s = await stat(absPath);
  if (s.isFile()) {
    out.push(absPath);
    return;
  }
  if (s.isDirectory()) {
    const entries = await readdir(absPath);
    for (const name of entries) {
      if (name === '.DS_Store') continue;
      await walk(join(absPath, name), out);
    }
  }
}

async function collectFiles(pkgFiles) {
  const collected = new Set();
  for (const entry of pkgFiles) {
    const abs = join(SPEC, entry);
    const dir = await isDir(abs);
    if (!dir) {
      collected.add(abs);
      continue;
    }
    const bucket = [];
    await walk(abs, bucket);
    for (const f of bucket) collected.add(f);
  }
  return [...collected]
    .map((abs) => relative(SPEC, abs).split(sep).join('/'))
    .filter((rel) => rel !== SELF_REFERENCE)
    .sort();
}

async function hashFile(relPath) {
  const bytes = await readFile(join(SPEC, relPath));
  return createHash('sha256').update(bytes).digest('hex');
}

async function buildIntegrity(pkgFiles) {
  const rels = await collectFiles(pkgFiles);
  const files = {};
  for (const rel of rels) {
    files[rel] = await hashFile(rel);
  }
  return { algorithm: 'sha256', files };
}

function stableStringify(value, indent = 2) {
  return JSON.stringify(value, null, indent) + '\n';
}

/** First `# ` heading of a markdown file, or the filename as fallback. */
async function docTitle(absPath, fallback) {
  const text = await readFile(absPath, 'utf8');
  for (const line of text.split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim();
  }
  return fallback;
}

/**
 * Derive the `schemas` catalog by walking `schemas/`: top-level files
 * land in `topLevel`, each subdirectory becomes its own group keyed by
 * the directory name. Ids are the path minus `.schema.json`, matching
 * the historical convention (`node`, `extensions/base`).
 */
async function deriveSchemas() {
  const root = join(SPEC, 'schemas');
  const out = { topLevel: [] };
  const entries = (await readdir(root)).sort();
  for (const name of entries) {
    const abs = join(root, name);
    if ((await stat(abs)).isDirectory()) {
      const group = [];
      for (const file of (await readdir(abs)).sort()) {
        if (!file.endsWith('.schema.json')) continue;
        const id = `${name}/${file.slice(0, -'.schema.json'.length)}`;
        group.push({ id, path: `schemas/${name}/${file}` });
      }
      if (group.length > 0) out[name] = group;
    } else if (name.endsWith('.schema.json')) {
      out.topLevel.push({
        id: name.slice(0, -'.schema.json'.length),
        path: `schemas/${name}`,
      });
    }
  }
  return out;
}

/**
 * Derive `prose` from the package's `files` array (publication order is
 * the reading order) and `interfaces` from its directory. Titles come
 * from each document's own H1, so a renamed document cannot desynchronise
 * from its manifest entry.
 */
async function deriveProse(pkgFiles) {
  const prose = [];
  for (const entry of pkgFiles) {
    if (!entry.endsWith('.md') || entry.includes('/')) continue;
    prose.push({ file: entry, title: await docTitle(join(SPEC, entry), entry) });
  }
  const interfaces = [];
  for (const file of (await readdir(join(SPEC, 'interfaces'))).sort()) {
    if (!file.endsWith('.md')) continue;
    interfaces.push({
      file: `interfaces/${file}`,
      title: await docTitle(join(SPEC, 'interfaces', file), file),
    });
  }
  return { prose, interfaces };
}

/** Derive the conformance case list from the cases directory. */
async function deriveConformance() {
  const casesDir = join(SPEC, 'conformance', 'cases');
  const cases = [];
  for (const file of (await readdir(casesDir)).sort()) {
    if (!file.endsWith('.json')) continue;
    cases.push({
      id: file.slice(0, -'.json'.length),
      file: `conformance/cases/${file}`,
    });
  }
  return {
    casesDir: 'conformance/cases',
    fixturesDir: 'conformance/fixtures',
    cases,
  };
}

function stripIntegrity(indexDoc) {
  const { integrity, ...rest } = indexDoc;
  return { rest, integrity };
}

async function main() {
  const pkg = await readJson(PKG_PATH);
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    console.error('spec/package.json has no `files` array — nothing to hash.');
    process.exit(2);
  }
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    console.error('spec/package.json has no `version` — cannot stamp manifest.');
    process.exit(2);
  }

  const indexDoc = await readJson(INDEX_PATH);
  const { rest, integrity: existing } = stripIntegrity(indexDoc);
  rest.specPackageVersion = pkg.version;
  rest.schemas = await deriveSchemas();
  const { prose, interfaces } = await deriveProse(pkg.files);
  rest.prose = prose;
  rest.interfaces = interfaces;
  rest.conformance = await deriveConformance();
  const fresh = await buildIntegrity(pkg.files);
  const next = { ...rest, integrity: fresh };
  const serialized = stableStringify(next);

  if (CHECK) {
    const onDisk = await readFile(INDEX_PATH, 'utf8');
    if (onDisk !== serialized) {
      console.error('spec/index.json is out of date.');
      console.error('Run: npm run spec --workspace=@skill-map/spec');
      if (existing) {
        const existingKeys = Object.keys(existing.files ?? {});
        const freshKeys = Object.keys(fresh.files);
        const added = freshKeys.filter((k) => !existingKeys.includes(k));
        const removed = existingKeys.filter((k) => !freshKeys.includes(k));
        const changed = freshKeys.filter(
          (k) => existingKeys.includes(k) && existing.files[k] !== fresh.files[k],
        );
        if (added.length) console.error('  added:   ' + added.join(', '));
        if (removed.length) console.error('  removed: ' + removed.join(', '));
        if (changed.length) console.error('  changed: ' + changed.join(', '));
      }
      process.exit(1);
    }
    console.log(`spec/index.json OK (${Object.keys(fresh.files).length} files hashed).`);
    return;
  }

  await writeFile(INDEX_PATH, serialized);
  console.log(
    `spec/index.json written (${Object.keys(fresh.files).length} files, sha256).`,
  );
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(2);
});
