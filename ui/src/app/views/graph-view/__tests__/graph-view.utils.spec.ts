import { describe, expect, it } from 'vitest';

import {
  isAnyPrimengOverlayOpen,
  isPoint,
  isStoredViewport,
  nodeHasTag,
} from '../graph-view.utils';
import type { INodeView } from '../../../../models/node';

function makeDocStub(matchedSelectors: ReadonlySet<string>): Document {
  return {
    querySelector(selector: string): Element | null {
      for (const sel of selector.split(',').map((s) => s.trim())) {
        if (matchedSelectors.has(sel)) return {} as Element;
      }
      return null;
    },
  } as unknown as Document;
}

describe('graph-view.utils — isAnyPrimengOverlayOpen', () => {
  it('returns false when no overlay selector matches', () => {
    expect(isAnyPrimengOverlayOpen(makeDocStub(new Set()))).toBe(false);
  });

  it('returns true for `.p-overlay-mask` (ConfirmDialog / Dialog scrim)', () => {
    expect(isAnyPrimengOverlayOpen(makeDocStub(new Set(['.p-overlay-mask'])))).toBe(true);
  });

  it('returns true for `.p-dialog` (non-modal dialog without mask)', () => {
    expect(isAnyPrimengOverlayOpen(makeDocStub(new Set(['.p-dialog'])))).toBe(true);
  });

  it('returns true for `.p-overlay` (OverlayPanel / Popover)', () => {
    expect(isAnyPrimengOverlayOpen(makeDocStub(new Set(['.p-overlay'])))).toBe(true);
  });
});

describe('graph-view.utils — nodeHasTag', () => {
  function makeNode(input: {
    authorTags?: unknown;
    userTags?: unknown;
  }): INodeView {
    return {
      path: 'agents/a.md',
      kind: 'agent',
      frontmatter: {
        name: 'a',
        description: '',
        metadata: { version: '1.0.0' },
        ...(input.authorTags !== undefined ? { tags: input.authorTags } : {}),
      } as INodeView['frontmatter'],
      sidecar:
        input.userTags !== undefined
          ? { annotations: { tags: input.userTags } as Record<string, unknown> }
          : undefined,
    } as INodeView;
  }

  it('matches author tags from frontmatter', () => {
    expect(nodeHasTag(makeNode({ authorTags: ['planning', 'review'] }), 'planning')).toBe(true);
  });

  it('matches user tags from sidecar annotations', () => {
    expect(nodeHasTag(makeNode({ userTags: ['custom'] }), 'custom')).toBe(true);
  });

  it('returns false when neither source carries the tag', () => {
    expect(nodeHasTag(makeNode({ authorTags: ['planning'] }), 'review')).toBe(false);
  });
});

describe('graph-view.utils — shape guards', () => {
  it('isPoint accepts finite { x, y }', () => {
    expect(isPoint({ x: 1, y: 2 })).toBe(true);
  });

  it('isPoint rejects NaN / missing fields', () => {
    expect(isPoint({ x: 1, y: Number.NaN })).toBe(false);
    expect(isPoint({ x: 1 })).toBe(false);
    expect(isPoint(null)).toBe(false);
  });

  it('isStoredViewport requires positive scale', () => {
    expect(isStoredViewport({ x: 0, y: 0, scale: 1 })).toBe(true);
    expect(isStoredViewport({ x: 0, y: 0, scale: 0 })).toBe(false);
    expect(isStoredViewport({ x: 0, y: 0, scale: -1 })).toBe(false);
  });
});
