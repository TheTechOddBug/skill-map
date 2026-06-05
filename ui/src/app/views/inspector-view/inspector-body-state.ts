/**
 * Body-fetch state machine for the inspector view.
 *
 * Owns the lifecycle of the markdown body card:
 *   - `path` change → bump a monotonic fetch token, set `loading`,
 *     fire `getNode(path, { includeBody: true })`.
 *   - Resolved `body` → render via the lazy markdown service, set
 *     `ready` (or `empty` / `unavailable` depending on payload).
 *   - Stale token (user navigated mid-flight) → drop the result.
 *
 * Returned as a small handle the component binds to. Lives outside
 * `inspector-view.ts` so the lifecycle + token guard is documented in
 * one place; the component owns inputs (the `path` signal) but does
 * not have to host the signals + effect + async method.
 */

import { assertInInjectionContext, effect, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { SafeHtml } from '@angular/platform-browser';
import type { Observable } from 'rxjs';

import type { IDataSourcePort } from '../../../services/data-source/data-source.port';
import type { MarkdownRenderer } from '../../../services/markdown-renderer';

export type TBodyState = 'idle' | 'loading' | 'empty' | 'unavailable' | 'error' | 'ready';

export interface IBodyStateConfig {
  /** Source of the active node path. `undefined` → state stays `idle`. */
  path: Signal<string | undefined>;
  dataSource: IDataSourcePort;
  markdown: MarkdownRenderer;
  /**
   * Optional reactive refresh trigger. When provided (the inspector wires
   * the `scan.completed` WS stream), the body is silently re-fetched and
   * re-rendered on each emission for the CURRENT path, so an external edit
   * to the open node's `.md` body shows up without the user re-selecting
   * the node. The path-change `effect` already covers navigation; this
   * covers same-path content changes (the watcher re-scan case), which is
   * why the body was the one card that did not update live.
   */
  scanCompleted$?: Observable<unknown>;
}

export interface IBodyStateHandle {
  /** Current lifecycle phase. Template `@switch (bodyState())` branches off this. */
  readonly bodyState: Signal<TBodyState>;
  /** Sanitized HTML for the `ready` state. `null` otherwise. */
  readonly bodyHtml: Signal<SafeHtml | null>;
}

/**
 * Wire the lifecycle. Must be called from a context where `effect()`
 * can be created (typically a component constructor / field
 * initializer). The runtime guard turns a misplaced call into a clear
 * NG0203 with the helper name in the stack, instead of a delayed
 * effect-construction failure deep inside the lifecycle.
 */
export function setupBodyState(config: IBodyStateConfig): IBodyStateHandle {
  assertInInjectionContext(setupBodyState);
  const { path: pathSignal, dataSource, markdown } = config;

  const bodyState = signal<TBodyState>('idle');
  const bodyHtml = signal<SafeHtml | null>(null);
  let fetchToken = 0;

  const fetchAndRender = async (path: string, token: number): Promise<void> => {
    try {
      const detail = await dataSource.getNode(path, { includeBody: true });
      if (token !== fetchToken) return;
      if (detail === null) {
        bodyState.set('unavailable');
        return;
      }
      const body = detail.item.body;
      if (body === null) {
        bodyState.set('unavailable');
        return;
      }
      if (body === undefined || body.trim().length === 0) {
        bodyState.set('empty');
        return;
      }
      const html = await markdown.render(body);
      if (token !== fetchToken) return;
      bodyHtml.set(html);
      bodyState.set('ready');
    } catch {
      if (token !== fetchToken) return;
      bodyState.set('error');
    }
  };

  // Lifecycle: kicks off on every path change. Token bumps so an
  // in-flight fetch from the previous path no-ops on resolve.
  effect(() => {
    const path = pathSignal();
    const myToken = ++fetchToken;
    bodyHtml.set(null);
    if (!path) {
      bodyState.set('idle');
      return;
    }
    bodyState.set('loading');
    void fetchAndRender(path, myToken);
  });

  // Reactive refresh: re-render the OPEN node's body when a watcher-driven
  // re-scan completes. Re-fetches silently (no `loading` flash, no
  // `bodyHtml` reset) so the user keeps reading the current render until
  // the fresh one swaps in; the token guard drops a stale resolve if the
  // user navigates mid-refresh. Mirrors the `LinkedNodesPanel`
  // scan.completed subscription so the body stays in step with the rest
  // of the inspector.
  config.scanCompleted$?.pipe(takeUntilDestroyed()).subscribe(() => {
    const path = pathSignal();
    if (path) void fetchAndRender(path, ++fetchToken);
  });

  return {
    bodyState: bodyState.asReadonly(),
    bodyHtml: bodyHtml.asReadonly(),
  };
}
