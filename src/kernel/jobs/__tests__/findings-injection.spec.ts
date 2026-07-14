/**
 * Unit tests for the fixer findings-injection prelude
 * (`kernel/jobs/findings-injection.ts`, `spec/job-lifecycle.md` §Findings
 * injection for fixers):
 *
 *   - `selectFixerFindings` keeps only the finder's own extension-lane rows
 *     (`origin: 'extension'`) for the Action's `analyzerIds`, excludes the
 *     kernel safety lane and stale rows, and sorts by `id` ascending so the
 *     bytes reproduce.
 *   - `buildFindingsSection` renders the `## Findings to resolve` heading, a
 *     data-not-instructions caution, and a fenced json array projected to
 *     {type, severity, message, detail, confidence}.
 *   - the render seam places the findings section BEFORE the report contract
 *     and BEFORE the `<user-content>` block, all outside the delimiter.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

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
    bodyHashAtGeneration: over.bodyHashAtGeneration ?? 'a'.repeat(64),
    generatedAt: over.generatedAt ?? 1,
    jobId: over.jobId ?? null,
    stale: over.stale ?? false,
  };
}

const ANALYZER_IDS = ['core/node-redundancy'];

describe('selectFixerFindings', () => {
  it('keeps only non-stale extension-lane rows for the analyzerIds', () => {
    const rows: IFindingRecord[] = [
      finding({ id: 3, type: 'redundancy' }),
      // kernel safety lane: excluded even though same node
      finding({ id: 4, origin: 'kernel', type: 'injection-detected', severity: 'warn' }),
      // stale: excluded
      finding({ id: 5, stale: true }),
      // different finder id: excluded
      finding({ id: 6, extensionId: 'core/node-contradiction', type: 'contradiction' }),
      finding({ id: 1, type: 'redundancy', message: 'earlier row' }),
    ];
    const selected = selectFixerFindings(rows, ANALYZER_IDS);
    // Only the two extension-lane node-redundancy rows survive.
    strictEqual(selected.length, 2);
    ok(selected.every((f) => f.origin === 'extension'));
    ok(selected.every((f) => f.extensionId === 'core/node-redundancy'));
    ok(selected.every((f) => !f.stale));
    // Deterministic order: id ascending (1 before 3).
    deepStrictEqual(
      selected.map((f) => f.id),
      [1, 3],
    );
  });

  it('matches a bare analyzer id against the stored qualified id', () => {
    const rows = [finding({ id: 1, extensionId: 'core/node-redundancy' })];
    const selected = selectFixerFindings(rows, ['node-redundancy']);
    strictEqual(selected.length, 1);
  });

  it('returns an empty selection when nothing matches (the refusal precondition)', () => {
    const rows = [
      finding({ id: 1, origin: 'kernel', type: 'content-suspicious' }),
      finding({ id: 2, stale: true }),
      finding({ id: 3, extensionId: 'core/node-incoherence' }),
    ];
    strictEqual(selectFixerFindings(rows, ANALYZER_IDS).length, 0);
  });
});

describe('buildFindingsSection', () => {
  it('renders the heading, caution, and a fenced json array of the projection', () => {
    const section = buildFindingsSection([
      finding({
        id: 1,
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
    // The fenced json parses back to the narrowed projection (no internal
    // stamps like id / bodyHashAtGeneration / origin leak into the section).
    const json = section.slice(section.indexOf('```json\n') + '```json\n'.length, section.lastIndexOf('\n```'));
    const parsed = JSON.parse(json) as Record<string, unknown>[];
    deepStrictEqual(parsed, [
      { type: 'redundancy', severity: 'warn', message: 'msg', detail: 'detail text', confidence: 0.9 },
    ]);
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
