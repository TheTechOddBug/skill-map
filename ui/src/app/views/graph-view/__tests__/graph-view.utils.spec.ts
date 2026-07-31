import { describe, expect, it } from 'vitest';

import {
  isAnyPrimengOverlayOpen,
  isFlowDragging,
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

describe('graph-view.utils, isAnyPrimengOverlayOpen', () => {
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

describe('graph-view.utils, nodeHasTag', () => {
  function makeNode(input: { tags?: unknown }): INodeView {
    return {
      path: 'agents/a.md',
      kind: 'agent',
      frontmatter: {
        name: 'a',
        description: '',
        metadata: { version: '1.0.0' },
      } as INodeView['frontmatter'],
      sidecar:
        input.tags !== undefined
          ? { present: true, annotations: { tags: input.tags } as Record<string, unknown> }
          : undefined,
    } as INodeView;
  }

  it('matches tags from sidecar annotations', () => {
    expect(nodeHasTag(makeNode({ tags: ['planning', 'review'] }), 'planning')).toBe(true);
  });

  it('returns false when the sidecar does not carry the tag', () => {
    expect(nodeHasTag(makeNode({ tags: ['planning'] }), 'review')).toBe(false);
  });

  it('returns false when the node has no sidecar tags', () => {
    expect(nodeHasTag(makeNode({}), 'planning')).toBe(false);
  });
});

describe('graph-view.utils, shape guards', () => {
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

describe('graph-view.utils, isFlowDragging', () => {
  it('is true while Foblex has stamped `f-dragging` on the flow host', () => {
    const host = document.createElement('f-flow');
    host.classList.add('f-dragging');
    expect(isFlowDragging(host)).toBe(true);
  });

  it('is false on an idle host (click that never moved)', () => {
    expect(isFlowDragging(document.createElement('f-flow'))).toBe(false);
  });

  it('is false when the flow has not mounted yet', () => {
    expect(isFlowDragging(null)).toBe(false);
    expect(isFlowDragging(undefined)).toBe(false);
  });
});
