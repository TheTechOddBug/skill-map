---
'@skill-map/cli': minor
---

Broken-ref findings now carry a hint when a same-named file exists on
disk but does not advertise `name:` in its frontmatter. Common case:
the author writes `@c` (or `/c`) expecting it to resolve to
`.claude/agents/c.md`, but the agent's frontmatter is missing the
`name: c` line, so trigger resolution falls through.

**`core/broken-ref` (`src/plugins/core/analyzers/broken-ref/index.ts`):**

- New side index `byBasenameWithoutName`, keyed by
  `normalizeTrigger(basename(node.path, ext))`, including only nodes
  whose `frontmatter.name` is absent or empty. Built in the same
  single pass as `byNormalizedName`, no extra walk.
- When a trigger-style link (`@x` / `/x`) fails to resolve, the rule
  now consults the basename index and, if a candidate exists, the
  emitted issue carries:
  - `data.hint = { kind: 'missing-frontmatter-name', suggestedName,
    candidates: string[] }`, structured payload for the UI / API
    consumers (e.g. clickable file rows).
  - `fix = { summary, autofixable: false }`, prose copy ready for
    CLI / JSON output. Two templates: single candidate vs many.
- Path-style links and trigger-style links without a candidate are
  unchanged. Existing finding shape stays additive.

**Texts (`src/plugins/core/analyzers/broken-ref/text.ts`):**

- New `hintSummarySingle` / `hintSummaryMany` templates. Same
  externalized-string discipline as the surrounding catalog.

**Tests (`__tests__/broken-ref-trigger-resolution.spec.ts`):**

- New describe block "hint when a same-named file lacks
  frontmatter.name" with 5 cases: `@c` + single candidate, `/c` +
  single candidate (slash sigil parity), unresolved trigger without
  candidate (regression guard), two candidates with the same basename
  (plural summary), and a file that advertises a different `name`
  (must NOT surface as a hint).

The `issue.schema.json` shape already permitted both `data.*` (free)
and `fix.{summary,autofixable}` (experimental), so no spec edit is
required for this addition.

## User-facing

When `@foo` or `/foo` fails to resolve and a file `foo.md` exists nearby without `name:` in its frontmatter, broken-ref now suggests adding `name: foo` to that file. The hint appears in `sm check`, `sm show`, and the inspector panel.
