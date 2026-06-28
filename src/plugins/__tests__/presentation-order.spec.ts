/**
 * Coverage for the built-in plugin presentation-order helper. The
 * sort is the single source of truth for the order `sm plugins list /
 * show / doctor` + `GET /api/plugins` + the SPA's Settings → Plugins
 * panel render in (`core` first, then the vendor plugins). A future
 * tweak (adding a new plugin, reshuffling the catalogue) without
 * matching tests would silently regress every surface that humans
 * actually read.
 *
 * Two invariants pin the contract:
 *
 *   1. The configured pin list (`core, claude, antigravity, codex,
 *      opencode, agent-skills`) is honoured verbatim and ids outside it land at
 *      the end, alphabetically.
 *   2. The sort is stable / pure: same input order, same output;
 *      empty input is allowed; the helper never mutates the caller's
 *      array (defensive copy via `[...plugins]`).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  BUILT_IN_PLUGIN_PRESENTATION_ORDER,
  sortPluginsForPresentation,
} from '../presentation-order.js';

function plugin(id: string): { id: string } {
  return { id };
}

describe('BUILT_IN_PLUGIN_PRESENTATION_ORDER', () => {
  it('starts with `core` (carries the universal extractors / analyzers / formatters the user reaches for the most)', () => {
    assert.equal(BUILT_IN_PLUGIN_PRESENTATION_ORDER[0], 'core');
  });

  it('lists every vendor plugin that ships in `builtInPlugins` today', () => {
    const expected = ['core', 'claude', 'antigravity', 'codex', 'opencode', 'agent-skills'];
    assert.deepEqual([...BUILT_IN_PLUGIN_PRESENTATION_ORDER], expected);
  });

  it('does NOT include the retired `gemini` id (replaced upstream by `antigravity`)', () => {
    assert.equal(BUILT_IN_PLUGIN_PRESENTATION_ORDER.includes('gemini'), false);
  });
});

describe('sortPluginsForPresentation', () => {
  it('orders the canonical set: core → claude → antigravity → codex → agent-skills', () => {
    // Input deliberately shuffled to verify the sort actually runs.
    const input = ['claude', 'agent-skills', 'core', 'codex', 'antigravity'].map(plugin);
    const result = sortPluginsForPresentation(input).map((b) => b.id);
    assert.deepEqual(result, ['core', 'claude', 'antigravity', 'codex', 'agent-skills']);
  });

  it('lands unknown ids at the end, alphabetical among themselves', () => {
    // The runtime catalogue might gain a drop-in plugin or a future
    // built-in. Anything not in the pin list lands AFTER every pinned
    // entry, sorted alphabetically so the slot is deterministic.
    const input = ['zeta-plugin', 'claude', 'alpha-plugin', 'core', 'mid-plugin'].map(plugin);
    const result = sortPluginsForPresentation(input).map((b) => b.id);
    assert.deepEqual(result, [
      'core',
      'claude',
      'alpha-plugin',
      'mid-plugin',
      'zeta-plugin',
    ]);
  });

  it('subset of the pinned list: each pinned id keeps its canonical slot', () => {
    // Real plugin runtime might disable some built-ins; the sort must
    // still respect the canonical slot for the survivors instead of
    // collapsing to alphabetical.
    const input = ['agent-skills', 'core', 'codex'].map(plugin);
    const result = sortPluginsForPresentation(input).map((b) => b.id);
    assert.deepEqual(result, ['core', 'codex', 'agent-skills']);
  });

  it('empty input returns []', () => {
    assert.deepEqual(sortPluginsForPresentation([]), []);
  });

  it('input that is already sorted is returned in the same order', () => {
    const input = BUILT_IN_PLUGIN_PRESENTATION_ORDER.map((id) => plugin(id));
    const result = sortPluginsForPresentation(input).map((b) => b.id);
    assert.deepEqual(result, [...BUILT_IN_PLUGIN_PRESENTATION_ORDER]);
  });

  it('returns a new array, does not mutate the caller', () => {
    // The helper splats into a fresh array before sorting in place, so
    // the caller's array stays in its original order. Verifying this
    // matters because `sm plugins list / doctor` and the BFF share
    // `builtInPlugins` (the runtime iteration order) and a mutation
    // would silently break the kernel's "core/markdown last" promise
    // (see spec/architecture.md §"core/markdown is the universal
    // fallback for unclaimed `.md` files").
    const input = ['claude', 'agent-skills', 'core'].map(plugin);
    const beforeIds = input.map((b) => b.id);
    sortPluginsForPresentation(input);
    assert.deepEqual(input.map((b) => b.id), beforeIds, 'input array must stay untouched');
  });

  it('preserves entry identity (same object references, just reordered)', () => {
    // The sort is shape-agnostic over `{ id: string }`; callers pass
    // richer objects (e.g. `IBuiltInPlugin` with `extensions`). The
    // entries returned must be the SAME object references so a future
    // caller can sort once and then read off whatever extra fields it
    // attached without re-keying.
    const core = { id: 'core', extra: 'core-extra' };
    const claude = { id: 'claude', extra: 'claude-extra' };
    const result = sortPluginsForPresentation([claude, core]);
    assert.equal(result[0], core);
    assert.equal(result[1], claude);
  });

  it('ties between two unknown ids break alphabetically and remain stable across runs', () => {
    // The sort uses `localeCompare` for the alphabetical tail, which is
    // stable per ECMAScript spec for V8. Re-sorting the result should
    // be a no-op.
    const input = ['zeta', 'beta', 'alpha', 'gamma'].map(plugin);
    const first = sortPluginsForPresentation(input).map((b) => b.id);
    const second = sortPluginsForPresentation(first.map(plugin)).map((b) => b.id);
    assert.deepEqual(first, ['alpha', 'beta', 'gamma', 'zeta']);
    assert.deepEqual(second, first);
  });
});
