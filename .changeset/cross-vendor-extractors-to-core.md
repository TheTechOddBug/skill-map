---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Move the cross-vendor Extractors out of the `claude` plugin bundle and into `core`, and rename `frontmatter` → `annotations` to reflect the post-Step 9.6 reality that the canonical home for those structured references is the sidecar `.sm` `annotations:` block (Decision #125), not the markdown frontmatter.

**Qualified-id changes**

- `claude/frontmatter` → `core/annotations`
- `claude/slash` → `core/slash`
- `claude/at-directive` → `core/at-directive`

The `claude` bundle now contains only `claudeProvider` (path classification + frontmatter parser). The Extractors moved into `core` (`granularity: 'extension'`), so each is now independently toggleable via `sm plugins disable core/<id>`. Previously these extractors lived under the `claude` bundle (`granularity: 'bundle'`) and could only be removed by disabling the whole Claude integration — the same `gemini` and `agent-skills` Provider bundles already reused them implicitly with an apologetic comment in `built-ins.ts`.

**Why now.** The three Extractors are universal:

- `slash` matches `/<command>` (every coding-agent platform — Claude, Gemini, Cursor, Aider — uses slash commands).
- `at-directive` matches `@<handle>` with both GitHub-style (`@scope/name`) and namespace-style (`@ns:verb`) forms.
- `annotations` (née `frontmatter`) reads `requires` / `related` / `supersedes` / `supersededBy` / `conflictsWith`, all defined in the skill-map spec, not in Claude's conventions; the canonical source moved to the sidecar in Step 9.6 with a transitional fallback to legacy frontmatter `metadata:`.

Keeping them under `claude/` was deuda histórica from when Claude was the only Provider. Moving them to `core` resolves the apologetic Gemini comment and matches the architectural reality.

**Surface changes**

- `src/built-in-plugins/extractors/frontmatter/` → `src/built-in-plugins/extractors/annotations/`. Module export `frontmatterExtractor` → `annotationsExtractor`. `pluginId: 'claude'` → `'core'`. Docstring rewritten so the sidecar is the canonical surface and the legacy fallback is documented as transitional.
- `src/built-in-plugins/extractors/{slash,at-directive}/index.ts` — `pluginId: 'claude'` → `'core'`.
- `src/built-in-plugins/built-ins.ts` — three Extractors moved out of the `claude` bundle (now Provider-only) into `core`. The apologetic comment in the `gemini` bundle is gone (reuse is now structural). Top-level docstring rewritten to describe the new bundle layout.
- `spec/architecture.md` § A.6 — namespace description updated to make `core/` the home of cross-vendor Extractors and vendor bundles strictly the Provider home.
- `spec/plugin-author-guide.md` § Qualified extension ids — built-in inventory table reflects the new ids; § Granularity table updated to use `claude/claude` as the bundle-granularity rejection example.
- `spec/db-schema.md` § `scan_extractor_runs` — example qualified id updated.
- `spec/schemas/extensions/base.schema.json` — qualified-id description example updated.
- `src/built-in-plugins/README.md` — bundle table + descriptions updated.
- `ROADMAP.md` and `.changeset/view-contributions-system.md` — adopter mentions cross-reference the rename.
- Tests: `src/test/built-ins-modes.test.ts`, `src/test/plugin-runtime-branches.test.ts`, `src/test/plugins-cli.test.ts`, `src/test/kernel.test.ts`, `src/built-in-plugins/extractors/extractors.test.ts`, `src/built-in-plugins/rules/rules.test.ts`, `src/built-in-plugins/formatters/ascii/ascii.test.ts`, `src/built-in-plugins/rules/validate-all/validate-all.test.ts`, `ui/src/app/components/linked-nodes-panel/linked-nodes-panel.spec.ts`, `ui/src/services/data-source/static-data-source.spec.ts` — qualified-id catalogue, `pluginId` assertions, fixture `sources` arrays, and the bundle-granularity rejection test all updated to the new ids and describe-block names.

**Migration**

- Persisted `config_plugins` rows referencing the old qualified ids (none of the moved Extractors had a useful bundle-granularity disable target, but if any user explicitly enabled / disabled `claude/<id>` it now no-ops; redo the toggle against `core/<id>`).
- The scan caches (`scan_extractor_runs`, `node_enrichments`, `scan_contributions`) self-revalidate: rows keyed by the old qualified id `claude/<id>` quietly become orphan and are swept on the next scan; new rows land under `core/<id>`. No migration code required.

**Out of scope.** The legacy `metadata:` frontmatter fallback inside the `annotations` Extractor stays in this bump to keep the diff to "rename + move". A follow-up bump removes it and tightens the docstring once the migration is confirmed complete across observed projects.

**Pre-1.0 minor bump.** Per `spec/versioning.md` § Pre-1.0 and `AGENTS.md`, breaking changes ship as minors while a workspace is in `0.Y.Z`.
