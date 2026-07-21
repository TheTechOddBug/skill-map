/**
 * Unit tests for `isTagsReportSchema`, the schema-derived tagger signal
 * (`spec/job-lifecycle.md` §Tags write-through), the exact mirror of the
 * summarizer detection: an Action is a tagger iff its report schema
 * `$ref`s a schema under the canonical tags namespace. There is no
 * manifest flag; this helper is the single detection point the record
 * path gates the sidecar `annotations.tags` write-through on.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { isTagsReportSchema, TAGS_SCHEMA_ID_PREFIX } from '../tags-schema.js';

describe('isTagsReportSchema', () => {
  it('detects a tags $ref inside allOf (the canonical extender shape)', () => {
    const schema = {
      $id: 'https://skill-map.ai/spec/v0/core/ai-tagger-action-report.schema.json',
      allOf: [{ $ref: `${TAGS_SCHEMA_ID_PREFIX}markdown.schema.json` }],
    };
    strictEqual(isTagsReportSchema(schema), true);
  });

  it('detects a top-level tags $ref', () => {
    strictEqual(isTagsReportSchema({ $ref: `${TAGS_SCHEMA_ID_PREFIX}markdown.schema.json` }), true);
  });

  it('finds the $ref anywhere in the schema tree (nested combinators)', () => {
    const schema = {
      type: 'object',
      oneOf: [
        { allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }] },
        { allOf: [{ $ref: `${TAGS_SCHEMA_ID_PREFIX}markdown.schema.json` }] },
      ],
    };
    strictEqual(isTagsReportSchema(schema), true);
  });

  it('returns false for a plain report-base-only schema (non-tagger)', () => {
    const schema = {
      $id: 'https://skill-map.ai/spec/v0/test/skill-echo-report.schema.json',
      allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    };
    strictEqual(isTagsReportSchema(schema), false);
  });

  it('returns false for a summaries $ref (the sibling namespace is not a tagger signal)', () => {
    strictEqual(
      isTagsReportSchema({
        allOf: [{ $ref: 'https://skill-map.ai/spec/v0/summaries/markdown.schema.json' }],
      }),
      false,
    );
  });

  it('ignores tags-looking plain strings that are not $ref values', () => {
    const schema = {
      description: `See ${TAGS_SCHEMA_ID_PREFIX}markdown.schema.json for the canonical shape.`,
      allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
    };
    strictEqual(isTagsReportSchema(schema), false);
  });

  it('returns false on an empty schema', () => {
    strictEqual(isTagsReportSchema({}), false);
  });
});
