---
"@skill-map/cli": patch
---

Rendered markdown now passes raw HTML through a hardened sanitizer instead of escaping it at the parser, so `<details>`, `<div align>` and `<picture>` embeds render instead of showing as literal tags. Image rewriting moved from the markdown-it rule to a DOMPurify hook, so a raw `<img>` becomes the same click-to-load chip; the config drops the SVG and MathML profiles, forbids `video`, `audio`, `source` and `input`, strips anchor `target`, and voids forged chips.

## User-facing

**Markdown that uses HTML blocks now renders.** Collapsible sections, centered blocks, and chart or badge embeds show as intended instead of as raw tags, and images inside them get the same click-to-load placeholder as the rest: nothing is fetched until you click.
