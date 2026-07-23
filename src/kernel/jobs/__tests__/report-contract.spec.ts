/**
 * Unit tests for the report-contract render prelude
 * (`kernel/jobs/report-contract.ts`, `spec/job-lifecycle.md` §Submit
 * step 9): the heading + one fenced ```json block per schema in the
 * chain, verbatim byte-copies (extension schema, canonical namespace
 * envelope when one applies, report-base), plus the render-seam
 * placement (before the `<user-content>` block, outside it).
 */

import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { buildReportContract, loadSpecSchemaText } from '../report-contract.js';
import { renderJobContent } from '../render.js';
import { FINDINGS_SCHEMA_ID_PREFIX } from '../findings-schema.js';
import { SUMMARY_SCHEMA_ID_PREFIX } from '../summary-schema.js';

const REPORT_BASE_BYTES = loadSpecSchemaText('schemas/report-base.schema.json');
const FINDINGS_ENVELOPE_BYTES = loadSpecSchemaText('schemas/findings/report.schema.json');
const SUMMARIES_MARKDOWN_BYTES = loadSpecSchemaText('schemas/summaries/markdown.schema.json');

/** A finder-shaped extension schema (findings envelope $ref). */
const FINDER_SCHEMA = {
  $id: 'urn:test:finder-report',
  allOf: [{ $ref: `${FINDINGS_SCHEMA_ID_PREFIX}report.schema.json` }],
};
const FINDER_SCHEMA_TEXT = JSON.stringify(FINDER_SCHEMA, null, 2);

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('buildReportContract', () => {
  it('finder chain: extension schema, findings envelope, report-base, in order', () => {
    const contract = buildReportContract({ schemaText: FINDER_SCHEMA_TEXT, schema: FINDER_SCHEMA });
    ok(contract.startsWith('## Report contract'), 'kernel-authored heading leads');
    ok(contract.includes(FINDER_SCHEMA_TEXT), 'extension schema verbatim');
    ok(contract.includes(FINDINGS_ENVELOPE_BYTES), 'findings envelope byte-copy');
    ok(contract.includes(REPORT_BASE_BYTES), 'report-base byte-copy');
    ok(
      contract.indexOf(FINDER_SCHEMA_TEXT) < contract.indexOf(FINDINGS_ENVELOPE_BYTES) &&
        contract.indexOf(FINDINGS_ENVELOPE_BYTES) < contract.indexOf(REPORT_BASE_BYTES),
      'chain order: extension schema, envelope, base',
    );
    strictEqual(countOccurrences(contract, '```json\n'), 3, 'one fenced block per schema');
  });

  it('summarizer chain: summaries/<kind> envelope resolves from the $ref', () => {
    const schema = {
      $id: 'urn:test:brief-report',
      allOf: [{ $ref: `${SUMMARY_SCHEMA_ID_PREFIX}markdown.schema.json` }],
    };
    const contract = buildReportContract({
      schemaText: JSON.stringify(schema, null, 2),
      schema,
    });
    ok(contract.includes(SUMMARIES_MARKDOWN_BYTES), 'summaries/markdown byte-copy');
    ok(contract.includes(REPORT_BASE_BYTES), 'report-base byte-copy');
    strictEqual(countOccurrences(contract, '```json\n'), 3);
  });

  it('report-base-only schema: two blocks, no namespace envelope', () => {
    const schema = {
      $id: 'urn:test:plain-report',
      allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
    };
    const contract = buildReportContract({
      schemaText: JSON.stringify(schema, null, 2),
      schema,
    });
    strictEqual(countOccurrences(contract, '```json\n'), 2, 'extension schema + base only');
    ok(!contract.includes(FINDINGS_ENVELOPE_BYTES));
    ok(!contract.includes(SUMMARIES_MARKDOWN_BYTES));
  });

  it('is deterministic (same input, same bytes)', () => {
    const a = buildReportContract({ schemaText: FINDER_SCHEMA_TEXT, schema: FINDER_SCHEMA });
    const b = buildReportContract({ schemaText: FINDER_SCHEMA_TEXT, schema: FINDER_SCHEMA });
    strictEqual(a, b);
  });
});

describe('renderJobContent with a report contract', () => {
  it('inserts the contract before the <user-content> block, outside it', () => {
    const contract = buildReportContract({ schemaText: FINDER_SCHEMA_TEXT, schema: FINDER_SCHEMA });
    const rendered = renderJobContent({
      node: { path: 'notes/guide.md' },
      nodeBody: 'BODY TEXT',
      promptTemplate: 'Lead-in prose.\n\n{{userContent}}\n\nTrailing instructions.',
      preamble: 'PREAMBLE\n',
      reportContract: contract,
    });
    const contractAt = rendered.indexOf('## Report contract');
    const openAt = rendered.indexOf('<user-content');
    const closeAt = rendered.indexOf('</user-content>');
    ok(contractAt > -1 && openAt > -1 && closeAt > -1);
    ok(contractAt < openAt, 'contract renders BEFORE the <user-content> block');
    ok(
      rendered.lastIndexOf('```json', openAt) < openAt &&
        rendered.indexOf('```json', closeAt) === -1,
      'every schema block sits outside <user-content>',
    );
    ok(rendered.indexOf('Lead-in prose.') < contractAt, 'template prose precedes the contract');
  });

  it('renders without a contract exactly as before (legacy callers)', () => {
    const rendered = renderJobContent({
      node: { path: 'notes/guide.md' },
      nodeBody: 'BODY',
      promptTemplate: 'X {{userContent}} Y',
      preamble: 'P\n',
    });
    ok(!rendered.includes('## Report contract'));
    ok(rendered.includes('<user-content id="notes/guide.md">'));
  });
});
