import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { bindSelectionToUrl, type ISelectionSyncNode } from '../selection-url-sync';

function makeParamMap(path: string | null): ParamMap {
  return {
    get: (name: string) => (name === 'path' ? path : null),
    getAll: () => (path !== null ? [path] : []),
    has: (name: string) => name === 'path' && path !== null,
    keys: path !== null ? ['path'] : [],
  };
}

function makeNode(path: string): ISelectionSyncNode {
  return { id: path, view: { path } };
}

/**
 * Build the fakes `bindSelectionToUrl` needs: a query-param stream the
 * test pushes to, a `navigate` spy, and the writable selection signals
 * the component would own.
 */
function setup(initialPath: string | null, nodes: readonly ISelectionSyncNode[]) {
  const queryParamMap$ = new BehaviorSubject<ParamMap>(makeParamMap(initialPath));
  const route = {
    queryParamMap: queryParamMap$.asObservable(),
    snapshot: { queryParamMap: makeParamMap(initialPath) },
  } as unknown as ActivatedRoute;

  const navigate = vi.fn().mockResolvedValue(true);
  const router = { navigate } as unknown as Router;

  const selectedNodeId = signal<string | null>(null);
  const selectedPath = signal<string | undefined>(undefined);
  const onDeepLinkSelect = vi.fn();

  bindSelectionToUrl({
    selectedPath,
    setSelectedNodeId: (id) => selectedNodeId.set(id),
    readSelectedNodeId: () => selectedNodeId(),
    graphNodes: signal(nodes),
    onDeepLinkSelect,
    router,
    route,
  });

  return { queryParamMap$, navigate, selectedNodeId, selectedPath, onDeepLinkSelect };
}

describe('selection-url-sync', () => {
  it('deep link: a matching ?path= selects the node AND fires onDeepLinkSelect', () => {
    TestBed.runInInjectionContext(() => {
      const nodes = [makeNode('a.md'), makeNode('docs/b.md')];
      const { selectedNodeId, onDeepLinkSelect } = setup('docs/b.md', nodes);
      TestBed.tick();
      expect(selectedNodeId()).toBe('docs/b.md');
      expect(onDeepLinkSelect).toHaveBeenCalledExactlyOnceWith('docs/b.md');
    });
  });

  it('deep link to an unknown path: no selection, no callback', () => {
    TestBed.runInInjectionContext(() => {
      const nodes = [makeNode('a.md')];
      const { selectedNodeId, onDeepLinkSelect } = setup('ghost.md', nodes);
      TestBed.tick();
      expect(selectedNodeId()).toBeNull();
      expect(onDeepLinkSelect).not.toHaveBeenCalled();
    });
  });

  it('in-map selection (selection → URL) navigates but does NOT fire onDeepLinkSelect', () => {
    TestBed.runInInjectionContext(() => {
      const nodes = [makeNode('a.md')];
      const { navigate, selectedNodeId, selectedPath, onDeepLinkSelect } = setup(null, nodes);
      TestBed.tick();

      // Simulate an in-map click: the component sets the selection
      // directly, which feeds the writer effect (not the reader).
      selectedNodeId.set('a.md');
      selectedPath.set('a.md');
      TestBed.tick();

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(onDeepLinkSelect).not.toHaveBeenCalled();
    });
  });

  it("swallows the writer's own echo instead of re-selecting a closed node", () => {
    TestBed.runInInjectionContext(() => {
      const nodes = [makeNode('a.md')];
      const { queryParamMap$, navigate, selectedNodeId, selectedPath } = setup(null, nodes);
      TestBed.tick();

      // In-map click: the writer mirrors the selection into `?path=`.
      selectedNodeId.set('a.md');
      selectedPath.set('a.md');
      TestBed.tick();
      expect(navigate).toHaveBeenCalledTimes(1);

      // The panel closes BEFORE that navigation's query-param change
      // lands (`router.navigate` is async). This is the real ordering:
      // the reader may not have run at all while the selection was set.
      selectedNodeId.set(null);
      selectedPath.set(undefined);
      TestBed.tick();

      // Now the param change arrives. It is the writer's own echo, not
      // an incoming deep link, so it must not resurrect the selection
      // the user just cleared.
      queryParamMap$.next(makeParamMap('a.md'));
      TestBed.tick();

      expect(selectedNodeId()).toBeNull();
    });
  });

  it('does not re-fire onDeepLinkSelect when the URL already matches the selection', () => {
    TestBed.runInInjectionContext(() => {
      const nodes = [makeNode('a.md')];
      const { queryParamMap$, selectedPath, onDeepLinkSelect } = setup('a.md', nodes);
      TestBed.tick();
      expect(onDeepLinkSelect).toHaveBeenCalledTimes(1);

      // Mirror what the writer does: the selection path now agrees with
      // the URL. Re-emitting the same param must be a reader no-op.
      selectedPath.set('a.md');
      queryParamMap$.next(makeParamMap('a.md'));
      TestBed.tick();
      expect(onDeepLinkSelect).toHaveBeenCalledTimes(1);
    });
  });
});
