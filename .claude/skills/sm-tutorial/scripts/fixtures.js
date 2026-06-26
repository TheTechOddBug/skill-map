#!/usr/bin/env node
/**
 * fixtures.js, the sm-tutorial fixture engine.
 *
 * Lays / edits / seeds / clears the demo, portfolio, harness, master,
 * and cli-external fixtures from `fixtures-data/` instead of having the
 * agent reproduce file content verbatim. Zero-dep, Node 24+, ESM.
 * Backstage machinery (same class as `Write`), NOT a teaching `sm` verb.
 *
 * Content lives under `fixtures-data/sets/<set>/{shared,<lang>}/` with
 * the provider dir as a literal `__PROVIDER__` path segment; only the
 * PATH is rewritten per provider (content is verbatim, relative links
 * are depth-correct in the claude layout). Kind is derived from the
 * path (paths.js#kindForPath); files whose kind the provider does not
 * claim are skipped.
 *
 * Verbs (all but `cat` print one JSON line to stdout):
 *   lay <set>   [--provider p] [--lang l]
 *   edit <id>   [--provider p] [--lang l]
 *   seed <snap> [--provider p] [--lang l]
 *   clear <footprint>          [--provider p]
 *   cat <set> --file <relpath> [--provider p] [--lang l]   (raw content to stdout)
 *
 * `clear` removes a named footprint (part-entry resets); the full
 * start-over wipe is `state.js wipe` (cwd-guarded + confirmation-gated).
 */

import { join, dirname, relative } from 'node:path';
import {
  readFileSync, writeFileSync, mkdirSync, rmSync, rmdirSync, readdirSync, statSync, existsSync,
} from 'node:fs';

import { parseArgs } from './lib/args.js';
import { emit, succeed, die } from './lib/io.js';
import { loadFixturesManifest, fixturesDir, resolveFootprint } from './lib/fixtures-manifest.js';
import {
  providerDir, kindsFor, resolveTargetPath, kindForPath, nodeIdForTokenPath, overlayKey,
  fragmentKindsFor, PROVIDER_TOKEN,
} from './lib/paths.js';

function opts(args) {
  return { provider: args.flags.provider ?? 'claude', lang: args.flags.lang ?? 'en' };
}

function pdirAndKinds(o) {
  return { pdir: providerDir(o.provider), kinds: kindsFor(o.provider) };
}

/** Recursively list files under `root`, relative to `root`, sorted. */
function walk(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of readdirSync(cur)) {
      const full = join(cur, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else out.push(relative(root, full));
    }
  }
  return out.sort();
}

function writeFileEnsuring(abs, content) {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/**
 * Lay one set's files for the given lang + provider. `only` (a Set of
 * token-form relpaths, claude-shaped and lens-agnostic) restricts to those
 * nodes, for the prologue's progressive reveal where each chapter lands its
 * own nodes; matching is by logical node id so a claude-shaped `--only`
 * entry still selects the agent-skills skill overlay of the same node.
 *
 * Tiers, in lay order (later wins): lang-invariant `shared/`, the language
 * tier, then the per-provider overlay (`providers/<provider>/{shared,<lang>}/`).
 * The overlay carries the skill-shaped variants of nodes a lens renders
 * differently (e.g. the `content-editor` agent becomes a skill on
 * agent-skills); claude declares no overlay because the base IS its shape.
 */
function laySet(manifest, set, o, only = null) {
  const { kinds } = pdirAndKinds(o);
  if (!manifest.sets.includes(set)) die('unknown-set', `set '${set}' is not in the manifest.`);
  const base = join(fixturesDir(), 'sets', set);
  const langDir = existsSync(join(base, o.lang)) ? o.lang : (manifest.defaultLang ?? 'en');
  const onlyIds = only ? new Set([...only].map(nodeIdForTokenPath)) : null;
  const oKey = overlayKey(o.provider);
  const laid = [];
  const laidIds = new Set();
  const skipped = [];
  const tiers = [
    join(base, 'shared'),
    join(base, langDir),
    join(base, 'providers', oKey, 'shared'),
    join(base, 'providers', oKey, langDir),
  ];
  for (const tierRoot of tiers) {
    for (const rel of walk(tierRoot)) {
      // `rel` is the token-form target path (e.g. __PROVIDER__/agents/x.md).
      if (onlyIds && !onlyIds.has(nodeIdForTokenPath(rel))) continue;
      const kind = kindForPath(rel);
      if (!kinds.has(kind)) { skipped.push({ path: rel, kind }); continue; }
      const target = resolveTargetPath(rel, o.provider);
      writeFileEnsuring(join(process.cwd(), target), readFileSync(join(tierRoot, rel)));
      laid.push(target);
      laidIds.add(nodeIdForTokenPath(rel));
    }
  }
  // Drop from `skipped` any node that the overlay laid under another kind
  // (the claude-shaped agent file is skipped, but its skill overlay landed),
  // so the report only flags nodes genuinely absent on this lens.
  const netSkipped = skipped.filter((s) => !laidIds.has(nodeIdForTokenPath(s.path)));
  return { laid, skipped: netSkipped };
}

// Count UNIQUE `.md` targets: a per-provider overlay can overwrite a base
// file (e.g. the open-standard `AGENTS.md` handbook), so `laid` may list the
// same target twice; the node count is the on-disk reality, not the write count.
const nodeCount = (paths) => new Set(paths.filter((p) => p.endsWith('.md'))).size;

/**
 * Resolve a fragment file path. A per-provider overlay
 * (`edits/<id>/providers/<provider>/<lang>/`) wins when present, mirroring
 * the set overlay, a fragment with a relative link to a provider-dir file
 * is depth-sensitive (the content-editor lives one level deeper as a skill
 * under agent-skills), so its link text differs per lens. Falls back to the
 * shared fragment, then to the default language for either tier.
 */
function fragmentPath(manifest, id, o, file) {
  const def = manifest.defaultLang ?? 'en';
  const dir = join(fixturesDir(), 'edits', id);
  const oKey = overlayKey(o.provider);
  const candidates = [
    join(dir, 'providers', oKey, o.lang, file),
    join(dir, 'providers', oKey, def, file),
    join(dir, o.lang, file),
    join(dir, def, file),
  ];
  return candidates.find((c) => existsSync(c)) ?? candidates[candidates.length - 1];
}

/** Apply one manifest edit (append fragments) honoring requiresKind. */
function applyEdit(manifest, id, o) {
  const { kinds } = pdirAndKinds(o);
  const def = manifest.edits?.[id];
  if (!def) die('unknown-edit', `edit '${id}' is not in the manifest.`);
  // Resolve the target to the shape this provider actually laid. When the
  // declared (claude-shaped) target's kind is unclaimed, fall back to the
  // skill-overlay path for the same node id, agent-skills renders the
  // content-editor agent as a skill, so the style fragment must append to
  // that skill body. Only genuinely-absent nodes skip the edit.
  let targetTok = def.target;
  if (!kinds.has(kindForPath(targetTok))) {
    const skillTok = `${PROVIDER_TOKEN}/skills/${nodeIdForTokenPath(def.target)}/SKILL.md`;
    const skillAbs = join(process.cwd(), resolveTargetPath(skillTok, o.provider));
    if (kinds.has('skill') && existsSync(skillAbs)) {
      targetTok = skillTok;
    } else {
      return { target: resolveTargetPath(def.target, o.provider), appended: [], skipped: true };
    }
  }
  const target = resolveTargetPath(targetTok, o.provider);
  const targetAbs = join(process.cwd(), target);
  if (!existsSync(targetAbs)) die('edit-target-missing', `edit '${id}' target not found: ${target}`);

  // Fragment gating is by TRACK, not the base-tier `kinds`: a rich provider
  // (codex) links to agent / command roles it renders via overlay (TOML agent,
  // command-as-skill), so those bullets apply even though its base kinds omit them.
  const fragKinds = fragmentKindsFor(o.provider);
  const fragments = (def.fragments ?? []).filter((f) => !f.requiresKind || fragKinds.has(f.requiresKind));
  if (fragments.length === 0) return { target, appended: [] };

  let content = readFileSync(targetAbs, 'utf8');
  if (!content.endsWith('\n')) content += '\n';
  if (def.prefix) content += def.prefix;
  const appended = [];
  for (const frag of fragments) {
    content += readFileSync(fragmentPath(manifest, id, o, frag.file), 'utf8');
    appended.push(frag.file);
  }
  writeFileSync(targetAbs, content);
  return { target, appended };
}

const VERBS = {
  lay(args) {
    const set = args.positional[0];
    if (!set) die('bad-args', 'usage: lay <set> [--only a,b] [--provider p] [--lang l]');
    const o = opts(args);
    const only = args.flags.only ? new Set(String(args.flags.only).split(',')) : null;
    const manifest = loadFixturesManifest();
    const { laid, skipped } = laySet(manifest, set, o, only);
    succeed({ laid, skipped, nodeCount: nodeCount(laid), needsProvision: !existsSync(join(process.cwd(), '.skill-map')) });
  },

  edit(args) {
    const id = args.positional[0];
    if (!id) die('bad-args', 'usage: edit <edit-id> [--provider p] [--lang l]');
    const manifest = loadFixturesManifest();
    succeed(applyEdit(manifest, id, opts(args)));
  },

  seed(args) {
    const snap = args.positional[0];
    if (!snap) die('bad-args', 'usage: seed <snapshot> [--provider p] [--lang l]');
    const o = opts(args);
    const manifest = loadFixturesManifest();
    const def = manifest.seeds?.[snap];
    if (!def) die('unknown-seed', `seed '${snap}' is not in the manifest.`);
    const laid = [];
    const skipped = [];
    for (const set of def.lay ?? []) {
      const r = laySet(manifest, set, o);
      laid.push(...r.laid);
      skipped.push(...r.skipped);
    }
    const edits = [];
    for (const id of def.edits ?? []) edits.push(applyEdit(manifest, id, o));
    const dropped = [];
    for (const rel of def.drop ?? []) {
      const resolved = resolveTargetPath(rel, o.provider);
      const abs = join(process.cwd(), resolved);
      if (existsSync(abs)) { rmSync(abs, { recursive: true, force: true }); dropped.push(resolved); }
    }
    const present = laid.filter((p) => !dropped.includes(p));
    succeed({
      laid, skipped, edits, dropped,
      nodeCount: nodeCount(present),
      needsProvision: !existsSync(join(process.cwd(), '.skill-map')),
    });
  },

  clear(args) {
    const name = args.positional[0];
    if (!name) die('bad-args', 'usage: clear <footprint> [--provider p]');
    const manifest = loadFixturesManifest();
    if (!manifest.footprints?.[name]) die('unknown-footprint', `footprint '${name}' is not in the manifest.`);
    const o = opts(args);
    const { pdir } = pdirAndKinds(o);
    const deleted = [];
    for (const rel of resolveFootprint(manifest, name, o.provider)) {
      const abs = join(process.cwd(), rel);
      if (existsSync(abs)) { rmSync(abs, { recursive: true, force: true }); deleted.push(rel); }
    }
    rmdirEmptyParents(pdir);
    succeed({ deleted });
  },

  cat(args) {
    const set = args.positional[0];
    const file = args.flags.file;
    if (!set || typeof file !== 'string') {
      emit({ ok: false, code: 'bad-args', error: 'usage: cat <set> --file <relpath> [--provider p] [--lang l]' });
      process.exit(1);
    }
    const o = opts(args);
    const { pdir } = pdirAndKinds(o);
    const manifest = loadFixturesManifest();
    const base = join(fixturesDir(), 'sets', set);
    const langDir = existsSync(join(base, o.lang)) ? o.lang : (manifest.defaultLang ?? 'en');
    // Accept a resolved path (`.claude/...`) or token form; normalise to token.
    const tokenForm = file.startsWith(`${pdir}/`) ? PROVIDER_TOKEN + file.slice(pdir.length) : file;
    // Prefer the per-provider overlay (so codex / agent-skills get their own
    // shape, e.g. the publish skill or the TOML agent) before the base.
    const oKey = overlayKey(o.provider);
    const found = [
      join(base, 'providers', oKey, langDir, tokenForm),
      join(base, 'providers', oKey, 'shared', tokenForm),
      join(base, langDir, tokenForm),
      join(base, 'shared', tokenForm),
    ].find((c) => existsSync(c));
    if (!found) {
      emit({ ok: false, code: 'not-found', error: `file '${file}' not found in set '${set}'.` });
      process.exit(1);
    }
    process.stdout.write(readFileSync(found, 'utf8'));
    process.exit(0);
  },
};

function rmdirEmptyParents(pdir) {
  const candidates = ['notes', 'docs', 'public', `${pdir}/agents`, `${pdir}/skills`, `${pdir}/commands`, pdir];
  for (const rel of candidates) {
    try { rmdirSync(join(process.cwd(), rel)); } catch { /* not empty or missing */ }
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
