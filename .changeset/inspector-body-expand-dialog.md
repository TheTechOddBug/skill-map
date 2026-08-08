---
"@skill-map/cli": patch
---

The inspector's Body section adds an Expand button next to the Raw / Rendered toggle: it opens the full node body in a large modal dialog (node name in the header, same toggle flipping the shared session-sticky view, same rendered / raw content with no extra fetch). Because the dialog portals to `<body>`, the rendered-markdown prose rules and the dialog chrome moved from the inspector's scoped styles to global `ui/src/styles.css`; the card-vs-dialog layout split stays scoped.

## User-facing

**Read the whole document comfortably.** The inspector's Body section has a new Expand button that opens the full document in a large dialog, with the same Raw / Rendered switch in its header. The view you pick sticks for the session, in and out of the dialog.
