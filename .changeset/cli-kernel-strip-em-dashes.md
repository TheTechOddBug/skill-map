---
"@skill-map/cli": patch
---

Strip em dashes (`—`) from CLI / kernel / built-in user-facing strings. Stylistic sweep matching the project rule against em dashes in written text; each replacement is a comma, colon, semicolon, or parenthetical pair chosen to read naturally in context.

Touches:

- `src/cli/i18n/*.texts.ts` (bump, check, config, db, export, help, history, init, orphans, plugins, scan, serve, sidecar, watch) and matching command `description` / `details` strings in `src/cli/commands/**`.
- `src/kernel/i18n/*.texts.ts` (orchestrator, plugin-loader, plugin-store) and a handful of inline `throw new Error(...)` messages in `src/kernel/sidecar/`, `src/kernel/orchestrator/renames.ts`, `src/kernel/adapters/`.
- `src/built-in-plugins/i18n/ascii.texts.ts`, `unknown-field.texts.ts`, the `stability` analyzer's `EXPERIMENTAL_TOOLTIP` / `DEPRECATED_TOOLTIP`, and matching fixture expectations in the analyzer + ascii formatter test suites.
- `src/core/runtime/i18n/plugin-runtime.texts.ts` (the warning row template).
- `src/cli/util/conformance-scopes.ts` and `src/tsup.config.ts` (build-time stderr messages).
- The em-dash sentinel for `db-schema` in `sm version` output flips to a plain hyphen (`-`); matching test regexes in `src/test/cli.test.ts`, `db-cli.test.ts`, `graph-cli.test.ts` updated.
- `context/cli-reference.md` regenerated from `sm help --format md` to reflect the new strings.

No behaviour change; user-visible output is byte-identical save for the punctuation substitution.
