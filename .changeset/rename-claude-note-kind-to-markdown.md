---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Phase 0 of the multi-provider rollout: rename the Claude Provider's fallback kind `note` → `markdown`.

The fallback kind classifies any markdown file under a Claude scope that does not match a more specific path (`.claude/agents/`, `.claude/commands/`, `.claude/skills/`). The previous name `note` overcommitted to a content role; the file is really just "generic markdown without a specific role". The new name reflects the *format*. Convention going forward: format-named kinds (`markdown`, future `toml`, future `json`) apply ONLY as the generic fallback. A file that IS a specific role (e.g. a Codex agent in TOML) classifies as `agent`, not `toml` — specific roles prevail over format naming.

This rename is mechanical and pure. No behavior, validation, or persistence change beyond the kind identifier.

**`@skill-map/spec`**
- `schemas/extensions/provider.schema.json` description updated (the spec doesn't hardcode kind names; only prose mentions changed).
- `schemas/node.schema.json` prose updated.
- `schemas/summaries/note.schema.json` → `schemas/summaries/markdown.schema.json` (renamed file, `$id` updated, `title: SummaryNote` → `SummaryMarkdown`, prose updated).
- `db-schema.md`, `README.md`, `conformance/coverage.md` — prose updates.
- `spec/index.json` regenerated (new file path + hash, old entry removed).

**`@skill-map/cli`**
- `built-in-plugins/providers/claude/index.ts` — `kinds.note` → `kinds.markdown`. `defaultRefreshAction` `claude/summarize-note` → `claude/summarize-markdown`. `ui.label: 'Notes'` → `'Markdown'`. Color and icon unchanged. `classify()` fallback `'note'` → `'markdown'`.
- `built-in-plugins/providers/claude/schemas/note.schema.json` → `markdown.schema.json` (renamed file, `$id` updated, `title: FrontmatterNote` → `FrontmatterMarkdown`).
- `kernel/types.ts` — `NodeKind` union: `'note'` → `'markdown'`.
- `built-in-plugins/formatters/ascii/index.ts` and `cli/commands/export.ts` — `KIND_ORDER` updated.
- All hardcoded `'note'` test fixtures and assertions across `src/test/`, `src/built-in-plugins/`, and the Claude conformance suite (`basic-scan.json`, `coverage.md`) flipped to `'markdown'`.
- Conformance fixture `spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/provider.js` (the negative-test fixture mirroring Claude shape) renamed alongside.

**UI (`ui/`, private workspace, no version bump per AGENTS.md `ui/` policy)**
- `models/node.ts` — `ISummaryNote` → `ISummaryMarkdown` with `kind: 'markdown'`. Union member updated.
- `node-card.ts/.html`, `graph-layout.ts/.spec.ts`, `collection-loader.ts/.spec.ts`, `static-data-source.spec.ts`, `node-card.spec.ts`, `vendor-frontmatter.spec.ts`, `inspector-view.html` — kind literal + class binding renames.
- CSS classes `.sm-gnode--note` → `.sm-gnode--markdown`, `.inspector__header--note` → `.inspector__header--markdown`. CSS variables `--sm-kind-note*` → `--sm-kind-markdown*` across `node-card.css`, `kind-palette.css`, `inspector-view.css`. The variables are runtime-injected from the Provider's `ui.color` value, so no static color value changed.
- i18n comments in `i18n/node-card.texts.ts` updated.

**Web (public site, `web/`)**
- `app.js` color map and `STR` label map: `note` → `markdown`.
- `index.html` demo SVG `data-type="note"` → `"markdown"`. Provider description prose dropped the legacy `hook` mention while we were there (out-of-date since spec 0.17.0; not a Phase 0 goal but cheap to fix in the same prose pass).
- `i18n.json` key `graph.legend.note` → `graph.legend.markdown` with EN/ES values `Markdown`/`Markdown` (dev-facing audience; the technical kind name reads cleaner than the prose word "Note").

**No data migration required.** Greenfield (per `feedback_greenfield_no_versioning.md`); existing local DBs rescan to pick up the new kind value. Historical CHANGELOG entries that reference `note` are intentionally left untouched — they document past behavior (precedent: the `.skill-mapignore` rename in spec 0.16.0).

**Demo data.** `web/demo/data.meta.json` is a generated artifact (regenerates on next demo build); the source changes drive it.

Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because both `@skill-map/spec` and `@skill-map/cli` are still 0.x and no released consumer mandates the prior kind name. The first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.
