/**
 * Invariant: every built-in rule declares its execution mode explicitly as
 * `deterministic`. The schema makes the field optional with a deterministic
 * default, so omitting it would still be valid, but the project policy is
 * to thread it explicitly so a future probabilistic Analyzer is the visible
 * deviation, not a silent flip of the default.
 *
 * Providers, Extractors, and Formatters are deterministic-only and MUST
 * NOT carry the `mode` field.
 *
 * This file also doubles as the qualified-id contract test for built-ins
 * (spec § A.6): every built-in declares a `pluginId` (`core` or `claude`)
 * and `listBuiltIns()` surfaces it on every Registry-ready row.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { builtIns, listBuiltIns } from '../built-ins.js';
import { enrichmentKindOfReportSchema } from '../../kernel/enrichments/enrichment-schema.js';
import { isTagsReportSchema, summaryKindOfReportSchema } from '../../kernel/jobs/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { composeScanExtensions, emptyPluginRuntime } from '../../core/runtime/plugin-runtime.js';

describe('built-in extensions, execution modes', () => {
  it('extractor manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    assert.ok(set.extractors.length > 0, 'expected at least one built-in extractor');
    for (const d of set.extractors) {
      assert.equal(
        (d as unknown as Record<string, unknown>)['mode'],
        undefined,
        `extractor ${d.id} must not declare mode, extractors are deterministic-only`,
      );
    }
  });

  it('every built-in rule declares an explicit mode; finders carry the contract pair', () => {
    // Analyzers are DUAL-MODE since the findings pipeline: deterministic
    // rules implement `evaluate()` and run at scan time; probabilistic
    // finders ship the codegen-inlined `promptTemplate` + `reportSchema`
    // pair instead and never enter a scan phase.
    const set = builtIns();
    assert.ok(set.analyzers.length > 0, 'expected at least one built-in rule');
    for (const r of set.analyzers) {
      assert.ok(
        r.mode === 'deterministic' || r.mode === 'probabilistic',
        `rule ${r.id} should declare an explicit mode; got ${JSON.stringify(r.mode)}`,
      );
      if (r.mode === 'probabilistic') {
        assert.equal(typeof r.promptTemplate, 'string', `finder ${r.id} inlines prompt.md`);
        assert.ok(r.reportSchema, `finder ${r.id} inlines report.schema.json`);
        assert.equal(r.evaluate, undefined, `finder ${r.id} must not implement evaluate()`);
      } else {
        assert.equal(typeof r.evaluate, 'function', `rule ${r.id} implements evaluate()`);
      }
    }
  });

  // Naming pattern (user decision 2026-07-18): every probabilistic (AI)
  // built-in follows `ai-<subject>-<kind>`, so a finder Analyzer ends in
  // `-analyzer` and a fixer / summarizer Action ends in `-action`. The
  // convention lets the UI derive a bare label (`ai-redundancy-analyzer`
  // reads as `redundancy`) and marks the AI family at a glance. Enforced
  // here so a future probabilistic built-in cannot ship off-pattern.
  it('every probabilistic built-in follows the ai-<subject>-<kind> naming pattern', () => {
    const set = builtIns();
    const probs = [
      ...set.analyzers.filter((a) => a.mode === 'probabilistic').map((a) => ({ id: a.id, kind: 'analyzer' })),
      ...set.actions.filter((a) => a.mode === 'probabilistic').map((a) => ({ id: a.id, kind: 'action' })),
    ];
    assert.ok(probs.length > 0, 'expected at least one probabilistic built-in');
    for (const { id, kind } of probs) {
      assert.match(
        id,
        new RegExp(`^ai-[a-z0-9]+(-[a-z0-9]+)*-${kind}$`),
        `probabilistic ${kind} '${id}' must follow the ai-<subject>-${kind} naming pattern`,
      );
    }
  });

  // Every probabilistic built-in's prompt MUST reference the
  // `{{userContent}}` placeholder: the render engine
  // (`kernel/jobs/render.ts` validateTemplate) throws `JobRenderError` at
  // SUBMIT time otherwise, so a prompt missing it only fails when a job is
  // actually queued, not at build. Asserted here so a new probabilistic
  // built-in cannot ship an un-submittable prompt (regression guard:
  // `core/ai-ping-action` first shipped without the placeholder).
  it('every probabilistic built-in prompt references {{userContent}}', () => {
    const set = builtIns();
    const probs = [
      ...set.analyzers.filter((a) => a.mode === 'probabilistic'),
      ...set.actions.filter((a) => a.mode === 'probabilistic'),
    ];
    assert.ok(probs.length > 0, 'expected at least one probabilistic built-in');
    for (const ext of probs) {
      assert.equal(
        typeof ext.promptTemplate,
        'string',
        `probabilistic ${ext.kind} '${ext.id}' must inline a prompt template`,
      );
      assert.match(
        ext.promptTemplate ?? '',
        /\{\{userContent\}\}/,
        `probabilistic ${ext.kind} '${ext.id}' prompt must reference {{userContent}}`,
      );
    }
  });

  // Fixer / finder pairing (user decision 2026-07-18): a fixer is named
  // after the finder it serves, so `ai-<subject>-action` pairs with
  // `ai-<subject>-analyzer` (`ai-redundancy-action` fixes
  // `ai-redundancy-analyzer`). The two then read as one family and collapse
  // to the same bare label on the inspector's two-state button. A
  // probabilistic Action WITHOUT `precondition.analyzerIds` (the summarizer)
  // is not a fixer and is exempt.
  it('every fixer shares its finder subject (ai-<subject>-action pairs ai-<subject>-analyzer)', () => {
    const set = builtIns();
    const subject = (id: string): string =>
      id.replace(/^ai-/, '').replace(/-(analyzer|action)$/, '');
    // A fixer whose `analyzerIds` reference a DETERMINISTIC analyzer is EXEMPT
    // from the pairing convention: that convention pairs a probabilistic AI
    // finder with its fixer (`ai-<subject>-analyzer` <-> `ai-<subject>-action`)
    // so both collapse to one bare label, but a deterministic-analyzer fixer
    // (e.g. `ai-reference-action` fixing `core/reference-broken`) is named
    // after what it FIXES, not after its analyzer, so its subject never
    // matches the analyzer's short id. Look each analyzerId's mode up in the
    // built-in analyzer set and skip the assertion when it is deterministic.
    const analyzerModeById = new Map<string, string>();
    for (const analyzer of set.analyzers) {
      analyzerModeById.set(analyzer.id, analyzer.mode ?? 'deterministic');
      analyzerModeById.set(qualifiedExtensionId(analyzer.pluginId, analyzer.id), analyzer.mode ?? 'deterministic');
    }
    const referencesDeterministicAnalyzer = (ids: readonly string[]): boolean =>
      ids.some((id) => analyzerModeById.get(id) === 'deterministic');
    const fixers = set.actions.filter(
      (a) =>
        a.mode === 'probabilistic' &&
        (a.precondition?.analyzerIds?.length ?? 0) > 0 &&
        !referencesDeterministicAnalyzer(a.precondition?.analyzerIds ?? []),
    );
    assert.ok(fixers.length > 0, 'expected at least one finder-paired fixer');
    for (const fx of fixers) {
      const fixerSubject = subject(fx.id);
      const finderSubjects = (fx.precondition?.analyzerIds ?? []).map((qid) =>
        subject(qid.split('/').pop() ?? qid),
      );
      assert.ok(
        finderSubjects.includes(fixerSubject),
        `fixer '${fx.id}' (subject '${fixerSubject}') must share a finder's subject; analyzerIds are ${JSON.stringify(fx.precondition?.analyzerIds)}`,
      );
    }
  });

  it('provider manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    for (const a of set.providers) {
      assert.equal(
        (a as unknown as Record<string, unknown>)['mode'],
        undefined,
        `provider ${a.id} must not declare mode, providers are deterministic-only`,
      );
    }
  });

  it('formatter manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    for (const f of set.formatters) {
      assert.equal(
        (f as unknown as Record<string, unknown>)['mode'],
        undefined,
        `formatter ${f.id} must not declare mode, formatters are deterministic-only`,
      );
    }
  });
});

describe('built-in extensions, qualified ids (spec § A.6)', () => {
  it('every built-in declares a recognised pluginId (`core`, `claude`, `antigravity`, `codex`, `opencode`, `agent-skills`, `github`, `test-plugin`)', () => {
    const set = builtIns();
    const all = [
      ...set.providers,
      ...set.extractors,
      ...set.analyzers,
      ...set.formatters,
      ...set.actions,
    ];
    const valid = new Set(['core', 'claude', 'antigravity', 'codex', 'opencode', 'agent-skills', 'github', 'test-plugin']);
    for (const ext of all) {
      assert.ok(
        valid.has(ext.pluginId),
        `${ext.kind}:${ext.id} must declare a recognised built-in pluginId; got ${JSON.stringify(ext.pluginId)}`,
      );
    }
  });

  it('built-in qualified id catalogue matches the spec mapping', () => {
    const set = builtIns();
    const qualifiedByKindAndShort = new Map<string, string>();
    const all = [
      ...set.providers,
      ...set.extractors,
      ...set.analyzers,
      ...set.formatters,
      ...set.actions,
    ];
    for (const ext of all) {
      qualifiedByKindAndShort.set(`${ext.kind}:${ext.id}`, qualifiedExtensionId(ext.pluginId, ext.id));
    }

    // Vendor provider plugins (provider-only today).
    assert.equal(qualifiedByKindAndShort.get('provider:claude'), 'claude/claude');
    assert.equal(qualifiedByKindAndShort.get('provider:antigravity'), 'antigravity/antigravity');
    assert.equal(qualifiedByKindAndShort.get('provider:agent-skills'), 'agent-skills/agent-skills');

    // Core kernel built-ins.
    assert.equal(qualifiedByKindAndShort.get('extractor:slash-command'), 'core/slash-command');
    assert.equal(qualifiedByKindAndShort.get('extractor:at-directive'), 'claude/at-directive');
    assert.equal(qualifiedByKindAndShort.get('extractor:external-url-counter'), 'core/external-url-counter');
    assert.equal(qualifiedByKindAndShort.get('analyzer:name-collision'), 'core/name-collision');
    assert.equal(qualifiedByKindAndShort.get('analyzer:node-stability'), 'core/node-stability');
    assert.equal(qualifiedByKindAndShort.get('analyzer:reference-broken'), 'core/reference-broken');
    assert.equal(qualifiedByKindAndShort.get('analyzer:link-kind-conflict'), 'core/link-kind-conflict');
    assert.equal(qualifiedByKindAndShort.get('analyzer:annotation-stale'), 'core/annotation-stale');
    assert.equal(qualifiedByKindAndShort.get('analyzer:annotation-orphan'), 'core/annotation-orphan');
    assert.equal(qualifiedByKindAndShort.get('formatter:ascii'), 'core/ascii');
    assert.equal(qualifiedByKindAndShort.get('analyzer:schema-violation'), 'core/schema-violation');
    assert.equal(qualifiedByKindAndShort.get('action:node-bump'), 'core/node-bump');
    assert.equal(qualifiedByKindAndShort.get('action:node-set-stability'), 'core/node-set-stability');
    assert.equal(qualifiedByKindAndShort.get('action:node-set-tags'), 'core/node-set-tags');
    assert.equal(qualifiedByKindAndShort.get('action:ai-summarizer-action'), 'core/ai-summarizer-action');
    assert.equal(qualifiedByKindAndShort.get('action:ai-redundancy-action'), 'core/ai-redundancy-action');
    assert.equal(qualifiedByKindAndShort.get('action:ai-contradiction-action'), 'core/ai-contradiction-action');
    assert.equal(qualifiedByKindAndShort.get('action:ai-incoherence-action'), 'core/ai-incoherence-action');
    assert.equal(qualifiedByKindAndShort.get('action:ai-reference-action'), 'core/ai-reference-action');
    assert.equal(qualifiedByKindAndShort.get('action:enrichment'), 'github/enrichment');
  });

  // Tests for `analyzer.recommendedActions` were retired with the
  // structure-as-truth refactor: the analyzer→action relationship is now
  // declared on the Action side via `precondition.analyzerIds` (Modelo B).
  // A future Modelo-B coverage suite will assert that every action's
  // declared `analyzerIds` reference real built-in analyzers; see
  // bd-3pw.8 task notes.

  it('listBuiltIns() rows carry stability + defaultEnabled, so ships-disabled stays disabled', () => {
    // Regression: `toExtensionRow` used to drop both fields, on a comment
    // claiming "stability was retired with the manifest refactor". It was
    // not. With them undefined, `installedDefaultEnabled` answered
    // "enabled", so `filterBuiltInManifests` kept rows for extensions
    // that ship disabled and they registered on a project with no config
    // at all. Execution was never affected (those gates read live
    // instances), which is exactly why it went unnoticed: the bug was
    // registry VISIBILITY, and `sm help` listed things that never run.
    const rows = listBuiltIns();
    const enrichment = rows.find((r) => r.pluginId === 'github' && r.id === 'enrichment');
    assert.ok(enrichment, 'github/enrichment must be present as a row');
    assert.equal(enrichment.stability, 'experimental');

    const bump = rows.find((r) => r.pluginId === 'core' && r.id === 'node-bump');
    assert.ok(bump, 'core/node-bump must be present as a row');
    assert.equal(bump.defaultEnabled, false, 'the orthogonal opt-in axis survives onto the row');

    // Every row must agree with its live instance on both fields; a
    // divergence is the same class of bug reappearing somewhere else.
    const live = Object.values(builtIns()).flat();
    for (const row of rows) {
      const instance = live.find(
        (x) => x.pluginId === row.pluginId && x.id === row.id && x.kind === row.kind,
      );
      if (!instance) continue;
      assert.equal(
        row.stability,
        instance.stability,
        `row ${row.pluginId}/${row.id} lost its stability`,
      );
      assert.equal(
        row.defaultEnabled,
        instance.defaultEnabled,
        `row ${row.pluginId}/${row.id} lost its defaultEnabled`,
      );
    }
  });

  it('listBuiltIns() rows carry pluginId verbatim', () => {
    const rows = listBuiltIns();
    const valid = new Set(['core', 'claude', 'antigravity', 'codex', 'opencode', 'agent-skills', 'github', 'test-plugin']);
    for (const row of rows) {
      assert.ok(
        valid.has(row.pluginId),
        `Registry row ${row.kind}:${row.id} must carry a recognised built-in pluginId; got ${JSON.stringify(row.pluginId)}`,
      );
    }
    // Smoke check the count: 4 providers (claude + agent-skills + core-markdown, plus a vendor placeholder) + 6 extractors + 12 rules + 1 formatter + 2 actions + 1 hook = 26.
    // Phase 7 added `core/unknown-slot` and `core/contribution-orphan`.
    // `core/link-counter` (rule that emits per-node link-count view contributions) brought the total to 22.
    // `core/job-file-orphan` (rule that flags orphan MD files under .skill-map/jobs/) brought it to 23.
    // `core/update-check` (first built-in hook; subscribes to `boot` and runs the once-per-day update banner) brought it to 24.
    // `core/tools-counter` (agent-only extractor that emits the tools wrench chip to `card.footer.left`) brought it to 25; it later moved into the claude plugin as `claude/tools-counter` (its precondition is `claude/agent` only, so it ships with the provider it serves).
    // `core/node-stability` (analyzer that surfaces lifecycle state as a `card.footer.right` chip plus `deprecated → warn` / `experimental → info` issues; flipped from extractor → analyzer) brought it to 26.
    // `core/unknown-slot` was lifted out of the scan pipeline and into `sm plugins doctor` (it validates plugin manifest metadata, not user content), keeping it at 26 (had briefly grown to 29 with three project-level action stubs `relink-contributions` / `prune-orphan-files` / `node-supersede`, but `relink-contributions` + `prune-orphan-files` were removed because Actions are per-node by design, project-level cleanup belongs in CLI verbs; `node-supersede` remained as a per-node declarer).
    // `core/json` (second built-in formatter; stringifies the persisted `ScanResult` for `sm graph --format json`) brings it to 27.
    // `core/mcp-tools` (extractor that detects `tools: [mcp__<server>__*]` and emits MCP virtual nodes + reference edges) brings it to 28.
    // OpenAI Codex provider (`codex/codex`) brings it to 29.
    // `core/name-reserved` (analyzer that flags user nodes whose name collides with a Provider runtime's built-in invocable) brings it to 30.
    // `core/reference-redundant` (analyzer that flags multi-form references to the same target) brings it to 31.
    // `core/link-self-loop` (analyzer that flags links whose source is their own resolved target, hidden from the UI by default) brings it to 32.
    // `core/extractor-collision` (analyzer that surfaces Signal IR resolver rejections, range-overlap losers, as warn issues) brings it to 33.
    // `core/issue-counter` (aggregate analyzer that runs after the detect phase and emits the per-card error / warn count chips on `card.footer.right`, replacing the hand-rolled chip block in `<sm-node-card>`) brings it to 34.
    // `core/supersede` (analyzer that projected the inspector `Supersede` action button) brought it to 35.
    // `core/node-set-stability` + `core/node-set-tags` (two deterministic actions writing `annotations.stability` / `annotations.tags` to the sidecar) and `core/tags` (analyzer that projected the inspector `Edit tags` action button) brought it to 38.
    // `core/backtick-path` (extractor that turns relative `.md` paths inside code spans / fences into `points` edges, the inverse-mask exception to the code-strip policy) brought it to 39.
    // Actions self-project their inspector button via scan-time `project()`: the two pure projector analyzers `core/supersede` + `core/tags` were deleted (their buttons moved onto `core/node-supersede` / `core/node-set-tags`), dropping the total back to 37.
    // `core/score-resolution` (a former `score`-phase analyzer that assigned the resolved-link 1.0 confidence) was briefly added (38) then deleted: the kernel now seeds the 1.0 confidence baseline on every link directly, and only the `core/name-reserved` / `core/reference-broken` detectors apply penalty deltas on top, dropping the total back to 37.
    // `core/job-file-orphan` (the rule that flagged orphan MD files under .skill-map/jobs/) was removed, to be reintroduced later under a probabilistic evaluation model, dropping the total to 36. (Step 10 Phase A later retired the on-disk job-files model entirely: the `findOrphanJobFiles` helper + `sm jobs prune --orphan-files` flag were removed, job content is now DB-only in `state_job_contents`.)
    // The supersede feature was removed wholesale: the `core/annotations` extractor (its only producer), the `core/node-supersede` action, and the `core/node-superseded` analyzer were all deleted, dropping the total to 33.
    // The codex `$skill` / `@`-file grammar split added two extractors (`codex/dollar-skill`, `codex/at-file`), bringing it to 35.
    // The `@`/`/` grammar consolidation then moved the shared `slash-command` (claude -> core) and `at-file` (codex -> core) into the vendor-neutral `core` plugin; a move, not an add/remove, so the total stays 35.
    // The OpenCode provider (`opencode/opencode`, its own agent + command kinds plus the composed open-standard skill kind) brings it to 36.
    // `claude/backtick-mention` (extractor that recovers bare `@handle` mentions from code spans / fences, resolution-gated by the `prune-unresolved-code-triggers` post-walk transform) brings it to 37.
    // `core/backtick-slash` (its `/command` sibling, same code-region domain and resolution gate, lens-gated claude / antigravity / opencode like the prose slash) brings it to 38.
    // `codex/backtick-dollar` (the `$skill` sibling completing the per-provider code-region trigger family, codex-only like the prose dollar) brings it to 39.
    // `core/name-mismatch` (analyzer that flags a declared `frontmatter.name` diverging from the node's path-derived handle, severity from the per-kind `identifierMismatch` knob) brings it to 40.
    // `core/ai-summarizer-action` (the first probabilistic built-in Action; the universal node summarizer, carrying its `prompt.md` + `report.schema.json` inlined by the built-ins codegen) brings it to 41.
    // `github/enrichment` (the first declared-network deterministic Action; Model A provenance verification against a node's `source` / `sourceVersion` annotations, executed via `sm enrich` behind the `allowNetworkActions` policy) brings it to 42.
    // `core/ai-redundancy-analyzer` (the first probabilistic built-in Analyzer, the internal-redundancy finder; experimental, ships disabled, prompt user-approved 2026-07-14) brings it to 43.
    // `core/ai-contradiction-analyzer` + `core/ai-incoherence-analyzer` (the rest of the wave-1 finder roster, same experimental/disabled mold; finders judge independently, no cross-sibling deferrals) bring it to 45.
    // `core/ai-redundancy-action` (the FIRST fixer: a probabilistic Action declaring `precondition.analyzerIds: ['core/ai-redundancy-analyzer']`; experimental, ships disabled; resolves redundancy findings via a template-mandated file edit) brings it to 46.
    // `core/ai-contradiction-action` (fixer for `core/ai-contradiction-analyzer`, `precondition.analyzerIds: ['core/ai-contradiction-analyzer']`; resolves conflicting / jointly-risky directive pairs) + `core/ai-incoherence-action` (fixer for `core/ai-incoherence-analyzer`; fixes dangling references, drifting terminology, missing context), both experimental and ships disabled, bring it to 48.
    // `core/auto-fix` (the former second built-in hook) was REMOVED on 2026-07-21: redundant with the per-job `auto_fix` flag; the record-side hook dispatch stays for drop-in hooks, keeping the count at 48.
    // `core/ai-reference-action` (the first DETERMINISTIC-analyzer fixer: a probabilistic Action declaring `precondition.analyzerIds: ['core/reference-broken']`, so its submit-time trigger is that rule's `scan_issues` rows injected as `## Issues to resolve`, not `state_findings`; experimental, ships disabled, exempt from the finder/fixer pairing convention) brings it to 49.
    // `core/ai-tagger-action` (the taxonomy sibling of the summarizer: stable probabilistic Action whose report `$ref`s the canonical tags schema; the record path merges its `tags[]` into the sidecar through the consent-gated write-through) brings it to 50.
    // `core/contribution-orphan` (the Phase 7 soft-warning stub that emitted [] waiting for a `contributionsRows` context field that never landed) was DELETED on 2026-07-22 (analyzer review pass closure), dropping the total to 49; `IAnalyzerContext.viewContributions` stays as a generic context surface.
    // `core/ai-name-action` (the second deterministic-analyzer fixer, `precondition.analyzerIds: ['core/name-mismatch']`, mirror of ai-reference-action: stable, enabled; settles a dual identity by aligning `frontmatter.name` to the file-derived handle, renames only by author choice) brings it back to 50.
    // The five OPTIMIZATION finder/fixer pairs (2026-07-22, user decision: the monolithic `skill-optimizer` capability decomposed into topics): `ai-verbosity-*`, `ai-vagueness-*`, `ai-structure-*`, `ai-trigger-*`, `ai-scope-*`, each an experimental ships-disabled probabilistic pair on the wave-1 mold, bring it to 60.
    // `core/ai-frontmatter-action` (standalone probabilistic Action that generates or completes a node's missing frontmatter: a path-aligned `name` + a use-when `description`, never overwriting existing fields; graduated stable/enabled 2026-07-22 after its live playground pass) brings it to 61.
    // The two security finders (`core/ai-security-analyzer` for hygiene the
    // author fixes, `core/ai-suspicion-analyzer` for adversarial content that
    // gets quarantined, deliberately fixer-less; both graduated
    // stable/enabled 2026-07-23 after their live playground passes) bring it to 63.
    // `core/ai-ping-action` (the hidden `locked` liveness probe: a probabilistic
    // Action an external agent claims + records so the Setup panel can tell an
    // agent is attending the queue; follows the ai- naming convention, stripped
    // from every discovery surface) brings it to 64.
    // `core/mermaid` + `core/dot` (the two graph formatters `cli-contract.md`
    // had documented since before they existed) bring it to 66.
    // `test-plugin/showcase` (the settings showcase, 2026-08-02: one
    // declaration per input-type, `defaultEnabled: false`) brings it to 67.
    // `core/ai-prose-to-rules-analyzer` + `core/ai-prose-to-rules-action` (the
    // checklist pair, user request 2026-08-08: the finder extracts rules
    // buried in prose and proposes them as a paste-ready checklist in the
    // finding detail, the fixer applies the conversion; graduated
    // stable/enabled the same day after the live playground pass, and
    // `ai-structure-analyzer` ceded the prose-should-be-a-list territory
    // to the finder in the same revision) bring it to 69.
    // `core/observed-link-missing` (the session-journal emergent-use
    // detector, 2026-08-16: flags observed invoke/spawn pairs no declared
    // link covers, `spec/provider-activity.md` §Session journal) brings
    // it to 70. `core/observed-link-dead` (its dead-design mirror,
    // 2026-08-17: flags declared links recorded sessions could have
    // confirmed but never did, volume-gated) brings it to 71.
    // `core/observed-node-dead` (the node-grain dead detector, 2026-08-17:
    // runnable nodes that never ran across enough active recorded
    // sessions) brings it to 72.
    assert.equal(rows.length, 72);
  });

  // Convention guard: every built-in EXTRACTOR description ends with a
  // concrete `Example:` clause (the operator reads these in
  // `sm plugins list` / `sm plugins show` / the Settings panel, and a
  // worked example makes an abstract "turns X into Y" description
  // legible). Enforced here so a future extractor cannot silently ship
  // without one. Scoped to extractors deliberately: analyzers / actions
  // / providers describe behaviour that a syntax example does not always
  // clarify.
  it('every built-in extractor description carries an `Example:`', () => {
    const offenders = listBuiltIns()
      .filter((row) => row.kind === 'extractor')
      .filter((row) => !/\bExample:/.test(row.description ?? ''))
      .map((row) => `${row.pluginId}/${row.id}`);
    assert.deepEqual(
      offenders,
      [],
      `extractor descriptions missing an \`Example:\` clause: ${offenders.join(', ')}`,
    );
  });

  // `defaultRefreshAction` was retired with the structure-as-truth
  // refactor along with the UI's Refresh button. The replacement UX is
  // TBD; this test was removed accordingly.

  it('the built-in `core/ai-summarizer-action` is probabilistic and carries its inlined siblings', () => {
    const set = builtIns();
    const action = set.actions.find((a) => a.id === 'ai-summarizer-action');
    if (!action) throw new Error('expected the ai-summarizer-action action to be bundled');
    assert.equal(action.pluginId, 'core');
    assert.equal(action.mode, 'probabilistic');
    assert.equal(action.probExpectedDurationSeconds, 120);
    // Codegen inlined prompt.md verbatim (the on-disk equivalent), including
    // the single sanctioned `{{userContent}}` placeholder the render engine
    // wraps in `<user-content>`.
    assert.equal(typeof action.promptTemplate, 'string');
    assert.ok(
      (action.promptTemplate ?? '').includes('{{userContent}}'),
      'inlined promptTemplate must carry the {{userContent}} placeholder',
    );
    // Codegen inlined report.schema.json parsed to an object. It is a thin
    // extender of the canonical summaries/markdown schema; that $ref is
    // ALSO the summarizer signal the record path detects
    // (`summaryKindOfReportSchema`, spec/job-lifecycle.md §Record).
    assert.ok(
      action.reportSchema !== null && typeof action.reportSchema === 'object',
      'inlined reportSchema must be a parsed object',
    );
    const schema = action.reportSchema as {
      allOf?: Array<{ $ref?: string }>;
    };
    assert.ok(
      (schema.allOf ?? []).some(
        (s) => s.$ref === 'https://skill-map.ai/spec/v1/summaries/markdown.schema.json',
      ),
      'reportSchema must extend summaries/markdown by its absolute $id',
    );
    assert.equal(
      summaryKindOfReportSchema(action.reportSchema as Record<string, unknown>),
      'markdown',
      'the summaries $ref must register the action as a markdown summarizer',
    );
  });

  it('the built-in `core/ai-tagger-action` is a stable probabilistic tagger with its inlined siblings', () => {
    const set = builtIns();
    const action = set.actions.find((a) => a.id === 'ai-tagger-action');
    if (!action) throw new Error('expected the ai-tagger-action action to be bundled');
    assert.equal(action.pluginId, 'core');
    assert.equal(action.mode, 'probabilistic');
    assert.equal(action.stability, 'stable');
    assert.equal(action.probExpectedDurationSeconds, 60);
    assert.equal(typeof action.promptTemplate, 'string');
    assert.ok(
      (action.promptTemplate ?? '').includes('{{userContent}}'),
      'inlined promptTemplate must carry the {{userContent}} placeholder',
    );
    // The report schema's $ref to the canonical tags shape IS the tagger
    // signal the record path surfaces the proposal on
    // (`isTagsReportSchema`, spec/job-lifecycle.md §Tags proposal).
    assert.ok(
      action.reportSchema !== null && typeof action.reportSchema === 'object',
      'inlined reportSchema must be a parsed object',
    );
    const tagSchema = action.reportSchema as { allOf?: Array<{ $ref?: string }> };
    assert.ok(
      (tagSchema.allOf ?? []).some(
        (s) => s.$ref === 'https://skill-map.ai/spec/v1/tags/markdown.schema.json',
      ),
      'reportSchema must extend tags/markdown by its absolute $id',
    );
    assert.equal(
      isTagsReportSchema(action.reportSchema as Record<string, unknown>),
      true,
      'the tags $ref must register the action as a tagger',
    );
  });

  it('deterministic built-in actions carry no inlined prompt template', () => {
    const set = builtIns();
    for (const action of set.actions) {
      if ((action.mode ?? 'deterministic') === 'probabilistic') continue;
      assert.equal(
        action.promptTemplate,
        undefined,
        `deterministic action ${action.id} must not carry an inlined promptTemplate`,
      );
    }
  });

  it('every built-in action carries its inlined report schema (structure-as-truth sibling)', () => {
    const set = builtIns();
    assert.ok(set.actions.length > 0, 'expected at least one built-in action');
    for (const action of set.actions) {
      assert.ok(
        action.reportSchema !== null && typeof action.reportSchema === 'object',
        `action ${action.id} must carry its codegen-inlined reportSchema`,
      );
    }
  });

  it('the built-in `github/enrichment` is a declared-network deterministic enricher that ships disabled', () => {
    const set = builtIns();
    const action = set.actions.find((a) => a.id === 'enrichment');
    if (!action) throw new Error('expected the github/enrichment action to be bundled');
    assert.equal(action.pluginId, 'github');
    assert.equal(action.mode, 'deterministic');
    // The single sanctioned purity carve-out: manifest-declared network IO,
    // gated at execution by the `allowNetworkActions` project policy.
    assert.deepEqual(action.io, ['network']);
    // Experimental flips the installed default to DISABLED (same
    // ships-disabled mechanism as core/node-bump), so the composed scan
    // catalog excludes it until the operator opts in.
    assert.equal(action.stability, 'experimental');
    assert.equal(typeof action.invoke, 'function');
    assert.equal(action.promptTemplate, undefined, 'deterministic: no prompt');
    // The inlined report schema extends the canonical enrichments/github
    // shape by its absolute $id; that $ref is ALSO the enricher signal
    // `sm enrich` detects (the mirror of the summarizer convention).
    const schema = action.reportSchema as { allOf?: Array<{ $ref?: string }> };
    assert.ok(
      (schema.allOf ?? []).some(
        (s) => s.$ref === 'https://skill-map.ai/spec/v1/enrichments/github.schema.json',
      ),
      'reportSchema must extend enrichments/github by its absolute $id',
    );
    assert.equal(
      enrichmentKindOfReportSchema(action.reportSchema as Record<string, unknown>),
      'github',
      'the enrichments $ref must register the action as a github enricher',
    );
    // The optional token secret rides on the extension-settings machinery.
    assert.equal(action.settings?.['token']?.type, 'secret');
  });

  it('the composed scan catalog excludes github/enrichment until enabled (ships disabled)', () => {
    const defaultComposed = composeScanExtensions({
      noBuiltIns: false,
      pluginRuntime: emptyPluginRuntime(),
    });
    assert.ok(defaultComposed, 'built-ins alone compose a non-empty pipeline');
    assert.ok(
      !defaultComposed.actions.some((a) => a.pluginId === 'github' && a.id === 'enrichment'),
      'experimental github/enrichment must not compose under installed defaults',
    );

    const enabledComposed = composeScanExtensions({
      noBuiltIns: false,
      pluginRuntime: emptyPluginRuntime(),
      // Operator opt-in: the qualified-id toggle wins over the
      // experimental installed default.
      resolveEnabled: (id, installedDefault = true) =>
        id === 'github/enrichment' ? true : installedDefault,
    });
    assert.ok(enabledComposed);
    assert.ok(
      enabledComposed.actions.some((a) => a.pluginId === 'github' && a.id === 'enrichment'),
      'an explicit enable folds github/enrichment into the composed catalog',
    );
  });

  it('claude provider declares schema + schemaJson per kind (Phase 3 catalog)', () => {
    const set = builtIns();
    const claude = set.providers.find((a) => a.id === 'claude');
    if (!claude) throw new Error('expected the claude provider to be bundled');
    const expectedKinds = new Set(['skill', 'agent', 'command']);
    const seen = new Set<string>();
    for (const [k, entry] of Object.entries(claude.kinds)) {
      seen.add(k);
      assert.equal(typeof entry.schema, 'string', `kinds.${k}.schema must be a string path`);
      assert.ok(entry.schema.endsWith('.schema.json'), `kinds.${k}.schema should point at a JSON Schema file`);
      assert.ok(entry.schemaJson !== null && typeof entry.schemaJson === 'object', `kinds.${k}.schemaJson must be a loaded JSON object`);
      const json = entry.schemaJson as { $id?: string };
      assert.equal(typeof json.$id, 'string', `kinds.${k}.schemaJson must declare an $id`);
    }
    for (const expected of expectedKinds) {
      assert.ok(seen.has(expected), `kind ${expected} must have a catalog entry`);
    }
  });
});
