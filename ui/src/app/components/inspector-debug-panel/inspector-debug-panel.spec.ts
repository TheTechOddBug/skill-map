import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { InspectorDebugPanel } from './inspector-debug-panel';
import type { INodeView, ISidecarOverlay } from '../../../models/node';

/**
 * `<sm-inspector-debug-panel>` — always-open behavior tests
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

describe('InspectorDebugPanel — always-open structure', () => {
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
      'dbg-sidecar-present',
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

  it('renders sidecar.present:false when the overlay reports it absent', () => {
    const node = makeNode();
    const overlay: ISidecarOverlay = { present: false, status: null };
    const { dom } = bootstrap({ node, sidecarRoot: null, overlay });
    const present = dom.querySelector('[data-testid="dbg-sidecar-present"]');
    expect(present!.textContent).toContain('false');
    // status is null → `(absent)` marker.
    const status = dom.querySelector('[data-testid="dbg-sidecar-status"]');
    expect(status!.textContent).toContain('(absent)');
  });

  it('renders concrete values when the sidecar root is populated', () => {
    const node = makeNode({ bodyHash: 'live-body', frontmatterHash: 'live-fm' });
    const sidecarRoot = {
      for: {
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
    expect(dom.querySelector('[data-testid="dbg-sidecar-present"]')!.textContent).toContain(
      'true',
    );
  });

  it('highlights drift when stored and live body hashes differ', () => {
    const node = makeNode({ bodyHash: 'live-body' });
    const sidecarRoot = { for: { bodyHash: 'stored-body' } };
    const overlay: ISidecarOverlay = { present: true, status: 'stale-body' };
    const { dom } = bootstrap({ node, sidecarRoot, overlay });
    const stored = dom.querySelector('[data-testid="dbg-body-hash-stored"] code');
    const live = dom.querySelector('[data-testid="dbg-body-hash-live"] code');
    expect(stored!.classList.contains('dbg__diff')).toBe(true);
    expect(live!.classList.contains('dbg__diff')).toBe(true);
  });
});
