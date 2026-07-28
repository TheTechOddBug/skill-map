#!/usr/bin/env node
/**
 * Generates the performance fixture: a synthetic Claude Code project with
 * N markdown nodes (default 1000) wired to each other through real,
 * resolvable references, so a scan over it exercises the whole pipeline at
 * scale (walker, frontmatter parser, extractors, link resolver, analyzers,
 * persistence) instead of just "many files on disk".
 *
 * Why generated and not committed: 1000 files would drown every `git log`,
 * diff, and grep in the repo for zero review value. `fixtures/perf/` is
 * gitignored and rebuilt on demand; the generator IS the source of truth.
 *
 * Deterministic by construction: a seeded PRNG (mulberry32) picks every
 * reference, so the same `--seed` + `--count` always produce byte-identical
 * output and two runs are comparable as a benchmark.
 *
 * Layout produced (default shape, `--count 1000`):
 *
 *     fixtures/perf/
 *       AGENTS.md                                     1  markdown
 *       README.md                                     1  markdown
 *       .mcp.json                                        3 virtual mcp nodes
 *       .skill-map/settings.json                         claude lens pinned
 *       .claude/skills/perf-skill-NNNN/SKILL.md     300  skill
 *       .claude/agents/perf-agent-NNNN.md           200  agent
 *       .claude/commands/perf-cmd-NNNN.md           242  command
 *       docs/bucket-NN/perf-doc-NNNN.md             256  markdown
 *                                                  ----
 *                                                  1000  .md files
 *
 * Usage:
 *   node scripts/gen-perf-fixture.js                     # 1000 files, fresh
 *   node scripts/gen-perf-fixture.js --count 5000        # bigger tree
 *   node scripts/gen-perf-fixture.js --refs 8            # denser graph
 *   node scripts/gen-perf-fixture.js --if-missing        # no-op if present
 *   node scripts/gen-perf-fixture.js --out fixtures/perf-xl
 *
 * Safety: a regenerate wipes the output directory only when it carries the
 * generator's own marker file (`.perf-fixture`). Any other directory is
 * refused, so a typo'd `--out` can never delete real work.
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Marker written at the fixture root; gates the destructive rebuild. */
const MARKER = '.perf-fixture';

/** How many doc buckets the `docs/` tree is split into (directory fan-out). */
const DOC_BUCKETS = 10;

/**
 * Share of the total file count per kind; docs absorb the remainder. The
 * command share is tuned so the DEFAULT shape (`--count 1000`) leaves
 * `docs/` at exactly 256 files, the design-default render cap
 * (`scan.maxNodes`): scoping the map to `docs/` fills it to the brim
 * with zero truncation, the exact cap boundary in one click.
 */
const MIX = { skill: 0.3, agent: 0.2, command: 0.242 };

/** MCP servers declared in `.mcp.json`, referenced from a few frontmatters. */
const MCP_SERVERS = ['perf-index', 'perf-store', 'perf-search'];

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    count: 1000,
    refs: 4,
    seed: 42,
    out: 'fixtures/perf',
    ifMissing: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--count': opts.count = Number(next()); break;
      case '--refs': opts.refs = Number(next()); break;
      case '--seed': opts.seed = Number(next()); break;
      case '--out': opts.out = next(); break;
      case '--if-missing': opts.ifMissing = true; break;
      case '--help':
      case '-h':
        process.stdout.write(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (!Number.isInteger(opts.count) || opts.count < 20) {
    throw new Error('--count must be an integer >= 20');
  }
  if (!Number.isInteger(opts.refs) || opts.refs < 0) {
    throw new Error('--refs must be an integer >= 0');
  }
  return opts;
}

const HELP = `gen-perf-fixture, build the skill-map performance fixture

  --count <n>    total .md files to emit (default 1000, min 20)
  --refs <n>     outgoing references per node (default 4)
  --seed <n>     PRNG seed, same seed = identical tree (default 42)
  --out <dir>    output directory (default fixtures/perf)
  --if-missing   skip generation when the fixture already exists
  -h, --help     this text
`;

// ---------------------------------------------------------------------------
// deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32, tiny seeded PRNG. Same seed, same tree, every run. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(4, '0');

// ---------------------------------------------------------------------------
// prose filler
// ---------------------------------------------------------------------------

const SENTENCES = [
  'Keep the working set small; the walker pays for every byte it reads.',
  'Prefer an explicit handoff over an implicit one so the graph stays readable.',
  'Anything the runtime cannot resolve is noise for the operator.',
  'Record the outcome before moving on, a silent success is indistinguishable from a skip.',
  'Batch the reads, then do the work once the whole picture is in hand.',
  'A reference that resolves is worth ten that merely look plausible.',
  'Stop at the first ambiguity and surface it instead of guessing.',
  'The cheap fix today is the expensive one every time this area is touched again.',
  'Measure before optimising; the bottleneck is rarely where it feels.',
  'Leave the tree in a state the next pass can pick up without archaeology.',
];

function paragraph(rng, lines) {
  const out = [];
  for (let i = 0; i < lines; i += 1) {
    out.push(SENTENCES[Math.floor(rng() * SENTENCES.length)]);
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// node planning
// ---------------------------------------------------------------------------

/**
 * Plans every node up front (kind, id, path) so references can point both
 * backwards and forwards across the tree.
 */
function planNodes(count) {
  const skills = Math.round(count * MIX.skill);
  const agents = Math.round(count * MIX.agent);
  const commands = Math.round(count * MIX.command);
  const roots = 2; // AGENTS.md + CLAUDE.md
  const docs = count - skills - agents - commands - roots;
  if (docs < 1) {
    throw new Error(`--count ${count} is too small for the node mix`);
  }

  const nodes = [];
  // Deliberately NOT `CLAUDE.md`: a generated agent-instructions file inside
  // the repo gets picked up as real project context by any Claude Code
  // session that touches the fixture. `README.md` is the same markdown node
  // for the scanner, with none of the context pollution.
  nodes.push({ kind: 'root', id: 'AGENTS', path: 'AGENTS.md' });
  nodes.push({ kind: 'root', id: 'README', path: 'README.md' });

  for (let i = 1; i <= skills; i += 1) {
    const id = `perf-skill-${pad(i)}`;
    nodes.push({ kind: 'skill', id, path: `.claude/skills/${id}/SKILL.md`, index: i });
  }
  for (let i = 1; i <= agents; i += 1) {
    const id = `perf-agent-${pad(i)}`;
    nodes.push({ kind: 'agent', id, path: `.claude/agents/${id}.md`, index: i });
  }
  for (let i = 1; i <= commands; i += 1) {
    const id = `perf-cmd-${pad(i)}`;
    nodes.push({ kind: 'command', id, path: `.claude/commands/${id}.md`, index: i });
  }
  for (let i = 1; i <= docs; i += 1) {
    const id = `perf-doc-${pad(i)}`;
    const bucket = String(i % DOC_BUCKETS).padStart(2, '0');
    nodes.push({ kind: 'doc', id, path: `docs/bucket-${bucket}/${id}.md`, index: i });
  }
  return nodes;
}

/** POSIX-style relative link from one node's file to another's. */
function linkBetween(fromPath, toPath) {
  const rel = relative(dirname(fromPath), toPath).split('\\').join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Renders one reference to `target` as the invocation flavour that node kind
 * actually answers to: `@name` for agents, `/name` for commands and skills,
 * a relative markdown link for plain docs.
 */
function renderRef(from, target) {
  switch (target.kind) {
    case 'agent':
      return `Hand the heavy lifting to @${target.id}.`;
    case 'command':
      return `Run /${target.id} once the checks are green.`;
    case 'skill':
      return `Apply /${target.id} to the collected batch.`;
    default:
      return `Read the [${target.id} notes](${linkBetween(from.path, target.path)}) first.`;
  }
}

/** Picks `n` distinct reference targets for `node`, deterministically. */
function pickTargets(rng, nodes, node, n) {
  const picked = [];
  const seen = new Set([node.path]);
  let guard = 0;
  while (picked.length < n && guard < n * 20) {
    guard += 1;
    const candidate = nodes[Math.floor(rng() * nodes.length)];
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    picked.push(candidate);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// body rendering
// ---------------------------------------------------------------------------

const TOOL_POOL = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

function frontmatterFor(node, rng) {
  const lines = ['---', `name: ${node.id}`];
  lines.push('description: |');
  lines.push(`  Synthetic ${node.kind} ${node.index ?? ''}`.trimEnd() + ' from the skill-map performance');
  lines.push('  fixture. Exists to give the scanner a realistic node with frontmatter,');
  lines.push('  prose, and outgoing references.');

  if (node.kind === 'agent') {
    const tools = TOOL_POOL.filter(() => rng() < 0.5);
    if (tools.length === 0) tools.push('Read');
    // A slice of the agents also reach an MCP server, which materialises the
    // virtual `mcp://` nodes through the core/mcp-tools extractor.
    if (node.index % 20 === 0) {
      const server = MCP_SERVERS[node.index % MCP_SERVERS.length];
      tools.push(`mcp__${server}__query`);
    }
    lines.push(`tools: [${tools.join(', ')}]`);
    lines.push(`model: ${node.index % 3 === 0 ? 'opus' : 'sonnet'}`);
  }
  if (node.kind === 'skill' && node.index % 25 === 0) {
    const server = MCP_SERVERS[node.index % MCP_SERVERS.length];
    lines.push(`allowed-tools: [Read, Grep, mcp__${server}__search]`);
  }
  lines.push('---');
  return lines.join('\n');
}

function renderNode(node, refs, rng) {
  const heading = node.kind === 'root' ? node.id : node.id;
  const parts = [
    frontmatterFor(node, rng),
    '',
    `# ${heading}`,
    '',
    paragraph(rng, 2),
    '',
    '## Steps',
    '',
    ...refs.map((ref, i) => `${i + 1}. ${ref}`),
    `${refs.length + 1}. Report the outcome and stop.`,
    '',
    '## Notes',
    '',
    paragraph(rng, 4),
    '',
    paragraph(rng, 3),
    '',
  ];
  return parts.join('\n');
}

function renderRootDoc(id, refs, rng) {
  return [
    `# ${id}`,
    '',
    paragraph(rng, 3),
    '',
    '## Entry points',
    '',
    ...refs.map((ref) => `- ${ref}`),
    '',
    paragraph(rng, 2),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = resolve(REPO_ROOT, opts.out);

  if (existsSync(outDir)) {
    if (opts.ifMissing) {
      process.stdout.write(`perf fixture already present at ${opts.out}, skipping\n`);
      return;
    }
    if (!existsSync(join(outDir, MARKER))) {
      throw new Error(
        `refusing to wipe ${opts.out}: no ${MARKER} marker, it was not created by this generator`,
      );
    }
    rmSync(outDir, { recursive: true, force: true });
  }

  const rng = makeRng(opts.seed);
  const nodes = planNodes(opts.count);
  const started = process.hrtime.bigint();

  let bytes = 0;
  const write = (relPath, content) => {
    const abs = join(outDir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    bytes += Buffer.byteLength(content, 'utf8');
  };

  for (const node of nodes) {
    const targets = pickTargets(rng, nodes, node, opts.refs);
    const refs = targets.map((t) => renderRef(node, t));
    const body = node.kind === 'root'
      ? renderRootDoc(node.id, refs, rng)
      : renderNode(node, refs, rng);
    write(node.path, body);
  }

  // Fixture chrome: the lens is pinned so a scan never has to prompt, and the
  // MCP config gives the run a few virtual nodes on top of the file nodes.
  write('.skill-map/settings.json', `${JSON.stringify({
    activeProvider: 'claude',
    activeProviderMarkers: ['claude'],
  }, null, 2)}\n`);
  write('.mcp.json', `${JSON.stringify({
    mcpServers: Object.fromEntries(MCP_SERVERS.map((name) => [
      name,
      { command: 'node', args: [`./servers/${name}.js`] },
    ])),
  }, null, 2)}\n`);
  write(MARKER, `generated by scripts/gen-perf-fixture.js, seed ${opts.seed}, count ${opts.count}\n`);

  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const counts = nodes.reduce((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});
  const mix = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
  process.stdout.write(
    `perf fixture written to ${opts.out}\n`
    + `  ${opts.count} markdown files (${mix}), ${opts.refs} refs each\n`
    + `  ${(bytes / 1024 / 1024).toFixed(2)} MiB in ${ms.toFixed(0)}ms (seed ${opts.seed})\n`,
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`gen-perf-fixture: ${err.message}\n`);
  process.exit(1);
}
