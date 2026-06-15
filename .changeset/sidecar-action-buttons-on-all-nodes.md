---
"@skill-map/cli": minor
---

The inspector sidecar action buttons (Set stability, Edit tags, Bump) now project on every real (non-virtual) node, not only nodes that already have a `.sm` sidecar. The write creates the sidecar when absent (gated by the write-consent flow), so a node can get its first annotation straight from the inspector. Bump is enabled on a node with no sidecar (it creates one) or a stale sidecar, and disabled only on a fresh one. Synthetic nodes stay excluded since there is no file to anchor a `.sm`.

## User-facing

You can now set stability, edit tags, or bump any node straight from the inspector, even ones without a `.sm` yet. The action creates the sidecar for you, with the usual write consent.
