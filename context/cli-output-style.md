# CLI human output — style guide

Operating manual for **human-mode** output of every `sm` verb. The
rules here were extracted while polishing the in-CLI verbs in
2026-05; load this annex before you redesign or add a verb so the new
output stays in lock-step with the rest of the surface.

**Scope**: the `--json` path of every verb stays as-is — schemas and
shapes are part of the public contract. This annex governs only what
the user sees on stdout / stderr in interactive runs.

**Authority**: same level as `AGENTS.md` (Topical annexes table).
Where this annex and `AGENTS.md` collide, treat the spec / ROADMAP
order from AGENTS.md as authoritative; this is a presentation
contract, not a behavioural one.

---

## 1. Glyph catalog

Every glyph is rendered raw (not behind an env-flag) so the bytes
print in non-TTY pipes too. Color is gated separately — wrap the
glyph through the matching `IAnsi` method at the call site and the
no-color paths fall back to the bare character.

| Glyph | Color  | Meaning                                            |
|-------|--------|----------------------------------------------------|
| `✓`   | green  | Success — task done, exit 0                        |
| `✕`   | red    | Error / failure / disabled — exit ≠ 0 in many cases |
| `⚠`   | yellow | Warning / advisory — soft signal, may not gate exit |
| `ℹ`   | cyan   | Informational — neutral context                    |
| `⋯`   | yellow | Dry-run / "would do" preview                       |
| `→`   | dim    | Outgoing link / arrow                              |
| `←`   | dim    | Incoming link / arrow                              |

ANSI escapes (xterm 256-color) — keep these raw, do NOT add a color
dep. Mirrors `cli/util/ansi.ts`:

| Color  | Code            |
|--------|-----------------|
| green  | `\x1b[38;5;42m`  |
| red    | `\x1b[38;5;203m` |
| yellow | `\x1b[38;5;214m` |
| cyan   | `\x1b[38;5;81m`  |
| dim    | `\x1b[2m`        |
| reset  | `\x1b[0m`        |

---

## 2. Color resolution

Always go through `ansiFor` from `cli/util/ansi.ts`:

```ts
import { ansiFor, type IAnsi } from '../util/ansi.js';

const stdout = this.context.stdout as NodeJS.WriteStream;
const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
```

Precedence is `--no-color` > `NO_COLOR` env > `FORCE_COLOR` env > stdout
TTY. The same precedence is used by `serve-banner.ts`'s
`resolveColorEnabled` — do NOT introduce a different rule.

When you need to forward "color enabled" past the CLI boundary (BFF,
core/runtime), pass a `colorEnabled?: boolean` field through the
options object — `core/` is forbidden from reading `process.env` per
the boundary lint, so the CLI resolves and forwards.

---

## 3. Layout patterns

### 3.1. Single-line success / failure

```
  ✓  <statement>
  ✕  <statement>
  ⋯  <statement>  (dry-run)
```

Examples:

- `✓  No issues.` (`sm check` empty)
- `✓  No stale enrichment rows.` (`sm refresh --stale` empty)
- `✓  Backup written: .skill-map/backups/<timestamp>.db`

### 3.2. Header + indented body

For verbs that produce a result and a destination (scan, refresh,
reconcile, undo-rename):

```
  ✓  <count summary>   <duration>
     <body line>
```

Body line at indent 5 — visually associates with the header glyph
column without competing for it.

### 3.3. Sectioned block (preferred for multi-section output)

Used by `sm config list`, `sm plugins doctor`, `sm history stats`,
`sm plugins show`. Section heading at indent 2, rows at indent 4:

```
  Section title
    label-1  value
    label-2  value

  Another section
    row-1   value
    row-2   value
```

- Pad labels to the longest in the section so values align.
- Sections separated by blank lines.
- Empty sections drop entirely — do NOT render `(none)` placeholders;
  the absence of a section IS the signal.

### 3.4. Table with footer

Used by `sm list`, `sm history`, `sm plugins list`, `sm orphans`. Two-
space row indent, dim header (`PATH KIND OUT IN ...`), dim metadata
columns, color on signal columns (`ISSUES > 0` yellow, `STATUS=failed`
red, etc.). No `-` separator under the header.

```
  HEADER1  HEADER2   HEADER3   ...
  row-1    cell      cell
  row-2    cell      cell

3 nodes
Tip: `sm show <path>` for details, `sm check` for issues.
```

Footer: blank line + count + dim tip line. Tip should point at the
next plausible verb the user might want.

Plural-correct the noun (`1 node` / `3 nodes`). The texts catalog
should expose `*FooterNounSingular` / `*FooterNounPlural` keys, never
`row(s)`-style parenthesised plurals.

### 3.5. Glyph row (issue list)

Used by `sm check`, `sm orphans`. Row is `<glyph>  <ruleId>  <message>`
with the rule-id column dim-padded to the longest in the rendered
set:

```
  filename.md
    ⚠  broken-ref   Broken invokes reference → /target
    ⚠  broken-ref   Broken mentions reference → @handle
```

- Group by file when multiple files surface (issue list).
- Strip `from <nodePath>` from the message when the path is already
  in the section header (sm check, sm show).
- Pad the rule-id column to the longest **across the rendered set**
  (not per-section) so columns line up between sections.

---

## 4. Texts catalog conventions

### 4.1. Templates carry a `{{glyph}}` placeholder

Move ANSI escapes out of templates — wrap the glyph at the call site:

```ts
// catalog
SUCCESS_LINE: '{{glyph}}  Done.\n',

// caller
this.printer!.data(tx(SUCCESS_LINE, { glyph: ansi.green('✓') }));
```

Templates stay color-free so a `--no-color` run reads the same bytes
modulo the wrapping. Keep section titles and labels as bare strings,
not `{{label}}` interpolations — they don't depend on data.

### 4.2. Catalog new keys, never inline

Do not split a stable string across `'literal' + tx(…)` — the i18n
catalog is the one place future-you greps. Even a small `(dry-run)`
suffix gets its own key (e.g. `dryRunTag: '  (dry-run)'`) so the
locale-extraction pass picks it up.

### 4.3. Pluralisation

Pair singular/plural noun keys explicitly:

```ts
fooNounSingular: 'row',
fooNounPlural: 'rows',
```

The renderer picks one based on `count === 1`. No `(s)` suffixes, no
`row${count !== 1 ? 's' : ''}` — those don't translate.

---

## 5. Path display

Render absolute paths under cwd as relative. Inline this helper while
the call sites are < 4; extract to `cli/util/path-display.ts` (or
similar) on the fourth caller:

```ts
import { isAbsolute, relative as pathRelative } from 'node:path';

function relativeIfBelow(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const rel = pathRelative(cwd, path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return path;
  return rel;
}
```

Existing inline copies live in `cli/commands/scan.ts` and
`cli/commands/db.ts`. `serve-banner.ts` has a near-identical
`formatDbPath` (same logic, slightly different sanitisation order) —
the day a fourth caller appears, fold the three into a single helper.

---

## 6. Sanitisation

Every plugin- or DB-sourced string that lands in the rendered output
runs through `sanitizeForTerminal()` from
`kernel/util/safe-text.ts` BEFORE interpolation:

- node paths, kinds, providers
- frontmatter values
- rule ids, issue messages, failure reasons
- extension ids, plugin ids

Sanitise once at the boundary (build a flat row shape, sanitise its
fields), not in every nested template — keeps the renderer focused
on layout and the gate auditable from one place. See `sm check`
(`renderHuman` in `cli/commands/check.ts`) and `sm show`
(`renderHeader` / `renderFieldBlock` in `cli/commands/show.ts`) for
the pattern.

---

## 7. JSON contract — never touched

`--json` paths are part of the published contract:

- The schema lives in `spec/schemas/`.
- Tests self-validate the output against AJV in many places
  (`sm scan --strict --json`, `sm history stats --json`).
- Downstream tooling parses it.

Color, glyphs, indentation, footer tips, section drops — none of it
changes the JSON path. When you redesign a verb, isolate the human
renderer (`renderHuman` / `renderTable` / etc.) so the JSON branch
stays a one-line `JSON.stringify(...)` next to it.

---

## 8. Exit codes & stderr discipline

Already canonical in `spec/cli-contract.md` — quoted here so the
human-render rules don't get confused with the contract:

- `printer.data(...)` → stdout (the result).
- `printer.info(...)` → stderr (banners, advisories), suppressed by
  `--quiet`.
- `printer.warn(...)` / `printer.error(...)` → stderr, never
  suppressed.
- `done in <…>` → stderr, suppressed by `--quiet`.

Glyph rules:

- `✕` on stderr for fatal-path messages emitted just before a non-Ok
  exit code. Don't put a glyph on every Clipanion parser error —
  those are handled centrally and don't follow the verb's renderer.
- `⚠` on stderr for non-blocking advisories (warnings).
- `✓` on stdout for the main success line.

---

## 9. Empty-state policy

**Don't print `(none)` placeholders inside a section** — drop the
section instead. The absence of a `Links in` block on `sm show`
signals "no incoming links" at a glance; `Links in (0)\n  (none)`
costs three lines for the same information.

**Empty result lists DO get a friendly line** (the result IS the
empty result), with a glyph:

- `✓  No issues.`
- `✓  No orphan / auto-rename issues.`
- `✓  No stale enrichment rows.`

---

## 10. Verbs done and their style anchors

When in doubt, copy the closest analogue:

| Verb | Style anchor |
|---|---|
| Single-line success | `sm db backup` (`cli/commands/db.ts`) |
| Head + body | `sm scan` (`cli/commands/scan.ts`) |
| Sectioned block | `sm config list` (`cli/commands/config.ts`) |
| Table with footer | `sm list` (`cli/commands/list.ts`) |
| Issue list grouped | `sm check` (`cli/commands/check.ts`) |
| Detail view | `sm show` (`cli/commands/show.ts`) |
| Aggregate stats | `sm history stats` (`cli/commands/history.ts`) |
| Plugin family | `sm plugins list` / `show` / `doctor` |

---

## 11. What this annex does NOT cover

- The **server banner** for `sm serve` (figlet logo). Lives in
  `cli/util/serve-banner.ts`; reused by `sm tutorial` via
  `renderLogoBlock`. Spec for that surface is the file itself.
- **Interactive prompts** (confirms on `db reset / restore`,
  `orphans undo-rename`). Format stays plain "Question?" — they're
  read by humans during the verb's flow, not as result output.
- **Migration progress** when the kernel auto-migrates on first
  open. That's a one-shot pre-flight emitted by `withSqlite`, not a
  verb-owned render.
- **Watcher batches** in `sm watch` / `sm scan --watch`. Has its own
  template (`WATCH_TEXTS.scannedSummary`); polishing pending.
