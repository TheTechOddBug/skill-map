/**
 * Step 9.1 follow-up, branch coverage for plugin-runtime.ts. The
 * happy path (no `pluginDir`, walks `<cwd>/.skill-map/plugins/`) is
 * exercised by the end-to-end tests in `plugin-runtime.test.ts`.
 * This file targets the remaining branches:
 *
 *   - `pluginDir` override replaces the project search path
 *   - `emptyPluginRuntime()` returns the canonical zero-runtime shape
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

    const runtime = await loadPluginRuntime({ pluginDir: customDir });
    assert.equal(runtime.discovered.length, 1);
    assert.equal(runtime.discovered[0]!.id, 'custom-only');
    assert.equal(runtime.extensions.extractors.length, 1);
    assert.equal(runtime.extensions.extractors[0]!.id, 'custom-only-d');
  });

  it('emptyPluginRuntime() returns the canonical zero-runtime shape', () => {
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
    const runtime = await loadPluginRuntime({ pluginDir: customDir });

    const noBi = composeFormatters({ noBuiltIns: true, pluginRuntime: runtime });
    assert.equal(noBi.length, 1);
    assert.equal(noBi[0]!.formatId, 'csv');

    const withBi = composeFormatters({ pluginRuntime: runtime });
    assert.ok(withBi.length >= 2, 'expected built-in ascii + plugin csv');
    assert.ok(withBi.some((f) => f.formatId === 'ascii'));
    assert.ok(withBi.some((f) => f.formatId === 'csv'));
  });

  // Every extension is independently toggle-able by its qualified id
  // `<plugin>/<ext>`. The runtime composer is the layer where those
  // toggles take effect (the loader's pre-import gate uses the same
  // key). Five cases cover the model:
  //   (a) disable every claude extension by qualified id → claude
  //       provider + extractors all skip compose; core stays.
  //   (b) disable `core/node-superseded` → only that rule disappears.
  //   (c) default, every built-in runs.
  //   (d) `--no-built-ins` overrides everything.
  //   (e) disable one extension inside a multi-extension plugin.
  describe('per-extension toggle filter', () => {
    it('(a) disable every claude extension by qualified id → claude plugin skips compose; core extensions untouched', () => {
      const runtime = emptyPluginRuntime();
      runtime.resolveEnabled = (id: string) =>
        !['claude/claude', 'claude/at-directive', 'claude/slash-command'].includes(id);
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: runtime });
      assert.ok(composed, 'core extensions still keep the pipeline non-empty');
      // The `claude` provider drops; the other vendor providers and the
      // markdown fallback stay.
      const providerIds = composed.providers.map((p) => p.id).sort();
      assert.deepEqual(providerIds, ['agent-skills', 'antigravity', 'markdown', 'openai']);
      // The two claude-bundled extractors drop alongside the provider;
      // the surviving extractors are the truly universal ones in `core`.
      const extractorIds = composed.extractors.map((d) => d.id).sort();
      assert.deepEqual(extractorIds, [
        'annotations',
        'external-url-counter',
        'markdown-link',
        'mcp-tools',
        'tools-counter',
      ]);
      // core/* rules unaffected.
      assert.ok(composed.analyzers.length >= 5, 'every core rule should survive');
    });

    it('(b) disable core/node-superseded → only that rule skips; other 17 core extensions stay', () => {
      const runtime = emptyPluginRuntime();
      runtime.resolveEnabled = (id: string) => id !== 'core/node-superseded';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: runtime });
      assert.ok(composed);
      const analyzerIds = composed.analyzers.map((r) => r.id).sort();
      // The 19 built-in rules: 18 detect-phase analyzers plus the
      // `issue-counter` aggregate analyzer that emits the per-card
      // severity chips post-walk. Disabling `core/node-superseded`
      // drops only one; the surviving 18 are listed below in
      // alphabetical order.
      assert.deepEqual(analyzerIds, [
        'annotation-field-unknown',
        'annotation-orphan',
        'annotation-stale',
        'contribution-orphan',
        'issue-counter',
        'job-file-orphan',
        'link-conflict',
        'link-counter',
        'link-self-loop',
        'name-reserved',
        'node-stability',
        'reference-broken',
        'reference-redundant',
        'schema-violation',
        'signal-collision',
        'supersede',
        'tags',
        'trigger-collision',
      ]);
      // claude / antigravity / openai / agent-skills / core-markdown providers
      // untouched; core extractors unaffected.
      assert.equal(composed.providers.length, 5);
      assert.equal(composed.extractors.length, 7, 'all 7 core extractors stay');
      // Formatter composer also respects the filter.
      const formatters = composeFormatters({ pluginRuntime: runtime });
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
      assert.equal(composed.analyzers.length, 19, 'all 19 rules loaded (18 detect-phase analyzers including the tags button projector + the issue-counter aggregate)');
      const formatters = composeFormatters({ pluginRuntime: emptyPluginRuntime() });
      assert.equal(formatters.length, 2, 'ascii + json formatters loaded');
    });

    it('(d) --no-built-ins overrides per-extension config (everything off)', () => {
      const runtime = emptyPluginRuntime();
      // Every id enabled at the resolver level, the macro flag must
      // still win and produce an empty pipeline.
      runtime.resolveEnabled = () => true;
      const composed = composeScanExtensions({ noBuiltIns: true, pluginRuntime: runtime });
      assert.equal(composed, undefined, '--no-built-ins + empty plugin runtime → undefined (zero-extension)');
      const formatters = composeFormatters({ noBuiltIns: true, pluginRuntime: runtime });
      assert.equal(formatters.length, 0);
    });

    it('(e) per-extension override flips one extension while keeping the rest of the plugin live', () => {
      // Every extension is independently toggle-able; disabling
      // `claude/at-directive` drops only that extractor. The provider
      // and `claude/slash-command` stay in the pipeline.
      const runtime = emptyPluginRuntime();
      runtime.resolveEnabled = (id: string) => id !== 'claude/at-directive';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: runtime });
      assert.ok(composed);
      const extractorIds = composed.extractors.map((d) => d.id).sort();
      assert.equal(
        extractorIds.includes('at-directive'),
        false,
        'claude/at-directive must be silenced by the per-extension override',
      );
      assert.ok(
        extractorIds.includes('slash-command'),
        'claude/slash-command stays live (sibling extension, no override on it)',
      );
      const providerIds = composed.providers.map((p) => p.id).sort();
      assert.ok(
        providerIds.includes('claude'),
        'claude provider stays live (no override on its qualified id)',
      );
    });

    it('filterBuiltInManifests narrows to the enabled extensions', () => {
      const all = listBuiltIns();
      // Disable every claude extension by qualified id AND
      // `core/node-superseded`; everything else stays.
      const claudeIds = new Set(['claude/claude', 'claude/at-directive', 'claude/slash-command']);
      const survivors = filterBuiltInManifests(all, (id: string) => {
        if (claudeIds.has(id)) return false;
        if (id === 'core/node-superseded') return false;
        return true;
      });
      const surviveIds = survivors.map((m) => `${m.pluginId}/${m.id}`).sort();
      assert.equal(surviveIds.includes('claude/claude'), false);
      assert.equal(surviveIds.includes('core/node-superseded'), false);
      assert.equal(surviveIds.includes('claude/slash-command'), false);
      assert.equal(surviveIds.includes('claude/at-directive'), false);
      assert.ok(surviveIds.includes('core/annotations'));
      assert.ok(surviveIds.includes('core/reference-broken'));
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
      assert.equal(composed.analyzers.length, 19, 'rules untouched');
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
      assert.equal(composed.analyzers.length, 19);
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

    const runtime = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(runtime.discovered.length, 2);
    assert.equal(runtime.extensions.extractors.length, 1, 'only the good plugin loaded');
    assert.equal(runtime.warnings.length, 1, 'one warning for the broken plugin');
    assert.match(runtime.warnings[0]!, /broken: invalid-manifest/);
  });
});
