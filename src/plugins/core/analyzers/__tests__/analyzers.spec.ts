import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { triggerCollisionAnalyzer } from '../trigger-collision/index.js';
import { nodeSupersededAnalyzer } from '../node-superseded/index.js';
import { linkConflictAnalyzer } from '../link-conflict/index.js';
import type { Confidence, Issue, Link, LinkKind, Node, NodeKind } from '../../../../kernel/types.js';

function mockNode(
  path: string,
  name?: string,
  annotations: Record<string, unknown> = {},
  kind: NodeKind = 'markdown',
): Node {
  return {
    path,
    kind,
    provider: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: { name },
    sidecar: {
      present: true,
      status: 'fresh',
      annotations: Object.keys(annotations).length === 0 ? null : annotations,
      root: { annotations },
    },
  };
}

function invocation(source: string, target: string, normalized: string, kind: 'invokes' | 'mentions' = 'invokes'): Link {
  return {
    source,
    target,
    kind,
    confidence: 0.6,
    sources: ['slash'],
    trigger: { originalTrigger: target, normalizedTrigger: normalized },
  };
}

// Rules' evaluate() returns Issue[] | Promise<Issue[]>. Await resolves both
// shapes uniformly and keeps each test's assertions typed as Issue[].
async function run(rule: typeof triggerCollisionAnalyzer, ctx: { nodes: Node[]; links: Link[] }): Promise<Issue[]> {
  return await rule.evaluate({ ...ctx, settings: {}, emitContribution: noopEmitContribution });
}

/** Stub for tests that don't exercise the contribution emit channel. */
function noopEmitContribution(): void {
  // no-op
}

describe('trigger-collision rule', () => {
  it('emits nothing when every trigger is distinct', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/rollback', '/rollback'),
    ];
    const issues = await run(triggerCollisionAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('flags two distinct targets sharing a trigger', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/Deploy', '/deploy'), // same normalized, different original/target
    ];
    const issues = await run(triggerCollisionAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    strictEqual(issues[0]?.analyzerId, 'trigger-collision');
    ok(issues[0]?.message.includes('/deploy'));
  });

  it('ignores duplicates where multiple links point to the same target', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/deploy', '/deploy'),
    ];
    const issues = await run(triggerCollisionAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('skips links without a trigger block', async () => {
    const links: Link[] = [
      { source: 'a.md', target: 'b.md', kind: 'references', confidence: 0.9, sources: ['annotations'] },
    ];
    const issues = await run(triggerCollisionAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('flags two advertisers of the same name (no invocations)', async () => {
    // Canonical example from the rule's doc: two commands declaring
    // `name: deploy` from different files compete for `/deploy`. Before
    // the Step 4.9 fix this slipped silently because the rule only
    // looked at links.
    const nodes = [
      mockNode('.claude/commands/deploy.md', 'deploy', {}, 'command'),
      mockNode('.claude/commands/deploy-v2.md', 'deploy', {}, 'command'),
    ];
    const issues = await run(triggerCollisionAnalyzer, { nodes, links: [] });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    strictEqual(issues[0]?.analyzerId, 'trigger-collision');
    ok(issues[0]?.message.includes('/deploy'));
    ok(issues[0]?.message.includes('.claude/commands/deploy.md'));
    ok(issues[0]?.message.includes('.claude/commands/deploy-v2.md'));
    const data = issues[0]!.data as { advertiserPaths: string[]; invocationTargets: string[] };
    strictEqual(data.advertiserPaths.length, 2);
    strictEqual(data.invocationTargets.length, 0);
    // Both advertising node paths show up in nodeIds.
    ok(issues[0]!.nodeIds.includes('.claude/commands/deploy.md'));
    ok(issues[0]!.nodeIds.includes('.claude/commands/deploy-v2.md'));
  });

  it('mixes claim kinds: one advertiser + one different-cased invocation → collision', async () => {
    // The advertised path is `.claude/commands/deploy.md` (token A); the
    // invocation target is `/Deploy` (token B). Both normalize to
    // `/deploy`, two distinct claim tokens, rule fires.
    const nodes = [mockNode('.claude/commands/deploy.md', 'deploy', {}, 'command')];
    const links = [invocation('a.md', '/Deploy', '/deploy')];
    const issues = await run(triggerCollisionAnalyzer, { nodes, links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    const data = issues[0]!.data as { advertiserPaths: string[]; invocationTargets: string[] };
    ok(data.advertiserPaths.includes('.claude/commands/deploy.md'));
    ok(data.invocationTargets.includes('/Deploy'));
  });

  it('does not fire when one advertiser is invoked by its canonical form', async () => {
    // `name: deploy` advertised + `/deploy` invoked is the normal flow:
    // the invocation's raw target equals the bucket-key (the normalized
    // trigger), so it's the canonical form of the advertised name.
    // Same logical claim, no ambiguity, no issue.
    const nodes = [mockNode('.claude/commands/deploy.md', 'deploy', {}, 'command')];
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/deploy', '/deploy'),
      invocation('c.md', '/deploy', '/deploy'),
    ];
    const issues = await run(triggerCollisionAnalyzer, { nodes, links });
    strictEqual(issues.length, 0);
  });

  it('ignores frontmatter.name on non-advertising kinds (note)', async () => {
    // A `note` happening to carry `name: deploy` doesn't compete for
    // `/deploy`. Only `command`, `skill`, `agent` advertise.
    const nodes = [
      mockNode('a.md', 'deploy', {}, 'markdown'),
      mockNode('b.md', 'deploy', {}, 'markdown'),
    ];
    const issues = await run(triggerCollisionAnalyzer, { nodes, links: [] });
    strictEqual(issues.length, 0);
  });
});

describe('superseded rule', () => {
  it('emits info per node declaring supersededBy', async () => {
    const nodes = [
      mockNode('old.md', 'old', { supersededBy: 'new.md' }),
      mockNode('new.md', 'new'),
      mockNode('other.md', 'other'),
    ];
    const issues = await run(nodeSupersededAnalyzer, { nodes, links: [] });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.nodeIds[0], 'old.md');
    strictEqual(issues[0]?.severity, 'info');
    ok(issues[0]?.message.includes('new.md'));
  });

  it('ignores nodes with no sidecar annotations', async () => {
    const node = mockNode('a.md', 'a'); // no annotations supplied
    const issues = await run(nodeSupersededAnalyzer, { nodes: [node], links: [] });
    strictEqual(issues.length, 0);
  });

  it('ignores non-string supersededBy values', async () => {
    const nodes = [mockNode('a.md', 'a', { supersededBy: '' }), mockNode('b.md', 'b', { supersededBy: 42 })];
    const issues = await run(nodeSupersededAnalyzer, { nodes, links: [] });
    strictEqual(issues.length, 0);
  });
});

// ---------------------------------------------------------------------------
// link-conflict
// ---------------------------------------------------------------------------

function rawLink(
  source: string,
  target: string,
  kind: LinkKind,
  extractor: string,
  confidence: Confidence = 0.6,
): Link {
  return {
    source,
    target,
    kind,
    confidence,
    sources: [extractor],
  };
}

describe('link-conflict rule', () => {
  it('emits nothing for an empty graph', async () => {
    const issues = await run(linkConflictAnalyzer, { nodes: [], links: [] });
    strictEqual(issues.length, 0);
  });

  it('stays silent when only one extractor emits the pair', async () => {
    const links = [rawLink('a.md', 'b.md', 'invokes', 'slash')];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('stays silent when two extractors agree on kind (happy path)', async () => {
    const links = [
      rawLink('audit-flow', 'security-scanner', 'references', 'annotations'),
      rawLink('audit-flow', 'security-scanner', 'references', 'slash'),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0, 'agreement on kind must not emit findings');
  });

  it('emits one warn when extractors disagree on kind', async () => {
    const links = [
      rawLink('audit-flow', 'security-scanner', 'references', 'annotations'),
      rawLink('audit-flow', 'security-scanner', 'invokes', 'slash'),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 1);
    const issue = issues[0]!;
    strictEqual(issue.analyzerId, 'link-conflict');
    strictEqual(issue.severity, 'warn');
    strictEqual(issue.nodeIds.length, 2);
    strictEqual(issue.nodeIds[0], 'audit-flow');
    strictEqual(issue.nodeIds[1], 'security-scanner');
    // Compact finding grammar: the target leads the message; the
    // source is the finding's own node and never appears.
    ok(!issue.message.includes('audit-flow'));
    ok(issue.message.includes('security-scanner'));
    ok(issue.message.includes('invokes'));
    ok(issue.message.includes('references'));
    const data = issue.data as { variants: Array<{ kind: string; sources: string[] }> };
    strictEqual(data.variants.length, 2);
    // Variants are sorted alphabetically by kind for determinism.
    strictEqual(data.variants[0]!.kind, 'invokes');
    strictEqual(data.variants[0]!.sources[0], 'slash');
    strictEqual(data.variants[1]!.kind, 'references');
    strictEqual(data.variants[1]!.sources[0], 'annotations');
  });

  it('groups multiple sources of the same kind into one variant', async () => {
    // Three rows, two kinds. References has 2 extractors (annotations +
    // at-directive), invokes has 1 (slash). After grouping: 2 variants.
    const links = [
      rawLink('a.md', 'b.md', 'references', 'annotations'),
      rawLink('a.md', 'b.md', 'references', 'at-directive'),
      rawLink('a.md', 'b.md', 'invokes', 'slash'),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 1);
    const data = issues[0]!.data as { variants: Array<{ kind: string; sources: string[] }> };
    strictEqual(data.variants.length, 2);
    const refs = data.variants.find((v) => v.kind === 'references')!;
    // Sources are deduped, sorted, and unioned across rows of the same kind.
    strictEqual(refs.sources.length, 2);
    strictEqual(refs.sources[0], 'annotations');
    strictEqual(refs.sources[1], 'at-directive');
  });

  it('keeps the highest-confidence value across rows of the same kind', async () => {
    const links = [
      rawLink('a.md', 'b.md', 'references', 'annotations', 0.3),
      rawLink('a.md', 'b.md', 'references', 'slash', 0.9),
      rawLink('a.md', 'b.md', 'invokes', 'at-directive', 0.6),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 1);
    const data = issues[0]!.data as { variants: Array<{ kind: string; confidence: number }> };
    const refs = data.variants.find((v) => v.kind === 'references')!;
    strictEqual(refs.confidence, 0.9, 'highest confidence wins per variant');
  });

  it('emits one issue per disagreeing pair', async () => {
    const links = [
      rawLink('a.md', 'b.md', 'invokes', 'slash'),
      rawLink('a.md', 'b.md', 'references', 'annotations'),
      rawLink('c.md', 'd.md', 'invokes', 'slash'),
      rawLink('c.md', 'd.md', 'mentions', 'at-directive'),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 2);
    const pairs = issues.map((i) => i.nodeIds.join('->')).sort();
    strictEqual(pairs[0], 'a.md->b.md');
    strictEqual(pairs[1], 'c.md->d.md');
  });

  it('does not confuse pairs with shared source or target', async () => {
    // (a → b, invokes) and (a → c, references) share `a` but are different
    // pairs. No conflict.
    const links = [
      rawLink('a.md', 'b.md', 'invokes', 'slash'),
      rawLink('a.md', 'c.md', 'references', 'annotations'),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('stays silent for references + points on the same pair (compatible by design)', async () => {
    // Decision #127: a markdown link and a backticked path to the same
    // target are two complementary surfaces, not detector disagreement.
    const links = [
      rawLink('skill.md', 'refs/a.md', 'references', 'markdown-link'),
      rawLink('skill.md', 'refs/a.md', 'points', 'backtick-path'),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('a points row never appears as a variant of somebody else\'s dispute', async () => {
    // invokes vs references is still a real conflict; the points row on
    // the same pair stays invisible to the rule (2 variants, not 3).
    const links = [
      rawLink('a.md', 'b.md', 'invokes', 'slash'),
      rawLink('a.md', 'b.md', 'references', 'annotations'),
      rawLink('a.md', 'b.md', 'points', 'backtick-path'),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 1);
    const data = issues[0]!.data as { variants: Array<{ kind: string }> };
    strictEqual(data.variants.length, 2);
    ok(data.variants.every((v) => v.kind !== 'points'));
  });

  it('stays silent for two points rows on the same pair', async () => {
    const links = [
      rawLink('a.md', 'b.md', 'points', 'backtick-path'),
      rawLink('a.md', 'b.md', 'points', 'backtick-path'),
    ];
    const issues = await run(linkConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });
});
