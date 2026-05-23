---
"@skill-map/cli": minor
---

CLI output-style audit pass 2. Pass 1 (landed in `21920e8`) covered `init`, `scan`, `config`, `help`, `history`, `export`, and the bare-`sm` no-project entry. Pass 2 migrates the remaining error / warning surfaces across twelve catalogs to `context/cli-output-style.md` §3.1b, the two-line block: glyph + headline followed by a dim hint sourced from a sibling `<key>Hint` catalogue entry. Colour resolution stays at the CLI seam (`ansiFor`-resolved glyph + `ansi.dim`-wrapped hint threaded through the texts pipeline at the call site).

**Catalogs migrated**, ~36 strings + matching hints:

- `serve.texts.ts`, full rewrite (11 strings + 8 hints). Covers `portInUse`, `pathNotFound`, `bindFailed`, the `--port` validator, `--scope` mismatch, missing-DB on first boot, and the no-network-interface diagnostic the auto-bind path can hit.
- `bump.texts.ts` (5 strings) including `gitAddFailed` where the previous "Continuing batch" tail moves into the dim-hint slot so the headline reads as a single thought.
- `db.texts.ts` (5 strings) across `db migrate`, `db reset`, `db restore`.
- `plugins.texts.ts` (4 strings) including a verb-parameterised hint on `toggleNeitherIdNorAll` so `sm plugins enable` and `sm plugins disable` both render a correct example.
- `refresh.texts.ts` (2 strings) plus a real user-visible bug fix, see below.
- `list.texts.ts` (2 strings).
- `sidecar.texts.ts` (1 string).
- `watch.texts.ts` (1 string).
- `graph.texts.ts` (1 string).
- `hooks.texts.ts` (1 string), a new `unknownFlavour` entry extracted from a previously-inline message.
- `option-validators.texts.ts` (1 string).
- `logger.texts.ts` (1 string), the catalogue entry was missing `{{glyph}}` entirely.

**Real bug fixed in `src/cli/commands/refresh.ts`.** The persist-failure branch called `tx(REFRESH_TEXTS.refreshFailed, { message })` without the `glyph` argument, leaving the literal token `{{glyph}}` on the operator's terminal on a real failure path. The test suite caught no regression because its assertions use partial-match regexes that ignored the prefix. Pass 2 threads `glyph: errGlyph` through and the literal is gone.

**Call-site updates** in fifteen files under `src/cli/commands/` and `src/cli/util/`, all threading the pre-resolved glyph + dim-wrapped hint into the catalogue's `{{glyph}}` / `{{hint}}` placeholders at the seam, no `process.env` reads anywhere downstream.

Pre-1.0 minor per `spec/versioning.md`. No `spec/` files touched. No new normative wording.

## User-facing

**Clearer CLI errors.** Errors from `sm serve`, `bump`, `db`, `plugins`, `refresh`, `list`, `watch`, `graph`, `hooks`, and `sidecar` now print a `✕` headline plus a dim hint on the next line. Fixes a `sm refresh` persist-failure that rendered `{{glyph}}` literally.
