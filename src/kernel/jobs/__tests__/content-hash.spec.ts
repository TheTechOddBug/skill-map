/**
 * Unit tests for the job content-hash helpers.
 *
 * Pins:
 *   - `computeContentHash` is the sha256 over the NUL-joined tuple in the
 *     fixed field order (`spec/job-lifecycle.md` §Submit step 3), hex.
 *   - the NUL delimiter defeats concatenation-ambiguity collisions.
 *   - `node.path` participates (two nodes with identical body + frontmatter
 *     but different paths hash differently).
 *   - `computePromptTemplateHash` hashes the whole kernel-authored
 *     prelude (preamble + template + report contract), so a preamble
 *     bump OR a schema-byte edit changes the hash
 *     (`spec/prompt-preamble.md`).
 */

import { describe, it } from 'node:test';
import { strictEqual, notStrictEqual, match } from 'node:assert';
import { createHash } from 'node:crypto';

import {
  computeContentHash,
  computePromptTemplateHash,
  type IContentHashInput,
} from '../content-hash.js';

const NUL = String.fromCharCode(0);

function base(): IContentHashInput {
  return {
    extensionId: 'core/skill-summarizer',
    extensionVersion: '1.2.3',
    nodePath: '.claude/skills/foo/SKILL.md',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    promptTemplateHash: 'c'.repeat(64),
  };
}

describe('computeContentHash', () => {
  it('is the sha256 over the NUL-joined tuple in the fixed field order', () => {
    const input = base();
    const expected = createHash('sha256')
      .update(
        [
          input.extensionId,
          input.extensionVersion,
          input.nodePath,
          input.bodyHash,
          input.frontmatterHash,
          input.promptTemplateHash,
        ].join(NUL),
        'utf8',
      )
      .digest('hex');
    strictEqual(computeContentHash(input), expected);
    match(computeContentHash(input), /^[a-f0-9]{64}$/);
  });

  it('changes when node.path changes (path participates in the hash)', () => {
    const a = base();
    const b = { ...base(), nodePath: '.claude/skills/bar/SKILL.md' };
    notStrictEqual(computeContentHash(a), computeContentHash(b));
  });

  it('NUL-delimits so a concatenation-ambiguous shift changes the hash', () => {
    // Without a delimiter both tuples concatenate to the same "abc..."
    // string; the NUL join keeps them distinct.
    const left = { ...base(), extensionId: 'ab', extensionVersion: 'c' };
    const right = { ...base(), extensionId: 'a', extensionVersion: 'bc' };
    notStrictEqual(computeContentHash(left), computeContentHash(right));
  });

  it('is stable across calls for the same input', () => {
    strictEqual(computeContentHash(base()), computeContentHash(base()));
  });
});

describe('computePromptTemplateHash', () => {
  const CONTRACT = '## Report contract\n\n```json\n{}\n```';

  it('hashes preamble + template + report contract (the whole prelude)', () => {
    const preamble = 'PREAMBLE\n';
    const template = 'Summarize {{userContent}}.';
    const expected = createHash('sha256')
      .update(preamble + template + CONTRACT, 'utf8')
      .digest('hex');
    strictEqual(
      computePromptTemplateHash({ preamble, template, reportContract: CONTRACT }),
      expected,
    );
  });

  it('changes when the preamble changes (preamble bump invalidates)', () => {
    const template = 'Summarize {{userContent}}.';
    const v1 = computePromptTemplateHash({
      preamble: 'PREAMBLE v1\n',
      template,
      reportContract: CONTRACT,
    });
    const v2 = computePromptTemplateHash({
      preamble: 'PREAMBLE v2\n',
      template,
      reportContract: CONTRACT,
    });
    notStrictEqual(v1, v2);
  });

  it('changes when the template changes', () => {
    const preamble = 'PREAMBLE\n';
    const a = computePromptTemplateHash({
      preamble,
      template: 'A {{userContent}}',
      reportContract: CONTRACT,
    });
    const b = computePromptTemplateHash({
      preamble,
      template: 'B {{userContent}}',
      reportContract: CONTRACT,
    });
    notStrictEqual(a, b);
  });

  it('changes when a report-contract schema byte changes (schema edit re-keys)', () => {
    const preamble = 'PREAMBLE\n';
    const template = 'Summarize {{userContent}}.';
    const a = computePromptTemplateHash({ preamble, template, reportContract: CONTRACT });
    const b = computePromptTemplateHash({
      preamble,
      template,
      reportContract: CONTRACT.replace('{}', '{ }'),
    });
    notStrictEqual(a, b);
  });
});

describe('computePromptTemplateHash, fixer findings section', () => {
  const PREAMBLE = 'PREAMBLE\n';
  const TEMPLATE = 'Summarize {{userContent}}.';
  const CONTRACT = '## Report contract\n\n```json\n{}\n```';
  const FINDINGS = '## Findings to resolve\n\n```json\n[]\n```';

  // Frozen pre-fixer digest of `PREAMBLE + TEMPLATE + CONTRACT` (the exact
  // formula before the findings section existed). A NON-FIXER job carries
  // NO findings section, so its `promptTemplateHash` MUST stay byte-identical
  // to this literal, proving the fixer feature did not silently re-key every
  // existing job (which would strand every prior `state_job_contents` row).
  const PRE_FIXER_HASH = 'ac1ac673f2590794e1a014f8e0fe732e9a42d673ed77ddc6f48771c0c6d5038d';

  it('non-fixer hash (no findings section) is byte-identical to the pre-fixer formula', () => {
    strictEqual(
      computePromptTemplateHash({ preamble: PREAMBLE, template: TEMPLATE, reportContract: CONTRACT }),
      PRE_FIXER_HASH,
    );
  });

  it('an absent findings section equals an empty-string findings section', () => {
    const absent = computePromptTemplateHash({
      preamble: PREAMBLE,
      template: TEMPLATE,
      reportContract: CONTRACT,
    });
    const empty = computePromptTemplateHash({
      preamble: PREAMBLE,
      template: TEMPLATE,
      findingsSection: '',
      reportContract: CONTRACT,
    });
    strictEqual(absent, empty);
    strictEqual(empty, PRE_FIXER_HASH);
  });

  it('a non-empty findings section re-keys the hash (a fixer is a distinct content row)', () => {
    const withFindings = computePromptTemplateHash({
      preamble: PREAMBLE,
      template: TEMPLATE,
      findingsSection: FINDINGS,
      reportContract: CONTRACT,
    });
    notStrictEqual(withFindings, PRE_FIXER_HASH);
    // Folds in the spec order: preamble + template + findings + contract.
    const expected = createHash('sha256')
      .update(PREAMBLE + TEMPLATE + FINDINGS + CONTRACT, 'utf8')
      .digest('hex');
    strictEqual(withFindings, expected);
  });

  it('a changed finding set changes the hash (re-run after re-judge is a new job)', () => {
    const a = computePromptTemplateHash({
      preamble: PREAMBLE,
      template: TEMPLATE,
      findingsSection: '## Findings to resolve\n\n```json\n[{"type":"redundancy"}]\n```',
      reportContract: CONTRACT,
    });
    const b = computePromptTemplateHash({
      preamble: PREAMBLE,
      template: TEMPLATE,
      findingsSection: '## Findings to resolve\n\n```json\n[{"type":"redundancy"},{"type":"redundancy"}]\n```',
      reportContract: CONTRACT,
    });
    notStrictEqual(a, b);
  });
});
