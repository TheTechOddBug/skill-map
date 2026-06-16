import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { nameCollisionAnalyzer } from '../name-collision/index.js';
import { linkKindConflictAnalyzer } from '../link-kind-conflict/index.js';
import type { Confidence, Issue, Link, LinkKind, Node } from '../../../../kernel/types.js';

// Rules' evaluate() returns Issue[] | Promise<Issue[]>. Await resolves both
// shapes uniformly and keeps each test's assertions typed as Issue[].
async function run(rule: typeof nameCollisionAnalyzer, ctx: { nodes: Node[]; links: Link[] }): Promise<Issue[]> {
  return await rule.evaluate({ ...ctx, settings: {}, emitContribution: noopEmitContribution });
}

/** Stub for tests that don't exercise the contribution emit channel. */
function noopEmitContribution(): void {
  // no-op
}

describe('name-collision rule', () => {
  // The analyzer is a pure projector of the orchestrator's precomputed
  // `ctx.nameCollisions` verdict. The kind-eligibility / normalization /
  // dedup logic lives in `collectNameCollisions` (covered in
  // node-identifiers.spec.ts), so these tests only assert the projection.
  type Claims = ReadonlyMap<string, readonly { path: string; kind: string }[]>;
  function runNameCollision(nameCollisions: Claims | undefined): Issue[] {
    const result = nameCollisionAnalyzer.evaluate({
      nodes: [],
      links: [],
      settings: {},
      emitContribution: noopEmitContribution,
      ...(nameCollisions ? { nameCollisions } : {}),
    } as unknown as Parameters<typeof nameCollisionAnalyzer.evaluate>[0]);
    return Array.isArray(result) ? result : [];
  }

  it('emits nothing when there are no name collisions', () => {
    strictEqual(runNameCollision(undefined).length, 0);
    strictEqual(runNameCollision(new Map()).length, 0);
  });

  it('flags one error per name claimed by two or more nodes', () => {
    const collisions: Claims = new Map([
      [
        'deploy',
        [
          { path: '.claude/commands/deploy.md', kind: 'command' },
          { path: '.claude/commands/deploy-v2.md', kind: 'command' },
        ],
      ],
    ]);
    const issues = runNameCollision(collisions);
    strictEqual(issues.length, 1);
    const issue = issues[0]!;
    strictEqual(issue.severity, 'error');
    strictEqual(issue.analyzerId, 'name-collision');
    // Subject is the bare normalised name, no `/` or `@` sigil (a sigil
    // would make the subject `` `/deploy` `` instead of `` `deploy` ``).
    ok(issue.message.startsWith('`deploy`:'));
    ok(issue.message.includes('.claude/commands/deploy.md'));
    ok(issue.message.includes('.claude/commands/deploy-v2.md'));
    strictEqual(issue.nodeIds.length, 2);
    ok(issue.nodeIds.includes('.claude/commands/deploy.md'));
    ok(issue.nodeIds.includes('.claude/commands/deploy-v2.md'));
    const data = issue.data as { name: string; claims: { path: string; kind: string }[] };
    strictEqual(data.name, 'deploy');
    strictEqual(data.claims.length, 2);
  });

  it('works across kinds (a command and an agent claiming one name)', () => {
    const collisions: Claims = new Map([
      [
        'reviewer',
        [
          { path: '.claude/agents/reviewer.md', kind: 'agent' },
          { path: '.claude/commands/reviewer.md', kind: 'command' },
        ],
      ],
    ]);
    const issues = runNameCollision(collisions);
    strictEqual(issues.length, 1);
    ok(issues[0]!.message.startsWith('`reviewer`:'));
  });
});

// ---------------------------------------------------------------------------
// link-kind-conflict
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

describe('link-kind-conflict rule', () => {
  it('emits nothing for an empty graph', async () => {
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links: [] });
    strictEqual(issues.length, 0);
  });

  it('stays silent when only one extractor emits the pair', async () => {
    const links = [rawLink('a.md', 'b.md', 'invokes', 'slash')];
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('stays silent when two extractors agree on kind (happy path)', async () => {
    const links = [
      rawLink('audit-flow', 'security-scanner', 'references', 'annotations'),
      rawLink('audit-flow', 'security-scanner', 'references', 'slash'),
    ];
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0, 'agreement on kind must not emit findings');
  });

  it('emits one warn when extractors disagree on kind', async () => {
    const links = [
      rawLink('audit-flow', 'security-scanner', 'references', 'annotations'),
      rawLink('audit-flow', 'security-scanner', 'invokes', 'slash'),
    ];
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 1);
    const issue = issues[0]!;
    strictEqual(issue.analyzerId, 'link-kind-conflict');
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
    // Remediation hint lives in `fix.summary`, not appended to message.
    ok(issue.fix?.summary?.includes('single kind'));
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
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
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
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
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
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
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
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('stays silent for references + points on the same pair (compatible by design)', async () => {
    // Decision #127: a markdown link and a backticked path to the same
    // target are two complementary surfaces, not detector disagreement.
    const links = [
      rawLink('skill.md', 'refs/a.md', 'references', 'markdown-link'),
      rawLink('skill.md', 'refs/a.md', 'points', 'backtick-path'),
    ];
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
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
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
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
    const issues = await run(linkKindConflictAnalyzer, { nodes: [], links });
    strictEqual(issues.length, 0);
  });
});
