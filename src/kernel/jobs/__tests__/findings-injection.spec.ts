/**
 * Unit tests for the fixer findings-injection prelude
 * (`kernel/jobs/findings-injection.ts`, `spec/job-lifecycle.md` §Findings
 * injection for fixers):
 *
 *   - `selectFixerFindings` keeps the finder's own extension-lane rows
 *     (`origin: 'extension'`) for the Action's `analyzerIds`, STALE ONES
 *     INCLUDED (flagged, not filtered: staleness is node-level, so fixing
 *     one section stales the findings about untouched sections whose
 *     defects are still present), excludes the kernel safety lane and other
 *     finders' lanes, and sorts by `id` ascending so the bytes reproduce.
 *   - `buildFindingsSection` renders the `## Findings to resolve` heading, a
 *     data-not-instructions caution, and a fenced json array projected to
 *     {id, type, severity, message, detail, confidence, stale}, `id` FIRST
 *     (the fixer echoes it back so the record path can stamp the
 *     resolution) and `stale` last (the agent verifies a flagged entry
 *     against the current body before acting).
 *   - the render seam places the findings section BEFORE the report contract
 *     and BEFORE the `<user-content>` block, all outside the delimiter.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, match, ok } from 'node:assert';

import {
  buildFindingsSection,
  selectFixerFindings,
} from '../findings-injection.js';
import { renderJobContent } from '../render.js';
import { buildReportContract } from '../report-contract.js';
import { FINDINGS_SCHEMA_ID_PREFIX } from '../findings-schema.js';
import type { IFindingRecord } from '../../types/storage.js';

/** Build a `state_findings`-shaped record with sane defaults. */
function finding(over: Partial<IFindingRecord> & { id: number }): IFindingRecord {
  return {
    id: over.id,
    nodeId: over.nodeId ?? 'notes/guide.md',
    extensionId: over.extensionId ?? 'core/node-redundancy',
    extensionVersion: over.extensionVersion ?? '0.1.0',
    origin: over.origin ?? 'extension',
    type: over.type ?? 'redundancy',
    severity: over.severity ?? 'info',
    message: over.message ?? 'The upload step is stated twice',
    detail: over.detail ?? '"Upload it" vs "Upload the artifact"; keep one',
    confidence: over.confidence ?? 0.7,
    model: over.model ?? null,
    resolution: over.resolution ?? null,
    resolutionActor: over.resolutionActor ?? null,
    resolutionNote: over.resolutionNote ?? null,
    resolutionBy: over.resolutionBy ?? null,
    resolutionAt: over.resolutionAt ?? null,
    bodyHashAtGeneration: over.bodyHashAtGeneration ?? 'a'.repeat(64),
    generatedAt: over.generatedAt ?? 1,
    jobId: over.jobId ?? null,
    stale: over.stale ?? false,
  };
}

const ANALYZER_IDS = ['core/node-redundancy'];

describe('selectFixerFindings', () => {
  it('keeps the extension-lane rows for the analyzerIds, stale ones INCLUDED', () => {
    const rows: IFindingRecord[] = [
      finding({ id: 3, type: 'redundancy' }),
      // kernel safety lane: excluded even though same node (an
      // `injection-detected` flag is not a prose defect a fixer resolves).
      finding({ id: 4, origin: 'kernel', type: 'injection-detected', severity: 'warn' }),
      // stale: INCLUDED (flagged). Staleness is node-level, so an earlier
      // fix on this node staled a judgment whose defect may still be there.
      finding({ id: 5, stale: true }),
      // different finder id: excluded
      finding({ id: 6, extensionId: 'core/node-contradiction', type: 'contradiction' }),
      finding({ id: 1, type: 'redundancy', message: 'earlier row' }),
    ];
    const selected = selectFixerFindings(rows, ANALYZER_IDS);
    // The three extension-lane node-redundancy rows survive, stale included.
    strictEqual(selected.length, 3);
    ok(selected.every((f) => f.origin === 'extension'));
    ok(selected.every((f) => f.extensionId === 'core/node-redundancy'));
    // Deterministic order: id ascending, regardless of freshness.
    deepStrictEqual(
      selected.map((f) => f.id),
      [1, 3, 5],
    );
    deepStrictEqual(
      selected.map((f) => f.stale),
      [false, false, true],
    );
  });

  it('selects a stale-ONLY finding set (the fix-one-then-queue-the-next case)', () => {
    // The exact live scenario: fixer 1 edited one section, which staled
    // EVERY finding on the node, including this untouched section's. The
    // selection must still be non-empty so the next fixer submits.
    const rows = [finding({ id: 1, stale: true }), finding({ id: 2, stale: true })];
    const selected = selectFixerFindings(rows, ANALYZER_IDS);
    strictEqual(selected.length, 2, 'stale-only is a real selection, never a refusal');
    ok(selected.every((f) => f.stale));
  });

  it('matches a bare analyzer id against the stored qualified id', () => {
    const rows = [finding({ id: 1, extensionId: 'core/node-redundancy' })];
    const selected = selectFixerFindings(rows, ['node-redundancy']);
    strictEqual(selected.length, 1);
  });

  it('returns an empty selection when nothing matches (the refusal precondition)', () => {
    // The two filters staleness does NOT relax: the kernel safety lane and
    // a finder outside the Action's analyzerIds, fresh or stale alike.
    const rows = [
      finding({ id: 1, origin: 'kernel', type: 'content-suspicious' }),
      finding({ id: 2, origin: 'kernel', type: 'injection-detected', stale: true }),
      finding({ id: 3, extensionId: 'core/node-incoherence' }),
      finding({ id: 4, extensionId: 'core/node-incoherence', stale: true }),
    ];
    strictEqual(selectFixerFindings(rows, ANALYZER_IDS).length, 0);
  });
});

describe('buildFindingsSection', () => {
  it('renders the heading, caution, and a fenced json array of the projection', () => {
    const section = buildFindingsSection([
      finding({
        id: 42,
        type: 'redundancy',
        severity: 'warn',
        message: 'msg',
        detail: 'detail text',
        confidence: 0.9,
      }),
    ]);
    ok(section.startsWith('## Findings to resolve'), 'kernel-authored heading leads');
    ok(/DATA/.test(section), 'caution names the findings as DATA');
    ok(section.includes('```json\n'), 'fenced json block present');
    // The fenced json parses back to the narrowed projection: `id` (what
    // the fixer echoes back) plus the fields needed to apply the fix, and
    // none of the internal stamps (bodyHashAtGeneration / origin / jobId).
    const json = section.slice(section.indexOf('```json\n') + '```json\n'.length, section.lastIndexOf('\n```'));
    const parsed = JSON.parse(json) as Record<string, unknown>[];
    deepStrictEqual(parsed, [
      {
        id: 42,
        type: 'redundancy',
        severity: 'warn',
        message: 'msg',
        detail: 'detail text',
        confidence: 0.9,
        stale: false,
      },
    ]);
  });

  it('flags each entry with its staleness so the agent can verify before acting', () => {
    // A mixed set is the norm once a sibling fixer has edited the node:
    // both entries ride, each carrying its own freshness.
    const section = buildFindingsSection([
      finding({ id: 1, stale: false }),
      finding({ id: 2, stale: true, message: 'judged before the last edit' }),
    ]);
    const json = section.slice(section.indexOf('```json\n') + '```json\n'.length, section.lastIndexOf('\n```'));
    const parsed = JSON.parse(json) as Record<string, unknown>[];
    deepStrictEqual(parsed.map((e) => e['stale']), [false, true]);
    // `stale` closes the shape (after `confidence`), so the agent reads the
    // judgment first and its freshness caveat last.
    deepStrictEqual(Object.keys(parsed[0]!), [
      'id',
      'type',
      'severity',
      'message',
      'detail',
      'confidence',
      'stale',
    ]);
  });

  it('leads each entry with `id` so the fixer can echo it back verbatim', () => {
    const section = buildFindingsSection([finding({ id: 7 }), finding({ id: 9 })]);
    // Key ORDER is contract-adjacent: the id is the first thing the
    // processing agent reads per entry (spec/job-lifecycle.md §Findings
    // injection for fixers), and it is what ties its `resolved[]` entry
    // back to this row at record.
    const json = section.slice(section.indexOf('```json\n') + '```json\n'.length, section.lastIndexOf('\n```'));
    const parsed = JSON.parse(json) as Record<string, unknown>[];
    deepStrictEqual(parsed.map((e) => Object.keys(e)[0]), ['id', 'id']);
    deepStrictEqual(parsed.map((e) => e['id']), [7, 9]);
    match(section, /"id": 7/);
  });

  it('never leaks the stored resolution stamps into the section', () => {
    // A finding a fixer left as a human-decision can be re-injected (it
    // stays open until the finder re-judges). Its resolution is skill-map's
    // record, NOT an instruction for the next fixer run: the section
    // carries the judgment only.
    const section = buildFindingsSection([
      finding({
        id: 1,
        resolution: 'human-decision',
        resolutionNote: 'needs an author decision',
        resolutionBy: 'core/node-consolidate',
        resolutionAt: 123,
      }),
    ]);
    ok(!section.includes('resolution'), 'no resolution key in the projection');
    ok(!section.includes('needs an author decision'), 'no prior note injected');
  });

  it('is deterministic given the same selection', () => {
    const rows = [finding({ id: 1 }), finding({ id: 2, message: 'second' })];
    strictEqual(buildFindingsSection(rows), buildFindingsSection(rows));
  });
});

describe('renderJobContent with a findings section (fixer)', () => {
  const FINDER_SCHEMA = {
    $id: 'urn:test:fixer-report',
    allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
  };

  it('places findings BEFORE the report contract BEFORE the <user-content> block', () => {
    const findingsSection = buildFindingsSection([finding({ id: 1 })]);
    const contract = buildReportContract({
      schemaText: JSON.stringify(FINDER_SCHEMA, null, 2),
      schema: FINDER_SCHEMA,
    });
    const rendered = renderJobContent({
      node: { path: 'notes/guide.md' },
      nodeBody: 'BODY TEXT',
      promptTemplate: 'Lead-in prose.\n\n{{userContent}}\n\nTrailing.',
      preamble: 'PREAMBLE\n',
      findingsSection,
      reportContract: contract,
    });
    const findingsAt = rendered.indexOf('## Findings to resolve');
    const contractAt = rendered.indexOf('## Report contract');
    const blockAt = rendered.indexOf('<user-content');
    ok(findingsAt > -1 && contractAt > -1 && blockAt > -1);
    ok(findingsAt < contractAt, 'findings render before the report contract');
    ok(contractAt < blockAt, 'report contract renders before the user-content block');
    ok(
      rendered.indexOf('Lead-in prose.') < findingsAt,
      'template prose before the placeholder precedes the findings',
    );
    // The findings section is kernel-authored prelude, never inside the block.
    const closeAt = rendered.indexOf('</user-content>');
    ok(rendered.indexOf('## Findings to resolve', closeAt) === -1, 'no findings inside/after the block');
  });

  it('references the findings envelope prefix only where a finder schema is used (sanity)', () => {
    // Guard the imported constant stays wired (used by sibling finder specs).
    ok(FINDINGS_SCHEMA_ID_PREFIX.length > 0);
  });
});
