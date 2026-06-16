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
import { qualifiedExtensionId } from '../../kernel/registry.js';

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

  it('every built-in rule declares mode: deterministic', () => {
    const set = builtIns();
    assert.ok(set.analyzers.length > 0, 'expected at least one built-in rule');
    for (const r of set.analyzers) {
      assert.equal(
        r.mode,
        'deterministic',
        `rule ${r.id} should declare mode: 'deterministic'`,
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
  it('every built-in declares a recognised pluginId (`core`, `claude`, `antigravity`, `openai`, `agent-skills`)', () => {
    const set = builtIns();
    const all = [
      ...set.providers,
      ...set.extractors,
      ...set.analyzers,
      ...set.formatters,
      ...set.actions,
    ];
    const valid = new Set(['core', 'claude', 'antigravity', 'openai', 'agent-skills']);
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
    assert.equal(qualifiedByKindAndShort.get('extractor:slash-command'), 'claude/slash-command');
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
  });

  // Tests for `analyzer.recommendedActions` were retired with the
  // structure-as-truth refactor: the analyzer→action relationship is now
  // declared on the Action side via `precondition.analyzerIds` (Modelo B).
  // A future Modelo-B coverage suite will assert that every action's
  // declared `analyzerIds` reference real built-in analyzers; see
  // bd-3pw.8 task notes.

  it('listBuiltIns() rows carry pluginId verbatim', () => {
    const rows = listBuiltIns();
    const valid = new Set(['core', 'claude', 'antigravity', 'openai', 'agent-skills']);
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
    // OpenAI Codex provider (`openai/openai`) brings it to 29.
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
    // `core/job-file-orphan` (the rule that flagged orphan MD files under .skill-map/jobs/) was removed, to be reintroduced later under a probabilistic evaluation model; the `findOrphanJobFiles` helper + `sm job prune --orphan-files` verb stay, dropping the total to 36.
    // The supersede feature was removed wholesale: the `core/annotations` extractor (its only producer), the `core/node-supersede` action, and the `core/node-superseded` analyzer were all deleted, dropping the total to 33.
    assert.equal(rows.length, 33);
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
