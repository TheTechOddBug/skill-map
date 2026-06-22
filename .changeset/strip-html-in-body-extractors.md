---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Body extractors now strip raw HTML (comments and tag tokens) before matching, alongside the existing code-region strip. A markdown link commented out as `<!-- [x](old.md) -->` or hidden in an attribute value (`<img alt="[x](y.md)">`) no longer produces a phantom edge. The strip is bounded to comments and tag tokens, so markdown nested inside a `<div>` block still resolves; `core/backtick-path` is unaffected (HTML is not a code region).

## User-facing

Scanning `.md` files that contain HTML no longer creates phantom links or false broken-reference warnings from links that were commented out or tucked inside HTML attributes.
