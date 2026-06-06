import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { InspectorDebugPanel } from '../inspector-debug-panel';
import type { INodeView, ISidecarOverlay } from '../../../../models/node';

/**
 * `<sm-inspector-debug-panel>`, always-open behavior tests
 * (catalog curation refinement 2026-05-07). The panel renders the
 * full row set whenever the host shows it; rows whose source is
 * missing display an explicit `(absent)` / `(not set)` marker.
 */

interface IBootstrapOpts {
  node: INodeView;
  sidecarRoot?: Record<string, unknown> | null;
  overlay?: ISidecarOverlay | undefined;
}

function bootstrap(opts: IBootstrapOpts): {
  dom: HTMLElement;
  fixture: ReturnType<typeof TestBed.createComponent<InspectorDebugPanel>>;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(InspectorDebugPanel);
  fixture.componentRef.setInput('node', opts.node);
  fixture.componentRef.setInput('sidecarRoot', opts.sidecarRoot ?? null);
  if (opts.overlay !== undefined) {
    fixture.componentRef.setInput('overlay', opts.overlay);
  }
  fixture.detectChanges();
  return { dom: fixture.nativeElement as HTMLElement, fixture };
}

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: { name: 'architect', description: 'd', metadata: { version: '' } },
    ...overrides,
  };
}

/** A full 64-char digest made of one repeated char (distinct per test). */
function hash64(ch: string): string {
  return ch.repeat(64);
}

/** Swap in a fake `navigator.clipboard`; returns a restore thunk. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return () => {
    if (original) {
      Object.defineProperty(navigator, 'clipboard', original);
    } else {
      Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard');
    }
  };
}

/** Drain the microtask queue so an awaited clipboard promise settles. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Resolve the click-to-copy button inside a hash cell by its testid. */
function copyButton(dom: HTMLElement, testid: string): HTMLButtonElement {
  const btn = dom.querySelector(`[data-testid="${testid}"] button.dbg__copy`);
  if (!btn) throw new Error(`no copy button under [data-testid="${testid}"]`);
  return btn as HTMLButtonElement;
}

describe('InspectorDebugPanel, always-open structure', () => {
  it('renders every row even when the sidecar is absent', () => {
    const node = makeNode({ bodyHash: 'live-body', frontmatterHash: 'live-fm' });
    const { dom } = bootstrap({ node, sidecarRoot: null, overlay: undefined });
    // Each diagnostic row has a stable testid; assert all of them exist.
    const ids = [
      'dbg-for-path',
      'dbg-body-hash-stored',
      'dbg-body-hash-live',
      'dbg-fm-hash-stored',
      'dbg-fm-hash-live',
      'dbg-resolved-provider',
      'dbg-resolved-kind',
      'dbg-sidecar-status',
    ];
    for (const id of ids) {
      expect(dom.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
  });

  it('shows `(absent)` markers for stored rows when no sidecar is attached', () => {
    const node = makeNode({ bodyHash: 'live-body', frontmatterHash: 'live-fm' });
    const { dom } = bootstrap({ node, sidecarRoot: null, overlay: undefined });
    const forPath = dom.querySelector('[data-testid="dbg-for-path"]');
    const bodyStored = dom.querySelector('[data-testid="dbg-body-hash-stored"]');
    const fmStored = dom.querySelector('[data-testid="dbg-fm-hash-stored"]');
    const status = dom.querySelector('[data-testid="dbg-sidecar-status"]');
    expect(forPath!.textContent).toContain('(absent)');
    expect(bodyStored!.textContent).toContain('(absent)');
    expect(fmStored!.textContent).toContain('(absent)');
    expect(status!.textContent).toContain('(absent)');
  });

  it('shows `(not set)` markers for resolvedAs rows when the field is absent', () => {
    const node = makeNode();
    const { dom } = bootstrap({ node, sidecarRoot: null, overlay: undefined });
    const provider = dom.querySelector('[data-testid="dbg-resolved-provider"]');
    const kind = dom.querySelector('[data-testid="dbg-resolved-kind"]');
    expect(provider!.textContent).toContain('(not set)');
    expect(kind!.textContent).toContain('(not set)');
  });

  it('still renders live hashes even when the sidecar is absent', () => {
    const node = makeNode({ bodyHash: 'live-body-hash', frontmatterHash: 'live-fm-hash' });
    const { dom } = bootstrap({ node, sidecarRoot: null, overlay: undefined });
    const bodyLive = dom.querySelector('[data-testid="dbg-body-hash-live"]');
    const fmLive = dom.querySelector('[data-testid="dbg-fm-hash-live"]');
    expect(bodyLive!.textContent).toContain('live-body-hash');
    expect(fmLive!.textContent).toContain('live-fm-hash');
  });

  it('shows the status `(absent)` marker when the overlay reports a null status', () => {
    const node = makeNode();
    const overlay: ISidecarOverlay = { present: false, status: null };
    const { dom } = bootstrap({ node, sidecarRoot: null, overlay });
    const status = dom.querySelector('[data-testid="dbg-sidecar-status"]');
    expect(status!.textContent).toContain('(absent)');
  });

  it('renders concrete values when the sidecar root is populated', () => {
    const node = makeNode({ bodyHash: 'live-body', frontmatterHash: 'live-fm' });
    const sidecarRoot = {
      identity: {
        path: 'agents/architect.md',
        bodyHash: 'live-body',
        frontmatterHash: 'live-fm',
        resolvedAs: { provider: 'claude', kind: 'agent' },
      },
    };
    const overlay: ISidecarOverlay = { present: true, status: 'fresh' };
    const { dom } = bootstrap({ node, sidecarRoot, overlay });
    expect(dom.querySelector('[data-testid="dbg-for-path"]')!.textContent).toContain(
      'agents/architect.md',
    );
    expect(dom.querySelector('[data-testid="dbg-body-hash-stored"]')!.textContent).toContain(
      'live-body',
    );
    expect(dom.querySelector('[data-testid="dbg-fm-hash-stored"]')!.textContent).toContain(
      'live-fm',
    );
    expect(dom.querySelector('[data-testid="dbg-resolved-provider"]')!.textContent).toContain(
      'claude',
    );
    expect(dom.querySelector('[data-testid="dbg-resolved-kind"]')!.textContent).toContain('agent');
    expect(dom.querySelector('[data-testid="dbg-sidecar-status"]')!.textContent).toContain(
      'fresh',
    );
  });

  it('highlights drift when stored and live body hashes differ', () => {
    const node = makeNode({ bodyHash: 'live-body' });
    const sidecarRoot = { identity: { bodyHash: 'stored-body' } };
    const overlay: ISidecarOverlay = { present: true, status: 'stale-body' };
    const { dom } = bootstrap({ node, sidecarRoot, overlay });
    const stored = dom.querySelector('[data-testid="dbg-body-hash-stored"] code');
    const live = dom.querySelector('[data-testid="dbg-body-hash-live"] code');
    expect(stored!.classList.contains('dbg__diff')).toBe(true);
    expect(live!.classList.contains('dbg__diff')).toBe(true);
  });

  it('copies the full hash to the clipboard and shows the inline confirmation', async () => {
    // Fake timers neutralise the component's ~2s "Copied" reset so no real
    // timer leaks past the test into a shared runner environment.
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restoreClipboard = stubClipboard(writeText);
    try {
      const full = hash64('a');
      const { dom, fixture } = bootstrap({
        node: makeNode({ bodyHash: full }),
        sidecarRoot: { identity: { bodyHash: full } },
      });

      copyButton(dom, 'dbg-body-hash-stored').click();
      // writeText fires synchronously inside the handler: the FULL 64-char
      // digest is written, never the truncated display form.
      expect(writeText).toHaveBeenCalledWith(full);

      await flushMicrotasks();
      fixture.detectChanges();
      expect(dom.querySelector('[data-testid="dbg-body-hash-stored"]')!.textContent).toContain(
        'Copied',
      );
    } finally {
      vi.useRealTimers();
      restoreClipboard();
    }
  });

  it('swallows a clipboard failure and shows no confirmation', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockRejectedValue(new Error('insecure context'));
    const restoreClipboard = stubClipboard(writeText);
    try {
      const full = hash64('b');
      const { dom, fixture } = bootstrap({
        node: makeNode({ bodyHash: full }),
        sidecarRoot: { identity: { bodyHash: full } },
      });

      copyButton(dom, 'dbg-body-hash-stored').click();
      expect(writeText).toHaveBeenCalledWith(full);

      // The rejection is caught inside the component, so nothing throws and
      // the row stays without a "Copied" note.
      await flushMicrotasks();
      fixture.detectChanges();
      expect(dom.querySelector('[data-testid="dbg-body-hash-stored"]')!.textContent).not.toContain(
        'Copied',
      );
    } finally {
      vi.useRealTimers();
      restoreClipboard();
    }
  });

  it('shows the confirmation only in the clicked hash row', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restoreClipboard = stubClipboard(writeText);
    try {
      const body = hash64('a');
      const fm = hash64('c');
      const { dom, fixture } = bootstrap({
        node: makeNode({ bodyHash: body, frontmatterHash: fm }),
        sidecarRoot: { identity: { bodyHash: body, frontmatterHash: fm } },
      });

      copyButton(dom, 'dbg-body-hash-stored').click();
      await flushMicrotasks();
      fixture.detectChanges();

      expect(dom.querySelector('[data-testid="dbg-body-hash-stored"]')!.textContent).toContain(
        'Copied',
      );
      for (const sibling of ['dbg-body-hash-live', 'dbg-fm-hash-stored', 'dbg-fm-hash-live']) {
        expect(dom.querySelector(`[data-testid="${sibling}"]`)!.textContent).not.toContain('Copied');
      }
    } finally {
      vi.useRealTimers();
      restoreClipboard();
    }
  });

  it('clears the confirmation after the reset timeout', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restoreClipboard = stubClipboard(writeText);
    try {
      const full = hash64('a');
      const { dom, fixture } = bootstrap({
        node: makeNode({ bodyHash: full }),
        sidecarRoot: { identity: { bodyHash: full } },
      });

      copyButton(dom, 'dbg-body-hash-stored').click();
      await flushMicrotasks();
      fixture.detectChanges();
      expect(dom.querySelector('[data-testid="dbg-body-hash-stored"]')!.textContent).toContain(
        'Copied',
      );

      // Advance past the ~2s reset; the inline note must clear itself.
      await vi.advanceTimersByTimeAsync(2000);
      fixture.detectChanges();
      expect(dom.querySelector('[data-testid="dbg-body-hash-stored"]')!.textContent).not.toContain(
        'Copied',
      );
    } finally {
      vi.useRealTimers();
      restoreClipboard();
    }
  });
});
