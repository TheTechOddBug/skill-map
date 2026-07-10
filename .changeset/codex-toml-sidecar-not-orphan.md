---
"@skill-map/cli": patch
---

Orphan-sidecar discovery now inverts `sidecarPathFor` for both anchor forms, so a `.sm` next to a non-`.md` node (a Codex `.toml` sub-agent, whose sidecar is `X.toml.sm`) resolves to its real sibling instead of a hardcoded `X.md`. An annotated Codex agent no longer emits a spurious `annotation-orphan` warning and `sm sidecar prune` no longer treats it as prunable; genuine orphans (append-form sidecars whose node is gone) still surface.

## User-facing

Annotating a Codex sub-agent (a `.toml` file) no longer raises a false "orphan sidecar" warning when you scan. Its annotations attach as expected, and prune leaves it alone.
