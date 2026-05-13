---
"@skill-map/cli": patch
---

Polish the graph view's default edge look to match Foblex's `schema-designer` example:

- **Endpoint markers**: every connection now paints a small dot at the source and an arrow at the target (via `<f-connection-marker-circle>` + `<f-connection-marker-arrow>`). Both markers inherit the kind's `--ff-marker-color` so they always match the line.
- **Thinner strokes**: per-kind widths cut by ~40%, `invokes` 2.5 → 1.5, `references` 2 → 1.25, `mentions` 1.5 → 1, `supersedes` 2 → 1.25. The selection-highlight stays one step thicker than the base (3 → 2).
- **Muted hues**: edge colors desaturated in `styles.css` so the network reads as quiet reference layer instead of competing with node cards (kind hue still recognisable).

## User-facing

**Edge look refresh** — graph edges now show a small **dot at the start** and arrow at the end, with thinner strokes and softer colors. Kind colors (invokes / references / mentions / supersedes) are still distinct but no longer compete with the node cards for attention.
