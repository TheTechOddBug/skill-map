/**
 * Unit tests for the canonical skill-action artifact loaders
 * (`skill-template.ts`, `spec/skill-actions.md`):
 *
 *   - `loadCanonicalSkillTemplate()` returns the conformance fixture
 *     `skill-action-template-v1.txt` byte-verbatim (the wrapper template
 *     is normative and reproduced there; implementations load the
 *     installed spec artifact, never a hand-copy), and the template
 *     contains `{{userContent}}` exactly once (the delimiter contract
 *     holds by construction).
 *   - `loadSkillActionReportSchema()` parses the ONE canonical report
 *     schema and requires `summary` (the only field skills add over
 *     report-base).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import {
  loadCanonicalSkillTemplate,
  loadSkillActionReportSchema,
  loadSkillActionReportSchemaText,
} from '../skill-template.js';
import { USER_CONTENT_PLACEHOLDER } from '../render.js';

function specRoot(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve('@skill-map/spec/index.json'));
}

describe('loadCanonicalSkillTemplate', () => {
  it('returns the spec conformance fixture byte-verbatim', () => {
    const fixture = readFileSync(
      join(specRoot(), 'conformance', 'fixtures', 'skill-action-template-v1.txt'),
      'utf8',
    );
    strictEqual(loadCanonicalSkillTemplate(), fixture);
  });

  it('contains {{userContent}} exactly once and authors no delimiter of its own', () => {
    const template = loadCanonicalSkillTemplate();
    strictEqual(template.split(USER_CONTENT_PLACEHOLDER).length - 1, 1);
    ok(!/<user-content/i.test(template));
  });

  it('is cached: two calls return the identical string', () => {
    strictEqual(loadCanonicalSkillTemplate(), loadCanonicalSkillTemplate());
  });
});

describe('loadSkillActionReportSchema', () => {
  it('parses the canonical schema text and requires summary', () => {
    const schema = loadSkillActionReportSchema();
    strictEqual(
      schema['$id'],
      'https://skill-map.ai/spec/v1/skill-actions/report.schema.json',
    );
    deepStrictEqual(schema['required'], ['summary']);
    // The chain the report contract inlines: this schema $refs ONLY
    // report-base (no summaries/ or findings/ namespace, so record
    // writes the execution row only).
    const text = loadSkillActionReportSchemaText();
    ok(text.includes('../report-base.schema.json'));
    ok(!text.includes('summaries/'));
    ok(!text.includes('findings/'));
  });

  it('is the parse of the verbatim schema text', () => {
    deepStrictEqual(loadSkillActionReportSchema(), JSON.parse(loadSkillActionReportSchemaText()));
  });
});
