---
"@skill-map/cli": patch
---

`sm history` and `sm history stats`: redesign the human renderers to match
the visual rhythm of the recent `sm scan` / `sm refresh` / `sm list` /
`sm config list` / `sm show` polish.

**`sm history` (table)** — old shape: a fixed 7-column flat-array layout
(`COL_WIDTHS`) with a `-`-separator row under the header. ISO timestamps
rendered with the literal `T` between date and time, the action column
truncated against a hard-coded slot, and no footer hint. New shape:

- Per-column widths are computed dynamically from the rendered set
  (header + data), with `COL_ID` capped at 26 and `COL_ACTION` at 28 so
  pathological ids don't blow the layout. Every other column is
  unbounded — single- and double-digit counts no longer reserve a 4-char
  slot.
- Rows carry a 2-space indent (`ROW_INDENT`) matching `sm list` /
  `sm plugins list`. The dash separator is gone.
- Headers render dim. Data cells: `id` plain, `started` dim, `action`
  plain, `status` colored (red on `failed`, yellow on `cancelled`, plain
  on `completed`), `duration` dim, `tokens` plain, `nodes` dim. Status
  cells preserve the `failed (timeout)` / `cancelled (user-cancelled)`
  shape composed at the boundary in `IHistoryRow` so colour applies to
  the whole cell.
- Started column swaps the ISO `T` for a space (`2026-04-30 10:00:00Z`)
  so the date / time pair reads as one human field rather than a
  machine token. JSON output is unchanged.
- Footer block: blank line, `<count> executions` (plural-correct via
  the new `tableFooterNoun*` keys), then a dim tip pointing at
  `sm history stats`.
- `DURATION` column header renamed to `DUR` to keep the column tight
  now that widths size to content. This is a label only — no flag, no
  JSON key.

**`sm history stats`** — old shape: free-prose lines (`Window: …`,
`Totals: …`, `Global error rate: …`) followed by sectioned headers
with un-aligned bullet rows (`Top actions by tokens:` /
`Top nodes:` / `Failures by reason:`) that always rendered even when
empty. New shape — sectioned, aligned, color-aware:

```
sm history stats — N executions · X failed · Y% error rate

  Window
    Since   <iso>
    Until   <iso>

  Totals
    Executions  N (X ok · Y failed · Z cancelled)
    Tokens      <in> in / <out> out
    Duration    <ms>

  Top actions (by tokens)
    <id>@<version>  N runs  ·  <in>/<out>

  Top nodes
    <path>  N runs

  Failures by reason
    <reason>  N
```

- One-line dense header (`statsHeader`) replaces the three-line
  Window/Totals/error-rate prose preamble. The summary co-locates
  count, failure count, and error rate so the operator sees the
  bottom line before scanning.
- Indented `Window` / `Totals` / `Top actions (by tokens)` /
  `Top nodes` / `Failures by reason` blocks built from
  `statsSectionHeader` + `statsFieldRow`. Field labels (`Since` /
  `Until` / `Executions` / `Tokens` / `Duration`) render dim and are
  padded to the longest visible label inside each section.
- The `Top actions` / `Top nodes` / `Failures by reason` sections
  drop entirely when their slice is empty — the old layout printed
  empty headers on a fresh DB. Run counts are plural-correct
  (`statsRunsSingular` / `statsRunsPlural`).
- `Executions` value composes a `N (X ok · Y failed · Z cancelled)`
  breakdown via `formatExecBreakdown`, with green / red / yellow on
  the populated buckets and zero buckets dropped. Token splits are
  dim. Failure counts in the breakdown render red.
- Helpers added: `renderStatsWindow`, `renderStatsTotals`,
  `formatExecBreakdown`, `renderStatsTopActions`, `renderStatsTopNodes`,
  `renderStatsFailures`, `trimMs` (drops `ms` suffix and swaps `T` for
  a space on ISO durations).

Color is wired through `ansiFor({ isTTY, noColorFlag })` for both
verbs — same precedence as the rest of the polished renderers (TTY
detection plus `--no-color`). The `--json`, `--since`, `--until`,
`--status`, `--top`, and `--period` paths are byte-identical to before
on both verbs; only the human paths are touched. The old
`// eslint-disable-next-line complexity` annotations are gone — the
new helpers are all under the cyclomatic limit.

Texts catalog: removed the old free-prose keys (`statsWindow`,
`statsTotals`, `statsGlobalErrorRate`, `statsTopActionsHeader`,
`statsTopNodesHeader`, `statsFailuresByReasonHeader`, and the
free-prose `Top*Row` shapes). Added `statsHeader`,
`statsSectionHeader`, `statsFieldRow`, the section-title and
field-label constants, the new column-aligned `statsTopActionsRow` /
`statsTopNodesRow` / `statsFailuresRow`, `statsExecutionsCount`,
`statsTokensSplit`, `statsRunsSingular` / `statsRunsPlural`, and the
table-footer keys (`tableFooterCount`, `tableFooterNounSingular`,
`tableFooterNounPlural`, `tableFooterTip`). `tableHeaderDuration`
shortened from `DURATION` to `DUR`.

Tests in `src/test/history-cli.test.ts` updated for the ISO
date-time separator swap (the column-collapse regression test now
matches `2026-MM-DD HH:MM:SSZ` instead of `2026-MM-DDT…`). Every
other history-cli assertion (`failed (timeout)` /
`cancelled (user-cancelled)` status composition, `No executions
found.`, `--json`, `--since`, `--status`, `--top`, `--period`, audit
H2 ANSI-strip) passes unchanged. No spec, kernel, or flag-surface
change; CLI reference output is identical.
