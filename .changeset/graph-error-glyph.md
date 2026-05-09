---
"@skill-map/cli": patch
---

Polish `sm graph` error path: the `No formatter registered for format=…` message now opens with a red ✕ glyph, matching the rest of the CLI's error-line style. The successful render path is untouched — its output comes from the registered formatter (markdown-flavored ASCII), which is intentionally preserved as-is for diff-tool / pipe compatibility.
