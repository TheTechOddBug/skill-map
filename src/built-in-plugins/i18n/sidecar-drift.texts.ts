/**
 * User-facing strings emitted by the `sidecar-drift` built-in extractor
 * (`built-in-plugins/extractors/sidecar-drift/index.ts`). The tooltip
 * is persisted into `scan_contributions.payload_json` and rendered on
 * hover of the `pi-sync` corner badge in `graph.node.alert`.
 *
 * Strings are plain English (per AGENTS.md `Externalized texts, not
 * internationalized`). The numbered hint at the end is intentional:
 * `sm bump <path>` is the one-call fix and the user discovers it
 * through this tooltip rather than scrolling the docs.
 */

export const SIDECAR_DRIFT_TEXTS = {
  staleBody:
    'Sidecar `.sm` is stale: the node body changed since the last bump. Run `sm bump <path>` to refresh.',
  staleFrontmatter:
    'Sidecar `.sm` is stale: the node frontmatter changed since the last bump. Run `sm bump <path>` to refresh.',
  staleBoth:
    'Sidecar `.sm` is stale: both the body and the frontmatter changed since the last bump. Run `sm bump <path>` to refresh.',
} as const;
