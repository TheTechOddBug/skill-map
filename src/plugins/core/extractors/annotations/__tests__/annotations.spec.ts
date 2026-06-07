import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { annotationsExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Node, Signal } from '../../../../../kernel/types.js';

function mockNode(path: string, sidecar: ISidecarOverlay | null): Node {
  return {
    path,
    kind: 'agent',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: {},
    sidecar,
  };
}

function makeContext(node: Node): { ctx: IExtractorContext; signals: Signal[] } {
  const signals: Signal[] = [];
  const virtualNodes: IEmittedNode[] = [];
  const ctx: IExtractorContext = {
    node,
    body: '',
    frontmatter: node.frontmatter ?? {},
    settings: {},
    emitLink: () => undefined,
    enrichNode: () => undefined,
    emitContribution: () => undefined,
    emitSignal: (s) => signals.push(s),
    emitNode: (n) => virtualNodes.push(n),
  };
  return { ctx, signals };
}

function run(sidecar: ISidecarOverlay | null): { signals: Signal[] } {
  const helper = makeContext(mockNode('docs/old.md', sidecar));
  annotationsExtractor.extract(helper.ctx);
  return helper;
}

describe('annotations extractor', () => {
  it('emits a supersedes signal for each supersedes entry', () => {
    const { signals } = run({ present: true, annotations: { supersedes: ['a.md', 'b.md'] } });
    strictEqual(signals.length, 2);
    for (const s of signals) {
      strictEqual(s.scope, 'sidecar');
      strictEqual(s.source, 'docs/old.md');
      strictEqual(s.candidates[0]!.kind, 'supersedes');
      strictEqual(s.candidates[0]!.confidence, 1);
    }
    deepStrictEqual(signals.map((s) => s.candidates[0]!.target).sort(), ['a.md', 'b.md']);
    deepStrictEqual(signals[0]!.fieldPath, ['annotations', 'supersedes', '0']);
  });

  it('emits an inverse supersedes signal for supersededBy (new node supersedes this one)', () => {
    const { signals } = run({ present: true, annotations: { supersededBy: 'new.md' } });
    strictEqual(signals.length, 1);
    const s = signals[0]!;
    strictEqual(s.source, 'new.md');
    strictEqual(s.candidates[0]!.target, 'docs/old.md');
    deepStrictEqual(s.fieldPath, ['annotations', 'supersededBy']);
  });

  it('deduplicates a target listed twice', () => {
    const { signals } = run({ present: true, annotations: { supersedes: ['dup.md', 'dup.md'] } });
    strictEqual(signals.length, 1);
  });

  it('ignores non-string and empty entries in supersedes', () => {
    const { signals } = run({ present: true, annotations: { supersedes: ['ok.md', 42, null, ''] } });
    strictEqual(signals.length, 1);
    strictEqual(signals[0]!.candidates[0]!.target, 'ok.md');
  });

  it('is silent when the sidecar is absent', () => {
    strictEqual(run(null).signals.length, 0);
  });

  it('is silent when the sidecar is present but has no annotations block', () => {
    strictEqual(run({ present: true }).signals.length, 0);
  });
});
