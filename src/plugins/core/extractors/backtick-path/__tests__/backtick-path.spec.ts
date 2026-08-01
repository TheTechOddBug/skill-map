import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { backtickPathExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import { resolveSignals } from '../../../../../kernel/orchestrator/resolver.js';
import type { Link, Node, Signal } from '../../../../../kernel/types.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'skill',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: {},
  };
}

function makeContext(node: Node, body: string): {
  ctx: IExtractorContext;
  links: Link[];
  signals: Signal[];
  virtualNodes: IEmittedNode[];
} {
  const links: Link[] = [];
  const signals: Signal[] = [];
  const virtualNodes: IEmittedNode[] = [];
  const ctx: IExtractorContext = {
    log: SILENT_EXTENSION_LOGGER,
    node,
    body,
    frontmatter: node.frontmatter ?? {},
    settings: {},
    emitLink: (link) => links.push(link),
    enrichNode: () => undefined,
    emitContribution: () => undefined,
    emitSignal: (s) => signals.push(s),
    emitNode: (n) => virtualNodes.push(n),
  };
  return { ctx, links, signals, virtualNodes };
}

/**
 * Run the extractor and flush its Signals through the kernel resolver so
 * tests assert on the merged `links` array, mirroring the real scan path.
 * Confidence stays at the emit value (0.85) here; the path-match lift to
 * 1.0 is a post-walk transform covered by the scan e2e + conformance case.
 */
async function runAndResolve(helper: ReturnType<typeof makeContext>): Promise<void> {
  await backtickPathExtractor.extract(helper.ctx);
  if (helper.signals.length === 0) return;
  const resolved = resolveSignals({
    signals: helper.signals,
    activeProvider: null,
    extractorOrder: ['backtick-path'],
  });
  for (const link of resolved.links) helper.links.push(link);
}

describe('backtick-path extractor', () => {
  it('emits a points link for a .md path inside an inline span, resolved against the source dir', async () => {
    const helper = makeContext(
      mockNode('skills/demo/SKILL.md'),
      'Read `references/rules.md` before doing anything else.',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.source, 'skills/demo/SKILL.md');
    strictEqual(link.target, 'skills/demo/references/rules.md');
    strictEqual(link.kind, 'points');
    strictEqual(link.confidence, 0.85);
    strictEqual(link.sources[0], 'backtick-path');
  });

  it('emits three links from a single inline span carrying three paths', async () => {
    const helper = makeContext(
      mockNode('skills/demo/SKILL.md'),
      'One span: `cat refs/a.md refs/b.md > refs/c.md` done.',
    );
    await runAndResolve(helper);
    const targets = helper.links.map((l) => l.target).sort();
    strictEqual(helper.links.length, 3);
    strictEqual(targets[0], 'skills/demo/refs/a.md');
    strictEqual(targets[1], 'skills/demo/refs/b.md');
    strictEqual(targets[2], 'skills/demo/refs/c.md');
  });

  it('emits links from a multi-line fenced block', async () => {
    const body = ['Setup:', '```bash', 'cat refs/a.md', 'diff refs/b.md refs/c.md', '```'].join('\n');
    const helper = makeContext(mockNode('skills/demo/SKILL.md'), body);
    await runAndResolve(helper);
    strictEqual(helper.links.length, 3);
  });

  it('ignores .md paths in prose outside code regions (markdown-link territory)', async () => {
    const body = 'A bare refs/a.md path and a [linked](./refs/b.md) one, no backticks.';
    const helper = makeContext(mockNode('skills/demo/SKILL.md'), body);
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('resolves ./ and ../ prefixes like markdown-link', async () => {
    const helper = makeContext(
      mockNode('docs/guide/index.md'),
      'See `../README.md` and `./local.md` for context.',
    );
    await runAndResolve(helper);
    const targets = helper.links.map((l) => l.target).sort();
    strictEqual(helper.links.length, 2);
    strictEqual(targets[0], 'docs/README.md');
    strictEqual(targets[1], 'docs/guide/local.md');
  });

  it('resolves a REPEATED ../ prefix, the .claude/agents shape', async () => {
    // Live-reported. The prefix was capped at one level, so this exact
    // token, which is what a file under `.claude/agents/` needs to reach
    // the rest of the repo, matched at NO start position: the second
    // `../` falls outside the prefix group and the lookbehind refuses a
    // later start because the preceding char is always `/` or `.`.
    //
    // The failure mode is what made it worth fixing rather than
    // documenting: no link AND no `reference-broken`, so the reference
    // was indistinguishable from one the author never wrote. A broken
    // link at least tells you where to look.
    const helper = makeContext(
      mockNode('.claude/agents/react.md'),
      'Visual rules live in `../../ui/context/theme.md`, read it first.',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'ui/context/theme.md');
  });

  it('accepts a mixed ./../ prefix, matching the @-token grammar', async () => {
    // Odd but legal, and `AT_TOKEN_RE` accepts it. The two grammars are
    // pinned to the same prefix construct precisely because divergence
    // between them is what let this bug live in one and not the other.
    const helper = makeContext(mockNode('docs/guide/index.md'), 'See `./../mix.md`.');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'docs/mix.md');
  });

  it('resolves three or more ../ levels', async () => {
    const helper = makeContext(
      mockNode('a/b/c/d/deep.md'),
      'See `../../../top.md` for the root rules.',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'a/top.md');
  });

  it('keeps a repeated ../ prefix verbatim on originalTrigger (intent bit)', async () => {
    // Same contract as the `./` case below: the post-walk lift reads the
    // authored token to decide the author declared file-relative intent,
    // and `../../` must not silently become a root-fallback candidate.
    const helper = makeContext(mockNode('.claude/agents/react.md'), 'See `../../ui/theme.md`.');
    await runAndResolve(helper);
    strictEqual(helper.links[0]!.trigger?.originalTrigger, '../../ui/theme.md');
  });

  it('keeps the ./ prefix verbatim on originalTrigger (the root-fallback intent bit)', async () => {
    // The post-walk lift reads `originalTrigger` to decide whether the
    // author declared file-relative intent (`./` / `../` never fall
    // back to the scan root); the prefix must survive normalisation.
    const helper = makeContext(mockNode('docs/guide/index.md'), 'See `./local.md`.');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.trigger?.originalTrigger, './local.md');
  });

  it('emits a points link for a BARE sibling filename (no slash): the runtime follows it', async () => {
    // `lee el archivo: ` + "`algo4.md`" is an instruction the runtime
    // resolves against the skill dir (verified empirically, every tested
    // model read the bare-referenced file), so the graph models the edge.
    const helper = makeContext(
      mockNode('skills/demo/SKILL.md'),
      'lee el archivo: `algo4.md` y devolve el codigo.',
    );
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    const link = helper.links[0]!;
    strictEqual(link.target, 'skills/demo/algo4.md');
    strictEqual(link.kind, 'points');
    strictEqual(link.confidence, 0.85);
  });

  it('captures a bare convention filename (`SKILL.md`); the self-ref surfaces downstream as a self-loop', async () => {
    // Slashless convention names now match (the runtime follows them).
    // A `SKILL.md` in a skill body resolves to the node's own sibling;
    // the extractor emits unconditionally, `core/link-self-loop` is the
    // one that excludes the self-edge from card chips downstream.
    const helper = makeContext(mockNode('skills/demo/SKILL.md'), 'ver `SKILL.md` para el formato.');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'skills/demo/SKILL.md');
  });

  it('bait suite emits nothing: placeholder, glob, URL, near-miss suffixes, absolute', async () => {
    const body = [
      'Placeholder: `context/tech/{PROJECT}-technical.md`',
      'Glob: `context/use-cases/*-S.md`',
      'URL: `https://example.com/docs/page.md`',
      'Var suffix: `const x = ref/b.md_var`',
      'Near miss: `5/3.mdx`',
      'Absolute: `/abs/x.md`',
      'Bare extension word: `formato .md solo`',
      // Guards the widened prefix: `(\.\.\/)+` must not start matching
      // dot runs that are not a chain of `../` segments.
      'Dot run: `....//x.md`',
      'Lone dots: `.../y.md`',
    ].join('\n');
    const helper = makeContext(mockNode('skills/demo/SKILL.md'), body);
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });

  it('deduplicates the same resolved target across span and fence, first occurrence wins', async () => {
    const body = ['Read `refs/a.md` then run:', '```', 'cat refs/a.md', '```'].join('\n');
    const helper = makeContext(mockNode('skills/demo/SKILL.md'), body);
    await runAndResolve(helper);
    strictEqual(helper.links.length, 1);
    strictEqual(helper.links[0]!.target, 'skills/demo/refs/a.md');
  });

  it('range and line point into the ORIGINAL body (mask preserves offsets)', async () => {
    const body = ['Intro.', '```bash', 'cat refs/a.md', '```', 'Read `refs/b.md` now.'].join('\n');
    const helper = makeContext(mockNode('skills/demo/SKILL.md'), body);
    await runAndResolve(helper);
    strictEqual(helper.signals.length, 2);
    const [first, second] = helper.signals;
    strictEqual(body.slice(first!.range!.start, first!.range!.end), 'refs/a.md');
    strictEqual(first!.range!.line, 3);
    strictEqual(body.slice(second!.range!.start, second!.range!.end), 'refs/b.md');
    strictEqual(second!.range!.line, 5);
  });

  it('candidate carries kind points, confidence 0.85, normalizedTrigger = resolved target', async () => {
    const helper = makeContext(mockNode('skills/demo/SKILL.md'), 'Read `refs/a.md` now.');
    await runAndResolve(helper);
    strictEqual(helper.signals.length, 1);
    const candidate = helper.signals[0]!.candidates[0]!;
    strictEqual(candidate.extractorId, 'backtick-path');
    strictEqual(candidate.kind, 'points');
    strictEqual(candidate.confidence, 0.85);
    strictEqual(candidate.trigger!.originalTrigger, 'refs/a.md');
    strictEqual(candidate.trigger!.normalizedTrigger, 'skills/demo/refs/a.md');
    ok(helper.signals[0]!.raw.includes('refs/a.md'));
  });

  it('is silent on a body with no code regions', async () => {
    const helper = makeContext(mockNode('skills/demo/SKILL.md'), 'plain prose, no code spans here');
    await runAndResolve(helper);
    strictEqual(helper.links.length, 0);
    strictEqual(helper.signals.length, 0);
  });
});
