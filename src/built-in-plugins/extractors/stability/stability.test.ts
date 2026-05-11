import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { stabilityExtractor } from './index.js';
import type { IExtractorContext } from '../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Node } from '../../../kernel/types.js';

function mockNode(path: string, sidecar?: ISidecarOverlay | null): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...(sidecar !== undefined ? { sidecar } : {}),
  };
}

function withAnnotations(annotations: Record<string, unknown>): ISidecarOverlay {
  return { present: true, status: 'fresh', annotations, root: { annotations } };
}

function ctx(
  frontmatter: Record<string, unknown>,
  sidecar?: ISidecarOverlay | null,
): { ctx: IExtractorContext; contributions: { id: string; payload: unknown }[] } {
  const contributions: { id: string; payload: unknown }[] = [];
  return {
    ctx: {
      node: mockNode('notes/x.md', sidecar),
      body: '',
      frontmatter,
      emitLink: () => undefined,
      enrichNode: () => undefined,
      emitContribution: (id, payload) => contributions.push({ id, payload }),
    },
    contributions,
  };
}

describe('stability extractor', () => {
  it('emits an experimental chip when sidecar annotations.stability is experimental', async () => {
    const { ctx: c, contributions } = ctx({}, withAnnotations({ stability: 'experimental' }));
    await stabilityExtractor.extract(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0], {
      id: 'experimental',
      payload: { value: 0, tooltip: 'Experimental — API may change' },
    });
  });

  it('emits a deprecated chip with warn severity when sidecar annotations.stability is deprecated', async () => {
    const { ctx: c, contributions } = ctx({}, withAnnotations({ stability: 'deprecated' }));
    await stabilityExtractor.extract(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0], {
      id: 'deprecated',
      payload: { value: 0, tooltip: 'Deprecated — avoid in new code', severity: 'warn' },
    });
  });

  it('emits nothing when sidecar annotations.stability is stable', async () => {
    const { ctx: c, contributions } = ctx({}, withAnnotations({ stability: 'stable' }));
    await stabilityExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('emits nothing when no sidecar and no legacy metadata', async () => {
    const { ctx: c, contributions } = ctx({ name: 'something' });
    await stabilityExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('falls back to legacy frontmatter metadata.stability when sidecar is absent', async () => {
    const { ctx: c, contributions } = ctx({ metadata: { stability: 'experimental' } });
    await stabilityExtractor.extract(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]?.id, 'experimental');
  });

  it('prefers sidecar annotations over legacy frontmatter metadata when both present', async () => {
    const { ctx: c, contributions } = ctx(
      { metadata: { stability: 'deprecated' } },
      withAnnotations({ stability: 'experimental' }),
    );
    await stabilityExtractor.extract(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]?.id, 'experimental');
  });

  it('emits nothing when sidecar is present but annotations.stability is missing', async () => {
    const { ctx: c, contributions } = ctx({}, withAnnotations({ version: 2 }));
    await stabilityExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('ignores unrecognised stability values from either source', async () => {
    const { ctx: c, contributions } = ctx({ metadata: { stability: 'beta' } });
    await stabilityExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('declares both viewContributions on card.footer.right with the expected icons', () => {
    deepStrictEqual(stabilityExtractor.viewContributions, {
      experimental: {
        slot: 'card.footer.right',
        icon: 'pi-bolt',
        label: 'experimental',
        emitWhenEmpty: false,
      },
      deprecated: {
        slot: 'card.footer.right',
        icon: 'pi-ban',
        label: 'deprecated',
        emitWhenEmpty: false,
      },
    });
  });

  it('emits no links', () => {
    deepStrictEqual(stabilityExtractor.emitsLinkKinds, []);
  });
});
