/**
 * Unit tests for `summaryKindOfReportSchema`, the schema-derived summarizer
 * signal (`spec/job-lifecycle.md` §Record): an Action is a summarizer iff
 * its report schema `$ref`s a canonical `summaries/<kind>.schema.json`.
 * There is no manifest flag; this helper is the single detection point the
 * record path gates the `state_summaries` write-through on.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { summaryKindOfReportSchema, SUMMARY_SCHEMA_ID_PREFIX } from '../summary-schema.js';

describe('summaryKindOfReportSchema', () => {
  it('detects a summaries/<kind> $ref inside allOf (the canonical extender shape)', () => {
    const schema = {
      $id: 'https://skill-map.ai/spec/v0/core/ai-summarizer-action-report.schema.json',
      allOf: [{ $ref: `${SUMMARY_SCHEMA_ID_PREFIX}markdown.schema.json` }],
    };
    strictEqual(summaryKindOfReportSchema(schema), 'markdown');
  });

  it('detects a top-level summaries $ref and extracts the kind from the filename', () => {
    strictEqual(
      summaryKindOfReportSchema({ $ref: `${SUMMARY_SCHEMA_ID_PREFIX}skill.schema.json` }),
      'skill',
    );
  });

  it('ignores a fragment suffix on the referenced summary schema', () => {
    strictEqual(
      summaryKindOfReportSchema({
        allOf: [{ $ref: `${SUMMARY_SCHEMA_ID_PREFIX}agent.schema.json#/properties/whatItDoes` }],
      }),
      'agent',
    );
  });

  it('returns null for a plain report-base-only schema (non-summarizer)', () => {
    const schema = {
      $id: 'https://skill-map.ai/spec/v0/test/skill-echo-report.schema.json',
      allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    };
    strictEqual(summaryKindOfReportSchema(schema), null);
  });

  it('returns null when a summaries-prefixed $ref does not target a *.schema.json file', () => {
    strictEqual(
      summaryKindOfReportSchema({ allOf: [{ $ref: `${SUMMARY_SCHEMA_ID_PREFIX}markdown.json` }] }),
      null,
    );
    strictEqual(
      summaryKindOfReportSchema({
        allOf: [{ $ref: `${SUMMARY_SCHEMA_ID_PREFIX}nested/markdown.schema.json` }],
      }),
      null,
    );
  });

  it('ignores summaries-looking plain strings that are not $ref values', () => {
    const schema = {
      description: `See ${SUMMARY_SCHEMA_ID_PREFIX}markdown.schema.json for the canonical shape.`,
      allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
    };
    strictEqual(summaryKindOfReportSchema(schema), null);
  });

  it('finds the $ref anywhere in the schema tree (nested combinators)', () => {
    const schema = {
      type: 'object',
      oneOf: [
        { allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }] },
        { allOf: [{ $ref: `${SUMMARY_SCHEMA_ID_PREFIX}hook.schema.json` }] },
      ],
    };
    strictEqual(summaryKindOfReportSchema(schema), 'hook');
  });

  it('returns null on an empty schema', () => {
    strictEqual(summaryKindOfReportSchema({}), null);
  });
});
