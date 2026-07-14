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
