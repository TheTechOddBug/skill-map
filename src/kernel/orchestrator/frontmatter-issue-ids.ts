/**
 * Analyzer ids the kernel itself stamps on frontmatter diagnostics, before
 * any analyzer runs (seeded into the issue accumulator):
 *
 *   - `frontmatter-invalid`     per-kind AJV schema failure (`orchestrator/frontmatter.ts`).
 *   - `frontmatter-malformed`   frontmatter present but structurally unusable.
 *   - `frontmatter-parse-error` YAML parse failure (parser, via `raw.parseIssues`).
 *
 * Single source of truth so consumers agree on "the kernel already flagged
 * this node's frontmatter":
 *   - `orchestrator/cache.ts` carries these across an incremental scan so a
 *     cached node does not silently drop the prior warning.
 *   - `core/schema-violation` suppresses its redundant frontmatter base-field
 *     check (missing `name` / `description`) when one of these already landed
 *     for the node, the base check only adds value when the kernel said
 *     nothing (dispatch never reached the per-kind validator).
 */
export const FRONTMATTER_ISSUE_ANALYZERS: ReadonlySet<string> = new Set([
  'frontmatter-invalid',
  'frontmatter-malformed',
  'frontmatter-parse-error',
]);
