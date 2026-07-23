/**
 * Unit tests for `reportSchemaExtendsFindings`, the schema-derived finder
 * signal (`spec/job-lifecycle.md` §Record, findings write-through): a
 * probabilistic Analyzer's `report.schema.json` MUST extend the canonical
 * findings envelope via `$ref`. The loader gates manifests on this helper
 * (`invalid-manifest` otherwise); exact mirror of `summary-schema.spec.ts`.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { reportSchemaExtendsFindings, FINDINGS_SCHEMA_ID_PREFIX } from '../findings-schema.js';

describe('reportSchemaExtendsFindings', () => {
  it('detects a findings $ref inside allOf (the canonical extender shape)', () => {
    const schema = {
      $id: 'https://skill-map.ai/spec/v0/test/quality-check-report.schema.json',
      allOf: [{ $ref: `${FINDINGS_SCHEMA_ID_PREFIX}report.schema.json` }],
    };
    strictEqual(reportSchemaExtendsFindings(schema), true);
  });

  it('detects a top-level findings $ref', () => {
    strictEqual(
      reportSchemaExtendsFindings({ $ref: `${FINDINGS_SCHEMA_ID_PREFIX}report.schema.json` }),
      true,
    );
  });

  it('ignores a fragment suffix on the referenced findings schema', () => {
    strictEqual(
      reportSchemaExtendsFindings({
        allOf: [{ $ref: `${FINDINGS_SCHEMA_ID_PREFIX}report.schema.json#/properties/findings` }],
      }),
      true,
    );
  });

  it('returns false for a plain report-base-only schema (non-finder)', () => {
    const schema = {
      $id: 'https://skill-map.ai/spec/v0/test/skill-echo-report.schema.json',
      allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    };
    strictEqual(reportSchemaExtendsFindings(schema), false);
  });

  it('returns false when a findings-prefixed $ref does not target a *.schema.json file', () => {
    strictEqual(
      reportSchemaExtendsFindings({ allOf: [{ $ref: `${FINDINGS_SCHEMA_ID_PREFIX}report.json` }] }),
      false,
    );
    strictEqual(
      reportSchemaExtendsFindings({
        allOf: [{ $ref: `${FINDINGS_SCHEMA_ID_PREFIX}nested/report.schema.json` }],
      }),
      false,
    );
  });

  it('ignores findings-looking plain strings that are not $ref values', () => {
    const schema = {
      description: `See ${FINDINGS_SCHEMA_ID_PREFIX}report.schema.json for the canonical shape.`,
      allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
    };
    strictEqual(reportSchemaExtendsFindings(schema), false);
  });

  it('finds the $ref anywhere in the schema tree (nested combinators)', () => {
    const schema = {
      type: 'object',
      oneOf: [
        { allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }] },
        { allOf: [{ $ref: `${FINDINGS_SCHEMA_ID_PREFIX}report.schema.json` }] },
      ],
    };
    strictEqual(reportSchemaExtendsFindings(schema), true);
  });

  it('returns false on an empty schema', () => {
    strictEqual(reportSchemaExtendsFindings({}), false);
  });
});
