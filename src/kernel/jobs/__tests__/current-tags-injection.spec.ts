/**
 * Unit tests for the tagger current-tags prelude
 * (`kernel/jobs/current-tags-injection.ts`, `spec/job-lifecycle.md`
 * §Current-tags injection for taggers):
 *
 *   - `selectCurrentTags` reads the node's `sidecar.annotations.tags` (the
 *     product's only tag source), drops non-string / empty entries, dedupes,
 *     and preserves the authored order so the rendered bytes reproduce.
 *   - `buildCurrentTagsSection` renders the `## Current tags` heading, the
 *     READ-ONLY caution (reuse verbatim, propose only what is missing, do
 *     NOT re-emit), and a fenced json array of the tag strings, with one tag
 *     and with several.
 *   - the render seam places the section AFTER the findings section, BEFORE
 *     the report contract, and OUTSIDE the `<user-content>` block.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { buildCurrentTagsSection, selectCurrentTags } from '../current-tags-injection.js';
import { buildFindingsSection } from '../findings-injection.js';
import { renderJobContent } from '../render.js';
import { buildReportContract } from '../report-contract.js';
import type { Node } from '../../types.js';
import type { IFindingRecord } from '../../types/storage.js';

/** A `Node`-shaped stub carrying only the sidecar overlay the selector reads. */
function nodeWith(annotations: Record<string, unknown> | null): Pick<Node, 'sidecar'> {
  return { sidecar: { present: annotations !== null, status: null, annotations, root: null } };
}

/** The parsed contents of the section's single fenced json block. */
function fencedJson(section: string): unknown {
  const open = section.indexOf('```json\n') + '```json\n'.length;
  return JSON.parse(section.slice(open, section.lastIndexOf('\n```')));
}

describe('selectCurrentTags', () => {
  it('reads sidecar.annotations.tags in authored order', () => {
    const node = nodeWith({ tags: ['deploy-pipeline', 'release-notes'] });
    deepStrictEqual(selectCurrentTags(node), ['deploy-pipeline', 'release-notes']);
  });

  it('returns an empty selection for an untagged node (the omission precondition)', () => {
    deepStrictEqual(selectCurrentTags(nodeWith(null)), []);
    deepStrictEqual(selectCurrentTags(nodeWith({})), []);
    deepStrictEqual(selectCurrentTags(nodeWith({ tags: [] })), []);
    deepStrictEqual(selectCurrentTags({}), []);
  });

  it('drops non-string / empty entries and dedupes (a hand-edited sidecar is untrusted)', () => {
    const node = nodeWith({ tags: ['ops', '', 'ops', 42, null, { tag: 'x' }, 'deploy'] });
    deepStrictEqual(selectCurrentTags(node), ['ops', 'deploy']);
  });

  it('ignores a tags value that is not an array', () => {
    deepStrictEqual(selectCurrentTags(nodeWith({ tags: 'ops' })), []);
  });
});

describe('buildCurrentTagsSection', () => {
  it('renders the heading, the READ-ONLY caution, and a fenced json array', () => {
    const section = buildCurrentTagsSection(['deploy-pipeline']);
    ok(section.startsWith('## Current tags'), 'kernel-authored heading leads');
    ok(/READ-ONLY/.test(section), 'caution names the section as read-only context');
    ok(/verbatim/.test(section), 'caution asks for verbatim reuse of a fitting tag');
    ok(/genuinely missing/.test(section), 'caution asks for only what is missing');
    ok(/do NOT re-emit/.test(section), 'caution forbids re-emitting the existing tags');
    ok(section.includes('```json\n'), 'fenced json block present');
    // One tag renders as a one-entry array, never a bare string.
    deepStrictEqual(fencedJson(section), ['deploy-pipeline']);
  });

  it('renders several tags as a json array in selection order', () => {
    const section = buildCurrentTagsSection(['deploy-pipeline', 'release-notes', 'ops']);
    deepStrictEqual(fencedJson(section), ['deploy-pipeline', 'release-notes', 'ops']);
  });

  it('is deterministic given the same selection', () => {
    const tags = ['a', 'b'];
    strictEqual(buildCurrentTagsSection(tags), buildCurrentTagsSection(tags));
  });
});

describe('renderJobContent with a current-tags section (tagger)', () => {
  const TAGGER_SCHEMA = {
    $id: 'urn:test:tagger-report',
    allOf: [{ $ref: 'https://skill-map.ai/spec/v0/report-base.schema.json' }],
  };

  /** Minimal `state_findings` row, only what `buildFindingsSection` projects. */
  const FINDING: IFindingRecord = {
    id: 1,
    nodeId: 'notes/guide.md',
    extensionId: 'core/ai-redundancy-analyzer',
    extensionVersion: '0.1.0',
    origin: 'extension',
    type: 'redundancy',
    severity: 'info',
    message: 'stated twice',
    detail: null,
    confidence: 0.7,
    model: null,
    resolution: null,
    resolutionActor: null,
    resolutionNote: null,
    resolutionBy: null,
    resolutionAt: null,
    bodyHashAtGeneration: 'a'.repeat(64),
    generatedAt: 1,
    jobId: null,
    stale: false,
  };

  it('places current tags AFTER findings, BEFORE the report contract and the block', () => {
    const rendered = renderJobContent({
      node: { path: 'notes/guide.md' },
      nodeBody: 'BODY TEXT',
      promptTemplate: 'Lead-in prose.\n\n{{userContent}}\n\nTrailing.',
      preamble: 'PREAMBLE\n',
      findingsSection: buildFindingsSection([FINDING]),
      currentTagsSection: buildCurrentTagsSection(['deploy-pipeline']),
      reportContract: buildReportContract({
        schemaText: JSON.stringify(TAGGER_SCHEMA, null, 2),
        schema: TAGGER_SCHEMA,
      }),
    });
    const findingsAt = rendered.indexOf('## Findings to resolve');
    const tagsAt = rendered.indexOf('## Current tags');
    const contractAt = rendered.indexOf('## Report contract');
    const blockAt = rendered.indexOf('<user-content id="notes/guide.md">');
    ok(findingsAt > -1 && tagsAt > -1 && contractAt > -1 && blockAt > -1);
    ok(findingsAt < tagsAt, 'current tags render after the findings section');
    ok(tagsAt < contractAt, 'current tags render before the report contract');
    ok(contractAt < blockAt, 'the whole prelude sits before the user-content block');
    ok(
      rendered.indexOf('Lead-in prose.') < tagsAt,
      'template prose before the placeholder precedes the section',
    );
  });

  it('keeps the section OUTSIDE the <user-content> delimiter', () => {
    const rendered = renderJobContent({
      node: { path: 'n.md' },
      nodeBody: 'BODY',
      promptTemplate: '{{userContent}}',
      preamble: 'PREAMBLE\n',
      currentTagsSection: buildCurrentTagsSection(['ops']),
    });
    const openAt = rendered.indexOf('<user-content id="n.md">');
    const closeAt = rendered.indexOf('</user-content>');
    const tagsAt = rendered.indexOf('## Current tags');
    ok(tagsAt > -1 && tagsAt < openAt, 'kernel-authored prelude, never user content');
    strictEqual(rendered.indexOf('## Current tags', closeAt), -1, 'nothing after the block');
  });

  it('renders nothing extra when no section is supplied (non-tagger jobs unchanged)', () => {
    const rendered = renderJobContent({
      node: { path: 'n.md' },
      nodeBody: 'BODY',
      promptTemplate: '{{userContent}}',
      preamble: 'PREAMBLE\n',
    });
    strictEqual(rendered, 'PREAMBLE\n\n<user-content id="n.md">\nBODY\n</user-content>');
  });
});
