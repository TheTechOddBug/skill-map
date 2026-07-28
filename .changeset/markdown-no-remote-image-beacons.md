---
"@skill-map/cli": patch
---

The rendered-markdown sanitizer now forbids `img` outright. Markdown bodies are author-controlled (a cloned repo's files, sidecar annotations, agent-written prompts), so `![x](https://attacker/pixel.png)` fired an outbound request the moment the operator opened the node, leaking their IP and view timing to the content author, the same beacon channel `css-guard.ts` already refuses for `url(...)`. Deliberate trade: an image in a body disappears instead of degrading to alt text.

## User-facing

**Images in rendered markdown are no longer loaded.** Opening a file from a repo you cloned can no longer tell its author your IP address or when you read it. The trade-off: an image embedded in a document body now disappears instead of rendering.
