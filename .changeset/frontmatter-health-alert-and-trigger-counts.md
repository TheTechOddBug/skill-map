---
"@skill-map/cli": patch
---

Three related fixes around graph link semantics and node health surfacing.

**Trigger-style edges now resolve to their target node consistently.** The
`slash` and `at-directive` extractors emit bare-name targets (`/full-agent`,
`@release-broker`). The graph layout and `core/link-counts` analyzer both
indexed lookup by `frontmatter.name`, so when the destination node had a
broken or empty `frontmatter.name` (typical cause: a YAML parse error on
the destination's own frontmatter), the edge was dropped from the rendered
graph AND the destination's `linksIn` chip stayed at zero. Both sides now
share a `pathBasenameForLink` fallback: `buildNameIndex` indexes nodes by
canonical `frontmatter.name` first, then by path basename as a fallback,
first-wins so the canonical name keeps priority when it exists. Ported
from `ui/src/services/trigger-resolve.ts` into a new
`src/kernel/util/trigger-resolve.ts` so kernel analyzers and the UI agree
on resolution rules. Deliberately NOT applied to `core/broken-ref`: its
contract remains "warn when the target is not resoluble by canonical
`frontmatter.name`", relaxing it would mask files whose frontmatter is
actually broken.

**`core/validate-all` now declares `viewContributions` for a frontmatter
health alert.** Adds a `graph.node.alert` badge plus a
`card.footer.right` chip (`danger` severity, same chassis as
`core/broken-ref`) that surfaces on vendor-provider nodes (`claude`,
`gemini`, `agent-skills`) whose `frontmatter` block was emitted with
non-zero bytes but is missing `name` or `description`. The catch-all
`markdown` provider is excluded so plain `README.md` / `CHANGELOG.md`
files never get flagged, and nodes with `bytes.frontmatter === 0` (no
frontmatter block at all) are also skipped, the alert means "you
authored a frontmatter block and it parsed badly", not "you forgot to
write one". Finding severity stays `warn` so `sm scan` exit code is
unaffected; the rendered chip/alert use `danger` so the UI badge reads
red. Per-node aggregation mirrors `broken-ref` so a node with two
failing checks surfaces a single alert with `count: 2`.

**Node-card title falls back to path basename when frontmatter.name is
empty.** Previously the card showed the raw path (`full-agent-gemini.md`
or the full relative path); now it shows the derived stable basename
(`full-agent-gemini`), reusing the same helper as the trigger resolver
so card text and edge resolution stay in sync.

Also: UI polish on the link-kind palette (host now stretches to the
kind-palette width, grid `1fr 1fr`, two-line tooltips with verbatim
syntax examples), `--sm-edge-supersedes` recoloured from purple to
grey across light/dark, supersedes connector solid (was dashed; the
grey already carries the lifecycle signal). Docs cleanup post the
annotations-catalog trim: a stale `conflictsWith` example in
`ROADMAP.md` / `spec/README.md` is now `supersededBy`, and
`spec/plugin-author-guide.md` says "10 conventional fields", matching
the current catalog size. 30 new tests across kernel (link-counts
trigger resolution, validate-all frontmatter base check) and UI
(trigger-resolve helpers).

## User-facing

**Broken frontmatter now lights up on the graph.** Vendor agent/skill
nodes missing `name` or `description` show a red alert badge and a
matching footer chip, same chassis as broken references. Trigger-style
links (`/cmd`, `@handle`) now also tally into the target's `linksIn`.
