---
"@skill-map/cli": patch
---

Follow-up sweep on the cli-ruler audit. Four pieces:

- **`sm plugins create` honors `-g/--global`.** The verb previously hardcoded the project plugins dir (`<cwd>/.skill-map/plugins/<id>`) and silently ignored the inherited `-g` flag. Now routes through `defaultProjectPluginsDir` / `defaultUserPluginsDir` so `-g` lands the scaffold under `~/.skill-map/plugins/<id>` as the help text already implied. `--at <path>` keeps overriding both.

- **`sm plugins create` strings moved to the i18n catalog.** Three inline literals (invalid-id error, refuse-overwrite error, post-scaffold success block) extracted to `PLUGINS_TEXTS.createInvalidId` / `createRefuseOverwrite` / `createSuccess` and emitted via `tx()`. The user-visible output is byte-identical, including the trailing em dash on the `slots list` hint line which is preserved verbatim to avoid a cosmetic diff in scripted output.

- **`sm plugins slots list` strings moved to the i18n catalog.** Section headers and the trailing tip extracted to `PLUGINS_TEXTS.slotsListHeaderViewSlots` / `slotsListHeaderInputTypes` / `slotsListTipFooter` / `slotsListTipText`. Output is byte-identical.

- **`reference-paths-walker` skip-set uses `SKILL_MAP_DIR`.** The `.skill-map` directory name was hardcoded in the walker's skip-list; replaced with the named export from `core/paths/db-path.ts` so the literal lives in one place and survives a future rename.

## User-facing

`sm plugins create <id> -g` now scaffolds under `~/.skill-map/plugins/<id>` instead of the project dir. The flag was advertised in `--help` but previously ignored.
