# Fixtures and state: the data + script model

The tutorial no longer embeds fixture content in prose or hand-edits
the state file. **Content lives in `fixtures-data/` and is laid by
`scripts/fixtures.js`; progress lives in `tutorial-state.json` and is
owned by `scripts/state.js`.** This file is the reference for that
model; the per-chapter invocations live in each `part-*.md`.

## Data layout (`fixtures-data/`)

```
fixtures-data/
  manifest.json                 sets, footprints, edits, seeds, providerToken, langs
  sets/<set>/
    shared/                     lang-invariant files (code: server.js, package.json, CLAUDE.md)
    en/  es/                    one tree per language (files with translatable prose)
  edits/<edit-id>/
    en/  es/                    append fragments (one file per fragment)
```

- **`__PROVIDER__`** is a literal path segment in the data tree (e.g.
  `sets/prologue/en/__PROVIDER__/agents/demo-agent.md`). The script
  resolves it per provider: `.claude/agents/…` on claude,
  `.agents/skills/…` on agent-skills (where the `skills/` segment
  collapses, since that layout has no `agents`/`commands` dirs). Only
  the PATH is resolved; file CONTENT is laid verbatim.
- **Kind** is derived from the path (`__PROVIDER__/agents|commands|skills`
  → agent/command/skill, else markdown); files whose kind the provider
  does not claim are skipped automatically.
- **Language**: pass `--lang en|es`. A missing language tier for a set
  falls back to the default (`en`). Translate prose (descriptions,
  body, list items, anchor text); keep paths, frontmatter keys, node
  identifiers, link targets, and code in English.

## Sets

| Set | What it lays | Used by |
|---|---|---|
| `universal` | `.skillmapignore`, `findings.md` | pre-flight |
| `prologue` | the seven Part 0 demo nodes | Part 0 (progressive, `--only`), `prologue-built` seed |
| `portfolio` | Express skeleton, handbook, `content-editor`, `docs/STYLE` + `DEPLOY` | Part 1 (`--only` boot, chapters lay the rest), `harness-connected` seed |
| `harness` | `check-links` skill, `publish` command | Part 1 connect chapters, `harness-connected` seed |
| `master` | `master-agent`, `master-skill`, `notes/ideas` | Part 3 `backstage-init` |
| `cli-external` | `link-validation/hijoA` + `hijoB` | Part 4 `reference-paths` |

## Edits (append fragments)

`edit <id>` appends fragment files to a target (after a one-time
`prefix`). A `requiresKind` on a fragment (or on the edit's target
kind) drops it on a provider that does not claim that kind.

| Edit | Target | Fragments |
|---|---|---|
| `todo-connectors` | `notes/todo.md` | five hub bullets (agent / command / skill gated by kind) |
| `agents-hub` | `AGENTS.md` | the two handbook hub bullets |
| `content-editor-style` | `<provider_dir>/agents/content-editor.md` | the style-guide reference line (agent target, so skipped on agent-skills) |

## Seeds (fast-forward snapshots)

`seed <id>` composes sets + edits + drops to fast-forward into a part
entered out of order.

| Seed | Lays | Edits | Drops |
|---|---|---|---|
| `prologue-built` (Part 4) | `prologue` | `todo-connectors` | `notes/private-credentials.md` |
| `harness-connected` (Part 2) | `portfolio` + `harness` | `agents-hub`, `content-editor-style` | , |

## Footprints (what `clear` and `wipe` remove)

`manifest.json#footprints` lists the full on-disk reach of each
fixture, INCLUDING files a part's later chapters add (the daily loop's
`public/style.css` + generated pages, the renamed `new-page` command,
`AGENTS.sm`; the portfolio's `DEPLOYMENT.md` rename). `fixtures.js clear <footprint>` (part-entry resets) and
`state.js wipe` (start-over) both read it, so the per-fixture path list
lives in ONE place. Add or drop a harness file there.

## Changing a fixture

Edit the data file under `fixtures-data/`; the chapter that teaches it
reads the same file (the agent lays it with `fixtures.js`, or shows it
to the tester with `fixtures.js cat <set> --file <relpath>`). There is
no second copy to keep in sync. After any change, rebuild
(`pnpm --filter @skill-map/cli build`) so the byte-for-byte payload
test sees the new bytes.

## Authoring notes (still apply)

- **A `command` node's H1 is a plain title (`# publish`), never the
  slash form (`# /publish`).** The `slash` extractor reads a `/name`
  token anywhere in the body (the H1 included) as an `invoke`, so
  `# /publish` makes the command invoke itself and `sm check` emits a
  spurious `core/link-self-loop`. Holds for every command fixture
  (`demo-command`, `publish`, the daily-loop `init`).
- **No backtick-wrapped relative `.md` paths in `AGENTS.md`'s body.**
  `core/backtick-path` turns a `` `docs/STYLE.md` `` in a code span
  into a `points` link; at kickoff (before `docs/` exists) that lands
  as a broken reference and breaks the "one lonely node" beat. Name
  the docs in prose, never as backticked paths.
