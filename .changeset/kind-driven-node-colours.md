---
"@skill-map/cli": patch
---

`<sm-node-card>` and `<sm-kind-palette>` hardcoded per-kind colours in CSS for only the four core kinds, so any Provider-declared kind (e.g. Antigravity's `workflow`) fell back to neutral markdown grey, icon included. The colour now comes from the kind: the node card binds `--accent` / `--kind-bg` / `--kind-fg` from the runtime kind registry's `--sm-kind-<kind>` vars and the palette binds the accent per button, so every Provider-declared kind paints its declared colour with no per-kind CSS.

## User-facing

**Provider kinds get their own colour.** Node kinds added by providers (for example Antigravity workflows) now show their declared colour in the graph and the kind filter, icon included, instead of falling back to grey.
