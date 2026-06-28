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

/**
 * Analyzer id the kernel stamps on the body backtick-balance diagnostic
 * (`node-build.ts`, derived from the same `stripCodeBlocks` policy the
 * prose extractors rely on). An unclosed fence or inline span corrupts
 * the code-strip policy, so the prose-side extractors stop emitting
 * edges past the dangling backtick. Distinct from the frontmatter ids
 * above because it is a BODY-syntax defect, not a frontmatter-shape one.
 */
export const BACKTICK_ISSUE_ID = 'backtick-unbalanced';

/**
 * Issues the kernel stamps per node during the walk AND caches across an
 * incremental scan, reused verbatim for an unchanged node so the warning
 * does not silently drop on a clean re-scan. Superset of the frontmatter
 * ids plus the body backtick diagnostic.
 *
 * Kept separate from `FRONTMATTER_ISSUE_ANALYZERS`: that narrower set is
 * ALSO the "kernel already validated this node's frontmatter shape"
 * signal `core/schema-violation` reads to suppress its redundant
 * `name` / `description` base-field check. A body backtick defect says
 * nothing about frontmatter shape, so it must NOT enter that set, only
 * this caching one.
 */
export const CACHED_KERNEL_ISSUE_ANALYZERS: ReadonlySet<string> = new Set([
  ...FRONTMATTER_ISSUE_ANALYZERS,
  BACKTICK_ISSUE_ID,
]);
