---
'@skill-map/cli': minor
---

`sm tutorial` now materializes a full Claude Code skill folder under
`<cwd>/.claude/skills/<slug>/` instead of a single `.md` file at the
cwd top level. This unblocks `sm tutorial master`: the canonical
`sm-master` skill ships a `references/` sub-folder (tour bodies +
fixture templates) that the SKILL.md reads at runtime, and the
previous single-file payload left those references missing when a
tester ran the verb.

**`src/cli/commands/tutorial.ts`:**

- `VARIANT_SPECS` switches from `{ filename, sourcePath, bundledName }`
  to `{ slug, sourceDir, triggerEn, triggerEs }`. The verb writes
  `<cwd>/.claude/skills/<slug>/` recursively from the resolved source
  directory.
- Refuse-to-clobber checks the existence of the destination directory;
  `--force` removes the existing tree before re-copying so the
  post-condition ("target matches the bundled payload byte-for-byte")
  holds even when the prior payload had extra files.
- Resolver swaps the body cache for a source-dir cache and walks the
  same dev / bundled candidate list, validating that each candidate
  is a directory before accepting it.

**`src/tsup.config.ts`:**

- The two skill-specific copy helpers collapse into a single
  `copySkillFolder(slug)` that runs `cpSync(sourceDir, distDir, {
  recursive: true })`, so `dist/cli/tutorial/sm-tutorial/` and
  `dist/cli/tutorial/sm-master/` ship the full payload. Soft-fail
  pattern and warning copy preserved.

**`src/cli/i18n/tutorial.texts.ts`:**

- Success copy points the tester at the skill folder and the trigger
  phrases (English / Spanish) instead of the legacy `@<filename>` file
  reference. New `enTrigger` / `esTrigger` placeholders fed by
  `VARIANT_SPECS`.

**Tests (`src/cli/commands/__tests__/tutorial-cli.spec.ts`):**

- All assertions move from "file at cwd" to "directory at
  `.claude/skills/<slug>/`". New helper `assertDirsEqual` walks both
  the source folder and the materialized folder and compares every
  file byte-for-byte.
- New case explicitly covers `references/` sub-folder shipping (the
  core of this fix) and a `--force` case proves leftovers from a
  prior payload get wiped.

**`context/cli-reference.md`** regenerated via `pnpm --filter
@skill-map/cli reference`.

## User-facing

`sm tutorial` now lays the skill at `.claude/skills/<slug>/` (was a single `.md`) so multi-file skills like `sm-master` ship their `references/`. Claude Code auto-discovers it; invoke with its trigger phrase (e.g. "tutorial maestro"), no more `@sm-master.md`.
