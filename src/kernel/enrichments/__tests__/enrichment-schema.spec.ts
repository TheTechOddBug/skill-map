/**
 * Unit tests for `enrichmentKindOfReportSchema`, the schema-derived
 * enricher signal (`spec/db-schema.md` §state_enrichments): an Action is
 * an enricher iff its report schema `$ref`s a canonical
 * `enrichments/<kind>.schema.json`. There is no manifest flag; this
 * helper is the single detection point the `sm enrich` dispatcher gates
 * the `state_enrichments` write-through on. Mirrors the summarizer
 * detection suite (`kernel/jobs/__tests__/summary-schema.spec.ts`).
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import {
  enrichmentKindOfReportSchema,
  ENRICHMENT_SCHEMA_ID_PREFIX,
} from '../enrichment-schema.js';

describe('enrichmentKindOfReportSchema', () => {
  it('detects an enrichments/<kind> $ref inside allOf (the canonical extender shape)', () => {
    const schema = {
      $id: 'https://skill-map.ai/spec/v1/github/enrichment-report.schema.json',
      allOf: [{ $ref: `${ENRICHMENT_SCHEMA_ID_PREFIX}github.schema.json` }],
    };
    strictEqual(enrichmentKindOfReportSchema(schema), 'github');
  });

  it('detects a top-level enrichments $ref and extracts the kind from the filename', () => {
    strictEqual(
      enrichmentKindOfReportSchema({ $ref: `${ENRICHMENT_SCHEMA_ID_PREFIX}gitlab.schema.json` }),
      'gitlab',
    );
  });

  it('ignores a fragment suffix on the referenced enrichment schema', () => {
    strictEqual(
      enrichmentKindOfReportSchema({
        allOf: [{ $ref: `${ENRICHMENT_SCHEMA_ID_PREFIX}github.schema.json#/properties/verified` }],
      }),
      'github',
    );
  });

  it('returns null for a plain report-base-only schema (non-enricher)', () => {
    const schema = {
      $id: 'https://skill-map.ai/spec/v1/test/skill-echo-report.schema.json',
      allOf: [{ $ref: 'https://skill-map.ai/spec/v1/report-base.schema.json' }],
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    };
    strictEqual(enrichmentKindOfReportSchema(schema), null);
  });

  it('returns null for a summaries-namespace $ref (that is the summarizer signal, not this one)', () => {
    strictEqual(
      enrichmentKindOfReportSchema({
        allOf: [{ $ref: 'https://skill-map.ai/spec/v1/summaries/markdown.schema.json' }],
      }),
      null,
    );
  });

  it('returns null when an enrichments-prefixed $ref does not target a *.schema.json file', () => {
    strictEqual(
      enrichmentKindOfReportSchema({ allOf: [{ $ref: `${ENRICHMENT_SCHEMA_ID_PREFIX}github.json` }] }),
      null,
    );
    strictEqual(
      enrichmentKindOfReportSchema({
        allOf: [{ $ref: `${ENRICHMENT_SCHEMA_ID_PREFIX}nested/github.schema.json` }],
      }),
      null,
    );
  });

  it('ignores enrichments-looking plain strings that are not $ref values', () => {
    const schema = {
      description: `See ${ENRICHMENT_SCHEMA_ID_PREFIX}github.schema.json for the canonical shape.`,
      allOf: [{ $ref: 'https://skill-map.ai/spec/v1/report-base.schema.json' }],
    };
    strictEqual(enrichmentKindOfReportSchema(schema), null);
  });

  it('finds the $ref anywhere in the schema tree (nested combinators)', () => {
    const schema = {
      type: 'object',
      oneOf: [
        { allOf: [{ $ref: 'https://skill-map.ai/spec/v1/report-base.schema.json' }] },
        { allOf: [{ $ref: `${ENRICHMENT_SCHEMA_ID_PREFIX}github.schema.json` }] },
      ],
    };
    strictEqual(enrichmentKindOfReportSchema(schema), 'github');
  });

  it('returns null on an empty schema', () => {
    strictEqual(enrichmentKindOfReportSchema({}), null);
  });
});
