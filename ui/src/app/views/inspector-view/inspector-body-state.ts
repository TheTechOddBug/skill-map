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

import { assertInInjectionContext, effect, signal, untracked, type Signal } from '@angular/core';
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
  /**
   * Optional source of an already-in-hand body string. When this signal
   * returns a `string` (including `''`), the body is that markdown and is
   * rendered directly, skipping the `getNode({ includeBody: true })` disk
   * re-read entirely. When it returns `undefined`, the body is fetched on
   * demand as before.
   *
   * This is how structured-frontmatter Providers (Codex sub-agents, whose
   * markdown prompt lives in the TOML `developer_instructions` field, not
   * after a frontmatter fence) render their effective body: the parsed
   * field already ships in `node.frontmatter`, so the inspector hands it in
   * here rather than asking the BFF, whose on-demand read would only strip a
   * (non-existent) `---` fence and hand back the raw TOML. The signal is
   * read untracked on a path change and re-read on each `scanCompleted$`
   * refresh, mirroring the fetch path's loud-load / silent-refresh split.
   */
  inlineBody?: Signal<string | undefined>;
}

export interface IBodyStateHandle {
  /** Current lifecycle phase. Template `@switch (bodyState())` branches off this. */
  readonly bodyState: Signal<TBodyState>;
  /** Sanitized HTML for the `ready` state. `null` otherwise. */
  readonly bodyHtml: Signal<SafeHtml | null>;
  /**
   * The raw source for the `ready` state, `null` otherwise. Lets the
   * inspector offer a Raw / Rendered toggle over the same content without
   * a second fetch. For fetched nodes this is the on-disk file VERBATIM
   * (`item.raw`, frontmatter included) so the Raw gutter's line numbers
   * match the file-absolute `L<n>` lines findings report; it falls back
   * to the body string when the BFF did not attach `raw` (static demo
   * snapshot) and for inline-body providers (Codex `developer_instructions`,
   * where finding lines are body-relative and the prompt IS the source).
   */
  readonly bodyRaw: Signal<string | null>;
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
  const { path: pathSignal, dataSource, markdown, inlineBody } = config;

  const bodyState = signal<TBodyState>('idle');
  const bodyHtml = signal<SafeHtml | null>(null);
  const bodyRaw = signal<string | null>(null);
  let fetchToken = 0;

  /**
   * Render an already-in-hand body string (the `inlineBody` path). Empty /
   * whitespace-only resolves to `empty` (hidden section); otherwise renders
   * the markdown. Never touches the network, so it doubles as the silent
   * refresh for inline providers.
   */
  const renderInlineBody = async (body: string, token: number): Promise<void> => {
    if (body.trim().length === 0) {
      if (token === fetchToken) bodyState.set('empty');
      return;
    }
    try {
      const html = await markdown.render(body);
      if (token !== fetchToken) return;
      bodyRaw.set(body);
      bodyHtml.set(html);
      bodyState.set('ready');
    } catch {
      if (token === fetchToken) bodyState.set('error');
    }
  };

  const fetchAndRender = async (path: string, token: number): Promise<void> => {
    try {
      const detail = await dataSource.getNode(path, { includeBody: true, includeRaw: true });
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
      // Raw toggle shows the on-disk file verbatim (frontmatter included)
      // so its gutter matches the file-absolute `L<n>` finding lines; the
      // body string is the fallback when the source attached no raw file.
      bodyRaw.set(detail.item.raw ?? body);
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
    bodyRaw.set(null);
    if (!path) {
      bodyState.set('idle');
      return;
    }
    bodyState.set('loading');
    // Read `inlineBody` untracked so this effect re-runs on path change only,
    // not on every content change, the `scanCompleted$` subscription owns the
    // silent same-path refresh (matching the fetch path's contract).
    const inline = untracked(() => inlineBody?.());
    if (inline !== undefined) {
      void renderInlineBody(inline, myToken);
    } else {
      void fetchAndRender(path, myToken);
    }
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
    if (!path) return;
    // Same inline-vs-fetch split as the path-change effect, but silent (no
    // `loading` flash, no `bodyHtml` reset). For an inline provider this
    // re-reads the freshly-scanned `developer_instructions` from the node
    // signal instead of re-fetching raw TOML from disk.
    const inline = inlineBody?.();
    if (inline !== undefined) {
      void renderInlineBody(inline, ++fetchToken);
    } else {
      void fetchAndRender(path, ++fetchToken);
    }
  });

  return {
    bodyState: bodyState.asReadonly(),
    bodyHtml: bodyHtml.asReadonly(),
    bodyRaw: bodyRaw.asReadonly(),
  };
}
