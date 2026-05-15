---
'@skill-map/web': patch
---

Align the plugin-ecosystem section on the landing with the canonical
kind order shipped by the kernel and surfaced by `sm plugins show`:
**provider, extractor, analyzer, action, formatter, hook**. Previously
the hexagonal satellite ring put `hook` before `formatter` walking
clockwise from the top (provider → extractor → analyzer → action →
hook → formatter), which disagreed with `EXTENSION_KINDS` in
`src/kernel/registry.ts` and with the new sorted output of `sm plugins
show <bundle>`. Swap involves three coordinated edits in
`web/index.html`: (a) the lower-left satellite at (143.5, 485) now
hosts the **Formatter** node and the upper-left satellite at
(143.5, 235) hosts the **Hook** node, glyph coordinates moved with
them; (b) the DOM order of `<g class="peco__sat">`,
`<g class="peco__line">`, and `<article class="peco__brief">` follows
the canonical sequence so the prev/next nav cycles in pipeline order;
(c) `web/i18n.json` reorders `pe.formatter.*` ahead of `pe.hook.*` for
file-level consistency. Pure repositioning, no copy or color changes,
the existing `peco__line` animation paths and CSS selectors target by
`data-pe-id` so nothing depends on the previous ordering.
