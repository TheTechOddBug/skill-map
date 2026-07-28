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
} from '../plugin-runtime.js';
import { readConformanceKillSwitches } from '../../../cli/util/conformance-env.js';
import { builtInPlugins, listBuiltIns } from '../../../plugins/built-ins.js';

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
      actions: [],
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

  it('composeScanExtensions populates resolvedSettings without mutating the built-in singleton', () => {
    const TARGET = 'core/external-url-counter';
    // A resolver that stamps a sentinel only on the target extractor.
    const composed = composeScanExtensions({
      noBuiltIns: false,
      pluginRuntime: emptyPluginRuntime(),
      resolveSettings: (ext) =>
        `${ext.pluginId}/${ext.id}` === TARGET ? { 'ignored-domains': ['sentinel.test'] } : {},
    });
    assert.ok(composed);
    const target = composed.extractors.find((e) => `${e.pluginId}/${e.id}` === TARGET);
    assert.ok(target, 'expected the external-url-counter extractor in the composed set');
    assert.deepEqual(target.resolvedSettings, { 'ignored-domains': ['sentinel.test'] });

    // The composed instance MUST be a shallow copy, not the module-level
    // singleton: the shared singleton in `builtInPlugins` keeps its
    // original (un-stamped) `resolvedSettings` so one scan's operator
    // values never leak into the next invocation.
    const singleton = builtInPlugins
      .flatMap((p) => p.extensions)
      .find((e) => `${e.pluginId}/${e.id}` === TARGET);
    assert.ok(singleton);
    assert.notEqual(singleton, target, 'composed extension must be a copy, not the singleton');
    assert.equal(singleton.resolvedSettings, undefined, 'singleton must not be mutated by compose');
  });

  // `allowSidecarWriters: false` project policy. The composer drops
  // every Action that declares `writes: ['sidecar']` so its inspector
  // button never projects. Identified by the manifest capability, not
  // an id list, so the gate covers external plugins too. The three
  // core writer actions are `node-bump` / `node-set-stability`
  // (experimental, off by default) + `node-set-tags`; the resolver
  // override enables all of them so the filter, not the default
  // experimental gate, is what removes them.
  describe('forbidSidecarWriters policy filter', () => {
    const WRITER_IDS = [
      'core/node-bump',
      'core/node-set-tags',
      'core/node-set-stability',
    ];
    const enableAll = (): boolean => true;

    it('keeps sidecar-writer actions when the policy permits writers', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        resolveEnabled: enableAll,
      });
      assert.ok(composed);
      const ids = composed.actions.map((a) => `${a.pluginId}/${a.id}`);
      for (const id of WRITER_IDS) {
        assert.ok(ids.includes(id), `expected ${id} in composed actions`);
      }
    });

    it('drops every sidecar-writer action when forbidSidecarWriters is true; other kinds untouched', () => {
      const allowed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        resolveEnabled: enableAll,
      });
      const forbidden = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        resolveEnabled: enableAll,
        forbidSidecarWriters: true,
      });
      assert.ok(allowed && forbidden);
      const forbiddenIds = forbidden.actions.map((a) => `${a.pluginId}/${a.id}`);
      for (const id of WRITER_IDS) {
        assert.ok(!forbiddenIds.includes(id), `expected ${id} dropped under the policy`);
      }
      // The policy is action-scoped: analyzers / extractors are intact.
      assert.deepEqual(
        forbidden.analyzers.map((a) => `${a.pluginId}/${a.id}`).sort(),
        allowed.analyzers.map((a) => `${a.pluginId}/${a.id}`).sort(),
      );
      assert.deepEqual(
        forbidden.extractors.map((e) => `${e.pluginId}/${e.id}`).sort(),
        allowed.extractors.map((e) => `${e.pluginId}/${e.id}`).sort(),
      );
    });

    it('the three core writer actions declare writes: [sidecar]', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        resolveEnabled: enableAll,
      });
      assert.ok(composed);
      const actions = composed.actions;
      for (const id of WRITER_IDS) {
        const matches = actions.filter((a) => `${a.pluginId}/${a.id}` === id);
        assert.equal(matches.length, 1, `expected exactly one ${id} in composed actions`);
        assert.deepEqual(matches[0]!.writes, ['sidecar']);
      }
    });
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
  //   (b) disable `core/name-collision` → only that rule disappears.
  //   (c) default: every built-in runs EXCEPT experimental ones, which
  //       ship disabled (`core/mcp-tools` stays out until opted in).
  //   (d) `--no-built-ins` overrides everything.
  //   (e) disable one extension inside a multi-extension plugin.
  describe('per-extension toggle filter', () => {
    it('(a) disable every claude extension by qualified id → claude plugin skips compose; core extensions untouched', () => {
      const runtime = emptyPluginRuntime();
      runtime.resolveEnabled = (id: string) =>
        ![
          'claude/claude',
          'claude/at-directive',
          'claude/backtick-mention',
          'claude/tools-counter',
        ].includes(id);
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: runtime });
      assert.ok(composed, 'core extensions still keep the pipeline non-empty');
      // The `claude` provider drops; the other vendor providers and the
      // markdown fallback stay.
      const providerIds = composed.providers.map((p) => p.id).sort();
      assert.deepEqual(providerIds, ['agent-skills', 'antigravity', 'codex', 'markdown', 'opencode']);
      // The three claude-bundled extractors (at-directive, backtick-mention,
      // tools-counter) drop alongside the provider; the survivors are the
      // vendor-neutral `core` extractors (including the moved
      // `slash-command` + `at-file`) PLUS codex's OWN `dollar-skill`, all
      // composed by default like any built-in.
      const extractorIds = composed.extractors.map((d) => d.id).sort();
      assert.deepEqual(extractorIds, [
        'at-file',
        'backtick-dollar',
        'backtick-path',
        'backtick-slash',
        'dollar-skill',
        'external-url-counter',
        'markdown-link',
        'mcp-tools',
        'slash-command',
      ]);
      // core/* rules unaffected.
      assert.ok(composed.analyzers.length >= 5, 'every core rule should survive');
    });

    it('(b) disable core/name-collision → only that rule skips; every other core analyzer stays', () => {
      const runtime = emptyPluginRuntime();
      runtime.resolveEnabled = (id: string) => id !== 'core/name-collision';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: runtime });
      assert.ok(composed);
      const analyzerIds = composed.analyzers.map((r) => r.id).sort();
      // 16 built-in analyzers ship now (the former projector analyzers
      // `core/supersede` + `core/tags` were deleted; the inspector
      // buttons that remain self-project from their own actions, e.g.
      // `core/node-set-stability`. Tag editing moved inline into the
      // inspector tag row, so `core/node-set-tags` no longer self-projects
      // a button; the
      // `core/score-resolution` score-phase scorer was deleted too, the
      // kernel now seeds the 1.0 confidence baseline directly and the
      // `core/name-reserved` / `core/reference-broken` detectors apply
      // their penalty deltas on top; `core/job-file-orphan` was removed,
      // to be reintroduced under a probabilistic evaluation model;
      // `core/name-mismatch` joined for the declared-vs-path-handle
      // divergence). This custom resolver enables every id except
      // `core/name-collision`, so 23 compose (the five optimization
      // finders ai-verbosity/-vagueness/-structure/-trigger/-scope joined
      // 2026-07-22, experimental but enabled by this resolver), listed below in
      // alphabetical order (`issue-counter` is the lone aggregate-phase
      // analyzer; `name-reserved` + `reference-broken` are the
      // score-phase ones; the three `ai-*` finders are probabilistic,
      // present in the composed catalog as queue targets but excluded
      // from every scan-time phase by the orchestrator's mode gate, and
      // sort first because `ai-` precedes `annotation-`).
      assert.deepEqual(analyzerIds, [
        'ai-contradiction-analyzer',
        'ai-incoherence-analyzer',
        'ai-redundancy-analyzer',
        'ai-scope-analyzer',
        'ai-security-analyzer',
        'ai-structure-analyzer',
        'ai-suspicion-analyzer',
        'ai-trigger-analyzer',
        'ai-vagueness-analyzer',
        'ai-verbosity-analyzer',
        'annotation-field-unknown',
        'annotation-orphan',
        'annotation-stale',
        'extractor-collision',
        'issue-counter',
        'link-counter',
        'link-kind-conflict',
        'link-self-loop',
        'name-mismatch',
        'name-reserved',
        'node-stability',
        'reference-broken',
        'reference-redundant',
        'schema-violation',
      ]);
      // claude / antigravity / codex / agent-skills / core-markdown providers
      // untouched; core extractors unaffected.
      assert.equal(composed.providers.length, 6);
      assert.equal(composed.extractors.length, 12, 'all 12 extractors stay');
      // Formatter composer also respects the filter.
      const formatters = composeFormatters({ pluginRuntime: runtime });
      // ascii + json formatters; name-collision toggle is unrelated to either.
      assert.equal(formatters.length, 2, 'ascii + json formatters still on; name-collision toggle is unrelated');
    });

    it('(c) default: every built-in runs except experimental ones', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
      });
      assert.ok(composed);
      assert.equal(composed.providers.length, 6, 'claude + antigravity (beta) + codex (beta) + opencode (beta) + agent-skills (stable, locked) + core-markdown load by default');
      assert.equal(composed.extractors.length, 12, 'all 12 extractors load by default; core/mcp-tools was promoted experimental → beta so it now ships enabled (the codex grammar extractors and the code-region siblings backtick-mention + backtick-slash + backtick-dollar load too)');
      assert.equal(composed.analyzers.length, 25, 'all 25 analyzers load by default; after core/annotation-stale graduated to stable (2026-07-19) no built-in analyzer is experimental, so every analyzer ships enabled, while the three probabilistic finders (ai-redundancy-analyzer / ai-contradiction-analyzer / ai-incoherence-analyzer) are STABLE queue targets excluded from scan-time phases by the mode gate (the former projector analyzers core/supersede + core/tags were deleted; the remaining inspector buttons self-project from their actions and tag editing moved inline; core/score-resolution was deleted, the kernel now seeds the 1.0 baseline directly; core/job-file-orphan was removed, to return under a probabilistic evaluation model; core/name-mismatch joined for declared-vs-path-handle divergences; core/contribution-orphan, the never-implemented stub, was deleted 2026-07-22; all five optimization finders ai-verbosity/-vagueness/-structure/-trigger/-scope graduated stable/enabled on 2026-07-22 after the one-by-one live playground pass; the two security finders ai-security-analyzer / ai-suspicion-analyzer graduated 2026-07-23 after theirs)');
      // Actions load into the pipeline as dispatch targets; those with a
      // `project()` also self-project an inspector button (e.g.
      // `core/node-set-stability`). `core/node-set-tags` is stable and
      // loads by default but no longer self-projects a button (tag editing
      // is inline in the inspector); `core/node-bump` stays experimental
      // (the sidecar writer opts in), so it ships disabled (no Bump button
      // by default), while its companion `core/annotation-stale` drift
      // analyzer graduated to stable and surfaces drift by default, the two
      // are no longer gated as a unit.
      const actionIds = composed.actions.map((a) => a.id).sort();
      assert.ok(actionIds.includes('node-set-tags'), 'core/node-set-tags is stable and loads by default (dispatched on-demand)');
      assert.ok(
        !actionIds.includes('node-bump'),
        'core/node-bump is experimental → ships disabled, not in the default pipeline',
      );
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
      // and its `claude/tools-counter` sibling stay in the pipeline.
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
        extractorIds.includes('tools-counter'),
        'claude/tools-counter stays live (sibling extension, no override on it)',
      );
      const providerIds = composed.providers.map((p) => p.id).sort();
      assert.ok(
        providerIds.includes('claude'),
        'claude provider stays live (no override on its qualified id)',
      );
    });

    it('(f) a beta extractor ships enabled; an experimental extension stays disabled unless overridden', () => {
      // `core/mcp-tools` was promoted experimental → beta, so it now ships
      // ENABLED by default and composes without any override.
      // `core/node-bump` is still experimental (the sidecar writer opts
      // in), so with the default resolver it must NOT compose; an explicit
      // enable override for its qualified id beats the installed default
      // and brings it back, just like any other extension. (Its former
      // pair-mate `core/annotation-stale` graduated to stable on
      // 2026-07-19, so it no longer serves as the experimental example.)
      const off = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
      });
      assert.ok(off);
      assert.ok(
        off.extractors.some((e) => e.id === 'mcp-tools'),
        'beta core/mcp-tools ships enabled and composes by default',
      );
      assert.equal(
        off.actions.some((a) => a.id === 'node-bump'),
        false,
        'experimental core/node-bump is excluded from the default pipeline',
      );

      const runtime = emptyPluginRuntime();
      // An explicit override force-enables the opted-in experimental id on
      // top of the installed defaults (an action alone would not make the
      // pipeline non-empty, so the rest of the default catalog rides along).
      const baseResolve = runtime.resolveEnabled.bind(runtime);
      runtime.resolveEnabled = (id: string) => id === 'core/node-bump' || baseResolve(id);
      const on = composeScanExtensions({ noBuiltIns: false, pluginRuntime: runtime });
      assert.ok(on);
      assert.ok(
        on.actions.some((a) => a.id === 'node-bump'),
        'an explicit enable override restores the experimental action',
      );
    });

    it('filterBuiltInManifests narrows to the enabled extensions', () => {
      const all = listBuiltIns();
      // Disable every claude extension by qualified id AND
      // `core/name-collision`; everything else stays.
      const claudeIds = new Set(['claude/claude', 'claude/at-directive', 'claude/tools-counter']);
      const survivors = filterBuiltInManifests(all, (id: string) => {
        if (claudeIds.has(id)) return false;
        if (id === 'core/name-collision') return false;
        return true;
      });
      const surviveIds = survivors.map((m) => `${m.pluginId}/${m.id}`).sort();
      assert.equal(surviveIds.includes('claude/claude'), false);
      assert.equal(surviveIds.includes('core/name-collision'), false);
      assert.equal(surviveIds.includes('claude/tools-counter'), false);
      assert.equal(surviveIds.includes('claude/at-directive'), false);
      // `slash-command` / `at-file` moved to the vendor-neutral `core` plugin,
      // so a claude-scoped filter no longer touches them.
      assert.ok(surviveIds.includes('core/slash-command'));
      assert.ok(surviveIds.includes('core/markdown-link'));
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
      assert.equal(composed.extractors.length, 12, 'extractors untouched (12: core/mcp-tools is now beta so it ships enabled; the codex grammar extractors and the three code-region trigger siblings load)');
      assert.equal(composed.analyzers.length, 25, 'analyzers untouched (all 25: core/annotation-stale graduated to stable so no built-in analyzer is experimental, and the three probabilistic finders are STABLE queue targets; the projector analyzers core/supersede + core/tags were deleted; core/score-resolution was deleted, the kernel seeds the 1.0 baseline directly; core/job-file-orphan was removed; core/name-mismatch joined; the contribution-orphan stub was deleted)');
    });

    it('(b) killSwitches.extractors empties only the extractors bucket', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        killSwitches: { extractors: true },
      });
      assert.ok(composed);
      assert.equal(composed.providers.length, 6, 'providers untouched (6: claude + antigravity (beta) + codex (beta) + opencode (beta) + agent-skills (stable, locked) + core-markdown load)');
      assert.equal(composed.extractors.length, 0);
      assert.equal(composed.analyzers.length, 25, 'analyzers untouched (all 25: no built-in analyzer is experimental since core/annotation-stale graduated to stable; the three probabilistic finders are stable queue targets)');
    });

    it('(c) killSwitches.analyzers empties only the rules bucket', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
        killSwitches: { analyzers: true },
      });
      assert.ok(composed);
      assert.equal(composed.providers.length, 6, 'providers untouched (6: claude + antigravity (beta) + codex (beta) + opencode (beta) + agent-skills (stable, locked) + core-markdown load)');
      assert.equal(composed.extractors.length, 12, 'extractors untouched (12: core/mcp-tools is now beta, enabled by default)');
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
    assert.match(runtime.warnings[0]!, /plugin broken \(invalid-manifest\), all extensions skipped/);
  });
});
