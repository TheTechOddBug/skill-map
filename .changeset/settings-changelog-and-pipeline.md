---
"@skill-map/cli": minor
---

Settings → Changelog tab + user-facing changelog pipeline.

The Settings modal's "Changelog" sidebar entry was a `coming-soon` placeholder. It now renders the user-facing release notes — newest-first, bullet list per version, package pills after each highlight. Read-only by design (the same JSON ships with the SPA in both live and demo modes; no BFF call).

**Authoring convention.** Each `.changeset/*.md` that bumps `@skill-map/cli` may end with an optional `## User-facing` H2 section — a short user-focused note (markdown allowed: `inline code`, **emphasis**, [links](#)). The technical body above stays unchanged for the auto-generated `CHANGELOG.md`.

**Pipeline.** The new `scripts/build-user-changelog.js` runs as the FIRST step of `npm run release:version` (before `changeset version` consumes the changesets). It:

- Walks every `.changeset/*.md`, parses YAML frontmatter, extracts the `## User-facing` markdown body when present.
- Computes the next `@skill-map/cli` version from the pending bumps (max bump type, pre-1.0 cap).
- Prepends a single new entry to `ui/src/data/user-changelog.json` consolidating every changeset that bumps the CLI.
- Idempotent: if the top entry already targets the same version, the script no-ops.
- Releases with zero `## User-facing` sections produce a `kind: 'internal'` placeholder so the version still appears with a "focus on stability and infra" line — versions don't silently disappear from the user changelog.

**Surface changes**

- `ui/src/app/components/settings-modal/settings-changelog.{ts,html,css}` — new component. Renders entries via `MarkdownRenderer` (the same markdown-it + DOMPurify path the inspector body uses); each highlight body becomes a bullet, package list becomes mono pills.
- `ui/src/data/user-changelog.{ts,json}` — typed JSON data + interfaces. Seed contains two manually-authored entries (0.18.0, 0.17.0) so the panel shows content from day one. Future releases populate via the script.
- `ui/src/app/components/settings-modal/settings-modal.{ts,html}` — `changelog` section flips from `coming-soon` to `available`, new `<sm-settings-changelog />` mount in the `@switch`.
- `ui/src/i18n/settings.texts.ts` — Changelog section strings.
- `package.json` (root) — `release:version` now runs `node scripts/build-user-changelog.js` before `changeset version`.
- `AGENTS.md` — new rule documenting the `## User-facing` convention.
- `.claude/agents/commit.md` — commit skill updated with §6.1 (decide whether to add `## User-facing`) plus a quick-reference decision tree and a "doesn't edit user-changelog.json directly" entry.

**Side fixes shipped together**

- `ui/src/app/components/settings-modal/settings-about.ts` — Project DB now shows the path **relative to** the Project Folder row above (`.skill-map/skill-map.db`) instead of the absolute redundant prefix. The status word `present` is dropped from the value when the DB is wired up — the path alone is enough; non-`present` states (e.g. `missing`) keep the indicator.
- `ui/src/app/services/update-check.ts` — `load()` short-circuits when the runtime mode is `demo`. The static demo bundle has no BFF; the previous unconditional `fetch('/api/update-status')` 404'd in demo mode and broke the e2e smoke suite. Reads via `readSkillMapModeFromMeta()` directly (not through DI) so existing unit tests that construct the service via `new` outside of an injection context keep passing.
- `e2e/smoke/demo.spec.ts` — "boots without console errors" test now correlates `requestfailed` events with the generic `Failed to load resource:` console messages and ignores third-party asset failures (Google Fonts CDN). The `/api/*` guard test stays intact: that's the demo bundle's actual contract.
- `scripts/dev-reset.sh` — new `--target=demo` mode that wipes `fixtures/demo-scope/.skill-map/` and re-inits. Unblocks the `npm run demo:build` chain when the demo fixture's DB falls behind a kernel migration consolidation.

## User-facing

**Settings → Changelog.** The Changelog tab in Settings now lists what's new in skill-map: one entry per release, newest first, bullet points for the user-facing changes plus the workspace(s) each change affected. The same content is bundled with the demo so it's available offline too. The tab populates automatically on every release.

**Project DB path.** The "Project DB" row in Settings → About now shows the path relative to your project folder (`.skill-map/skill-map.db`) instead of repeating the absolute prefix already shown in the row above. Cleaner, less redundant.
