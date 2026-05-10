---
"@skill-map/cli": patch
---

Fix two `sm plugins` inconsistencies and align the tester tutorial with the verbs that actually exist at v0.20.0.

**`sm plugins show` accepts qualified `<bundle>/<ext>` ids**

Previously, only bare bundle ids (`core`, `claude`) and user-plugin ids resolved; passing a qualified extension id (e.g. `core/external-url-counter`) returned exit 5 / "Plugin not found", even though `sm plugins enable` and `sm plugins disable` accept the same shape. The verbs now agree on id resolution: a qualified id is validated (bundle exists, extension exists inside it) using the same directed error messages as the toggle verbs (`Qualified extension id references unknown bundle`, `Qualified extension id not found`), then the parent bundle's detail is rendered. `show` is informational, so the granularity-mismatch rejection that toggle applies is intentionally skipped — `sm plugins show claude/some-ext` still surfaces the `claude` bundle.

**`sm plugins list` reflects per-extension disable state**

For granularity=extension bundles (only the built-in `core` today), individually-disabled extensions were invisible in the list output: the row showed `core ✓ 21 ext` regardless of how many extensions had been turned off, and the only way to see per-extension state was `sm plugins show <bundle>` or `sm plugins doctor`. The list renderer now prefixes disabled extension names with the same `✕` glyph the row header uses (`✕ superseded`), inside the same dim names line under the bundle row. The bundle row glyph is unchanged (`core` itself stays `✓` because the bundle id is still enabled — only the extension flipped). User plugins (granularity=bundle) keep their existing rendering: the row glyph already tells the bundle-level story.

**Tester tutorial — alignment with v0.20.0 verbs**

The `sm-tutorial` skill (`.claude/skills/sm-tutorial/SKILL.md`, also shipped via `sm tutorial` as the bundled `dist/cli/tutorial/sm-tutorial.md`) promised behaviours that did not match the current CLI surface. Five corrections:

- `kind: hook` and `kind: note` were promised for `.claude/hooks/demo-hook.md` and `notes/todo.md`. The Provider catalog at v0.20.0 emits `agent` / `command` / `skill` / `markdown` only; both files land as `markdown` (the catch-all). The fixture comments now state this explicitly and flag dedicated `hook` / `note` kinds as roadmap.
- `sm graph --root <path>` does not exist (the verb has only `--format` and `--no-plugins`, and dumps the whole persisted graph). The line is removed from Step 6.
- `sm export --format json --kind <kind>` does not exist (`export` takes a positional query and `--format`). The example is rewritten to use the actual query syntax: `sm export "kind=markdown" --format json` and `sm export "path=notes/**" --format json`. A short paragraph documents the query grammar (`kind=…`, `path=…`, `has=issues`, comma-OR within a key, AND across keys).
- Step 5 explanation now states that `sm check` reads from the persisted `scan_issues` table without re-walking the filesystem, so the verb's output reflects whatever the last scan / watcher run captured.
- Step 7 (broken-ref planting) ran `sm check` with the watcher already stopped (Step 4 ends with Ctrl+C), which made the verb print `✓ No issues` even after the file edit. An explicit `sm scan` now precedes `sm check` so the persisted snapshot picks up the bullet before the rule fires.

## User-facing

`sm plugins show core/<ext>` now resolves like `enable`/`disable` do, and `sm plugins list` marks individually-disabled extensions with `✕`. The `sm tutorial` content is realigned with the v0.20.0 verbs (no more `sm graph --root` / `sm export --kind` / `kind: hook` claims).
