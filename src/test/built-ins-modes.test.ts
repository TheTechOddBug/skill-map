/**
 * Invariant: every built-in rule declares its execution mode explicitly as
 * `deterministic`. The schema makes the field optional with a deterministic
 * default, so omitting it would still be valid — but the project policy is
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

import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
import { qualifiedExtensionId } from '../kernel/registry.js';

describe('built-in extensions — execution modes', () => {
  it('extractor manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    assert.ok(set.extractors.length > 0, 'expected at least one built-in extractor');
    for (const d of set.extractors) {
      assert.equal(
        (d as unknown as Record<string, unknown>)['mode'],
        undefined,
        `extractor ${d.id} must not declare mode — extractors are deterministic-only`,
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
        `provider ${a.id} must not declare mode — providers are deterministic-only`,
      );
    }
  });

  it('formatter manifest does NOT declare mode (deterministic-only kind)', () => {
    const set = builtIns();
    for (const f of set.formatters) {
      assert.equal(
        (f as unknown as Record<string, unknown>)['mode'],
        undefined,
        `formatter ${f.id} must not declare mode — formatters are deterministic-only`,
      );
    }
  });
});

describe('built-in extensions — qualified ids (spec § A.6)', () => {
  it('every built-in declares a recognised pluginId (`core`, `claude`, `gemini`, `agent-skills`)', () => {
    const set = builtIns();
    const all = [
      ...set.providers,
      ...set.extractors,
      ...set.analyzers,
      ...set.formatters,
      ...set.actions,
    ];
    const valid = new Set(['core', 'claude', 'gemini', 'agent-skills']);
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

    // Vendor provider bundles (provider-only today).
    assert.equal(qualifiedByKindAndShort.get('provider:claude'), 'claude/claude');
    assert.equal(qualifiedByKindAndShort.get('provider:gemini'), 'gemini/gemini');
    assert.equal(qualifiedByKindAndShort.get('provider:agent-skills'), 'agent-skills/agent-skills');

    // Core kernel built-ins.
    assert.equal(qualifiedByKindAndShort.get('extractor:annotations'), 'core/annotations');
    assert.equal(qualifiedByKindAndShort.get('extractor:slash'), 'core/slash');
    assert.equal(qualifiedByKindAndShort.get('extractor:at-directive'), 'core/at-directive');
    assert.equal(qualifiedByKindAndShort.get('extractor:external-url-counter'), 'core/external-url-counter');
    assert.equal(qualifiedByKindAndShort.get('analyzer:trigger-collision'), 'core/trigger-collision');
    assert.equal(qualifiedByKindAndShort.get('analyzer:stability'), 'core/stability');
    assert.equal(qualifiedByKindAndShort.get('analyzer:broken-ref'), 'core/broken-ref');
    assert.equal(qualifiedByKindAndShort.get('analyzer:superseded'), 'core/superseded');
    assert.equal(qualifiedByKindAndShort.get('analyzer:link-conflict'), 'core/link-conflict');
    assert.equal(qualifiedByKindAndShort.get('analyzer:annotation-stale'), 'core/annotation-stale');
    assert.equal(qualifiedByKindAndShort.get('analyzer:annotation-orphan'), 'core/annotation-orphan');
    assert.equal(qualifiedByKindAndShort.get('formatter:ascii'), 'core/ascii');
    assert.equal(qualifiedByKindAndShort.get('analyzer:validate-all'), 'core/validate-all');
    assert.equal(qualifiedByKindAndShort.get('action:bump'), 'core/bump');
    assert.equal(qualifiedByKindAndShort.get('action:mark-superseded'), 'core/mark-superseded');
  });

  it('every analyzer.recommendedActions entry resolves to a registered Action', () => {
    const set = builtIns();
    const actionIds = new Set(
      set.actions.map((a) => qualifiedExtensionId(a.pluginId, a.id)),
    );
    for (const analyzer of set.analyzers) {
      for (const ref of analyzer.recommendedActions ?? []) {
        assert.ok(
          actionIds.has(ref),
          `analyzer ${analyzer.id} references unknown action ${ref} in recommendedActions`,
        );
      }
    }
  });

  it('annotation-stale recommends core/bump', () => {
    const set = builtIns();
    const annotationStale = set.analyzers.find((a) => a.id === 'annotation-stale');
    assert.ok(annotationStale, 'expected annotation-stale to be bundled');
    assert.deepEqual(annotationStale.recommendedActions, ['core/bump']);
  });

  it('listBuiltIns() rows carry pluginId verbatim', () => {
    const rows = listBuiltIns();
    const valid = new Set(['core', 'claude', 'gemini', 'agent-skills']);
    for (const row of rows) {
      assert.ok(
        valid.has(row.pluginId),
        `Registry row ${row.kind}:${row.id} must carry a recognised built-in pluginId; got ${JSON.stringify(row.pluginId)}`,
      );
    }
    // Smoke check the count: 4 providers (claude + gemini + agent-skills + core-markdown) + 6 extractors + 12 rules + 1 formatter + 2 actions + 1 hook = 26.
    // Phase 7 added `core/unknown-slot` and `core/contribution-orphan`.
    // `core/link-counts` (rule that emits per-node link-count view contributions) brought the total to 22.
    // `core/job-orphan-file` (rule that flags orphan MD files under .skill-map/jobs/) brought it to 23.
    // `core/update-check` (first built-in hook; subscribes to `boot` and runs the once-per-day update banner) brought it to 24.
    // `core/tools-count` (agent-only extractor that emits the tools wrench chip to `card.footer.left`) brought it to 25.
    // `core/stability` (analyzer that surfaces lifecycle state as a `card.footer.right` chip plus `deprecated → warn` / `experimental → info` issues; flipped from extractor → analyzer) brought it to 26.
    // `core/unknown-slot` was lifted out of the scan pipeline and into `sm plugins doctor` (it validates plugin manifest metadata, not user content), keeping it at 26 (had briefly grown to 29 with three project-level action stubs `relink-contributions` / `prune-orphan-files` / `mark-superseded`, but `relink-contributions` + `prune-orphan-files` were removed because Actions are per-node by design — project-level cleanup belongs in CLI verbs; `mark-superseded` remained as a per-node declarer).
    assert.equal(rows.length, 26);
  });

  it('claude provider declares qualified action ids in kinds[<kind>].defaultRefreshAction', () => {
    const set = builtIns();
    const claude = set.providers.find((a) => a.id === 'claude');
    assert.ok(claude, 'expected the claude provider to be bundled');
    for (const [kind, entry] of Object.entries(claude.kinds)) {
      assert.match(
        entry.defaultRefreshAction,
        /^[a-z][a-z0-9]*(-[a-z0-9]+)*\/[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        `defaultRefreshAction for kind ${kind} must be a qualified action id; got ${entry.defaultRefreshAction}`,
      );
    }
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
