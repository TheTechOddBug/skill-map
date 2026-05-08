---
"@skill-map/cli": patch
---

`sm show`: redesign the human renderer to match the visual rhythm of
the recent `sm scan` / `sm check` / `sm refresh` / `sm list` /
`sm config list` polish.

Old shape: identity line `<path> [<kind>] (provider: <provider>)`,
stacked `title:`/`description:`/`stability:`/`version:` rows aligned
by hand-tuned label padding, `Weight: bytes …` and a continuation
`        tokens …` sharing one prose line, `External refs: N`,
`Frontmatter:` heading + indented JSON, `Links out (N, U unique):` /
`Links in (N, U unique):` headers with `(none)` placeholders when
empty, `- [<kind>/<confidence>] → <endpoint> (×N)  sources: a, b`
bullet lines, and an `Issues (N):` section with
`- [<severity>] <ruleId>: <message>` rows.

New shape — sectioned, aligned, color-aware:

```
  ✓  <path>   <kind>   provider: <provider>

  <Label>  <value>
  …

  Frontmatter
    { … }

  Links out (N)
    →  <kind>  <confidence>  <endpoint>  (×N)

  Issues (N)
    ⚠  <ruleId>   <message>
```

- One-line header with green `✓` glyph (mirrors `sm scan` /
  `sm refresh` outcome lines). The `provider: <provider>` tail is
  dim and elided when `provider === kind` — the universal-markdown
  fallback rendered `kind=markdown` next to `(provider: markdown)`,
  which was pure noise.
- Field block (`Title` / `Description` / `Stability` / `Version` /
  `Bytes` / `Tokens` / `External refs`) with dim labels and a label
  column padded to the longest visible label across the rendered
  subset. Multi-line values (typically long descriptions) wrap with
  continuation rows indented to the value column. Trailing
  whitespace-only lines from YAML block scalars (`description: |`
  ending in `\n`) are stripped so an empty continuation row never
  appears between fields. `Bytes` and `Tokens` use the unified
  `<total> total · <frontmatter> frontmatter · <body> body` shape;
  `Tokens` is gated on presence (still null for synthesizing
  Providers).
- `Frontmatter` always renders (the `{}` body conveys "no metadata"
  even when empty); the JSON body is dim.
- `Links out` / `Links in` sections drop entirely when the node has
  no edges in that direction — the old `(none)` placeholder was
  noise on already-clean nodes. When present, rows are
  column-aligned by kind + confidence widths within the section,
  arrow + confidence are dim, and the `(×N)` collapsed-row marker
  is dim. The `sources: a, b` tail is dropped from human output
  (still present in `--json`).
- `Issues` section drops when empty; rows mirror `sm check` —
  severity glyph (`✕` red / `⚠` yellow / `ℹ` cyan), dim ruleId
  padded to the longest ruleId in the section, message. Messages
  containing ` from <nodePath>` are trimmed because the path is
  already in the header — prose like "Broken X reference from
  <path> → <target>" reads as "Broken X reference → <target>",
  matching the trim already done by `sm check`.

Color is wired through `ansiFor({ isTTY, noColorFlag })` — same
precedence as `sm check` / `sm plugins list` / `sm serve` (TTY
detection plus `--no-color`). The grouping logic (`aggregateLinks`,
`IGroupedLink`) and the `--json` payload are unchanged. Tests in
`src/test/scan-readers.test.ts` updated to match the new shape:
glyph + path header, `Bytes` field row, `Links out (N)` count, and
`External refs  N` (field row, no colon). The `Links in` regex was
dropped because empty sections drop now and incoming-link presence
depends on the fixture. No spec, kernel, or flag-surface change;
CLI reference output is identical.
