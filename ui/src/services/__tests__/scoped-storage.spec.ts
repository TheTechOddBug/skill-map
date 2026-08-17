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
  STORAGE_SCHEMA_VERSION,
  STORAGE_VERSION_KEY,
  resetPlan,
  resetScopeNamespaceForTest,
  scopeNamespace,
  scopedKey,
} from '../scoped-storage';

function setMeta(root: string): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', SCOPE_META_NAME);
  meta.setAttribute('content', root);
  document.head.appendChild(meta);
}

function clearMeta(): void {
  for (const el of document.querySelectorAll(`meta[name="${SCOPE_META_NAME}"]`)) el.remove();
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
    localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_SCHEMA_VERSION));
    localStorage.setItem(SCOPE_REGISTRY_KEY, '{not json');
    setMeta('/home/x/project-a');
    expect(scopeNamespace()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('a version mismatch WIPES the whole sm.* family and stamps the version (no retrocompat)', () => {
    // The pre-namespace era: bare project state + a preference, no version.
    localStorage.setItem('sm.live.recording', '[]');
    localStorage.setItem('sm.graph.node-positions', '{}');
    localStorage.setItem('sm.workspace.rail-width', '440');
    localStorage.setItem('unrelated.key', 'survives');

    setMeta('/home/x/project-a');
    scopeNamespace();

    expect(localStorage.getItem('sm.live.recording')).toBeNull();
    expect(localStorage.getItem('sm.graph.node-positions')).toBeNull();
    expect(localStorage.getItem('sm.workspace.rail-width')).toBeNull();
    expect(localStorage.getItem('unrelated.key')).toBe('survives');
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('resetPlan: each bump declares its blast radius; steps accumulate across a skip', () => {
    const table = { 2: 'all', 3: ['sm.live.recording'], 4: ['sm.map.overrides'] } as const;
    // One selective step: only its keys.
    expect(resetPlan(2, 3, table)).toEqual(['sm.live.recording']);
    // Two selective steps (2 -> 4): the union.
    expect(resetPlan(2, 4, table)).toEqual(['sm.live.recording', 'sm.map.overrides']);
    // Any 'all' step in the chain totals the wipe.
    expect(resetPlan(1, 3, table)).toBe('all');
  });

  it('resetPlan: unknown territory falls back to the full wipe (misreading is worse)', () => {
    const table = { 2: ['sm.live.recording'] } as const;
    expect(resetPlan(null, 2, table)).toBe('all'); // the unversioned era
    expect(resetPlan(5, 2, table)).toBe('all'); // a FUTURE version downgraded
    expect(resetPlan(0, 2, table)).toBe('all'); // off-range garbage
    expect(resetPlan(1, 3, { 2: ['sm.a'] })).toBe('all'); // step 3 undeclared
  });

  it('a selective reset clears the base key AND its scoped variants, nothing else', () => {
    // Simulate a future selective bump by seeding version current-1...
    // not possible against the real table (v2 is the floor), so drive
    // the seam the gate uses: the plan says exactly which spellings go.
    const plan = resetPlan(2, 3, { 3: ['sm.live.recording'] });
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
    localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_SCHEMA_VERSION));
    localStorage.setItem('sm.workspace.rail-width', '440');
    setMeta('/home/x/project-a');
    scopeNamespace();
    expect(localStorage.getItem('sm.workspace.rail-width')).toBe('440');
  });
});
