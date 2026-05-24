/**
 * Step 9.1 follow-up, branch coverage for plugin-runtime.ts. The
 * happy path (no `pluginDir`, walks `<cwd>/.skill-map/plugins/`) is
 * exercised by the end-to-end tests in `plugin-runtime.test.ts`.
 * This file targets the remaining branches:
 *
 *   - `pluginDir` override replaces the project search path
 *   - `emptyPluginRuntime()` returns the canonical zero-bundle shape
 *   - `composeScanExtensions({ noBuiltIns: true, ... })` returns
 *     `undefined` when no plugin extensions exist (orchestrator
 *     follows its zero-extension code path)
 *   - `composeFormatters({ noBuiltIns: true })` returns plugin
 *     formatters only (no built-ins)
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composeFormatters,
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  loadPluginRuntime,
} from '../../../cli/util/plugin-runtime.js';
import { readConformanceKillSwitches } from '../../../cli/util/conformance-env.js';
import { listBuiltIns } from '../../../plugins/built-ins.js';

let root: string;
let counter = 0;

function freshDir(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function plantExtractor(pluginsDir: string, id: string): void {
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
      granularity: 'bundle',
    }),
  );
  const extDir = join(dir, 'extractors', `${id}-d`);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, 'index.mjs'),
    `export default {
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      extract() {},
    };`,
  );
}

function plantFormatter(pluginsDir: string, id: string, formatId: string): void {
  // Structure-as-truth: formatId IS the formatter folder name.
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
      granularity: 'bundle',
    }),
  );
  const fmtDir = join(dir, 'formatters', formatId);
  mkdirSync(fmtDir, { recursive: true });
  writeFileSync(
    join(fmtDir, 'index.mjs'),
    `export default {
      version: '1.0.0',
      description: 'test',
      format() { return ''; },
    };`,
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugin-rt-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('plugin-runtime, branch coverage', () => {
  it('pluginDir override replaces the project search path', async () => {
    const customDir = freshDir('custom');
    plantExtractor(customDir, 'custom-only');

    const bundle = await loadPluginRuntime({ pluginDir: customDir });
    assert.equal(bundle.discovered.length, 1);
    assert.equal(bundle.discovered[0]!.id, 'custom-only');
    assert.equal(bundle.extensions.extractors.length, 1);
    assert.equal(bundle.extensions.extractors[0]!.id, 'custom-only-d');
  });

  it('emptyPluginRuntime() returns the canonical zero-bundle shape', () => {
    const empty = emptyPluginRuntime();
    assert.deepEqual(empty.extensions, {
      providers: [],
      extractors: [],
      analyzers: [],
      formatters: [],
      hooks: [],
    });
    assert.deepEqual(empty.manifests, []);
    assert.deepEqual(empty.warnings, []);
    assert.deepEqual(empty.discovered, []);
  });

  it('composeScanExtensions({ noBuiltIns, empty plugins }) returns undefined', () => {
    const composed = composeScanExtensions({
      noBuiltIns: true,
      pluginRuntime: emptyPluginRuntime(),
    });
    assert.equal(composed, undefined, 'kernel-empty-boot path expects undefined');
  });

  it('composeScanExtensions with built-ins returns the full set', () => {
    const composed = composeScanExtensions({
      noBuiltIns: false,
      pluginRuntime: emptyPluginRuntime(),
    });
    assert.ok(composed);
    assert.ok(composed.providers.length >= 1, 'expected at least the claude provider');
    assert.ok(composed.extractors.length >= 1, 'expected at least one built-in extractor');
    assert.ok(composed.analyzers.length >= 1, 'expected at least one built-in rule');
  });

  it('composeFormatters({ noBuiltIns: true }) excludes built-in formatters', async () => {
    const customDir = freshDir('formatter-only');
    plantFormatter(customDir, 'custom-formatter', 'csv');
    const bundle = await loadPluginRuntime({ pluginDir: customDir });

    const noBi = composeFormatters({ noBuiltIns: true, pluginRuntime: bundle });
    assert.equal(noBi.length, 1);
    assert.equal(noBi[0]!.formatId, 'csv');

    const withBi = composeFormatters({ pluginRuntime: bundle });
    assert.ok(withBi.length >= 2, 'expected built-in ascii + plugin csv');
    assert.ok(withBi.some((f) => f.formatId === 'ascii'));
    assert.ok(withBi.some((f) => f.formatId === 'csv'));
  });

  // Spec § A.7, granularity. The runtime composer is the layer where
  // per-extension toggles for granularity=extension bundles take effect
  // (the loader's pre-import resolveEnabled is coarse / bundle-level).
  // Four cases cover the model:
  //   (a) disable the whole `claude` bundle → none of its 4 extensions reach scan.
  //   (b) disable `core/superseded` → only that rule disappears; the other
  //       core extensions stay live.
  //   (c) default, every built-in runs.
  //   (d) `--no-built-ins` overrides everything.
  describe('granularity, built-in toggle filter', () => {
    it('(a) disable claude → claude provider skips compose; core extensions untouched', () => {
      const bundle = emptyPluginRuntime();
      bundle.resolveEnabled = (id: string) => id !== 'claude';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: bundle });
      assert.ok(composed, 'core extensions still keep the pipeline non-empty');
      // Disabling the `claude` bundle drops only `claudeProvider`. The
      // `antigravity`, `agent-skills`, `core-markdown`, and `openai`
      // providers stay (each lives in its own bundle).
      const providerIds = composed.providers.map((p) => p.id).sort();
      assert.deepEqual(providerIds, ['agent-skills', 'antigravity', 'markdown', 'openai']);
      // Phase 4b of the active-lens migration moved `at-directive` and
      // `slash` from `core` BACK to `claude` (Claude-flavoured rules).
      // Disabling the `claude` bundle now drops those too; the
      // surviving core extractors are the truly universal ones.
      const extractorIds = composed.extractors.map((d) => d.id).sort();
      assert.deepEqual(extractorIds, [
        'annotations',
        'external-url-counter',
        'markdown-link',
        'mcp-tools',
        'tools-count',
      ]);
      // core/* rules unaffected.
      assert.ok(composed.analyzers.length >= 5, 'every core rule should survive');
    });

    it('(b) disable core/superseded → only that rule skips; other 15 core extensions stay', () => {
      const bundle = emptyPluginRuntime();
      bundle.resolveEnabled = (id: string) => id !== 'core/superseded';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: bundle });
      assert.ok(composed);
      const analyzerIds = composed.analyzers.map((r) => r.id).sort();
      // The 16 built-in rules are: trigger-collision, broken-ref,
      // superseded, link-conflict, annotation-stale, annotation-orphan,
      // job-orphan-file, stability, unknown-field, contribution-orphan,
      // validate-all, link-counts, reserved-name,
      // redundant-target-reference, self-loop, signal-collision.
      // Disabling `core/superseded` drops only one; the surviving 15
      // are listed below in alphabetical order.
      assert.deepEqual(analyzerIds, [
        'annotation-orphan',
        'annotation-stale',
        'broken-ref',
        'contribution-orphan',
        'job-orphan-file',
        'link-conflict',
        'link-counts',
        'redundant-target-reference',
        'reserved-name',
        'self-loop',
        'signal-collision',
        'stability',
        'trigger-collision',
        'unknown-field',
        'validate-all',
      ]);
      // claude / antigravity / openai / agent-skills / core-markdown providers
      // untouched; core extractors unaffected.
      assert.equal(composed.providers.length, 5);
      assert.equal(composed.extractors.length, 7, 'all 7 core extractors stay');
      // Formatter composer also respects the filter.
      const formatters = composeFormatters({ pluginRuntime: bundle });
      // ascii + json formatters; superseded toggle is unrelated to either.
      assert.equal(formatters.length, 2, 'ascii + json formatters still on; superseded toggle is unrelated');
    });

    it('(c) default, every built-in runs', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
      });
      assert.ok(composed);
      assert.equal(composed.providers.length, 5, 'claude + antigravity + openai + agent-skills + core-markdown providers loaded');
      assert.equal(composed.extractors.length, 7, 'all 7 core extractors loaded (stability moved to analyzers)');
      assert.equal(composed.analyzers.length, 16, 'all 16 rules loaded (15 prior + signal-collision from Phase 2.D of the Signal IR migration)');
      const formatters = composeFormatters({ pluginRuntime: emptyPluginRuntime() });
      assert.equal(formatters.length, 2, 'ascii + json formatters loaded');
    });

    it('(d) --no-built-ins overrides per-extension config (everything off)', () => {
      const bundle = emptyPluginRuntime();
      // Every id enabled at the resolver level, the macro flag must
      // still win and produce an empty pipeline.
      bundle.resolveEnabled = () => true;
      const composed = composeScanExtensions({ noBuiltIns: true, pluginRuntime: bundle });
      assert.equal(composed, undefined, '--no-built-ins + empty plugin runtime → undefined (zero-extension)');
      const formatters = composeFormatters({ noBuiltIns: true, pluginRuntime: bundle });
      assert.equal(formatters.length, 0);
    });

    it('(e) per-extension override INSIDE bundle granularity disables one extension while keeping the bundle live', () => {
      // Phase 4b follow-up: granularity=bundle bundles accept
      // per-extension overrides on top of the bundle kill-switch.
      // Disabling `claude/at-directive` while leaving `claude` enabled
      // must drop only that extractor; the rest of the claude bundle
      // (provider + slash) stays in the pipeline.
      const bundle = emptyPluginRuntime();
      bundle.resolveEnabled = (id: string) => id !== 'claude/at-directive';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: bundle });
      assert.ok(composed);
      const extractorIds = composed.extractors.map((d) => d.id).sort();
      assert.equal(
        extractorIds.includes('at-directive'),
        false,
        'claude/at-directive must be silenced by the per-extension override',
      );
      assert.ok(
        extractorIds.includes('slash'),
        'claude/slash stays live (sibling extension, no override on it)',
      );
      const providerIds = composed.providers.map((p) => p.id).sort();
      assert.ok(
        providerIds.includes('claude'),
        'claude provider stays live (bundle is still enabled)',
      );
    });

    it('(f) bundle kill-switch overrides any per-extension truthy override', () => {
      // When the bundle id resolves to false, the bundle is OFF entirely,
      // a per-extension `enabled: true` override does NOT resurrect the
      // extension. This guards the "bundle as coarse kill-switch"
      // promise documented in plugin-author-guide.md § Granularity.
      const bundle = emptyPluginRuntime();
      bundle.resolveEnabled = (id: string) => id !== 'claude';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: bundle });
      assert.ok(composed);
      const providerIds = composed.providers.map((p) => p.id);
      assert.equal(providerIds.includes('claude'), false);
      const extractorIds = composed.extractors.map((d) => d.id);
      assert.equal(extractorIds.includes('at-directive'), false);
      assert.equal(extractorIds.includes('slash'), false);
    });

    it('filterBuiltInManifests honours bundle vs extension granularity', () => {
      const all = listBuiltIns();
      // Disable claude (bundle granularity) AND core/superseded
      // (extension granularity); everything else stays.
      const survivors = filterBuiltInManifests(all, (id: string) => {
        if (id === 'claude') return false;
        if (id === 'core/superseded') return false;
        return true;
      });
      const surviveIds = survivors.map((m) => `${m.pluginId}/${m.id}`).sort();
      assert.equal(surviveIds.includes('claude/claude'), false);
      assert.equal(surviveIds.includes('core/superseded'), false);
      // Phase 4b: `at-directive` and `slash` moved BACK to the `claude`
      // bundle (Claude-flavoured interpretation rules), so disabling
      // the bundle now cascades to them. `core/annotations` and
      // `core/external-url-counter` stay in `core` because their
      // semantics are universal.
      assert.equal(surviveIds.includes('claude/slash'), false);
      assert.equal(surviveIds.includes('claude/at-directive'), false);
      assert.ok(surviveIds.includes('core/annotations'));
      assert.ok(surviveIds.includes('core/broken-ref'));
      assert.ok(surviveIds.includes('core/external-url-counter'));
      assert.ok(surviveIds.includes('core/ascii'));
    });
  });

  // Conformance kill-switches, composer-level contract. The
  // conformance runner injects `SKILL_MAP_DISABLE_ALL_*=1` env vars
  // when running `sm scan` as a child process; the CLI verb reads
  // them at the boundary via `readConformanceKillSwitches()` and
  // threads the resolved booleans here. The composer itself is
  // env-agnostic, these tests assert against the typed options bag.
  // Cases:
  //   (a) providers:true → providers empty, extractors + rules unaffected.
  //   (b) extractors:true → extractors empty.
  //   (c) analyzers:true → rules empty.
  //   (d) all three true → composed=undefined (kernel-empty-boot).
  //
  // The helper's '1'-literal env contract is covered separately
  // (`describe('readConformanceKillSwitches, env-var contract')`).
  describe('conformance kill-switches (composer options)', () => {
    it('(a) killSwitches.providers empties only the providers bucket', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        killSwitches: { providers: true },
      });
      assert.ok(composed);
      assert.equal(composed.providers.length, 0);
      assert.equal(composed.extractors.length, 7, 'extractors untouched');
      assert.equal(composed.analyzers.length, 16, 'rules untouched');
    });

    it('(b) killSwitches.extractors empties only the extractors bucket', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        killSwitches: { extractors: true },
      });
      assert.ok(composed);
      assert.equal(composed.providers.length, 5);
      assert.equal(composed.extractors.length, 0);
      assert.equal(composed.analyzers.length, 16);
    });

    it('(c) killSwitches.analyzers empties only the rules bucket', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        killSwitches: { analyzers: true },
      });
      assert.ok(composed);
      assert.equal(composed.providers.length, 5);
      assert.equal(composed.extractors.length, 7);
      assert.equal(composed.analyzers.length, 0);
    });

    it('(d) all three true → composed undefined (kernel-empty-boot invariant)', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        killSwitches: { providers: true, extractors: true, analyzers: true },
      });
      assert.equal(composed, undefined);
    });
  });

  // `readConformanceKillSwitches`, adapter-side contract. The helper
  // reads three env vars and returns the typed bag the composer
  // consumes. Truthy = literal `'1'`. Anything else (absent, `'0'`,
  // `'true'`, whitespace) is `false` so the conformance runner
  // injecting `'1'` is unambiguous and a stray export of the variable
  // in a developer shell does not silently disable production scans.
  describe('readConformanceKillSwitches, env-var contract', () => {
    it('returns all-false when no env vars are set', () => {
      const bag = readConformanceKillSwitches({});
      assert.equal(bag.providers, false);
      assert.equal(bag.extractors, false);
      assert.equal(bag.analyzers, false);
    });

    it('returns all-true when each env var is literal "1"', () => {
      const bag = readConformanceKillSwitches({
        SKILL_MAP_DISABLE_ALL_PROVIDERS: '1',
        SKILL_MAP_DISABLE_ALL_EXTRACTORS: '1',
        SKILL_MAP_DISABLE_ALL_ANALYZERS: '1',
      });
      assert.equal(bag.providers, true);
      assert.equal(bag.extractors, true);
      assert.equal(bag.analyzers, true);
    });

    it('treats every non-"1" value as off', () => {
      for (const stray of ['0', 'true', 'yes', '', ' 1 ']) {
        const bag = readConformanceKillSwitches({
          SKILL_MAP_DISABLE_ALL_PROVIDERS: stray,
          SKILL_MAP_DISABLE_ALL_EXTRACTORS: stray,
          SKILL_MAP_DISABLE_ALL_ANALYZERS: stray,
        });
        assert.equal(bag.providers, false, `stray value ${JSON.stringify(stray)} must be off`);
        assert.equal(bag.extractors, false, `stray value ${JSON.stringify(stray)} must be off`);
        assert.equal(bag.analyzers, false, `stray value ${JSON.stringify(stray)} must be off`);
      }
    });
  });

  it('failed plugins surface in warnings, not extensions', async () => {
    const dir = freshDir('mixed');
    // Bad plugin
    const bad = join(dir, 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'plugin.json'), '{ malformed');
    // Good plugin alongside
    plantExtractor(dir, 'good');

    const bundle = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(bundle.discovered.length, 2);
    assert.equal(bundle.extensions.extractors.length, 1, 'only the good plugin loaded');
    assert.equal(bundle.warnings.length, 1, 'one warning for the broken plugin');
    assert.match(bundle.warnings[0]!, /broken: invalid-manifest/);
  });
});
