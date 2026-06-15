/**
 * Format-consistency guard for built-in analyzer finding messages.
 *
 * Every diagnosis body passed to `formatFinding({ body })` must follow
 * the canonical grammar `<what>; <why>`: a capitalised `<what>` clause,
 * a `; ` separator, then the `<why>`. Placeholders (`{{x}}`) are allowed
 * anywhere. Remediation advice belongs in `Issue.fix.summary`, NOT in the
 * body, so a body must not be an imperative hint.
 *
 * This is the "stop finding inconsistent messages" backstop: when a new
 * analyzer (or a new branch) adds a body template, add it to
 * `BODY_TEMPLATES` and this test pins the shape. Labels, fix-summary
 * hints, tooltips, chip text, and interpolated sub-values are NOT bodies
 * and are intentionally excluded. `core/issue-counter` and
 * `core/link-counter` emit no `<what>; <why>` findings (aggregate /
 * counter surfaces), so they have no entry here.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { ANNOTATION_FIELD_UNKNOWN_TEXTS } from '../annotation-field-unknown/text.js';
import { ANNOTATION_ORPHAN_TEXTS } from '../annotation-orphan/text.js';
import { ANNOTATION_STALE_TEXTS } from '../annotation-stale/text.js';
import { EXTRACTOR_COLLISION_TEXTS } from '../extractor-collision/text.js';
import { JOB_FILE_ORPHAN_TEXTS } from '../job-file-orphan/text.js';
import { LINK_KIND_CONFLICT_TEXTS } from '../link-kind-conflict/text.js';
import { LINK_SELF_LOOP_TEXTS } from '../link-self-loop/text.js';
import { NAME_COLLISION_TEXTS } from '../name-collision/text.js';
import { NAME_RESERVED_TEXTS } from '../name-reserved/text.js';
import { NODE_STABILITY_TEXTS } from '../node-stability/text.js';
import { NODE_SUPERSEDED_TEXTS } from '../node-superseded/text.js';
import { REFERENCE_BROKEN_TEXTS } from '../reference-broken/text.js';
import { REFERENCE_REDUNDANT_TEXTS } from '../reference-redundant/text.js';
import { SCHEMA_VIOLATION_TEXTS } from '../schema-violation/text.js';

/** Every `formatFinding({ body })` diagnosis template, as `[analyzer.field, template]`. */
const BODY_TEMPLATES: ReadonlyArray<readonly [string, string]> = [
  ['annotation-field-unknown.unknownAnnotationKey', ANNOTATION_FIELD_UNKNOWN_TEXTS.unknownAnnotationKey],
  ['annotation-field-unknown.unknownRootKey', ANNOTATION_FIELD_UNKNOWN_TEXTS.unknownRootKey],
  ['annotation-field-unknown.pluginNamespaceInvalid', ANNOTATION_FIELD_UNKNOWN_TEXTS.pluginNamespaceInvalid],
  ['annotation-orphan.message', ANNOTATION_ORPHAN_TEXTS.message],
  ['annotation-stale.bodyDrift', ANNOTATION_STALE_TEXTS.bodyDrift],
  ['annotation-stale.frontmatterDrift', ANNOTATION_STALE_TEXTS.frontmatterDrift],
  ['annotation-stale.bothDrift', ANNOTATION_STALE_TEXTS.bothDrift],
  ['extractor-collision.message', EXTRACTOR_COLLISION_TEXTS.message],
  ['job-file-orphan.message', JOB_FILE_ORPHAN_TEXTS.message],
  ['link-kind-conflict.message', LINK_KIND_CONFLICT_TEXTS.message],
  ['link-self-loop.message', LINK_SELF_LOOP_TEXTS.message],
  ['name-collision.message', NAME_COLLISION_TEXTS.message],
  ['name-reserved.message', NAME_RESERVED_TEXTS.message],
  ['name-reserved.linkMessage', NAME_RESERVED_TEXTS.linkMessage],
  ['node-stability.experimental', NODE_STABILITY_TEXTS.experimental],
  ['node-stability.deprecated', NODE_STABILITY_TEXTS.deprecated],
  ['node-superseded.message', NODE_SUPERSEDED_TEXTS.message],
  ['reference-broken.message', REFERENCE_BROKEN_TEXTS.message],
  ['reference-redundant.message', REFERENCE_REDUNDANT_TEXTS.message],
  ['schema-violation.nodeFailure', SCHEMA_VIOLATION_TEXTS.nodeFailure],
  ['schema-violation.linkFailure', SCHEMA_VIOLATION_TEXTS.linkFailure],
  ['schema-violation.frontmatterBaseFailure', SCHEMA_VIOLATION_TEXTS.frontmatterBaseFailure],
];

// `<what>` is a capitalised clause with no `;`, then `; `, then `<why>`.
const BODY_GRAMMAR = /^[A-Z][^;]*; .+/;
// A body must not be pre-formatted: no backtick subject head, no `L<line>:`
// prefix (formatFinding adds both), no leading lowercase imperative.
const PRE_FORMATTED = /^(`|L\d+:)/;

describe('finding message format consistency', () => {
  for (const [label, template] of BODY_TEMPLATES) {
    it(`${label} follows the canonical \`<what>; <why>\` grammar`, () => {
      assert.doesNotMatch(template, PRE_FORMATTED, `${label}: body must not carry subject / line prefix`);
      assert.match(template, BODY_GRAMMAR, `${label}: body must read "<what>; <why>"`);
    });
  }
});
