---
"@skill-map/spec": minor
"@skill-map/cli": patch
---

Step 9.6 catalog curation. The annotation surface settled in Steps 9.6.1 → 9.6.7 went through a UX review on 2026-05-07; 16 fields with no clear value or that duplicated other surfaces were dropped from the curated catalog, and the per-bump rationale field `audit.bumpReason` was rolled back together with its CLI / BFF inputs.

**Annotations dropped (16).** `spec/schemas/annotations.schema.json` no longer documents `provides`, `type`, `author`, `created`, `updated`, `category`, `keywords`, `icon`, `color`, `priority`, `readme`, `examplesUrl`, `github`, `homepage`, `linkedin`, `twitter`. The schema stays `additionalProperties: true`, so legacy / opaque keys still ride through; the built-in `unknown-field` rule warns on any of them as a typo. Greenfield, no migration: no released consumer depended on these in `annotations.*`.

**Annotations kept (15).** `version`, `stability`, `supersedes`, `supersededBy`, `requires`, `conflictsWith`, `related`, `authors`, `license`, `source`, `sourceVersion`, `released`, `tags`, `hidden`, `docsUrl`. The load-bearing versioning + supersession block is unchanged.

**`audit.bumpReason` rolled back.** Removed from `spec/schemas/sidecar.schema.json#/$defs/audit/properties`. CLI: `--reason` flag dropped from `sm bump`; `IBumpInput.reason` removed; `buildAudit` no longer emits the field. BFF: `reason` removed from the `POST /api/sidecar/bump` JSON body schema. Tests assert the audit block surfaces `lastBumpedAt` / `lastBumpedBy` only on a bump-without-reason path. The audit block stays `additionalProperties: true` so the field can ride opaquely if a legacy sidecar carries it; the schema just doesn't curate it anymore. R6's mitigation set drops the bumpReason reference — the contract is now "bump rewrites the file; narrative goes in the `.md` body, which is never touched".

**deepMerge null-as-delete primitive retained.** The kernel's `FilesystemSidecarStore.deepMerge` still treats a `null` patch value as a delete sentinel. No current caller after the bumpReason rollback, but the primitive is architecturally sound for future Actions that need per-write erase semantics. JSDoc updated to flag this; the unit tests stay (renamed the example field name from `bumpReason` to a neutral placeholder).

**Fixtures + conformance.** All `.sm` files in `fixtures/local-scope/` and `fixtures/demo-scope/` trimmed to the curated set; the kitchen-sink reference fixture trimmed to 15 annotations + the load-bearing supersession block (kept the `example-plugin:` namespace). Conformance fixture `spec/conformance/fixtures/sidecar-end-to-end/agents/stale.sm` trimmed (removed `type` + `author`) so the `unknown-field` rule's expected warning count matches the case file's `issuesCount: 2` assertion. Structural sample at `spec/conformance/fixtures/sidecar-example/agent-example.sm` trimmed to the curated catalog.

**Spec docs.** `spec/architecture.md` `## Annotation system` section: catalog list updated, `audit.bumpReason` line dropped, bump-field-set stability clause rewritten to enumerate the four current audit fields with `additionalProperties: true` documented. `spec/cli-contract.md`: `--reason` removed from the two `sm bump` rows; the worked `.sm` round-trip example trailing line replaced; `POST /api/sidecar/bump` body shape no longer carries `reason`. `spec/conformance/coverage.md` row 27 updated. `spec/index.json` regenerated.

**ROADMAP.md.** §Step 9.6 carries a `Catalog curation 2026-05-07` note enumerating the dropped + kept sets; R6's mitigation list drops the bumpReason mention; the abridged decisions and §Frontmatter standard catalog descriptors updated.

**Out of scope.** UI display tiering (4-tier vendor/plugin layout, inspector sections) is a separate task delegated to app-agent later. Kernel `Node.author` denormalization stays untouched — `author` rides on `additionalProperties: true` for users who want to keep writing it informally; the read path persists the value but the field is no longer curated.
