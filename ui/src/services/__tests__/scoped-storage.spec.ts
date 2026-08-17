/**
 * `scoped-storage`: the per-project localStorage namespace (hash of the
 * scope root the BFF stamps into `index.html`), the `sm.scopes` debug
 * registry, and the NO-RETROCOMPAT version gate that wipes the whole
 * `sm.*` family on any layout mismatch (user decisions 2026-08-17).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SCOPE_META_NAME,
  SCOPE_REGISTRY_KEY,
  STORAGE_VERSION_KEY,
  VERSION_META_NAME,
  resetPlan,
  resetScopeNamespaceForTest,
  scopeNamespace,
  scopedKey,
} from '../scoped-storage';

function setMeta(root: string): void {
  addMeta(SCOPE_META_NAME, root);
}

function setVersionMeta(version: string): void {
  addMeta(VERSION_META_NAME, version);
}

function addMeta(name: string, content: string): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', name);
  meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

function clearMeta(): void {
  for (const name of [SCOPE_META_NAME, VERSION_META_NAME]) {
    for (const el of document.querySelectorAll(`meta[name="${name}"]`)) el.remove();
  }
}

describe('scoped-storage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetScopeNamespaceForTest();
  });

  afterEach(() => {
    clearMeta();
    resetScopeNamespaceForTest();
    localStorage.clear();
  });

  it('namespaces keys with a stable 8-hex hash of the meta root', () => {
    setMeta('/home/x/project-a');
    const first = scopedKey('sm.graph.node-positions');
    expect(first).toMatch(/^sm\.graph\.node-positions\.[0-9a-f]{8}$/);

    // Same root resolves to the SAME namespace after a memo reset:
    // positions saved yesterday are found tomorrow.
    resetScopeNamespaceForTest();
    expect(scopedKey('sm.graph.node-positions')).toBe(first);
  });

  it('two projects mint two namespaces (the whole point)', () => {
    setMeta('/home/x/project-a');
    const a = scopeNamespace();
    clearMeta();
    resetScopeNamespaceForTest();
    setMeta('/home/x/project-b');
    const b = scopeNamespace();
    expect(a).not.toBe(b);
  });

  it('registers each root in the sm.scopes debug directory without clobbering', () => {
    setMeta('/home/x/project-a');
    const a = scopeNamespace();
    clearMeta();
    resetScopeNamespaceForTest();
    setMeta('/home/x/project-b');
    const b = scopeNamespace();

    const registry = JSON.parse(localStorage.getItem(SCOPE_REGISTRY_KEY)!) as Record<
      string,
      string
    >;
    expect(registry[a]).toBe('/home/x/project-a');
    expect(registry[b]).toBe('/home/x/project-b');
  });

  it('no meta (demo bundle, dev harness) falls back to the default namespace, no registry', () => {
    expect(scopedKey('sm.live.recording')).toBe('sm.live.recording.default');
    expect(localStorage.getItem(SCOPE_REGISTRY_KEY)).toBeNull();
  });

  it('a corrupt registry never blocks the namespace', () => {
    localStorage.setItem(SCOPE_REGISTRY_KEY, '{not json');
    setMeta('/home/x/project-a');
    expect(scopeNamespace()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('an unversioned origin WIPES the whole sm.* family and stamps the CLI version', () => {
    // The pre-namespace era: bare project state + a preference, no version.
    localStorage.setItem('sm.live.recording', '[]');
    localStorage.setItem('sm.graph.node-positions', '{}');
    localStorage.setItem('sm.workspace.rail-width', '440');
    localStorage.setItem('unrelated.key', 'survives');

    setMeta('/home/x/project-a');
    setVersionMeta('1.12.0');
    scopeNamespace();

    expect(localStorage.getItem('sm.live.recording')).toBeNull();
    expect(localStorage.getItem('sm.graph.node-positions')).toBeNull();
    expect(localStorage.getItem('sm.workspace.rail-width')).toBeNull();
    expect(localStorage.getItem('unrelated.key')).toBe('survives');
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBe('1.12.0');
  });

  it('a release crossing NO layout threshold wipes nothing and re-stamps', () => {
    localStorage.setItem(STORAGE_VERSION_KEY, '1.12.0');
    localStorage.setItem('sm.workspace.rail-width', '440');
    setMeta('/home/x/project-a');
    setVersionMeta('1.13.2'); // no VERSION_RESETS entry crossed past 1.12.0
    scopeNamespace();
    expect(localStorage.getItem('sm.workspace.rail-width')).toBe('440');
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBe('1.13.2');
  });

  it('no version meta = the gate stays inert (dev harness has no idea what runs)', () => {
    localStorage.setItem('sm.live.recording', '[]');
    setMeta('/home/x/project-a');
    scopeNamespace();
    expect(localStorage.getItem('sm.live.recording')).toBe('[]');
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBeNull();
  });

  it('resetPlan: only thresholds CROSSED by the upgrade apply; unions accumulate', () => {
    const table = {
      '1.12.0': 'all',
      '1.14.0': ['sm.live.recording'],
      '1.15.0': ['sm.map.overrides'],
    } as const;
    // A release crossing nothing resets nothing.
    expect(resetPlan('1.12.0', '1.13.5', table)).toEqual([]);
    // One selective threshold crossed: only its keys.
    expect(resetPlan('1.13.0', '1.14.2', table)).toEqual(['sm.live.recording']);
    // Two selective thresholds in one jump: the union.
    expect(resetPlan('1.13.0', '1.15.0', table)).toEqual([
      'sm.live.recording',
      'sm.map.overrides',
    ]);
    // Any crossed 'all' totals the wipe.
    expect(resetPlan('1.11.0', '1.14.0', table)).toBe('all');
  });

  it('resetPlan: unknown territory falls back to the full wipe (misreading is worse)', () => {
    const table = { '1.12.0': ['sm.live.recording'] } as const;
    expect(resetPlan(null, '1.12.0', table)).toBe('all'); // the unversioned era
    expect(resetPlan('2.0.0', '1.12.0', table)).toBe('all'); // a downgrade
    expect(resetPlan('garbage', '1.12.0', table)).toBe('all'); // unreadable stored
    expect(resetPlan('1.11.0', 'garbage', table)).toBe('all'); // unreadable current
  });

  it('a selective reset clears the base key AND its scoped variants, nothing else', () => {
    const plan = resetPlan('1.13.0', '1.14.0', { '1.14.0': ['sm.live.recording'] });
    expect(plan).toEqual(['sm.live.recording']);
    const survives = ['sm.live.recording-not-this', 'sm.graph.node-positions.abc'];
    const goes = ['sm.live.recording', 'sm.live.recording.550b52c7'];
    for (const key of [...survives, ...goes]) {
      const hit =
        plan !== 'all' && plan.some((base) => key === base || key.startsWith(`${base}.`));
      expect(hit, key).toBe(goes.includes(key));
    }
  });

  it('a matching version leaves every sm.* key alone', () => {
    localStorage.setItem(STORAGE_VERSION_KEY, '1.12.0');
    localStorage.setItem('sm.workspace.rail-width', '440');
    setMeta('/home/x/project-a');
    setVersionMeta('1.12.0');
    scopeNamespace();
    expect(localStorage.getItem('sm.workspace.rail-width')).toBe('440');
  });
});
