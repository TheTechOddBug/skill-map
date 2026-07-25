/**
 * Current-tags section of a TAGGER job's rendered content
 * (`spec/job-lifecycle.md` §Current-tags injection for taggers). A tagger
 * is an Action whose `report.schema.json` `$ref`s a schema under
 * `spec/schemas/tags/` (`isTagsReportSchema`, the same detector the record
 * path uses to turn a completed report into a tags proposal).
 *
 * WHY the injection exists: without it the model infers tags blind to what
 * the node already carries and proposes near-duplicates of them (`deploy`
 * next to an existing `deploy-pipeline`), which a human then has to
 * reconcile by hand. With it the model can reuse an existing tag verbatim,
 * propose only what is genuinely missing, and stay consistent with the
 * vocabulary the operator has been building.
 *
 * Two pure building blocks the CLI submit path composes, mirroring
 * `findings-injection.ts`:
 *   - `selectCurrentTags`, the SELECTION: the node's
 *     `sidecar.annotations.tags` (the only tag source in the product, same
 *     projection `scan_node_tags` persists), narrowed to non-empty strings
 *     and deduped, in AUTHORED order (the sidecar array order is what the
 *     operator sees in the tags editor, and it is deterministic per file,
 *     so the rendered bytes reproduce).
 *   - `buildCurrentTagsSection`, the RENDER: the `## Current tags`
 *     heading, a one-line READ-ONLY caution, then a fenced ```json array
 *     of the tag strings.
 *
 * The section is kernel-authored prelude: it renders OUTSIDE the
 * `<user-content>` block, between the findings-to-resolve section and the
 * report contract, and folds into `promptTemplateHash` (`content-hash.ts`)
 * exactly like those siblings, so a node whose tags changed re-keys its
 * job content instead of reusing a stale render. It is OMITTED entirely
 * when the node carries no tags (nothing to state), which also keeps every
 * non-tagger job's hash byte-identical to the pre-injection formula.
 */

import type { Node } from '../types.js';
import { JOB_TEXTS } from '../i18n/jobs.texts.js';

/**
 * The node's current tags, read from the sidecar overlay the scan mirror
 * already carries (`sidecar.annotations.tags`, `spec/architecture.md`
 * §Storage rule: tags are human curation, so the `.sm` companion is their
 * home and the DB column is a projection of it). Non-string / empty
 * entries are dropped and duplicates collapse, so a hand-edited sidecar
 * cannot inject noise into the prompt. Empty array = nothing to inject.
 *
 * Deliberately sources the node the submit path ALREADY resolved: no extra
 * filesystem read, no second query.
 */
export function selectCurrentTags(node: Pick<Node, 'sidecar'>): string[] {
  const raw = node.sidecar?.annotations?.['tags'];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) continue;
    seen.add(item);
  }
  return [...seen];
}

/**
 * Render the `## Current tags` section from ALREADY-SELECTED tags
 * (`selectCurrentTags`): the heading, a one-line READ-ONLY caution (reuse
 * an existing tag verbatim when it fits, propose only what is genuinely
 * missing, do NOT re-emit the existing tags in the report), then a fenced
 * ```json array of the tag strings. Callers MUST NOT invoke this with an
 * empty array: a node with no tags gets NO section at all
 * (`spec/job-lifecycle.md` §Current-tags injection for taggers).
 */
export function buildCurrentTagsSection(tags: readonly string[]): string {
  const json = JSON.stringify([...tags], null, 2);
  return (
    `${JOB_TEXTS.currentTagsHeading}\n\n` +
    `${JOB_TEXTS.currentTagsCaution}\n\n` +
    `\`\`\`json\n${json}\n\`\`\``
  );
}
