# CLI human output, style guide

Operating manual for **human-mode** output of every `sm` verb. The
analyzers here were extracted while polishing the in-CLI verbs in
2026-05; load this annex before you redesign or add a verb so the new
output stays in lock-step with the rest of the surface.

**Scope**: the `--json` path of every verb stays as-is, schemas and
shapes are part of the public contract. This annex governs only what
the user sees on stdout / stderr in interactive runs.

**Authority**: same level as `AGENTS.md` (Topical annexes table).
Where this annex and `AGENTS.md` collide, treat the spec / ROADMAP
order from AGENTS.md as authoritative; this is a presentation
contract, not a behavioural one.

---

## 1. Glyph catalog

Every glyph is rendered raw (not behind an env-flag) so the bytes
print in non-TTY pipes too. Color is gated separately, wrap the
glyph through the matching `IAnsi` method at the call site and the
no-color paths fall back to the bare character.

| Glyph | Color  | Meaning                                            |
|-------|--------|----------------------------------------------------|
| `✓`   | green  | Success, task done, exit 0                        |
| `✕`   | red    | Error / failure / disabled, exit ≠ 0 in many cases |
| `⚠`   | yellow | Warning / advisory, soft signal, may not gate exit |
| `ℹ`   | cyan   | Informational, neutral context                    |
| `⋯`   | yellow | Dry-run / "would do" preview                       |
| `→`   | dim    | Outgoing link / arrow                              |
| `←`   | dim    | Incoming link / arrow                              |

ANSI escapes (xterm 256-color), keep these raw, do NOT add a color
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
`resolveColorEnabled`, do NOT introduce a different analyzer.

When you need to forward "color enabled" past the CLI boundary (BFF,
core/runtime), pass a `colorEnabled?: boolean` field through the
options object, `core/` is forbidden from reading `process.env` per
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
- `✓  No stale enrichment rows.` (`sm enrich --stale` empty)
- `✓  Backup written: .skill-map/backups/<timestamp>.db`

### 3.1b. Error with hint, two-line block (preferred over single-line for actionable failures)

Whenever an error message has a clear "next step" (a flag the user
should pass, a command they should run first, the allowed values for a
rejected enum), use the two-line block:

```
  ✕  <headline, what failed>
     <hint, what to do about it>
```

- Glyph + headline: red `✕` followed by two spaces and the failure
  statement. Sentence-cased, no trailing period unless multi-sentence.
- Hint at indent 3, dim. One short sentence, the actionable next
  step. Long hints can wrap into two indented lines but no further.
- Templates expose two keys: `<key>` (the full block, with `{{glyph}}`
  and `{{hint}}`) and `<key>Hint` (the bare hint string the caller
  wraps in `ansi.dim(...)`). Keep the hint catalog-side so it stays
  greppable.

Examples (from `cli/i18n/*.texts.ts`):

```
✕  DB not found at .skill-map/skill-map.db
   Run `sm scan` first.
```

```
✕  Refusing to wipe a populated DB (11 rows in scan_*) with a zero-result scan.
   Pass --allow-empty to override. If this is unexpected, double-check the root paths.
```

```
✕  --kind: invalid value "foo".
   Allowed: orphan, medium, ambiguous.
```

```
✕  sm sidecars annotate: /abs/path.sm already exists
   Pass --force to overwrite.
```

The single-line `✕  <statement>` form (3.1) stays valid when there is
nothing actionable to add (parse-only failure, mutually-exclusive flag
combo with self-evident remedy). When in doubt, prefer 3.1b.

### 3.2. Header + indented body

For verbs that produce a result and a destination (scan, refresh,
reconcile, undo-rename):

```
  ✓  <count summary>   <duration>
     <body line>
```

Body line at indent 5, visually associates with the header glyph
column without competing for it.

### 3.3. Sectioned block (preferred for multi-section output)

Used by `sm config list`, `sm plugins doctor`, `sm history stats`,
`sm plugins list <id>` (per-plugin detail) and `sm plugins show <plugin>/<ext>`
(the narrower single-extension block). Section heading at indent 2, rows at
indent 4:

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
- Empty sections drop entirely, do NOT render `(none)` placeholders;
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

Used by `sm check`, `sm orphans`. Row is `<glyph>  <analyzerId>  <message>`
with the analyzer-id column dim-padded to the longest in the rendered
set:

```
  filename.md
    ⚠  broken-ref   Broken invokes reference → /target
    ⚠  broken-ref   Broken mentions reference → @handle
```

- Group by file when multiple files surface (issue list).
- Strip `from <nodePath>` from the message when the path is already
  in the section header (sm check, sm show).
- Pad the analyzer-id column to the longest **across the rendered set**
  (not per-section) so columns line up between sections.

---

## 4. Texts catalog conventions

### 4.1. Templates carry a `{{glyph}}` placeholder

Move ANSI escapes out of templates, wrap the glyph at the call site:

```ts
// catalog
SUCCESS_LINE: '{{glyph}}  Done.\n',

// caller
this.printer!.data(tx(SUCCESS_LINE, { glyph: ansi.green('✓') }));
```

Templates stay color-free so a `--no-color` run reads the same bytes
modulo the wrapping. Keep section titles and labels as bare strings,
not `{{label}}` interpolations, they don't depend on data.

### 4.2. Catalog new keys, never inline

Do not split a stable string across `'literal' + tx(…)`, the i18n
catalog is the one place future-you greps. Even a small `(dry-run)`
suffix gets its own key (e.g. `dryRunTag: '  (dry-run)'`) so the
locale-extraction pass picks it up.

### 4.2b. Error templates: pair `<key>` with `<key>Hint`

When the error follows the two-line block (§3.1b), expose two catalog
entries:

```ts
nodeNotFound:
  '{{glyph}}  Node not found: {{nodePath}}\n' +
  '   {{hint}}\n',
nodeNotFoundHint:
  'Run `sm scan` first, then retry with the path as it appears in `sm list`.',
```

Caller composes the two:

```ts
this.printer!.error(
  tx(ENRICH_TEXTS.nodeNotFound, {
    glyph: ansi.red('✕'),
    nodePath: this.nodePath,
    hint: ansi.dim(ENRICH_TEXTS.nodeNotFoundHint),
  }),
);
```

The hint key stays a bare string (no `{{glyph}}` or leading indent) so
the caller can `ansi.dim(...)` it cleanly and a non-TTY pipe gets the
plain hint text. If the hint itself needs interpolation (e.g.
`Allowed: {{allowed}}.`), the caller wraps the inner `tx(...)` in
`ansi.dim(...)`.

### 4.3. Pluralisation

Two catalog-side patterns are blessed (decision 2026-07-28, closing
the convention split the cli-architect review flagged); pick per key
and stay consistent within a verb:

1. **Paired noun keys**, the renderer picks one based on
   `count === 1`:

```ts
fooNounSingular: 'row',
fooNounPlural: 'rows',
```

2. **The `{{plural}}` slot**, the call site passes the suffix
   (`plural: count === 1 ? '' : 's'`) and the catalog embeds it:

```ts
fooSummary: '{{glyph}}  {{count}} finding{{plural}} cleared.\n',
```

The slot is the majority pattern across the verbs and fine for
regular `-s` plurals; use paired noun keys when the noun is irregular
(`entry` / `entries`) or the sentence changes shape around the count.
(The catalogs are English-only by design, AGENTS.md §Externalized
texts; translatability is not a criterion today.)

Still banned regardless of pattern: parenthesised `row(s)` forms, and
any plural composed INLINE in a command file
(`` `row${count !== 1 ? 's' : ''}` `` outside a catalog), the string
belongs in the `*.texts.ts` catalog either way.

---

## 5. Path display

Render absolute paths under cwd as relative. Use the shared helper at
`cli/util/path-display.ts`:

```ts
import { relativeIfBelow } from '../util/path-display.js';

const display = relativeIfBelow(absPath, defaultRuntimeContext().cwd);
```

Behaviour:

- Relative inputs pass through unchanged.
- Absolute inputs **under** `cwd` collapse to the short
  `.skill-map/...` form.
- Absolute inputs **outside** `cwd` (parents, siblings, different
  roots, Windows drives) keep their absolute form so the user is
  never confused about WHICH file the path points at.

Sanitise plugin- / DB-sourced paths with `sanitizeForTerminal()`
BEFORE calling, the helper is intentionally sanitisation-free so
callers compose the gate at the row-shape boundary (see §6).

`serve-banner.ts` keeps its own `formatDbPath` (sanitises the input
inline, used only by the figlet boot banner). It's the one carve-out;
every other CLI verb routes through `relativeIfBelow`.

---

## 6. Sanitisation

Every plugin- or DB-sourced string that lands in the rendered output
runs through `sanitizeForTerminal()` from
`kernel/util/safe-text.ts` BEFORE interpolation:

- node paths, kinds, providers
- frontmatter values
- analyzer ids, issue messages, failure reasons
- extension ids, plugin ids

Sanitise once at the boundary (build a flat row shape, sanitise its
fields), not in every nested template, keeps the renderer focused
on layout and the gate auditable from one place. See `sm check`
(`renderHuman` in `cli/commands/check.ts`), `sm show`
(`renderHeader` / `renderFieldBlock` in `cli/commands/show.ts`) and
the jobs family (`safeJobView` in `cli/commands/job-queue.ts`) for
the pattern.

**Payload-channel exemption** (decision 2026-07-28): a stdout stream
that IS the artifact does not sanitise, because byte fidelity is the
contract there. Exactly two cases today: `--json` bodies (§7 below)
and `sm graph` formatter output (dot / mermaid / a deliberately
ANSI-colored terminal format; the plugin trust gate governs who gets
to emit it). Human inspection surfaces are NOT payload channels even
when they print stored blobs: `sm jobs preview` sanitises its
rendered content (agents consume the byte-exact form via
`sm jobs claim --json`), and `sm plugins show` sanitises the prompt
template it renders (raw bytes ride `--json`). When adding a verb
that prints stored content, ask "is stdout here a machine artifact
or a human view?" and place it accordingly.

---

## 7. JSON contract, never touched

`--json` paths are part of the published contract:

- The schema lives in `spec/schemas/`.
- Tests self-validate the output against AJV in many places
  (`sm scan --strict --json`, `sm history stats --json`).
- Downstream tooling parses it.

Color, glyphs, indentation, footer tips, section drops, none of it
changes the JSON path. When you redesign a verb, isolate the human
renderer (`renderHuman` / `renderTable` / etc.) so the JSON branch
stays a one-line `JSON.stringify(...)` next to it.

---

## 8. Exit codes & stderr discipline

Already canonical in `spec/cli-contract.md`, quoted here so the
human-render analyzers don't get confused with the contract:

- `printer.data(...)` → stdout (the result).
- `printer.info(...)` → stderr (banners, advisories), suppressed by
  `--quiet`.
- `printer.warn(...)` / `printer.error(...)` → stderr, never
  suppressed.
- `done in <…>` → stderr, suppressed by `--quiet`.

Glyph analyzers:

- `✕` on stderr for fatal-path messages emitted just before a non-Ok
  exit code. Don't put a glyph on every Clipanion parser error,
  those are handled centrally and don't follow the verb's renderer.
- `⚠` on stderr for non-blocking advisories (warnings).
- `✓` on stdout for the main success line.

---

## 9. Empty-state policy

**Don't print `(none)` placeholders inside a section**, drop the
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
- The **update-available banner** emitted at BOOT, above the verb's
  output, when a newer `@skill-map/cli` is published on npm. Lives in
  `cli/util/update-check-banner.ts`. Renders as a 4-line boxed block,
  60-col wide, cyan border, bold cyan header `┌─ ⬇ Update available ─...`,
  body line 1 with the version transition (`current → latest`), body
  line 2 with the dim actionable hint, closing footer `└──────...`.
  Sample:
  ```
  ┌─ ⬇ Update available ──────────────────────────
  │  0.21.0 → 0.22.0
  │  Run `npm i -g @skill-map/cli@latest` to update.
  └────────────────────────────────────────────────
  ```
  Fires at most once per 24h and is silent on every failure mode (no
  DB, network down, opt-out via `SM_NO_UPDATE_CHECK=1` / `CI` /
  `updateCheck.enabled: false` / non-TTY stderr). `cli/entry.ts`
  injects the probe into the `boot` event payload (`runUpdateCheck`)
  and the `core/update-check` hook invokes it before `cli.run()`, so
  verb-owned renderers don't have to know about it.
- **Interactive prompts** (confirms on `db reset / restore`,
  `orphans undo-rename`). Format stays plain "Question?", they're
  read by humans during the verb's flow, not as result output. The one
  exception is the **first-run telemetry consent prompt**
  (`cli/telemetry/first-run-prompt.ts`): a one-time onboarding block that
  DOES adopt the verb-output style (cyan `ℹ` header, sectioned `[d]etails`
  with `→` / `✕` rows, `✓` / `ℹ` confirmation), composed through `IAnsi`
  like any verb renderer. Strings live in `cli/i18n/telemetry.texts.ts`.
- **Migration progress** when the kernel auto-migrates on first
  open. That's a one-shot pre-flight emitted by `withSqlite`, not a
  verb-owned render.
- **Watcher batches** in `sm watch` / `sm scan --watch`. Has its own
  template (`WATCH_TEXTS.scannedSummary`); polishing pending.

---

## 99. Compliance checklist (PR / new verb gate)

Before merging a PR that adds or modifies a CLI verb's human-mode
output, walk this checklist. Any "no" is a blocker until either
fixed or explicitly waived in the PR description with a reason.

**Strings catalog (`cli/i18n/*.texts.ts` and `core/runtime/i18n/*.texts.ts`)**

- [ ] Every error-shaped string (the verb exits non-zero on this
      branch) is structured per §3.1b: `'{{glyph}}  <headline>\n   {{hint}}\n'`,
      with a sibling `<key>Hint` entry carrying the bare hint string.
      Single-line `'{{glyph}}  <statement>'` is allowed ONLY when there
      is no actionable next step.
- [ ] Every warning-shaped string (verb keeps running but flags an
      advisory) carries `{{glyph}}` in column 0 followed by two
      spaces. The caller wraps with `ansi.yellow('⚠')` at the seam.
- [ ] Every success / completion string uses the matching glyph
      (`✓` green for success, `⋯` yellow for dry-run, `ℹ` cyan for
      informational). No emoji shortcuts (`✅` / `❌` are banned in
      the style guide).
- [ ] No em dashes (`—`) anywhere in catalog strings. The
      `no-restricted-syntax` lint rule in `src/eslint.config.js`
      blocks new ones at the seam; existing ones must use commas or
      parentheses.

**Emission sites (`cli/commands/*.ts`)**

- [ ] Glyphs are resolved through `this.ansiFor('stdout' | 'stderr')`
      and passed into `tx(...)` interpolation. Never hardcode ANSI
      escapes at the call site, always go through `IAnsi`.
- [ ] `printer.data()` for primary payload (stdout). `printer.info()`
      for banner / progress / status (stderr, suppressed under
      `--quiet`). `printer.warn()` and `printer.error()` for advisory
      and failure (stderr, always emitted). No `console.log` /
      `process.stderr.write` at the seam.
- [ ] Outer wrappers (`<verb>: {{message}}` shells) do NOT re-prefix a
      pre-rendered glyph when the inner message is already a §3.1b
      block. Either the outer or the inner adds the glyph, not both.
      The double-glyph regression is easy to introduce and hard to
      notice without a manual smoke run.

**Boundary discipline (`core/runtime/`, `server/`)**

- [ ] `core/runtime/` and `server/` MUST NOT read `process.env` for
      colour resolution. The CLI / BFF entry point resolves colour
      (via `ansiFor`) and threads either pre-rendered glyph strings
      OR an `IAnsi`-shaped value object into the runtime's options
      bag. The boundary lint enforces the no-`process.env` rule;
      the glyph contract enforces the rest.

**Quick smoke**

Before merging, run the verb in an interactive TTY and confirm:
1. The success path looks like one of the patterns in §3.1 / §3.2.
2. Each failure branch looks like §3.1b (glyph + headline + dim hint).
3. Each warning branch looks like §3.1 with the `⚠` glyph.
4. The `--no-color` flag (or `NO_COLOR=1`) strips ANSI without
   eating the glyph bytes (glyphs render raw, only colour gates).
5. The `--json` path is byte-identical regardless of TTY / colour
   (JSON shape is public contract; human-mode is not).
