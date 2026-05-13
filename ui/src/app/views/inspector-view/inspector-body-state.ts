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
import type { SafeHtml } from '@angular/platform-browser';

import type { IDataSourcePort } from '../../../services/data-source/data-source.port';
import type { MarkdownRenderer } from '../../../services/markdown-renderer';

export type TBodyState = 'idle' | 'loading' | 'empty' | 'unavailable' | 'error' | 'ready';

export interface IBodyStateConfig {
  /** Source of the active node path. `undefined` → state stays `idle`. */
  path: Signal<string | undefined>;
  dataSource: IDataSourcePort;
  markdown: MarkdownRenderer;
}

export interface IBodyStateHandle {
  /** Current lifecycle phase. Template `@switch (bodyState())` branches off this. */
  readonly bodyState: Signal<TBodyState>;
  /** Sanitized HTML for the `ready` state. `null` otherwise. */
  readonly bodyHtml: Signal<SafeHtml | null>;
  /**
   * Manual re-fetch, wired to the body card's refresh button. No-op
   * during `loading` so a double-click can't kick off two in-flight
   * fetches against the same token.
   */
  refresh: () => void;
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

  const refresh = (): void => {
    const path = pathSignal();
    if (!path) return;
    if (bodyState() === 'loading') return;
    const myToken = ++fetchToken;
    bodyHtml.set(null);
    bodyState.set('loading');
    void fetchAndRender(path, myToken);
  };

  return {
    bodyState: bodyState.asReadonly(),
    bodyHtml: bodyHtml.asReadonly(),
    refresh,
  };
}
