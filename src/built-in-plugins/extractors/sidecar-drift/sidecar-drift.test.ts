import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { sidecarDriftExtractor } from './index.js';
import { SIDECAR_DRIFT_TEXTS } from '../../i18n/sidecar-drift.texts.js';
import type { IExtractorContext } from '../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Node, SidecarStatus } from '../../../kernel/types.js';

function mockNode(sidecar: ISidecarOverlay | undefined): Node {
  const node: Node = {
    path: 'notes/x.md',
    kind: 'markdown',
    provider: 'core-markdown',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
  if (sidecar) node.sidecar = sidecar;
  return node;
}

function ctx(sidecar: ISidecarOverlay | undefined): {
  ctx: IExtractorContext;
  contributions: { id: string; payload: unknown }[];
} {
  const contributions: { id: string; payload: unknown }[] = [];
  return {
    ctx: {
      node: mockNode(sidecar),
      body: '',
      frontmatter: {},
      emitLink: () => undefined,
      enrichNode: () => undefined,
      emitContribution: (id, payload) => contributions.push({ id, payload }),
    },
    contributions,
  };
}

function sidecar(status: SidecarStatus | null | undefined): ISidecarOverlay {
  return { present: true, status: status ?? null };
}

describe('sidecar-drift extractor', () => {
  it('emits nothing when the node carries no sidecar overlay', async () => {
    const { ctx: c, contributions } = ctx(undefined);
    await sidecarDriftExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('emits nothing when the sidecar overlay is marked absent', async () => {
    const { ctx: c, contributions } = ctx({ present: false });
    await sidecarDriftExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('emits nothing when status is fresh', async () => {
    const { ctx: c, contributions } = ctx(sidecar('fresh'));
    await sidecarDriftExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('emits nothing when status is missing (null)', async () => {
    const { ctx: c, contributions } = ctx(sidecar(null));
    await sidecarDriftExtractor.extract(c);
    strictEqual(contributions.length, 0);
  });

  it('emits warn + body tooltip on stale-body, no count', async () => {
    const { ctx: c, contributions } = ctx(sidecar('stale-body'));
    await sidecarDriftExtractor.extract(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0], {
      id: 'drift',
      payload: {
        icon: 'sync',
        severity: 'warn',
        tooltip: SIDECAR_DRIFT_TEXTS.staleBody,
      },
    });
  });

  it('emits warn + frontmatter tooltip on stale-frontmatter, no count', async () => {
    const { ctx: c, contributions } = ctx(sidecar('stale-frontmatter'));
    await sidecarDriftExtractor.extract(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0], {
      id: 'drift',
      payload: {
        icon: 'sync',
        severity: 'warn',
        tooltip: SIDECAR_DRIFT_TEXTS.staleFrontmatter,
      },
    });
  });

  it('emits warn + both tooltip + count=2 on stale-both', async () => {
    const { ctx: c, contributions } = ctx(sidecar('stale-both'));
    await sidecarDriftExtractor.extract(c);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0], {
      id: 'drift',
      payload: {
        icon: 'sync',
        severity: 'warn',
        tooltip: SIDECAR_DRIFT_TEXTS.staleBoth,
        count: 2,
      },
    });
  });

  it('declares graph.node.alert contribution with sync icon', () => {
    deepStrictEqual(sidecarDriftExtractor.viewContributions, {
      drift: {
        slot: 'graph.node.alert',
        icon: 'sync',
        emitWhenEmpty: false,
      },
    });
  });
});
