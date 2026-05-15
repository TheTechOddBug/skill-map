---
'@skill-map/cli': patch
---

Rework the `sm tutorial` demo fixture (`sm-tutorial` skill) so the
Live UI block teaches the three link kinds (`mentions`, `invokes`,
`references`) from the syntax the tester writes. Step 3 now creates
four files instead of three, the extra node is a second
`markdown` (`notes/demo-guideline.md`) that gives the hub a real
`references` target. Step 5 collapses three separate file edits
into a single edit on `notes/todo.md`, which becomes the only
source of connectors in the demo: four bullets, one per target,
covering `@demo-agent` (`mentions`), `/demo-command` (`invokes`),
`/demo-skill` (`invokes`), and `[demo-guideline](./demo-guideline.md)`
(`references`). The downstream count references, the
`.skillmapignore` tree shown in Step 6, the deep-dive edit target
in Step 8, the `sm list` expected output in Step 9, the Provider
detection global substitution rule, and the start-over wipe list
all updated to match.

## User-facing

`sm tutorial` now teaches the three link kinds (`mentions`,
`invokes`, `references`) from the syntax you write in
`notes/todo.md`: `@handle`, `/slash`, and `[text](path)`. A new
`demo-guideline.md` node ships in the demo fixture as a real
target for `references` links.
